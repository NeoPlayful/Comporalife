import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { BUDGET_CARRYOVER_MAX_PERIODS, BUDGET_WARNING_RATIO } from '../../config/constants.js';
import { errors } from '../../lib/errors.js';
import { roundMoney, toDecimal } from '../../lib/money.js';
import { buildBasis } from '../analytics/coverage.js';
import type { AnalyticsContext } from '../analytics/analytics.service.js';
import { loadAnalyticsRows, sumBy, type AnalyticsRow } from '../analytics/query.service.js';
import { resolvePeriodWindow } from '../analytics/period.js';

export type BudgetLevel = 'ok' | 'warning' | 'exceeded' | 'unknown';

export interface BudgetItemProgress {
  itemId: string;
  categoryId: string;
  categoryName: string;
  amount: string;
  carryIn: string;
  available: string;
  spent: string;
  remaining: string;
  usageRatio: string | null;
  level: BudgetLevel;
  childCategoryIds: string[];
}

export interface BudgetTotals {
  amount: string;
  carryIn: string;
  available: string;
  spent: string;
  remaining: string;
  usageRatio: string | null;
  level: BudgetLevel;
  carryOut: string;
  carryoverTruncated: boolean;
}

export interface BudgetProgress {
  totals: BudgetTotals;
  items: BudgetItemProgress[];
  uncategorizedSpent: string;
  rolloverChain: number;
}

/** 按周期类型生成用户时区下的自然月/自然年窗口 */
export function budgetWindow(
  periodType: 'monthly' | 'yearly',
  year: number,
  month: number,
  timezone: string,
): { fromText: string; toText: string } {
  const anchor = new Date(Date.UTC(year, periodType === 'monthly' ? month - 1 : 0, 1));
  return resolvePeriodWindow(periodType === 'monthly' ? 'month' : 'year', anchor, timezone);
}

export function levelOf(spent: Decimal, available: Decimal, isComplete: boolean): BudgetLevel {
  if (!isComplete) return 'unknown';
  if (available.isNegative() || spent.greaterThan(available)) return 'exceeded';
  if (available.isZero()) return 'exceeded';
  if (spent.div(available).greaterThanOrEqualTo(BUDGET_WARNING_RATIO)) return 'warning';
  return 'ok';
}

/**
 * 展开分类树：返回 categoryId -> 该分类及其后代 ID。
 * 分类最多两级，这里一次查完在内存展开，避免递归查询。
 */
async function buildDescendantMap(
  prisma: PrismaClient,
  userId: string,
): Promise<Map<string, string[]>> {
  const categories = await prisma.category.findMany({
    where: { userId },
    select: { id: true, parentId: true },
  });

  const childrenOf = new Map<string, string[]>();
  for (const category of categories) {
    if (!category.parentId) continue;
    const list = childrenOf.get(category.parentId) ?? [];
    list.push(category.id);
    childrenOf.set(category.parentId, list);
  }

  const map = new Map<string, string[]>();
  for (const category of categories) {
    map.set(category.id, [category.id, ...(childrenOf.get(category.id) ?? [])]);
  }
  return map;
}

function expenseRows(rows: AnalyticsRow[]): AnalyticsRow[] {
  return rows.filter((row) => row.type === 'expense');
}

/**
 * 计算一个周期的已花费：
 * - 分类额度按「该分类及其子分类」汇总
 * - 未分类支出计入总预算，但不计入任何分类额度
 */
export function computeSpent(
  rows: AnalyticsRow[],
  categoryIds: string[] | null,
): Decimal {
  const expenses = expenseRows(rows);
  if (!categoryIds || categoryIds.length === 0) {
    return sumBy(expenses, (row) => row.amountBase);
  }

  const allowed = new Set(categoryIds);
  return roundMoney(
    expenses
      .filter((row) => row.categoryId !== null && allowed.has(row.categoryId))
      .reduce((sum, row) => sum.plus(row.amountBase), new Decimal(0)),
  );
}

/**
 * 结转链：仅月度、仅正结余、最多回溯 BUDGET_CARRYOVER_MAX_PERIODS 个周期。
 * 结转是计算值，不落库——修改历史流水后本期结转立即变化。
 *
 * 前置周期的预算与流水一次性取回后缓存，避免每个分类额度重复查询 12 个月。
 */
