import Decimal from 'decimal.js';

/**
 * 目标进度与预测的纯计算内核。
 * 不读时钟、不访问数据库：所有 as-of 与"今天"都由调用方传入，便于单元测试。
 */

const SCALE = 6;

export interface GoalCoreInput {
  targetAmount: string;
  currency: string;
  targetDate: string | null;
  startedAt: string;
  initialAmount: string;
  inflationAdjusted: boolean;
  inflationRate: string | null;
  expectedAnnualReturn: string | null;
  monthlyContribution: string | null;
}

export interface GoalCoreProgress {
  /** 已按通胀调整的目标金额 */
  targetAmount: Decimal;
  originalTargetAmount: Decimal;
  currentAmount: Decimal;
  progress: Decimal;
  gap: Decimal;
  isAchieved: boolean;
  /** 到目标日期的剩余整月数，无目标日期时为 null */
  monthsRemaining: number | null;
}

function toDate(text: string): Date {
  // 统一按 UTC 零点解析，避免本地时区把日期推进一天
  return new Date(`${text.slice(0, 10)}T00:00:00.000Z`);
}

function monthDiff(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

/** 目标金额的通胀调整：按起算日到目标日期的整年数复利 */
export function inflateTarget(input: GoalCoreInput): Decimal {
  const original = new Decimal(input.targetAmount);
  if (!input.inflationAdjusted || !input.targetDate || input.inflationRate === null) {
    return original.toDecimalPlaces(SCALE);
  }

  const years = monthDiff(toDate(input.startedAt), toDate(input.targetDate)) / 12;
  if (years <= 0) return original.toDecimalPlaces(SCALE);

  return original
    .times(new Decimal(1).plus(input.inflationRate).pow(years))
    .toDecimalPlaces(SCALE, Decimal.ROUND_HALF_UP);
}

/**
 * 进度计算。
 * 当前金额由调用方按绑定口径算出（净资产增量 / 账户余额 / 组合市值），
 * 这里只负责与目标金额比较；`progress` 不封顶，展示层再决定是否截断。
 */
export function computeProgress(params: {
  input: GoalCoreInput;
  currentAmount: Decimal;
  asOf: string;
}): GoalCoreProgress {
  const targetAmount = inflateTarget(params.input);
  const current = params.currentAmount.toDecimalPlaces(SCALE, Decimal.ROUND_HALF_UP);

  const progress = targetAmount.isZero() ? new Decimal(0) : current.div(targetAmount);
  const gap = Decimal.max(0, targetAmount.minus(current));
  const monthsRemaining = params.input.targetDate
    ? Math.max(0, monthDiff(toDate(params.asOf), toDate(params.input.targetDate)))
    : null;

  return {
    targetAmount,
    originalTargetAmount: new Decimal(params.input.targetAmount).toDecimalPlaces(SCALE),
    currentAmount: current,
    progress: progress.toDecimalPlaces(SCALE, Decimal.ROUND_HALF_UP),
    gap: gap.toDecimalPlaces(SCALE, Decimal.ROUND_HALF_UP),
    isAchieved: current.greaterThanOrEqualTo(targetAmount) && !targetAmount.isZero(),
    monthsRemaining,
  };
}

export interface GoalCurvePoint {
  /** 该月月末，YYYY-MM-DD */
  asOf: string;
  currentAmount: string;
  progress: string;
  isAchieved: boolean;
}

/**
 * 首次达成判定：按月扫描曲线，取第一个进度 ≥ 1 的月份。
 * 月粒度是明确的取舍——逐日重放全部账户的成本与价值不成比例，
 * 报告与界面必须标注"实际达成可能发生在该月内更早的日期"。
 */
export function findFirstAchieved(curve: GoalCurvePoint[]): string | null {
  for (const point of curve) {
    if (point.isAchieved) return point.asOf;
  }
  return null;
}
