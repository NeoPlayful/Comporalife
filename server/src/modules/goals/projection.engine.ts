import Decimal from 'decimal.js';
import { simulate } from '../simulations/compound.engine.js';
import { GOAL_PROJECTION_MAX_MONTHS } from '../../config/constants.js';

/**
 * 目标预测与反推。
 * 全部复用 Phase 1 的复利引擎，不复制任何复利公式——
 * 两个引擎给出不同数字时，用户无法判断该信哪个。
 */

const MONEY_SCALE = 6;
const BISECT_ITERATIONS = 100;
const BISECT_TOLERANCE = new Decimal('0.01');

export interface ProjectionInput {
  targetAmount: Decimal;
  currentAmount: Decimal;
  monthsRemaining: number | null;
  expectedAnnualReturn: Decimal | null;
  monthlyContribution: Decimal | null;
  inflationRate: Decimal;
  feeRate: Decimal;
  maxMonths?: number;
}

/** 给定月供与月数，调用复利引擎求到期值 */
function valueAt(params: {
  currentAmount: Decimal;
  monthlyContribution: Decimal;
  annualReturn: Decimal;
  years: number;
  inflationRate: Decimal;
  feeRate: Decimal;
}): Decimal {
  if (params.years <= 0) return params.currentAmount;

  const result = simulate({
    principal: params.currentAmount,
    contributionAmount: params.monthlyContribution,
    contributionFrequency: 'monthly',
    contributionTiming: 'end',
    annualReturnRate: params.annualReturn,
    years: params.years,
    inflationRate: params.inflationRate,
    feeRate: params.feeRate,
  });

  return new Decimal(result.finalNominalValue);
}

export interface RequiredMonthlyResult {
  requiredMonthly: Decimal | null;
  /** 已达到或当前资产足以覆盖目标 */
  alreadyAchieved: boolean;
  /** 无解：负收益且期限不足以靠投入达成，或解得值超过合理性上限 */
  infeasible: boolean;
  reason: string | null;
}

/**
 * 反推所需月供：V(m) = T。
 * V(m) 在 m ≥ 0 上严格单调递增，二分稳定；
 * 复利引擎含费用、通胀与投入时点，没有可用的闭式解。
 */
export function solveRequiredMonthly(params: {
  targetAmount: Decimal;
  currentAmount: Decimal;
  months: number;
  annualReturn: Decimal;
  inflationRate: Decimal;
  feeRate: Decimal;
  maxMonthly?: Decimal;
}): RequiredMonthlyResult {
  const years = params.months / 12;

  const atZero = valueAt({
    currentAmount: params.currentAmount,
    monthlyContribution: new Decimal(0),
    annualReturn: params.annualReturn,
    years,
    inflationRate: params.inflationRate,
    feeRate: params.feeRate,
  });

  if (atZero.greaterThanOrEqualTo(params.targetAmount)) {
    return { requiredMonthly: new Decimal(0), alreadyAchieved: true, infeasible: false, reason: 'already_achieved' };
  }

  if (params.months <= 0) {
    return { requiredMonthly: null, alreadyAchieved: false, infeasible: true, reason: 'target_date_passed' };
  }

  const cap = params.maxMonthly ?? new Decimal(params.targetAmount.isZero() ? 1 : params.targetAmount.toNumber());
  const atCap = valueAt({
    currentAmount: params.currentAmount,
    monthlyContribution: cap,
    annualReturn: params.annualReturn,
    years,
    inflationRate: params.inflationRate,
    feeRate: params.feeRate,
  });

  if (atCap.lessThan(params.targetAmount)) {
    // 即使每月投入与目标同额也够不到：负收益吞噬本金，或期限过短
    return { requiredMonthly: null, alreadyAchieved: false, infeasible: true, reason: 'infeasible_within_horizon' };
  }

  let low = new Decimal(0);
  let high = cap;

  for (let i = 0; i < BISECT_ITERATIONS; i += 1) {
    const mid = low.plus(high).div(2);
    const value = valueAt({
      currentAmount: params.currentAmount,
      monthlyContribution: mid,
      annualReturn: params.annualReturn,
      years,
      inflationRate: params.inflationRate,
      feeRate: params.feeRate,
    });

    if (value.greaterThanOrEqualTo(params.targetAmount)) {
      high = mid;
    } else {
      low = mid;
    }

    if (high.minus(low).lessThan(BISECT_TOLERANCE)) break;
  }

  // 取上界，保证代入引擎后确实达到目标，而不是差一分钱
  return {
    requiredMonthly: high.toDecimalPlaces(2, Decimal.ROUND_UP),
    alreadyAchieved: false,
    infeasible: false,
    reason: null,
  };
}

