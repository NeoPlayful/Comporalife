import type { MonteCarloResult, QuantileSet } from './monte-carlo.engine.js';
import type { NormalizedScenario } from './scenario.validation.js';

function num(value: number): string {
  // 金额与比率统一 6 位小数、字符串输出，避免 JSON 数字精度丢失与前端显示抖动
  return value.toFixed(6);
}

function quantiles(set: QuantileSet): Record<string, string> {
  return {
    p5: num(set.p5),
    p10: num(set.p10),
    p25: num(set.p25),
    p50: num(set.p50),
    p75: num(set.p75),
    p90: num(set.p90),
    p95: num(set.p95),
    mean: num(set.mean),
    sd: num(set.sd),
  };
}

export function serializeResult(result: MonteCarloResult) {
  return {
    terminal: {
      nominal: quantiles(result.terminal.nominal),
      real: quantiles(result.terminal.real),
    },
    contributed: {
      nominal: quantiles(result.contributed.nominal),
      real: quantiles(result.contributed.real),
    },
    standardError: num(result.standardError),
    probabilities: {
      loss: num(result.probabilities.loss),
      realLoss: num(result.probabilities.realLoss),
      target: result.probabilities.target === null ? null : num(result.probabilities.target),
      ruin: num(result.probabilities.ruin),
    },
    drawdown: {
      p50: num(result.drawdown.p50),
      p90: num(result.drawdown.p90),
      p99: num(result.drawdown.p99),
      mean: num(result.drawdown.mean),
    },
    yearlyBands: result.yearlyBands.map((band) => ({
      year: band.year,
      p10: num(band.p10),
      p25: num(band.p25),
      p50: num(band.p50),
      p75: num(band.p75),
      p90: num(band.p90),
    })),
    histogram: {
      min: num(result.histogram.min),
      max: num(result.histogram.max),
      bins: result.histogram.bins,
    },
    deterministic: result.deterministic,
  };
}

/** 完整假设快照：结果必须能脱离方案被独立解释 */
export function buildAssumptions(
  scenario: NormalizedScenario,
  extra: { seed: number; modelVersion: string; stressPreset?: string | null },
) {
  return {
    returnModel: 'lognormal' as const,
    modelVersion: extra.modelVersion,
    seed: extra.seed,
    pathCount: scenario.pathCount,
    years: scenario.years,
    rebalance: scenario.rebalance,
    assets: scenario.assets.map((asset) => ({
      key: asset.key,
      label: asset.label,
      weight: num(asset.weight),
      expectedAnnualReturn: num(asset.expectedAnnualReturn),
      annualVolatility: num(asset.annualVolatility),
    })),
    correlation: scenario.correlation.map((row) => row.map((value) => num(value))),
    initialValue: num(scenario.initialValue),
    contribution: {
      amount: num(scenario.contribution.amount),
      frequency: scenario.contribution.frequency,
      timing: scenario.contribution.timing,
    },
    withdrawal: {
      amount: num(scenario.withdrawal.amount),
      frequency: scenario.withdrawal.frequency,
      startYear: scenario.withdrawal.startYear,
    },
    inflationRate: num(scenario.inflationRate),
    feeRate: num(scenario.feeRate),
    targetAmount: scenario.targetAmount === null ? null : num(scenario.targetAmount),
    stressPreset: extra.stressPreset ?? null,
  };
}

/** 从快照还原引擎输入，供路径接口按索引再生成时使用 */
export function inputFromAssumptions(assumptions: Record<string, unknown>) {
  const assets = (assumptions.assets as Array<Record<string, string>>).map((asset) => ({
    key: asset.key!,
    label: asset.label!,
    weight: Number(asset.weight),
    expectedAnnualReturn: Number(asset.expectedAnnualReturn),
    annualVolatility: Number(asset.annualVolatility),
  }));

  return {
    years: Number(assumptions.years),
    pathCount: Number(assumptions.pathCount),
    seed: Number(assumptions.seed),
    rebalance: assumptions.rebalance as 'none' | 'monthly' | 'quarterly' | 'annual',
    assets,
    correlation: (assumptions.correlation as string[][]).map((row) => row.map((value) => Number(value))),
    initialValue: Number(assumptions.initialValue),
    contribution: assumptions.contribution as {
      amount: string;
      frequency: 'none' | 'monthly' | 'annual';
      timing: 'begin' | 'end';
    },
    withdrawal: assumptions.withdrawal as {
      amount: string;
      frequency: 'none' | 'monthly' | 'annual';
      startYear: number;
    },
    inflationRate: Number(assumptions.inflationRate),
    feeRate: Number(assumptions.feeRate),
    targetAmount: assumptions.targetAmount === null ? null : Number(assumptions.targetAmount),
  };
}
