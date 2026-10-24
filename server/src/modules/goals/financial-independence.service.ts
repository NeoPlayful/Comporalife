import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import {
  FI_DEFAULT_WITHDRAWAL_RATE,
  FI_MAX_WITHDRAWAL_RATE,
  FI_MIN_EXPENSE_MONTHS,
  FI_MIN_WITHDRAWAL_RATE,
} from '../../config/constants.js';
import { errors } from '../../lib/errors.js';
import { moneyToString, roundMoney, toDecimal } from '../../lib/money.js';
import { getUserAnalyticsContext } from '../analytics/analytics.service.js';
import { computeCashflow } from '../analytics/cashflow.service.js';
import { computeNetWorth } from '../analytics/networth.service.js';

const EXPENSE_SCALES = [0.8, 1, 1.2] as const;
const WITHDRAWAL_STEPS = 3;

export interface FinancialIndependenceView {
  annualExpense: string | null;
  expenseBasis: { months: number; from: string; to: string; isComplete: boolean } | null;
  withdrawalRate: string;
  targetAssets: string | null;
  investableAssets: string | null;
  progress: string | null;
  coverageMonths: string | null;
  safetyMargin: string | null;
  sensitivity: {
    expenseScale: string[];
    withdrawalRates: string[];
    cells: Array<Array<{ targetAssets: string | null; progress: string | null }>>;
  } | null;
  unavailableReasons: string[];
  disclaimers: string[];
}

/** 可投资资产 = 非负债账户余额 + 证券市值，与净资产口径一致 */
async function computeInvestableAssets(
  prisma: PrismaClient,
  params: { userId: string; baseCurrency: string; asOf: Date },
): Promise<Decimal> {
  const netWorth = await computeNetWorth(prisma, {
    userId: params.userId,
    baseCurrency: params.baseCurrency,
    asOf: params.asOf,
  });

  // 负债不从"可投资资产"里扣：它已经通过净资产之外的借贷关系存在，
  // 这里只统计能够产生现金流的资产部分
  return roundMoney(netWorth.totalAssets);
}

/**
 * 年化支出：最近 N 个完整月的支出合计 ÷ 实际月数 × 12。
 * 不完整月不补零、不按天外推——按天外推会系统性低估或高估，
 * 而"少一个月就少算一个月"是唯一能解释清楚的口径。
 */
async function computeAnnualExpense(
  prisma: PrismaClient,
  params: { userId: string; timezone: string; baseCurrency: string; months: number },
): Promise<{ annual: Decimal | null; months: number; from: string; to: string; isComplete: boolean }> {
  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - params.months + 1, 1));

  const cashflow = await computeCashflow(prisma, {
    userId: params.userId,
    timezone: params.timezone,
    from,
    to,
  });

  const completeMonths = cashflow.points.filter((point) => point.isComplete).length;

  if (completeMonths < FI_MIN_EXPENSE_MONTHS) {
    return {
      annual: null,
      months: completeMonths,
      from: formatInTimeZone(from, params.timezone, 'yyyy-MM-dd'),
      to: formatInTimeZone(to, params.timezone, 'yyyy-MM-dd'),
      isComplete: false,
    };
  }

  const totalExpense = cashflow.points
    .filter((point) => point.isComplete)
    .reduce((sum, point) => sum.plus(point.expense), new Decimal(0));

  const annual = totalExpense.div(completeMonths).times(12);

  return {
    annual: roundMoney(annual),
    months: completeMonths,
    from: formatInTimeZone(from, params.timezone, 'yyyy-MM-dd'),
    to: formatInTimeZone(to, params.timezone, 'yyyy-MM-dd'),
    isComplete: completeMonths === params.months,
  };
}

