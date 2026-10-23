import type { MonteCarloInput, MonteCarloResult, QuantileSet, YearBand } from './monte-carlo.engine.js';

export const STRESS_PRESET_KEYS = ['crash', 'stagflation', 'lost_decade'] as const;
export type StressPresetKey = (typeof STRESS_PRESET_KEYS)[number];

export interface StressPreset {
  key: StressPresetKey;
  /** 前端据此取文案，不在后端硬编码展示文本 */
  labelKey: string;
  descriptionKey: string;
  /** 参与统计的假设说明，随结果返回 */
  assumption: {
    annualReturn: number;
    inflationRate: number;
    shockMonths?: number;
  };
}

export const STRESS_PRESETS: StressPreset[] = [
  {
    key: 'crash',
    labelKey: 'stress.preset.crash.label',
    descriptionKey: 'stress.preset.crash.description',
    assumption: { annualReturn: 0, inflationRate: 0, shockMonths: 25 },
  },
  {
    key: 'stagflation',
    labelKey: 'stress.preset.stagflation.label',
    descriptionKey: 'stress.preset.stagflation.description',
    assumption: { annualReturn: 0.01, inflationRate: 0.06 },
  },
  {
    key: 'lost_decade',
    labelKey: 'stress.preset.lost_decade.label',
    descriptionKey: 'stress.preset.lost_decade.description',
    assumption: { annualReturn: 0, inflationRate: 0.02 },
  },
];

export function findPreset(key: string): StressPreset | undefined {
  return STRESS_PRESETS.find((preset) => preset.key === key);
}

/**
 * 压力情景是确定性路径，不是概率事件。
 * 因此结果只含单条路径，并且不提供任何「概率」字段——
 * 把极端情景混进分位数会让 P5 变成无意义的数字。
 */
export function simulateStress(
  input: MonteCarloInput,
  preset: StressPreset,
): MonteCarloResult {
  const months = input.years * 12;
  const monthlyReturns = buildMonthlyReturns(preset, months, input.feeRate);

  let value = input.initialValue;
  let contributed = input.initialValue;
  let depleted = false;
  const yearlyValues: number[] = [];

  let growthIndex = 1;
  let peak = 1;
  let maxDrawdown = 0;

  for (let month = 0; month < months; month += 1) {
    const yearIndex = Math.floor(month / 12);
    const monthOfYear = month % 12;
    const timing = input.contribution.timing;

    const contribution = contributionFor(input, monthOfYear);
    const withdrawal = withdrawalFor(input, yearIndex, monthOfYear);

    if (timing === 'begin' && !depleted) {
      value += contribution;
      contributed += contribution;
      value -= withdrawal;
      if (value < 0) value = 0;
    }

    const grow = 1 + monthlyReturns[month]!;
    if (value > 0) {
      growthIndex *= grow;
      if (growthIndex > peak) peak = growthIndex;
      const drawdown = peak > 0 ? 1 - growthIndex / peak : 0;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    value *= grow;

    if (timing === 'end' && !depleted) {
      value += contribution;
      contributed += contribution;
      value -= withdrawal;
    }

    if (value <= 0) {
      depleted = true;
      value = 0;
    }

    if (monthOfYear === 11) yearlyValues.push(value);
  }

  const deflator = Math.pow(1 + input.inflationRate, input.years);
  const realValue = deflator > 0 ? value / deflator : value;
  const realContributed = deflator > 0 ? contributed / deflator : contributed;

  const single = (value: number): QuantileSet => ({
    p5: value,
    p10: value,
    p25: value,
    p50: value,
    p75: value,
    p90: value,
    p95: value,
    mean: value,
    sd: 0,
  });

  const terminal = single(value);

  return {
    terminal: { nominal: terminal, real: single(realValue) },
    contributed: { nominal: single(contributed), real: single(realContributed) },
    standardError: 0,
    probabilities: {
      loss: value < contributed ? 1 : 0,
      realLoss: realValue < realContributed ? 1 : 0,
      // 确定性情景没有「达标概率」的语义，统一返回 null
      target: null,
      ruin: depleted ? 1 : 0,
    },
    drawdown: { p50: maxDrawdown, p90: maxDrawdown, p99: maxDrawdown, mean: maxDrawdown },
    yearlyBands: yearlyValues.map((yearValue, index) => bandOf(yearValue, index + 1)),
    histogram: {
      min: value,
      max: value,
      bins: [1, ...new Array(19).fill(0)],
    },
    samplePaths: [{ index: 0, values: yearlyValues }],
    deterministic: true,
  };
}

function bandOf(value: number, year: number): YearBand {
  return { year, p10: value, p25: value, p50: value, p75: value, p90: value };
}

function contributionFor(input: MonteCarloInput, monthOfYear: number): number {
  if (input.contribution.frequency === 'none') return 0;
  if (input.contribution.frequency === 'monthly') return input.contribution.amount;
  return monthOfYear === 0 ? input.contribution.amount : 0;
}

function withdrawalFor(input: MonteCarloInput, yearIndex: number, monthOfYear: number): number {
  const { withdrawal } = input;
  if (withdrawal.frequency === 'none') return 0;
  if (yearIndex + 1 < withdrawal.startYear) return 0;
  if (withdrawal.frequency === 'monthly') return withdrawal.amount;
  return monthOfYear === 0 ? withdrawal.amount : 0;
}

/**
 * 月度收益序列。
 * 崩盘情景在首年第 6 个月单月下跌 35%，随后 24 个月线性恢复到原水平，
 * 这样「冲击后是否还能恢复」本身也是压力测试的一部分。
 */
function buildMonthlyReturns(preset: StressPreset, months: number, feeRate: number): number[] {
  const feeMonthly = 1 - Math.pow(1 - feeRate, 1 / 12);
  const returns: number[] = new Array(months).fill(0);

  switch (preset.key) {
    case 'crash': {
      const monthlyBase = Math.pow(1 + preset.assumption.annualReturn, 1 / 12) - 1;
      for (let m = 0; m < months; m += 1) returns[m] = monthlyBase;

      const shockMonth = 5;
      if (months > shockMonth) returns[shockMonth] = -0.35;

      // 用冲击后的绝对水平线性回升，避免逐月复利把恢复期拉长
      let level = 1;
      for (let m = 0; m <= shockMonth && m < months; m += 1) level *= 1 + returns[m]!;
      const recoveryMonths = Math.min(24, months - shockMonth - 1);
      const target = 1;
      for (let k = 1; k <= recoveryMonths; k += 1) {
        const desired = level + ((target - level) * k) / recoveryMonths;
        returns[shockMonth + k] = desired / level - 1;
        level = desired;
      }
      break;
    }
    case 'stagflation': {
      const monthly = Math.pow(1 + preset.assumption.annualReturn, 1 / 12) - 1;
      const window = Math.min(60, months);
      for (let m = 0; m < window; m += 1) returns[m] = monthly;
      break;
    }
    case 'lost_decade': {
      const monthly = Math.pow(1 + preset.assumption.annualReturn, 1 / 12) - 1;
      const window = Math.min(120, months);
      for (let m = 0; m < window; m += 1) returns[m] = monthly;
      break;
    }
  }

  // 费用在所有情景下都按同一换算扣除
  for (let m = 0; m < months; m += 1) returns[m] = (1 + returns[m]!) * (1 - feeMonthly) - 1;

  return returns;
}
