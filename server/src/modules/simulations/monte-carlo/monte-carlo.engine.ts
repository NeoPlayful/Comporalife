import {
  MONTE_CARLO_HISTOGRAM_BINS,
  MONTE_CARLO_SAMPLE_PATHS,
} from '../../../config/constants.js';
import { percentile } from '../../../lib/percentile.js';
import type { Matrix } from './correlation.js';
import { NormalSampler, Xoshiro128, pathSeed } from './random.js';

export const MODEL_VERSION = 'montecarlo-v1';

export type Rebalance = 'none' | 'monthly' | 'quarterly' | 'annual';
export type Frequency = 'none' | 'monthly' | 'annual';
export type Timing = 'begin' | 'end';

export interface MonteCarloAsset {
  key: string;
  label: string;
  /** 合计必须为 1 */
  weight: number;
  expectedAnnualReturn: number;
  annualVolatility: number;
}

export interface MonteCarloInput {
  years: number;
  pathCount: number;
  seed: number;
  rebalance: Rebalance;
  assets: MonteCarloAsset[];
  /** 已通过校验的下三角矩阵，n × n */
  cholesky: Matrix;

  initialValue: number;
  contribution: { amount: number; frequency: Frequency; timing: Timing };
  withdrawal: { amount: number; frequency: Frequency; startYear: number };
  inflationRate: number;
  feeRate: number;
  targetAmount: number | null;
}

export interface QuantileSet {
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  mean: number;
  sd: number;
}