interface CarryoverPeriod {
  year: number;
  month: number;
  rollover: boolean;
  totalAmount: Decimal | null;
  itemAmounts: Map<string, Decimal>;
  rows: AnalyticsRow[];
  isComplete: boolean;
}

async function loadCarryoverPeriods(
  prisma: PrismaClient,
  context: AnalyticsContext,
  params: {
    periodType: 'monthly' | 'yearly';
    year: number;
    month: number;
    carryoverEnabled: boolean;
  },
): Promise<{ periods: CarryoverPeriod[]; truncated: boolean }> {
  if (params.periodType !== 'monthly' || !params.carryoverEnabled) {
    return { periods: [], truncated: false };
  }

  const chain: Array<{ year: number; month: number }> = [];
  let cursorYear = params.year;
  let cursorMonth = params.month;

  for (let index = 0; index < BUDGET_CARRYOVER_MAX_PERIODS; index += 1) {
    cursorMonth -= 1;
    if (cursorMonth < 1) {
      cursorMonth = 12;
      cursorYear -= 1;
    }
    chain.push({ year: cursorYear, month: cursorMonth });
  }

  const periods: CarryoverPeriod[] = [];

  for (const period of chain) {
    const previous = await prisma.budget.findUnique({
      where: {
        userId_periodType_year_month: {
          userId: context.userId,
          periodType: 'monthly',
          year: period.year,
          month: period.month,
        },
      },
      select: {
        rollover: true,
        totalAmount: true,
        items: { select: { categoryId: true, amount: true } },
      },
    });

    // 前置周期没有预算或未开启结转时，链在此重置
    if (!previous || !previous.rollover) continue;

    const window = budgetWindow('monthly', period.year, period.month, context.timezone);
    const result = await loadAnalyticsRows(prisma, {
      userId: context.userId,
      fromText: window.fromText,
      toText: window.toText,
      timezone: context.timezone,
      baseCurrency: context.baseCurrency,
    });

    periods.push({
      year: period.year,
      month: period.month,
      rollover: previous.rollover,
      totalAmount: previous.totalAmount ? toDecimal(previous.totalAmount.toString()) : null,
      itemAmounts: new Map(
        previous.items.map((item) => [item.categoryId, toDecimal(item.amount.toString())]),
      ),
      rows: result.rows,
      isComplete: result.isComplete,
    });
  }

  return { periods, truncated: periods.length >= BUDGET_CARRYOVER_MAX_PERIODS };
}

/** 按分类（含后代）或总额，逐周期累加正结余 */
export function accumulateCarryover(
  periods: CarryoverPeriod[],
  categoryId: string | null,
  categoryIds: string[] | null,
): Decimal {
  let carry = new Decimal(0);

  for (const period of periods) {
    const amount = categoryId
      ? (period.itemAmounts.get(categoryId) ?? new Decimal(0))
      : (period.totalAmount ?? new Decimal(0));

    const spent = computeSpent(period.rows, categoryIds);
    const remaining = roundMoney(amount.plus(carry).minus(spent));
    carry = remaining.isNegative() ? new Decimal(0) : remaining;
  }

  return roundMoney(carry);
}

export interface BudgetProgressResponse {
  budget: {
    id: string;
    periodType: 'monthly' | 'yearly';
    year: number;
    month: number;
    totalAmount: string | null;
    rollover: boolean;
    status: string;
    version: number;
    note: string | null;
  };
  period: { from: string; to: string; timezone: string };
  total: BudgetTotals;
  items: BudgetItemProgress[];
  uncategorizedSpent: string;
  coverage: ReturnType<typeof import('../analytics/coverage.js').computeCoverage>;
  basis: Record<string, unknown>;
}

