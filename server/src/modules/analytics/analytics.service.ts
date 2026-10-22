import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import {
  ANALYTICS_MAX_SERIES_POINTS,
  LARGE_EXPENSE_MEDIAN_MULTIPLE,
  LARGE_EXPENSE_MIN_SAMPLES,
} from '../../config/constants.js';
import { roundMoney, toDecimal } from '../../lib/money.js';
import { median, percentile } from '../../lib/percentile.js';
import { buildBasis, computeCoverage, type Coverage } from './coverage.js';
import {
  changeRatio,
  enumeratePeriodKeys,
  hasYearOfHistory,
  previousWindow,
  resolveRange,
  yearAgoWindow,
  type Granularity,
  type PeriodGranularity,
} from './period.js';
import {
  loadAnalyticsRows,
  sumBy,
  type AnalyticsResult,
  type AnalyticsRow,
} from './query.service.js';

export interface AnalyticsContext {
  userId: string;
  timezone: string;
  baseCurrency: string;
}

export async function getUserAnalyticsContext(
  prisma: PrismaClient,
  userId: string,
): Promise<AnalyticsContext> {
  const settings = await prisma.userSettings.findUniqueOrThrow({
    where: { userId },
    select: { timezone: true, baseCurrency: true },
  });
  return { userId, timezone: settings.timezone, baseCurrency: settings.baseCurrency };
}

async function load(
  prisma: PrismaClient,
  context: AnalyticsContext,
  fromText: string,
  toText: string,
): Promise<AnalyticsResult> {
  return loadAnalyticsRows(prisma, {
    userId: context.userId,
    fromText,
    toText,
    timezone: context.timezone,
    baseCurrency: context.baseCurrency,
  });
}

function expensesOf(rows: AnalyticsRow[]): AnalyticsRow[] {
  return rows.filter((row) => row.type === 'expense');
}

function incomesOf(rows: AnalyticsRow[]): AnalyticsRow[] {
  return rows.filter((row) => row.type === 'income');
}

export interface IncomeExpenseSummary {
  income: string;
  expense: string;
  net: string;
  savingsRate: string | null;
  investableSurplus: string;
  transactionCounts: { income: number; expense: number };
}

/** 收支汇总：收入为 0 时储蓄率为 null，不返回 0 或无穷大 */
export function summarizeIncomeExpense(rows: AnalyticsRow[]): IncomeExpenseSummary {
  const incomes = incomesOf(rows);
  const expenses = expensesOf(rows);

  const income = sumBy(incomes, (row) => row.amountBase);
  const expense = sumBy(expenses, (row) => row.amountBase);
  const net = roundMoney(income.minus(expense));

  return {
    income: income.toFixed(6),
    expense: expense.toFixed(6),
    net: net.toFixed(6),
    savingsRate: income.isZero() ? null : net.div(income).toDecimalPlaces(4).toFixed(4),
    investableSurplus: net.toFixed(6),
    transactionCounts: { income: incomes.length, expense: expenses.length },
  };
}

export interface IncomeExpenseResponse extends IncomeExpenseSummary {
  coverage: Coverage;
  period: AnalyticsResult['range'];
  basis: Record<string, unknown>;
}

export async function getIncomeExpense(
  prisma: PrismaClient,
  context: AnalyticsContext,
  fromText: string,
  toText: string,
): Promise<IncomeExpenseResponse> {
  const result = await load(prisma, context, fromText, toText);

  return {
    ...summarizeIncomeExpense(result.rows),
    coverage: computeCoverage(result.rows, result),
    period: result.range,
    basis: buildBasis({
      timezone: context.timezone,
      baseCurrency: context.baseCurrency,
      range: result.range,
    }),
  };
}

interface CategoryBucket {
  categoryId: string;
  name: string;
  amount: Decimal;
  count: number;
}

/**
 * 分类汇总：level=1 时把二级分类金额向上汇总到一级。
 * 未分类金额不进入 items，只体现在 coverage 中。
 */