export async function computeFinancialIndependence(
  prisma: PrismaClient,
  params: {
    userId: string;
    body: { annualExpense?: string; withdrawalRate?: string };
    asOf?: Date;
  },
): Promise<FinancialIndependenceView> {
  const context = await getUserAnalyticsContext(prisma, params.userId);
  const asOf = params.asOf ?? new Date();

  const withdrawalRate = toDecimal(params.body.withdrawalRate ?? String(FI_DEFAULT_WITHDRAWAL_RATE));

  if (withdrawalRate.lessThan(FI_MIN_WITHDRAWAL_RATE) || withdrawalRate.greaterThan(FI_MAX_WITHDRAWAL_RATE)) {
    throw errors.fiParametersInvalid(
      `提取率必须在 ${(FI_MIN_WITHDRAWAL_RATE * 100).toFixed(0)}% 到 ${(FI_MAX_WITHDRAWAL_RATE * 100).toFixed(0)}% 之间`,
      { withdrawalRate: withdrawalRate.toString() },
    );
  }

  const unavailableReasons: string[] = [];

  let annualExpense: Decimal | null;
  let expenseBasis: FinancialIndependenceView['expenseBasis'];

  if (params.body.annualExpense) {
    annualExpense = roundMoney(params.body.annualExpense);
    // 用户直接给定年化支出时没有月份区间，如实标注而不是伪造 12 个月
    expenseBasis = { months: 0, from: '', to: '', isComplete: true };
  } else {
    const expense = await computeAnnualExpense(prisma, {
      userId: params.userId,
      timezone: context.timezone,
      baseCurrency: context.baseCurrency,
      months: 12,
    });

    annualExpense = expense.annual;
    expenseBasis = { months: expense.months, from: expense.from, to: expense.to, isComplete: expense.isComplete };

    if (annualExpense === null) unavailableReasons.push('insufficient_expense_months');
  }

  const investableAssets = await computeInvestableAssets(prisma, {
    userId: params.userId,
    baseCurrency: context.baseCurrency,
    asOf,
  });

  let targetAssets: Decimal | null = null;
  let progress: Decimal | null = null;
  let coverageMonths: Decimal | null = null;
  let safetyMargin: Decimal | null = null;
  let sensitivity: FinancialIndependenceView['sensitivity'] = null;

  if (annualExpense !== null && !annualExpense.isZero() && !withdrawalRate.isZero()) {
    targetAssets = roundMoney(annualExpense.div(withdrawalRate));
    progress = investableAssets.div(targetAssets);
    safetyMargin = investableAssets.minus(targetAssets).div(targetAssets);

    const monthlyExpense = annualExpense.div(12);
    if (!monthlyExpense.isZero()) coverageMonths = investableAssets.div(monthlyExpense);

    const withdrawalRates = buildWithdrawalSteps(withdrawalRate);
    const cells = withdrawalRates.map((rate) =>
      EXPENSE_SCALES.map((scale) => {
        const scaledExpense = annualExpense!.times(scale);
        const scaledTarget = scaledExpense.div(rate);
        return {
          targetAssets: moneyToString(scaledTarget),
          progress: scaledTarget.isZero() ? null : investableAssets.div(scaledTarget).toFixed(6),
        };
      }),
    );

    sensitivity = {
      expenseScale: EXPENSE_SCALES.map((scale) => scale.toFixed(6)),
      withdrawalRates: withdrawalRates.map((rate) => rate.toFixed(6)),
      cells,
    };
  } else if (annualExpense !== null && annualExpense.isZero()) {
    // 支出为 0 时除零，返回 null 而不是 Infinity
    unavailableReasons.push('no_expense_recorded');
  }

  return {
    annualExpense: annualExpense === null ? null : moneyToString(annualExpense),
    expenseBasis,
    withdrawalRate: withdrawalRate.toFixed(6),
    targetAssets: targetAssets === null ? null : moneyToString(targetAssets),
    investableAssets: moneyToString(investableAssets),
    progress: progress === null ? null : progress.toFixed(6),
    coverageMonths: coverageMonths === null ? null : coverageMonths.toFixed(6),
    safetyMargin: safetyMargin === null ? null : safetyMargin.toFixed(6),
    sensitivity,
    unavailableReasons,
    disclaimers: [
      'withdrawal_rate_is_scenario_only',
      'past_expense_not_future_expense',
      'not_retirement_advice',
    ],
  };
}

/** 以当前提取率为中心取三档（±1 个百分点），且必须落在允许区间内 */
function buildWithdrawalSteps(center: Decimal): Decimal[] {
  const offsets = Array.from({ length: WITHDRAWAL_STEPS }, (_, index) => index - Math.floor(WITHDRAWAL_STEPS / 2));

  return offsets.map((offset) => {
    const value = center.plus(new Decimal(offset).times(0.01));
    if (value.lessThan(FI_MIN_WITHDRAWAL_RATE)) return toDecimal(FI_MIN_WITHDRAWAL_RATE);
    if (value.greaterThan(FI_MAX_WITHDRAWAL_RATE)) return toDecimal(FI_MAX_WITHDRAWAL_RATE);
    return value;
  });
}