export async function computeBudgetProgress(
  prisma: PrismaClient,
  context: AnalyticsContext,
  budgetId: string,
): Promise<BudgetProgressResponse> {
  const budget = await prisma.budget.findFirst({
    where: { id: budgetId, userId: context.userId },
    select: {
      id: true,
      periodType: true,
      year: true,
      month: true,
      totalAmount: true,
      rollover: true,
      status: true,
      version: true,
      note: true,
      items: {
        select: {
          id: true,
          categoryId: true,
          amount: true,
          category: { select: { name: true, archived: true } },
        },
      },
    },
  });

  if (!budget) throw errors.budgetNotFound();

  const window = budgetWindow(
    budget.periodType,
    budget.year,
    budget.month,
    context.timezone,
  );
  const result = await loadAnalyticsRows(prisma, {
    userId: context.userId,
    fromText: window.fromText,
    toText: window.toText,
    timezone: context.timezone,
    baseCurrency: context.baseCurrency,
  });

  const descendants = await buildDescendantMap(prisma, context.userId);
  const isComplete = result.isComplete;

  const { periods, truncated } = await loadCarryoverPeriods(prisma, context, {
    periodType: budget.periodType,
    year: budget.year,
    month: budget.month,
    carryoverEnabled: budget.rollover,
  });

  const items: BudgetItemProgress[] = [];
  for (const item of budget.items) {
    const categoryIds = descendants.get(item.categoryId) ?? [item.categoryId];
    const amount = toDecimal(item.amount.toString());
    const carryIn = accumulateCarryover(periods, item.categoryId, categoryIds);

    const spent = computeSpent(result.rows, categoryIds);
    const available = roundMoney(amount.plus(carryIn));
    const remaining = roundMoney(available.minus(spent));

    items.push({
      itemId: item.id,
      categoryId: item.categoryId,
      categoryName: item.category.name,
      amount: roundMoney(amount).toFixed(6),
      carryIn: carryIn.toFixed(6),
      available: available.toFixed(6),
      spent: spent.toFixed(6),
      remaining: remaining.toFixed(6),
      usageRatio: available.isZero() ? null : spent.div(available).toDecimalPlaces(4).toFixed(4),
      level: levelOf(spent, available, isComplete),
      childCategoryIds: categoryIds.slice(1),
    });
  }

  const totalSpent = sumBy(expenseRows(result.rows), (row) => row.amountBase);
  const uncategorizedSpent = sumBy(
    expenseRows(result.rows).filter((row) => row.categoryId === null),
    (row) => row.amountBase,
  );

  const totalCarryIn = budget.totalAmount
    ? accumulateCarryover(periods, null, null)
    : new Decimal(0);
  const totalChain = periods.length;
  const carryoverTruncated = truncated;

  const totalAmount = budget.totalAmount ? toDecimal(budget.totalAmount.toString()) : new Decimal(0);
  const totalAvailable = roundMoney(totalAmount.plus(totalCarryIn));
  const totalRemaining = roundMoney(totalAvailable.minus(totalSpent));
  const hasTotal = budget.totalAmount !== null;

  return {
    budget: {
      id: budget.id,
      periodType: budget.periodType,
      year: budget.year,
      month: budget.month,
      totalAmount: budget.totalAmount ? roundMoney(budget.totalAmount.toString()).toFixed(6) : null,
      rollover: budget.rollover,
      status: budget.status,
      version: budget.version,
      note: budget.note,
    },
    period: { from: window.fromText, to: window.toText, timezone: context.timezone },
    total: {
      amount: totalAmount.toFixed(6),
      carryIn: totalCarryIn.toFixed(6),
      available: totalAvailable.toFixed(6),
      spent: totalSpent.toFixed(6),
      remaining: totalRemaining.toFixed(6),
      usageRatio:
        !hasTotal || totalAvailable.isZero()
          ? null
          : totalSpent.div(totalAvailable).toDecimalPlaces(4).toFixed(4),
      level: hasTotal ? levelOf(totalSpent, totalAvailable, isComplete) : 'unknown',
      carryOut: budget.rollover && totalRemaining.isPositive() ? totalRemaining.toFixed(6) : '0.000000',
      carryoverTruncated,
    },
    items,
    uncategorizedSpent: uncategorizedSpent.toFixed(6),
    coverage: (await import('../analytics/coverage.js')).computeCoverage(result.rows, result),
    basis: buildBasis({
      timezone: context.timezone,
      baseCurrency: context.baseCurrency,
      range: result.range,
      extra: {
        rolloverChain: totalChain,
        uncategorizedCountsTowardTotalOnly: true,
      },
    }),
  };
}