export interface EtaResult {
  etaMonths: number | null;
  reason: string | null;
}

/**
 * 达成所需月数：固定月供求最小 n。
 * 单调性来自"投入只增不减"，因此可以二分；超出上限返回 null 而不是上限值，
 * 否则界面上会出现一个虚假的"50 年后达成"。
 */
export function solveEta(params: {
  targetAmount: Decimal;
  currentAmount: Decimal;
  monthlyContribution: Decimal;
  annualReturn: Decimal;
  inflationRate: Decimal;
  feeRate: Decimal;
  maxMonths?: number;
}): EtaResult {
  if (params.currentAmount.greaterThanOrEqualTo(params.targetAmount)) {
    return { etaMonths: 0, reason: null };
  }

  if (params.monthlyContribution.isZero() && params.annualReturn.lessThanOrEqualTo(0)) {
    return { etaMonths: null, reason: 'no_growth_no_contribution' };
  }

  const maxMonths = params.maxMonths ?? GOAL_PROJECTION_MAX_MONTHS;

  const atMax = valueAt({
    currentAmount: params.currentAmount,
    monthlyContribution: params.monthlyContribution,
    annualReturn: params.annualReturn,
    years: maxMonths / 12,
    inflationRate: params.inflationRate,
    feeRate: params.feeRate,
  });

  if (atMax.lessThan(params.targetAmount)) {
    return { etaMonths: null, reason: 'beyond_horizon' };
  }

  let low = 0;
  let high = maxMonths;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const value = valueAt({
      currentAmount: params.currentAmount,
      monthlyContribution: params.monthlyContribution,
      annualReturn: params.annualReturn,
      years: mid / 12,
      inflationRate: params.inflationRate,
      feeRate: params.feeRate,
    });

    if (value.greaterThanOrEqualTo(params.targetAmount)) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  return { etaMonths: low, reason: null };
}

export interface TimelinePoint {
  month: string;
  value: string;
}

/** 首年按月、之后按年抽样，避免把 600 个点塞进响应 */
export function buildTimeline(params: {
  startMonth: string;
  currentAmount: Decimal;
  monthlyContribution: Decimal;
  annualReturn: Decimal;
  inflationRate: Decimal;
  feeRate: Decimal;
  months: number;
}): TimelinePoint[] {
  const points: TimelinePoint[] = [];
  if (params.months <= 0) return points;

  const [startYear, startMonthIndex] = params.startMonth.split('-').map(Number) as [number, number];

  for (let m = 1; m <= params.months; m += 1) {
    const isMonthly = m <= 12;
    const isYearly = m % 12 === 0;
    if (!isMonthly && !isYearly) continue;

    const value = valueAt({
      currentAmount: params.currentAmount,
      monthlyContribution: params.monthlyContribution,
      annualReturn: params.annualReturn,
      years: m / 12,
      inflationRate: params.inflationRate,
      feeRate: params.feeRate,
    });

    const totalMonths = startMonthIndex - 1 + m;
    const year = startYear + Math.floor(totalMonths / 12);
    const month = (totalMonths % 12) + 1;

    points.push({
      month: `${year}-${String(month).padStart(2, '0')}`,
      value: value.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP).toFixed(MONEY_SCALE),
    });
  }

  return points;
}