function bucketByCategory(rows: AnalyticsRow[], level: 1 | 2): Map<string, CategoryBucket> {
  const buckets = new Map<string, CategoryBucket>();

  for (const row of rows) {
    if (!row.categoryId) continue;

    const useParent = level === 1 && row.categoryParentId !== null;
    const key = useParent ? row.categoryParentId! : row.categoryId;
    const name = useParent ? (row.categoryParentName ?? row.categoryName ?? '') : (row.categoryName ?? '');

    const bucket = buckets.get(key) ?? { categoryId: key, name, amount: new Decimal(0), count: 0 };
    bucket.amount = bucket.amount.plus(row.amountBase);
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  return buckets;
}

export interface CategoryItem {
  categoryId: string;
  name: string;
  amount: string;
  ratio: string | null;
  count: number;
  previousAmount: string | null;
  changeRatio: string | null;
}

export interface CategoryAnalyticsResponse {
  kind: 'income' | 'expense';
  level: 1 | 2;
  items: CategoryItem[];
  total: string;
  coverage: Coverage;
  period: AnalyticsResult['range'];
  basis: Record<string, unknown>;
}

export async function getCategoryAnalytics(
  prisma: PrismaClient,
  context: AnalyticsContext,
  params: { fromText: string; toText: string; kind: 'income' | 'expense'; level: 1 | 2; previous: boolean },
): Promise<CategoryAnalyticsResponse> {
  const result = await load(prisma, context, params.fromText, params.toText);
  const kindRows = result.rows.filter((row) => row.type === params.kind);
  const buckets = bucketByCategory(kindRows, params.level);

  const total = sumBy(kindRows, (row) => row.amountBase);

  let previousBuckets: Map<string, CategoryBucket> | null = null;
  if (params.previous) {
    const previous = previousWindow(
      { fromText: params.fromText, toText: params.toText, mode: 'custom' },
      context.timezone,
    );
    const previousResult = await load(prisma, context, previous.fromText, previous.toText);
    previousBuckets = bucketByCategory(
      previousResult.rows.filter((row) => row.type === params.kind),
      params.level,
    );
  }

  const items: CategoryItem[] = [...buckets.values()]
    .filter((bucket) => !bucket.amount.isZero())
    .sort((a, b) => b.amount.comparedTo(a.amount))
    .map((bucket) => {
      const previousAmount = previousBuckets?.get(bucket.categoryId)?.amount ?? null;
      return {
        categoryId: bucket.categoryId,
        name: bucket.name,
        amount: roundMoney(bucket.amount).toFixed(6),
        ratio: total.isZero() ? null : bucket.amount.div(total).toDecimalPlaces(4).toFixed(4),
        count: bucket.count,
        previousAmount: previousAmount ? roundMoney(previousAmount).toFixed(6) : null,
        changeRatio: previousAmount ? changeRatio(roundMoney(bucket.amount), roundMoney(previousAmount)) : null,
      };
    });

  return {
    kind: params.kind,
    level: params.level,
    items,
    total: total.toFixed(6),
    coverage: computeCoverage(result.rows, result),
    period: result.range,
    basis: buildBasis({
      timezone: context.timezone,
      baseCurrency: context.baseCurrency,
      range: result.range,
      extra: { level: params.level, kind: params.kind, uncategorizedExcludedFromItems: true },
    }),
  };
}

export interface AccountAnalyticsItem {
  accountId: string;
  name: string;
  type: string;
  currency: string;
  income: string;
  expense: string;
  net: string;
  transferIn: string;
  transferOut: string;
  incomeBase: string;
  expenseBase: string;
}

export interface AccountAnalyticsResponse {
  items: AccountAnalyticsItem[];
  totals: { incomeBase: string; expenseBase: string };
  coverage: Coverage;
  period: AnalyticsResult['range'];
  basis: Record<string, unknown>;
}

/** 账户维度：转账单独列出，不并入收支，否则账户维度会与总览对不上 */
export function summarizeByAccount(rows: AnalyticsRow[]): AccountAnalyticsItem[] {
  const map = new Map<string, {
    name: string;
    type: string;
    currency: string;
    income: Decimal;
    expense: Decimal;
    transferIn: Decimal;
    transferOut: Decimal;
  }>();

  for (const row of rows) {
    const bucket = map.get(row.accountId) ?? {
      name: row.accountName,
      type: row.accountType,
      currency: row.currency,
      income: new Decimal(0),
      expense: new Decimal(0),
      transferIn: new Decimal(0),
      transferOut: new Decimal(0),
    };

    if (row.type === 'income') {
      bucket.income = bucket.income.plus(row.amountBase);
    } else if (row.type === 'expense') {
      bucket.expense = bucket.expense.plus(row.amountBase);
    } else if (row.type === 'transfer' || row.type === 'adjustment') {
      // 转账方向由账户腿原始符号决定：正为流入，负为流出
      if (row.signedAmount.isNegative()) {
        bucket.transferOut = bucket.transferOut.plus(row.amountBase);
      } else {
        bucket.transferIn = bucket.transferIn.plus(row.amountBase);
      }
    }

    map.set(row.accountId, bucket);
  }

  return [...map.entries()]
    .map(([accountId, bucket]) => ({
      accountId,
      name: bucket.name,
      type: bucket.type,
      currency: bucket.currency,
      income: roundMoney(bucket.income).toFixed(6),
      expense: roundMoney(bucket.expense).toFixed(6),
      net: roundMoney(bucket.income.minus(bucket.expense)).toFixed(6),
      transferIn: roundMoney(bucket.transferIn).toFixed(6),
      transferOut: roundMoney(bucket.transferOut).toFixed(6),
      incomeBase: roundMoney(bucket.income).toFixed(6),
      expenseBase: roundMoney(bucket.expense).toFixed(6),
    }))
    .sort((a, b) => Number(b.expenseBase) - Number(a.expenseBase));
}

export async function getAccountAnalytics(
  prisma: PrismaClient,
  context: AnalyticsContext,
  fromText: string,
  toText: string,
): Promise<AccountAnalyticsResponse> {
  const result = await load(prisma, context, fromText, toText);
  const consumption = result.rows.filter(
    (row) => row.type === 'income' || row.type === 'expense',
  );

  const items = summarizeByAccount(result.rows);

  return {
    items,
    totals: {
      incomeBase: sumBy(consumption, (row) => (row.type === 'income' ? row.amountBase : new Decimal(0))).toFixed(6),
      expenseBase: sumBy(consumption, (row) => (row.type === 'expense' ? row.amountBase : new Decimal(0))).toFixed(6),
    },
    coverage: computeCoverage(result.rows, result),
    period: result.range,
    basis: buildBasis({
      timezone: context.timezone,
      baseCurrency: context.baseCurrency,
      range: result.range,
      extra: { transfersSeparated: true },
    }),
  };
}

export interface UncategorizedResponse {
  count: number;
  amount: string;
  oldestOccurredAt: string | null;
  byAccount: Array<{ accountId: string; name: string; count: number; amount: string }>;
  items: Array<{
    transactionId: string;
    occurredAt: string;
    description: string;
    merchant: string | null;
    amount: string;
    currency: string;
    accountName: string;
  }>;
  truncated: boolean;
  period: AnalyticsResult['range'];
}

export async function getUncategorized(
  prisma: PrismaClient,
  context: AnalyticsContext,
  fromText: string,
  toText: string,
  limit = 50,
): Promise<UncategorizedResponse> {
  const result = await load(prisma, context, fromText, toText);
  const uncategorized = result.rows.filter(
    (row) => row.type === 'expense' && row.categoryId === null,
  );

  const byAccountMap = new Map<string, { name: string; count: number; amount: Decimal }>();
  for (const row of uncategorized) {
    const bucket = byAccountMap.get(row.accountId) ?? { name: row.accountName, count: 0, amount: new Decimal(0) };
    bucket.count += 1;
    bucket.amount = bucket.amount.plus(row.amountBase);
    byAccountMap.set(row.accountId, bucket);
  }

  const sorted = [...uncategorized].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const amount = uncategorized.reduce((sum, row) => sum.plus(row.amountBase), new Decimal(0));

  return {
    count: uncategorized.length,
    amount: roundMoney(amount).toFixed(6),
    oldestOccurredAt: sorted[0]?.occurredAt.toISOString() ?? null,
    byAccount: [...byAccountMap.entries()]
      .map(([accountId, bucket]) => ({
        accountId,
        name: bucket.name,
        count: bucket.count,
        amount: roundMoney(bucket.amount).toFixed(6),
      }))
      .sort((a, b) => Number(b.amount) - Number(a.amount)),
    items: sorted.slice(0, limit).map((row) => ({
      transactionId: row.transactionId,
      occurredAt: row.occurredAt.toISOString(),
      description: row.description,
      merchant: row.merchant,
      amount: row.amountBase.toFixed(6),
      currency: row.currency,
      accountName: row.accountName,
    })),
    truncated: uncategorized.length > limit,
    period: result.range,
  };
}

export interface MerchantItem {
  merchant: string;
  amount: string;
  count: number;
  ratio: string | null;
  lastOccurredAt: string;
  topCategoryName: string | null;
}

export interface MerchantResponse {
  items: MerchantItem[];
  unattributed: { amount: string; count: number };
  total: string;
  coverage: Coverage;
  period: AnalyticsResult['range'];
  basis: Record<string, unknown>;
}

/** 商户排行：商户为空的流水单独归入 unattributed，绝不从描述推断商户 */
export function summarizeMerchants(rows: AnalyticsRow[], limit: number): Omit<MerchantResponse, 'coverage' | 'period' | 'basis'> {
  const expenses = expensesOf(rows);
  const total = sumBy(expenses, (row) => row.amountBase);

  const map = new Map<string, {
    amount: Decimal;
    count: number;
    lastOccurredAt: Date;
    categoryTotals: Map<string, Decimal>;
  }>();
  let unattributedAmount = new Decimal(0);
  let unattributedCount = 0;

  for (const row of expenses) {
    const merchant = row.merchant?.trim();
    if (!merchant) {
      unattributedAmount = unattributedAmount.plus(row.amountBase);
      unattributedCount += 1;
      continue;
    }

    const bucket = map.get(merchant) ?? {
      amount: new Decimal(0),
      count: 0,
      lastOccurredAt: row.occurredAt,
      categoryTotals: new Map<string, Decimal>(),
    };
    bucket.amount = bucket.amount.plus(row.amountBase);
    bucket.count += 1;
    if (row.occurredAt > bucket.lastOccurredAt) bucket.lastOccurredAt = row.occurredAt;
    if (row.categoryName) {
      bucket.categoryTotals.set(
        row.categoryName,
        (bucket.categoryTotals.get(row.categoryName) ?? new Decimal(0)).plus(row.amountBase),
      );
    }
    map.set(merchant, bucket);
  }

  const items = [...map.entries()]
    .sort((a, b) => b[1].amount.comparedTo(a[1].amount))
    .slice(0, limit)
    .map(([merchant, bucket]) => {
      const top = [...bucket.categoryTotals.entries()].sort((a, b) => b[1].comparedTo(a[1]))[0];
      return {
        merchant,
        amount: roundMoney(bucket.amount).toFixed(6),
        count: bucket.count,
        ratio: total.isZero() ? null : bucket.amount.div(total).toDecimalPlaces(4).toFixed(4),
        lastOccurredAt: bucket.lastOccurredAt.toISOString(),
        topCategoryName: top?.[0] ?? null,
      };
    });

  return {
    items,
    unattributed: { amount: roundMoney(unattributedAmount).toFixed(6), count: unattributedCount },
    total: total.toFixed(6),
  };
}

export async function getMerchants(
  prisma: PrismaClient,
  context: AnalyticsContext,
  fromText: string,
  toText: string,
  limit: number,
): Promise<MerchantResponse> {
  const result = await load(prisma, context, fromText, toText);

  return {
    ...summarizeMerchants(result.rows, limit),
    coverage: computeCoverage(result.rows, result),
    period: result.range,
    basis: buildBasis({
      timezone: context.timezone,
      baseCurrency: context.baseCurrency,
      range: result.range,
      extra: { unattributedExcludedFromRanking: true },
    }),
  };
}

export interface TrendPoint {
  period: string;
  income: string;
  expense: string;
  net: string;
  isComplete: boolean;
}

export interface TrendResponse {
  points: TrendPoint[];
  granularity: Granularity;
  downgraded: boolean;
  totals: { income: string; expense: string; net: string };
  coverage: Coverage;
  period: AnalyticsResult['range'];
  basis: Record<string, unknown>;
}

function defaultGranularity(days: number): Granularity {
  if (days <= 90) return 'day';
  if (days <= 730) return 'week';
  return 'month';
}

function pointCount(days: number, granularity: Granularity): number {
  if (granularity === 'day') return days;
  if (granularity === 'week') return Math.ceil(days / 7) + 1;
  return Math.ceil(days / 28) + 1;
}

export function summarizeTrend(
  rows: AnalyticsRow[],
  from: Date,
  to: Date,
  timezone: string,
  granularity: Granularity,
): TrendPoint[] {
  const keys = enumeratePeriodKeys(from, to, timezone, granularity);
  const buckets = new Map<string, { income: Decimal; expense: Decimal; count: number }>();

  for (const row of rows) {
    if (row.type !== 'income' && row.type !== 'expense') continue;

    const key =
      granularity === 'month' ? row.periodKey : granularity === 'day' ? row.dayKey : weekKeyFromRow(row);

    const bucket = buckets.get(key) ?? { income: new Decimal(0), expense: new Decimal(0), count: 0 };
    if (row.type === 'income') bucket.income = bucket.income.plus(row.amountBase);
    else bucket.expense = bucket.expense.plus(row.amountBase);
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  return keys.map((key) => {
    const bucket = buckets.get(key);
    const income = bucket?.income ?? new Decimal(0);
    const expense = bucket?.expense ?? new Decimal(0);
    return {
      period: key,
      income: roundMoney(income).toFixed(6),
      expense: roundMoney(expense).toFixed(6),
      net: roundMoney(income.minus(expense)).toFixed(6),
      // 该周期没有流水时不完整，不能解释为零支出
      isComplete: (bucket?.count ?? 0) > 0,
    };
  });
}

function weekKeyFromRow(row: AnalyticsRow): string {
  // 复用 period.ts 的周日键：以周一为起点，取该周周日
  const day = new Date(`${row.dayKey}T00:00:00.000Z`);
  const weekday = ((day.getUTCDay() + 6) % 7) + 1; // 1 = 周一
  const end = new Date(day.getTime() + (7 - weekday) * 86_400_000);
  return end.toISOString().slice(0, 10);
}

export async function getTrend(
  prisma: PrismaClient,
  context: AnalyticsContext,
  fromText: string,
  toText: string,
  requested?: Granularity,
): Promise<TrendResponse> {
  const result = await load(prisma, context, fromText, toText);
  const { from, to } = resolveRange(fromText, toText, context.timezone);

  let granularity = requested ?? defaultGranularity(result.range.days);
  let downgraded = false;

  // 点数超限时逐级降级，而不是静默截断
  const ladder: Granularity[] = ['day', 'week', 'month'];
  while (
    pointCount(result.range.days, granularity) > ANALYTICS_MAX_SERIES_POINTS &&
    granularity !== 'month'
  ) {
    granularity = ladder[ladder.indexOf(granularity) + 1]!;
    downgraded = true;
  }

  const points = summarizeTrend(result.rows, from, to, context.timezone, granularity);
  const incomes = incomesOf(result.rows);
  const expenses = expensesOf(result.rows);
  const totalIncome = sumBy(incomes, (row) => row.amountBase);
  const totalExpense = sumBy(expenses, (row) => row.amountBase);

  return {
    points,
    granularity,
    downgraded,
    totals: {
      income: totalIncome.toFixed(6),
      expense: totalExpense.toFixed(6),
      net: roundMoney(totalIncome.minus(totalExpense)).toFixed(6),
    },
    coverage: computeCoverage(result.rows, result),
    period: result.range,
    basis: buildBasis({
      timezone: context.timezone,
      baseCurrency: context.baseCurrency,
      range: result.range,
      extra: { granularity, downgraded },
    }),
  };
}

export interface PeriodComparisonResponse {
  current: { period: AnalyticsResult['range']; summary: IncomeExpenseSummary };
  previous: { period: AnalyticsResult['range']; summary: IncomeExpenseSummary } | null;
  changes: Record<string, string | null>;
  yoy: {
    period: AnalyticsResult['range'];
    summary: IncomeExpenseSummary;
    changes: Record<string, string | null>;
  } | null;
  basis: Record<string, unknown>;
}

export async function getPeriodComparison(
  prisma: PrismaClient,
  context: AnalyticsContext,
  fromText: string,
  toText: string,
  mode: PeriodGranularity | 'custom',
): Promise<PeriodComparisonResponse> {
  const current = await load(prisma, context, fromText, toText);
  const currentSummary = summarizeIncomeExpense(current.rows);

  const previousRange = previousWindow({ fromText, toText, mode }, context.timezone);
  const previous = await load(prisma, context, previousRange.fromText, previousRange.toText);
  const previousSummary = summarizeIncomeExpense(previous.rows);

  const changes = {
    income: changeRatio(
      toDecimal(currentSummary.income),
      toDecimal(previousSummary.income),
    ),
    expense: changeRatio(
      toDecimal(currentSummary.expense),
      toDecimal(previousSummary.expense),
    ),
    net: changeRatio(toDecimal(currentSummary.net), toDecimal(previousSummary.net)),
    savingsRate:
      currentSummary.savingsRate !== null && previousSummary.savingsRate !== null
        ? changeRatio(toDecimal(currentSummary.savingsRate), toDecimal(previousSummary.savingsRate))
        : null,
  };

  const earliest = await prisma.transaction.findFirst({
    where: { userId: context.userId, status: 'posted' },
    orderBy: { occurredAt: 'asc' },
    select: { occurredAt: true },
  });

  const yoyAvailable = hasYearOfHistory(earliest?.occurredAt ?? null, { fromText, toText }, context.timezone);

  let yoy: PeriodComparisonResponse['yoy'] = null;
  if (yoyAvailable) {
    const yoyRange = yearAgoWindow({ fromText, toText, mode }, context.timezone);
    const yoyResult = await load(prisma, context, yoyRange.fromText, yoyRange.toText);
    const yoySummary = summarizeIncomeExpense(yoyResult.rows);
    yoy = {
      period: yoyResult.range,
      summary: yoySummary,
      changes: {
        income: changeRatio(toDecimal(currentSummary.income), toDecimal(yoySummary.income)),
        expense: changeRatio(toDecimal(currentSummary.expense), toDecimal(yoySummary.expense)),
        net: changeRatio(toDecimal(currentSummary.net), toDecimal(yoySummary.net)),
      },
    };
  }

  return {
    current: { period: current.range, summary: currentSummary },
    previous: { period: previous.range, summary: previousSummary },
    changes,
    yoy,
    basis: buildBasis({
      timezone: context.timezone,
      baseCurrency: context.baseCurrency,
      range: current.range,
      extra: { comparisonMode: mode, yoyAvailable },
    }),
  };
}

export interface LargeExpenseItem {
  transactionId: string;
  occurredAt: string;
  description: string;
  merchant: string | null;
  categoryName: string | null;
  uncategorized: boolean;
  amount: string;
  multipleOfMedian: string | null;
}

export interface LargeExpenseResponse {
  threshold: string;
  thresholdSource: 'p95' | 'median_multiple' | 'parameter';
  items: LargeExpenseItem[];
  median: string | null;
  expenseCount: number;
  coverage: Coverage;
  period: AnalyticsResult['range'];
  basis: Record<string, unknown>;
}

export async function getLargeExpenses(
  prisma: PrismaClient,
  context: AnalyticsContext,
  fromText: string,
  toText: string,
  thresholdInput: string | undefined,
  limit: number,
): Promise<LargeExpenseResponse> {
  const result = await load(prisma, context, fromText, toText);
  const expenses = expensesOf(result.rows);
  const values = expenses.map((row) => Number(row.amountBase.toString()));

  const medianValue = median(values);
  const p95 = percentile(values, 0.95);

  let threshold: number;
  let thresholdSource: LargeExpenseResponse['thresholdSource'];

  if (thresholdInput) {
    threshold = Number(thresholdInput);
    thresholdSource = 'parameter';
  } else if (values.length < LARGE_EXPENSE_MIN_SAMPLES || p95 === null) {
    threshold = (medianValue ?? 0) * LARGE_EXPENSE_MEDIAN_MULTIPLE;
    thresholdSource = 'median_multiple';
  } else {
    threshold = p95;
    thresholdSource = 'p95';
  }

  const items = expenses
    .filter((row) => row.amountBase.greaterThanOrEqualTo(toDecimal(threshold)))
    .sort((a, b) => b.amountBase.comparedTo(a.amountBase))
    .slice(0, limit)
    .map((row) => ({
      transactionId: row.transactionId,
      occurredAt: row.occurredAt.toISOString(),
      description: row.description,
      merchant: row.merchant,
      categoryName: row.categoryName,
      uncategorized: row.categoryId === null,
      amount: row.amountBase.toFixed(6),
      multipleOfMedian:
        medianValue && medianValue > 0
          ? Number(row.amountBase.toString()).toFixed(0) === '0'
            ? null
            : (Number(row.amountBase.toString()) / medianValue).toFixed(1)
          : null,
    }));

  return {
    threshold: roundMoney(toDecimal(threshold)).toFixed(6),
    thresholdSource,
    items,
    median: medianValue === null ? null : roundMoney(toDecimal(medianValue)).toFixed(6),
    expenseCount: expenses.length,
    coverage: computeCoverage(result.rows, result),
    period: result.range,
    basis: buildBasis({
      timezone: context.timezone,
      baseCurrency: context.baseCurrency,
      range: result.range,
      extra: { thresholdSource, minSamples: LARGE_EXPENSE_MIN_SAMPLES },
    }),
  };
}

export { ANALYTICS_MAX_SERIES_POINTS, LARGE_EXPENSE_MIN_SAMPLES, LARGE_EXPENSE_MEDIAN_MULTIPLE } from '../../config/constants.js';