/** 校验分类额度：必须是本人的、未归档的收入支出分类中的支出类 */
export async function validateBudgetItems(
  prisma: PrismaClient,
  userId: string,
  items: Array<{ categoryId: string; amount: string }>,
): Promise<void> {
  if (items.length === 0) return;

  const categoryIds = items.map((item) => item.categoryId);
  const uniqueIds = new Set(categoryIds);
  if (uniqueIds.size !== categoryIds.length) {
    throw errors.budgetItemInvalid('同一分类重复出现');
  }

  const categories = await prisma.category.findMany({
    where: { id: { in: categoryIds }, userId },
    select: { id: true, kind: true, archived: true, parentId: true },
  });

  if (categories.length !== categoryIds.length) {
    throw errors.budgetItemInvalid('分类不存在');
  }

  for (const category of categories) {
    if (category.kind !== 'expense') {
      throw errors.budgetItemInvalid('预算只能使用支出分类', { categoryId: category.id });
    }
    if (category.archived) {
      throw errors.budgetItemInvalid('分类已归档，不能设置预算', { categoryId: category.id });
    }
  }

  // 父子分类同时预算会让同一笔支出被计入两次
  const byId = new Map(categories.map((category) => [category.id, category]));
  for (const category of categories) {
    if (!category.parentId) continue;
    if (byId.has(category.parentId)) {
      throw errors.budgetCategoryConflict([category.parentId, category.id]);
    }
  }
}

export const budgetItemAmount = (value: string): Decimal => roundMoney(toDecimal(value));

export interface BudgetAlert {
  budgetId: string;
  periodType: string;
  scope: 'total' | 'category';
  categoryId?: string;
  categoryName?: string;
  level: string;
  spent: string;
  available: string;
  usageRatio: string | null;
}

/**
 * 当前周期的超支与接近超支项。
 * 抽出为服务函数：预算页与仪表板聚合共用同一口径，避免两处各算一套。
 */
export async function computeBudgetAlerts(
  prisma: PrismaClient,
  context: { userId: string; timezone: string; baseCurrency: string },
): Promise<BudgetAlert[]> {
  const now = new Date();
  const year = Number(formatInTimeZone(now, context.timezone, 'yyyy'));
  const month = Number(formatInTimeZone(now, context.timezone, 'MM'));

  const [monthly, yearly] = await Promise.all([
    prisma.budget.findUnique({
      where: { userId_periodType_year_month: { userId: context.userId, periodType: 'monthly', year, month } },
      select: { id: true },
    }),
    prisma.budget.findUnique({
      where: { userId_periodType_year_month: { userId: context.userId, periodType: 'yearly', year, month: 0 } },
      select: { id: true },
    }),
  ]);

  const alerts: BudgetAlert[] = [];

  for (const candidate of [monthly, yearly]) {
    if (!candidate) continue;
    const progress = await computeBudgetProgress(prisma, context, candidate.id);

    if (progress.total.level === 'warning' || progress.total.level === 'exceeded') {
      alerts.push({
        budgetId: candidate.id,
        periodType: progress.budget.periodType,
        scope: 'total',
        level: progress.total.level,
        spent: progress.total.spent,
        available: progress.total.available,
        usageRatio: progress.total.usageRatio,
      });
    }

    for (const item of progress.items) {
      if (item.level !== 'warning' && item.level !== 'exceeded') continue;
      alerts.push({
        budgetId: candidate.id,
        periodType: progress.budget.periodType,
        scope: 'category',
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        level: item.level,
        spent: item.spent,
        available: item.available,
        usageRatio: item.usageRatio,
      });
    }
  }

  // 超支优先，其次按使用率降序
  alerts.sort((a, b) => {
    if (a.level !== b.level) return a.level === 'exceeded' ? -1 : 1;
    return Number(b.usageRatio ?? 0) - Number(a.usageRatio ?? 0);
  });

  return alerts;
}
