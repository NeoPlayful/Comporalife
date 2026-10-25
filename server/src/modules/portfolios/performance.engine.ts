import Decimal from 'decimal.js';
import { roundMoney } from '../../lib/money.js';

export type PerformanceReason =
  | 'insufficient_data'
  | 'missing_valuation'
  | 'zero_start_value'
  | 'no_cashflow_sign_change'
  | 'not_converged';

export interface ValuePoint {
  date: string;
  value: Decimal;
  complete: boolean;
  /** 该点市值的来源：重算，或手工估值快照 */
  valuationSource?: 'computed' | 'manual_snapshot';
  /** 使用手工快照时，快照自身的估值日期 */
  snapshotDate?: string | null;
}

export interface ExternalCashflow {
  date: string;
  amount: Decimal;
  kind: 'deposit' | 'withdraw';
}

export interface TwrSegment {
  from: string;
  to: string;
  startValue: Decimal;
  endValue: Decimal;
  netFlow: Decimal;
  return: Decimal | null;
}

export interface TwrResult {
  value: Decimal | null;
  reason: PerformanceReason | null;
  segments: TwrSegment[];
}

export interface XirrCashflow {
  date: string;
  amount: Decimal;
  kind: 'deposit' | 'withdraw' | 'terminal';
}

export interface XirrResult {
  value: Decimal | null;
  reason: PerformanceReason | null;
  cashflows: XirrCashflow[];
}

const DAY_MS = 86_400_000;

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
}

/** 按日期索引估值，缺失或不完整时返回 null */
function valueAt(points: ValuePoint[], date: string): Decimal | null {
  const point = points.find((item) => item.date === date);
  if (!point || !point.complete) return null;
  return point.value;
}

/**
 * 时间加权收益率。
 *
 * 在每个外部现金流发生时点切分区间，逐段计算收益率后连乘。
 * 现金流按「期末发生」处理：先计收益、再计流入，
 * 这样入金本身不会被算成收益。
 */
export function computeTwr(params: {
  startDate: string;
  endDate: string;
  points: ValuePoint[];
  cashflows: ExternalCashflow[];
}): TwrResult {
  const { startDate, endDate } = params;

  // 只在区间内的现金流参与分段，区间外的入金不影响本段收益
  const flows = params.cashflows
    .filter((flow) => flow.date > startDate && flow.date <= endDate)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const boundaries = [startDate, ...flows.map((flow) => flow.date), endDate].filter(
    (date, index, list) => list.indexOf(date) === index,
  );

  if (boundaries.length < 2) {
    return { value: null, reason: 'insufficient_data', segments: [] };
  }

  const segments: TwrSegment[] = [];
  let growth = new Decimal(1);

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const from = boundaries[index]!;
    const to = boundaries[index + 1]!;

    const startValue = valueAt(params.points, from);
    const endValue = valueAt(params.points, to);

    if (startValue === null || endValue === null) {
      return { value: null, reason: 'missing_valuation', segments };
    }

    // 分段区间内的净外部现金流：该段末端发生的现金流属于本段
    const netFlow = flows
      .filter((flow) => flow.date > from && flow.date <= to)
      .reduce(
        (sum, flow) => sum.plus(flow.kind === 'deposit' ? flow.amount : flow.amount.negated()),
        new Decimal(0),
      );

    if (startValue.isZero()) {
      return { value: null, reason: 'zero_start_value', segments };
    }

    const segmentReturn = endValue.minus(netFlow).div(startValue).minus(1);
    growth = growth.mul(segmentReturn.plus(1));

    segments.push({
      from,
      to,
      startValue: roundMoney(startValue),
      endValue: roundMoney(endValue),
      netFlow: roundMoney(netFlow),
      return: segmentReturn.toDecimalPlaces(8),
    });
  }

  return { value: growth.minus(1).toDecimalPlaces(8), reason: null, segments };
}

/** XIRR 的净现值；t 以年为单位 */
function npv(rate: number, flows: Array<{ years: number; amount: number }>): number {
  return flows.reduce((sum, flow) => sum + flow.amount / Math.pow(1 + rate, flow.years), 0);
}

function dnpv(rate: number, flows: Array<{ years: number; amount: number }>): number {
  return flows.reduce(
    (sum, flow) => sum - (flow.years * flow.amount) / Math.pow(1 + rate, flow.years + 1),
    0,
  );
}

/**
 * 资金加权收益率（XIRR）。
 *
 * 现金流约定：入金为负、出金为正、期末价值为正。
 * 买入/卖出/股息/手续费不进入现金流——它们是组合内部变动。
 *
 * 求解顺序：牛顿迭代 → 失败回落二分 → 仍不收敛则返回 null。
 * 不使用浮点比较判断收敛，避免极小值陷阱。
 */
export function computeXirr(params: {
  startDate: string;
  endDate: string;
  cashflows: ExternalCashflow[];
  terminalValue: Decimal;
}): XirrResult {
  const flows: XirrCashflow[] = params.cashflows
    .filter((flow) => flow.date >= params.startDate && flow.date <= params.endDate)
    .map((flow) => ({
      date: flow.date,
      amount: flow.kind === 'deposit' ? flow.amount.negated() : flow.amount,
      kind: flow.kind,
    }));

  flows.push({ date: params.endDate, amount: params.terminalValue, kind: 'terminal' });

  // 全同号或无现金流时方程无解，必须显式返回而不是给 0
  const hasNegative = flows.some((flow) => flow.amount.isNegative());
  const hasPositive = flows.some((flow) => flow.amount.isPositive());
  if (!hasNegative || !hasPositive) {
    return { value: null, reason: 'no_cashflow_sign_change', cashflows: flows };
  }

  const baseDate = params.startDate;
  const numeric = flows.map((flow) => ({
    years: daysBetween(baseDate, flow.date) / 365,
    amount: Number(flow.amount.toString()),
  }));

  const tolerance = 1e-9;
  let rate = 0.1;
  let converged = false;

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const value = npv(rate, numeric);
    if (!Number.isFinite(value)) break;
    if (Math.abs(value) < tolerance) {
      converged = true;
      break;
    }

    const derivative = dnpv(rate, numeric);
    if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-12) break;

    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= -0.9999 || next > 1000) break;
    rate = next;
  }

  if (!converged) {
    // 二分：XIRR 的 NPV 在定义域内单调递减，二分会稳定收敛
    let low = -0.9999;
    let high = 10;
    let lowValue = npv(low, numeric);
    const highValue = npv(high, numeric);

    if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) {
      return { value: null, reason: 'not_converged', cashflows: flows };
    }

    for (let iteration = 0; iteration < 200; iteration += 1) {
      const mid = (low + high) / 2;
      const midValue = npv(mid, numeric);

      if (Math.abs(midValue) < tolerance || high - low < 1e-9) {
        rate = mid;
        converged = true;
        break;
      }

      if (midValue * lowValue > 0) {
        low = mid;
        lowValue = midValue;
      } else {
        high = mid;
      }
    }
  }

  if (!converged) {
    return { value: null, reason: 'not_converged', cashflows: flows };
  }

  return {
    value: new Decimal(rate).toDecimalPlaces(6),
    reason: null,
    cashflows: flows.map((flow) => ({ ...flow, amount: roundMoney(flow.amount) })),
  };
}

/** 采样点降级：日 → 周 → 月，与 Phase 3 趋势接口同一策略 */
export function downgradeGranularity(
  points: number,
  maxPoints: number,
): 'day' | 'week' | 'month' {
  if (points <= maxPoints) return 'day';
  if (points / 7 <= maxPoints) return 'week';
  return 'month';
}