export interface YearBand {
  year: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface MonteCarloResult {
  terminal: { nominal: QuantileSet; real: QuantileSet };
  contributed: { nominal: QuantileSet; real: QuantileSet };
  /** 名义终值均值的标准误，用于判断样本是否足够 */
  standardError: number;
  probabilities: {
    /** 名义终值低于累计投入 */
    loss: number;
    /** 实际终值（通胀折算后）低于实际累计投入 */
    realLoss: number;
    /** 未设目标时为 null，绝不返回 0 */
    target: number | null;
    /** 期末前触及 0 */
    ruin: number;
  };
  drawdown: { p50: number; p90: number; p99: number; mean: number };
  yearlyBands: YearBand[];
  histogram: { min: number; max: number; bins: number[] };
  samplePaths: Array<{ index: number; values: number[] }>;
  /** 确定性压力情景时为 true，此时不含概率语义 */
  deterministic: boolean;
}

export interface EngineHooks {
  /** 每片处理完回调，参数为已处理路径数 */
  onChunk?: (processedPaths: number) => void | Promise<void>;
  /** 返回 true 时中断并返回 cancelled */
  shouldCancel?: () => boolean | Promise<boolean>;
}

export type SimulateOutcome =
  | { ok: true; result: MonteCarloResult }
  | { ok: false; cancelled: true };

/** 每月实际投入金额 */
function monthlyContribution(input: MonteCarloInput, monthOfYear: number): number {
  const { contribution } = input;
  if (contribution.frequency === 'none') return 0;
  if (contribution.frequency === 'monthly') return contribution.amount;
  // 年付落在每年第一个月，与复利引擎同一约定
  return monthOfYear === 0 ? contribution.amount : 0;
}

function monthlyWithdrawal(input: MonteCarloInput, yearIndex: number, monthOfYear: number): number {
  const { withdrawal } = input;
  if (withdrawal.frequency === 'none') return 0;
  if (yearIndex + 1 < withdrawal.startYear) return 0;
  if (withdrawal.frequency === 'monthly') return withdrawal.amount;
  return monthOfYear === 0 ? withdrawal.amount : 0;
}

function shouldRebalance(rebalance: Rebalance, monthOfYear: number): boolean {
  switch (rebalance) {
    case 'none':
      return false;
    case 'monthly':
      return true;
    case 'quarterly':
      return monthOfYear % 3 === 2;
    case 'annual':
      return monthOfYear === 11;
    default:
      return false;
  }
}

interface Precomputed {
  n: number;
  months: number;
  monthlyDrift: number[];
  monthlyVol: number[];
  cholesky: Matrix;
  feeMonthly: number;
  /** 各资产的月收益乘数由每次抽样决定，这里只预计算不随路径变化的部分 */
}

function precompute(input: MonteCarloInput): Precomputed {
  const n = input.assets.length;

  const monthlyDrift = input.assets.map((asset) => {
    const volMonthly = asset.annualVolatility / Math.sqrt(12);
    // 减去 σ²/2 保证零波动时退化到 (1+R)^(1/12)−1，
    // 否则波动会把期望收益系统性抬高，用户会看到比输入更高的收益率
    return Math.log(1 + asset.expectedAnnualReturn) / 12 - (volMonthly * volMonthly) / 2;
  });

  const monthlyVol = input.assets.map((asset) => asset.annualVolatility / Math.sqrt(12));

  return {
    n,
    months: input.years * 12,
    monthlyDrift,
    monthlyVol,
    cholesky: input.cholesky,
    feeMonthly: 1 - Math.pow(1 - input.feeRate, 1 / 12),
  };
}

interface PathOutcome {
  terminalValue: number;
  contributed: number;
  maxDrawdown: number;
  depleted: boolean;
  yearlyValues: number[];
}

/**
 * 跑一条路径。
 * 每月顺序：期初投入 → 收益 → 费用 → 期末投入 → 再平衡。
 * 期初/期末只影响现金流量相对收益的位置，与复利引擎的 begin/end 语义对齐。
 * 引擎不读时钟、不访问数据库，相同输入必得相同输出。
 */
function simulatePath(
  input: MonteCarloInput,
  pre: Precomputed,
  pathIndex: number,
): PathOutcome {
  const rng = new Xoshiro128(pathSeed(input.seed, pathIndex));
  const sampler = new NormalSampler(rng);

  const weights = input.assets.map((asset) => asset.weight);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const normalized = totalWeight > 0 ? weights.map((w) => w / totalWeight) : new Array(pre.n).fill(1 / pre.n);

  const assetValues = new Array<number>(pre.n);
  for (let i = 0; i < pre.n; i += 1) assetValues[i] = input.initialValue * normalized[i]!;

  let portfolioValue = input.initialValue;
  let contributed = input.initialValue;

  // 回撤基于增长指数而非账户值：持续定投会掩盖回撤
  let growthIndex = 1;
  let peakIndex = 1;
  let maxDrawdown = 0;

  let depleted = false;
  const normalBuffer = new Array<number>(pre.n);
  const correlated = new Array<number>(pre.n);
  const yearlyValues: number[] = [];

  for (let yearIndex = 0; yearIndex < input.years; yearIndex += 1) {
    for (let monthOfYear = 0; monthOfYear < 12; monthOfYear += 1) {
      const contribution = monthlyContribution(input, monthOfYear);
      const withdrawal = monthlyWithdrawal(input, yearIndex, monthOfYear);
      const timing = input.contribution.timing;

      if (timing === 'begin') {
        applyFlows(assetValues, normalized, contribution, withdrawal, depleted);
        if (!depleted) contributed += contribution;
        portfolioValue = sumAssets(assetValues);
        if (portfolioValue <= 0) {
          depleted = true;
          portfolioValue = 0;
        }
      }

      // 抽样与相关性：z = L · u
      for (let i = 0; i < pre.n; i += 1) normalBuffer[i] = sampler.next();
      for (let i = 0; i < pre.n; i += 1) {
        let sum = 0;
        for (let k = 0; k <= i; k += 1) sum += pre.cholesky[i]![k]! * normalBuffer[k]!;
        correlated[i] = sum;
      }

      const beforeGrowth = portfolioValue;
      for (let i = 0; i < pre.n; i += 1) {
        const grossReturn = Math.exp(pre.monthlyDrift[i]! + pre.monthlyVol[i]! * correlated[i]!);
        assetValues[i] = assetValues[i]! * grossReturn;
      }

      const afterGrowth = sumAssets(assetValues);

      // 增长指数只反映投资收益，与投入/提款无关
      if (beforeGrowth > 0 && afterGrowth > 0) {
        growthIndex *= afterGrowth / beforeGrowth;
        if (growthIndex > peakIndex) peakIndex = growthIndex;
        const drawdown = peakIndex > 0 ? 1 - growthIndex / peakIndex : 0;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      }

      // 费用按比例摊到各资产，保持资产值之和等于组合总值
      const keepRatio = 1 - pre.feeMonthly;
      for (let i = 0; i < pre.n; i += 1) assetValues[i] = assetValues[i]! * keepRatio;
      portfolioValue = afterGrowth * keepRatio;

      if (timing === 'end') {
        applyFlows(assetValues, normalized, contribution, withdrawal, depleted);
        if (!depleted) contributed += contribution;
        portfolioValue = sumAssets(assetValues);
        if (portfolioValue <= 0) {
          depleted = true;
          portfolioValue = 0;
        }
      }

      if (depleted) {
        for (let i = 0; i < pre.n; i += 1) assetValues[i] = 0;
      } else if (shouldRebalance(input.rebalance, monthOfYear)) {
        for (let i = 0; i < pre.n; i += 1) assetValues[i] = portfolioValue * normalized[i]!;
      }
    }

    yearlyValues.push(portfolioValue);
  }

  return { terminalValue: portfolioValue, contributed, maxDrawdown, depleted, yearlyValues };
}

function sumAssets(assetValues: number[]): number {
  let total = 0;
  for (const value of assetValues) total += value;
  return total;
}

/**
 * 现金流作用于各资产：投入按目标权重分配，提款按当前市值占比扣减。
 * 破产后不再接受投入，避免「先破产再复活」的失真结果。
 */
function applyFlows(
  assetValues: number[],
  normalized: number[],
  contribution: number,
  withdrawal: number,
  depleted: boolean,
): void {
  if (depleted) return;

  if (contribution > 0) {
    for (let i = 0; i < assetValues.length; i += 1) {
      assetValues[i] = assetValues[i]! + contribution * normalized[i]!;
    }
  }

  if (withdrawal > 0) {
    const total = sumAssets(assetValues);
    if (total <= 0) return;

    for (let i = 0; i < assetValues.length; i += 1) {
      const share = assetValues[i]! / total;
      assetValues[i] = Math.max(0, assetValues[i]! - withdrawal * share);
    }
  }
}

function quantileSet(values: Float64Array): QuantileSet {
  const sorted = Array.from(values).sort((a, b) => a - b);
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  const variance = sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / sorted.length;

  return {
    p5: percentile(sorted, 0.05) ?? 0,
    p10: percentile(sorted, 0.1) ?? 0,
    p25: percentile(sorted, 0.25) ?? 0,
    p50: percentile(sorted, 0.5) ?? 0,
    p75: percentile(sorted, 0.75) ?? 0,
    p90: percentile(sorted, 0.9) ?? 0,
    p95: percentile(sorted, 0.95) ?? 0,
    mean,
    sd: Math.sqrt(variance),
  };
}

/**
 * 一段路径区间的原始结果。
 * 分片执行时每片返回一个 batch，聚合必须等全部 batch 到齐后再统一做——
 * 各片各自取分位数再合并会得到统计上错误的结果。
 */
export interface PathBatch {
  startIndex: number;
  count: number;
  terminal: Float64Array;
  real: Float64Array;
  contributed: Float64Array;
  drawdowns: Float64Array;
  depleted: Uint8Array;
  /** [yearIndex][pathInBatch] */
  yearly: Float64Array[];
  samplePaths: Array<{ index: number; values: number[] }>;
}

/** 同步跑 [start, end) 区间的路径，不含聚合。不读时钟、不访问外部。 */
export function simulatePaths(input: MonteCarloInput, start: number, end: number): PathBatch {
  const pre = precompute(input);
  const count = Math.max(0, end - start);

  const terminal = new Float64Array(count);
  const real = new Float64Array(count);
  const contributed = new Float64Array(count);
  const drawdowns = new Float64Array(count);
  const depleted = new Uint8Array(count);
  const yearly = Array.from({ length: input.years }, () => new Float64Array(count));

  const deflator = Math.pow(1 + input.inflationRate, input.years);
  const sampleIndexes = sampleIndexSet(input.pathCount, start, end);
  const samplePaths: Array<{ index: number; values: number[] }> = [];

  for (let local = 0; local < count; local += 1) {
    const pathIndex = start + local;
    const outcome = simulatePath(input, pre, pathIndex);

    terminal[local] = outcome.terminalValue;
    real[local] = deflator > 0 ? outcome.terminalValue / deflator : outcome.terminalValue;
    contributed[local] = outcome.contributed;
    drawdowns[local] = outcome.maxDrawdown;
    if (outcome.depleted) depleted[local] = 1;

    for (let y = 0; y < input.years; y += 1) {
      yearly[y]![local] = outcome.yearlyValues[y] ?? outcome.terminalValue;
    }

    if (sampleIndexes.has(pathIndex)) {
      samplePaths.push({ index: pathIndex, values: outcome.yearlyValues });
    }
  }

  return { startIndex: start, count, terminal, real, contributed, drawdowns, depleted, yearly, samplePaths };
}

/**
 * 单条路径的完整月度序列，用于路径接口按索引再生成。
 * 与批量模拟共用同一 pathSeed，因此结果与全量运行中的该路径完全一致。
 */
export function simulateSinglePath(
  input: MonteCarloInput,
  pathIndex: number,
): { monthly: number[]; yearly: number[] } {
  const pre = precompute(input);
  const rng = new Xoshiro128(pathSeed(input.seed, pathIndex));
  const sampler = new NormalSampler(rng);

  const weights = input.assets.map((asset) => asset.weight);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const normalized = totalWeight > 0 ? weights.map((w) => w / totalWeight) : new Array(pre.n).fill(1 / pre.n);

  const assetValues = new Array<number>(pre.n);
  for (let i = 0; i < pre.n; i += 1) assetValues[i] = input.initialValue * normalized[i]!;

  let portfolioValue = input.initialValue;
  let depleted = false;

  const normalBuffer = new Array<number>(pre.n);
  const correlated = new Array<number>(pre.n);
  const monthly: number[] = [];
  const yearly: number[] = [];

  for (let yearIndex = 0; yearIndex < input.years; yearIndex += 1) {
    for (let monthOfYear = 0; monthOfYear < 12; monthOfYear += 1) {
      const contribution = monthlyContribution(input, monthOfYear);
      const withdrawal = monthlyWithdrawal(input, yearIndex, monthOfYear);

      if (input.contribution.timing === 'begin') {
        applyFlows(assetValues, normalized, contribution, withdrawal, depleted);
        portfolioValue = sumAssets(assetValues);
        if (portfolioValue <= 0) depleted = true;
      }

      for (let i = 0; i < pre.n; i += 1) normalBuffer[i] = sampler.next();
      for (let i = 0; i < pre.n; i += 1) {
        let sum = 0;
        for (let k = 0; k <= i; k += 1) sum += pre.cholesky[i]![k]! * normalBuffer[k]!;
        correlated[i] = sum;
      }

      const keepRatio = 1 - pre.feeMonthly;
      for (let i = 0; i < pre.n; i += 1) {
        assetValues[i] =
          assetValues[i]! * Math.exp(pre.monthlyDrift[i]! + pre.monthlyVol[i]! * correlated[i]!) * keepRatio;
      }

      if (input.contribution.timing === 'end') {
        applyFlows(assetValues, normalized, contribution, withdrawal, depleted);
        if (portfolioValue <= 0) depleted = true;
      }

      portfolioValue = depleted ? 0 : sumAssets(assetValues);
      if (depleted) {
        for (let i = 0; i < pre.n; i += 1) assetValues[i] = 0;
      } else if (shouldRebalance(input.rebalance, monthOfYear)) {
        for (let i = 0; i < pre.n; i += 1) assetValues[i] = portfolioValue * normalized[i]!;
      }

      monthly.push(portfolioValue);
    }

    yearly.push(portfolioValue);
  }

  return { monthly, yearly };
}

/**
 * 采样路径的索引集合由 (seed, pathCount) 决定，与分片边界无关。
 * 否则改一下 chunkSize 就会让「同种子的样本路径」也跟着变。
 */
function sampleIndexSet(pathCount: number, start: number, end: number): Set<number> {
  const total = Math.min(MONTE_CARLO_SAMPLE_PATHS, pathCount);
  const result = new Set<number>();

  for (let i = 0; i < total; i += 1) {
    const index = Math.floor((i * pathCount) / total);
    if (index >= start && index < end) result.add(index);
  }

  return result;
}

/** 把任意多个 batch 合并成一个连续数组视图所需的数据 */
function concatBatches(input: MonteCarloInput, batches: PathBatch[]): {
  terminal: Float64Array;
  real: Float64Array;
  contributed: Float64Array;
  drawdowns: Float64Array;
  depleted: Uint8Array;
  yearly: Float64Array[];
  samplePaths: Array<{ index: number; values: number[] }>;
} {
  const total = batches.reduce((sum, batch) => sum + batch.count, 0);

  const terminal = new Float64Array(total);
  const real = new Float64Array(total);
  const contributed = new Float64Array(total);
  const drawdowns = new Float64Array(total);
  const depleted = new Uint8Array(total);
  const yearly = Array.from({ length: input.years }, () => new Float64Array(total));
  const samplePaths: Array<{ index: number; values: number[] }> = [];

  let offset = 0;
  for (const batch of batches) {
    terminal.set(batch.terminal, offset);
    real.set(batch.real, offset);
    contributed.set(batch.contributed, offset);
    drawdowns.set(batch.drawdowns, offset);
    depleted.set(batch.depleted, offset);
    for (let y = 0; y < input.years; y += 1) {
      yearly[y]!.set(batch.yearly[y]!, offset);
    }
    samplePaths.push(...batch.samplePaths);
    offset += batch.count;
  }

  samplePaths.sort((a, b) => a.index - b.index);
  return { terminal, real, contributed, drawdowns, depleted, yearly, samplePaths };
}

/** 统一聚合：分位数、概率、回撤、年度带、直方图。 */
export function aggregatePaths(input: MonteCarloInput, batches: PathBatch[]): MonteCarloResult {
  const data = concatBatches(input, batches);
  const pathCount = data.terminal.length;

  const terminalNominal = quantileSet(data.terminal);
  const terminalReal = quantileSet(data.real);
  const contributedNominal = quantileSet(data.contributed);

  const deflator = Math.pow(1 + input.inflationRate, input.years);
  const realDeflator = deflator > 0 ? deflator : 1;
  const contributedRealValues = new Float64Array(pathCount);
  for (let i = 0; i < pathCount; i += 1) {
    contributedRealValues[i] = data.contributed[i]! / realDeflator;
  }
  const contributedReal = quantileSet(contributedRealValues);

  let lossCount = 0;
  let realLossCount = 0;
  let targetCount = 0;
  let ruinCount = 0;

  for (let i = 0; i < pathCount; i += 1) {
    if (data.terminal[i]! < data.contributed[i]!) lossCount += 1;
    if (data.real[i]! < contributedRealValues[i]!) realLossCount += 1;
    if (input.targetAmount !== null && data.terminal[i]! >= input.targetAmount) targetCount += 1;
    if (data.depleted[i] === 1) ruinCount += 1;
  }

  const yearlyBands: YearBand[] = data.yearly.map((column, index) => {
    const sorted = Array.from(column).sort((a, b) => a - b);
    return {
      year: index + 1,
      p10: percentile(sorted, 0.1) ?? 0,
      p25: percentile(sorted, 0.25) ?? 0,
      p50: percentile(sorted, 0.5) ?? 0,
      p75: percentile(sorted, 0.75) ?? 0,
      p90: percentile(sorted, 0.9) ?? 0,
    };
  });

  const drawdownList = Array.from(data.drawdowns).sort((a, b) => a - b);
  const drawdownMean = drawdownList.reduce((sum, v) => sum + v, 0) / drawdownList.length;

  return {
    terminal: { nominal: terminalNominal, real: terminalReal },
    contributed: { nominal: contributedNominal, real: contributedReal },
    standardError: pathCount > 0 ? terminalNominal.sd / Math.sqrt(pathCount) : 0,
    probabilities: {
      loss: pathCount > 0 ? lossCount / pathCount : 0,
      realLoss: pathCount > 0 ? realLossCount / pathCount : 0,
      target: input.targetAmount === null ? null : pathCount > 0 ? targetCount / pathCount : 0,
      ruin: pathCount > 0 ? ruinCount / pathCount : 0,
    },
    drawdown: {
      p50: percentile(drawdownList, 0.5) ?? 0,
      p90: percentile(drawdownList, 0.9) ?? 0,
      p99: percentile(drawdownList, 0.99) ?? 0,
      mean: drawdownMean,
    },
    yearlyBands,
    histogram: buildHistogram(data.terminal),
    samplePaths: data.samplePaths,
    deterministic: false,
  };
}

/**
 * 一次性跑完全部路径并聚合。
 * 纯函数：相同输入必得相同输出；进度与取消通过 hooks 注入，引擎不感知 HTTP 与数据库。
 */
export async function simulate(
  input: MonteCarloInput,
  hooks: EngineHooks = {},
): Promise<SimulateOutcome> {
  const batches: PathBatch[] = [];
  const chunkSize = Math.max(1, Math.floor(input.pathCount / 20));

  for (let start = 0; start < input.pathCount; start += chunkSize) {
    if (hooks.shouldCancel) {
      const cancelled = await hooks.shouldCancel();
      if (cancelled) return { ok: false, cancelled: true };
    }

    const end = Math.min(input.pathCount, start + chunkSize);
    batches.push(simulatePaths(input, start, end));

    if (hooks.onChunk) await hooks.onChunk(end);
  }

  return { ok: true, result: aggregatePaths(input, batches) };
}

/**
 * 终值直方图。
 * 桶边界随运行确定，保证历史结果可复现；两次遍历让 min/max 与计数口径一致。
 */
export function buildHistogram(values: Float64Array, binCount = MONTE_CARLO_HISTOGRAM_BINS): {
  min: number;
  max: number;
  bins: number[];
} {
  if (values.length === 0) return { min: 0, max: 0, bins: new Array(binCount).fill(0) };

  let min = Infinity;
  let max = -Infinity;

  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (min === max) {
    const bins = new Array<number>(binCount).fill(0);
    bins[0] = values.length;
    return { min, max, bins };
  }

  const width = (max - min) / binCount;
  const bins = new Array<number>(binCount).fill(0);

  for (const value of values) {
    const index = Math.min(binCount - 1, Math.floor((value - min) / width));
    bins[index]! += 1;
  }

  return { min, max, bins };
}
