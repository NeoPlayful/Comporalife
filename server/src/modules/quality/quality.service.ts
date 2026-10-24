import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import {
  DUPLICATE_WINDOW_DAYS,
  INVESTMENT_PRICE_STALE_DAYS,
  QUALITY_ITEM_LIMIT,
  QUALITY_LOOKBACK_MONTHS,
  RATE_STALE_DAYS,
} from '../../config/constants.js';
import { moneyToString, roundMoney, toDecimal } from '../../lib/money.js';
import { loadAllPortfolioValuations } from '../portfolios/valuation.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface QualityContext {
  userId: string;
  timezone: string;
  baseCurrency: string;
}

export interface QualityMetric {
  /** 指标键，前端据此选文案 */
  key: string;
  /** 计数；样本不足时为 null，绝不返回 0 冒充「没有问题」 */
  count: number | null;
  /** 判定口径的稳定键，由前端翻译 */
  rule: string;
  /** 计数不可用的原因码 */
  unavailableReason: string | null;
}

export interface QualitySummary {
  checkedAt: string;
  lookbackMonths: number;
  metrics: QualityMetric[];
  isComplete: boolean;
}

export interface DuplicateCandidate {
  transactionId: string;
  accountId: string;
  accountName: string;
  occurredAt: string;
  description: string;
  amount: string;
  currency: string;
  conflictingTransactionId: string;
  conflictingOccurredAt: string;
  conflictingDescription: string;
  dayGap: number;
}

function monthEnd(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** 最近 N 个完整月的月份键（yyyy-MM），从旧到新 */
export function recentMonthKeys(now: Date, months: number): string[] {
  const keys: string[] = [];
  for (let offset = months; offset >= 1; offset -= 1) {
    const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    keys.push(`${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

/**
 * 未分类流水：只统计已过账的支出。
 * 转账与投资转换天然没有消费分类，计入会让指标长期偏高，
 * 用户会逐渐忽略它——指标一旦失去可信度就没有意义。
 */
export async function countUncategorized(
  prisma: PrismaClient,
  context: QualityContext,
): Promise<QualityMetric> {
  const count = await prisma.transaction.count({
    where: {
      userId: context.userId,
      status: 'posted',
      type: { in: ['expense', 'income'] },
      categoryId: null,
    },
  });

  return {
    key: 'uncategorized',
    count,
    rule: 'posted_income_expense_without_category',
    unavailableReason: null,
  };
}

/**
 * 疑似重复：同账户、金额相同、日期相差不超过窗口天数，且不是同一条交易。
 *
 * 只用账本本身的信号（账户 + 金额 + 日期），不依赖导入指纹：
 * 指纹在导入时已经用于阻断完全重复，这里要找的是「手工补录 + 导入」
 * 这类跨来源的重复，指纹覆盖不到。
 */
export async function findDuplicateCandidates(
  prisma: PrismaClient,
  context: QualityContext,
  options: { limit?: number; windowDays?: number } = {},
): Promise<{ items: DuplicateCandidate[]; total: number; truncated: boolean }> {
  const limit = options.limit ?? QUALITY_ITEM_LIMIT;
  const windowDays = options.windowDays ?? DUPLICATE_WINDOW_DAYS;

  const accounts = await prisma.account.findMany({
    where: { userId: context.userId },
    select: { id: true, name: true },
  });
  const accountName = new Map(accounts.map((account) => [account.id, account.name]));

  const entries = await prisma.transactionEntry.findMany({
    where: {
      userId: context.userId,
      accountId: { not: null },
      transaction: { status: 'posted', type: { in: ['income', 'expense'] } },
    },
    select: {
      accountId: true,
      amount: true,
      transaction: {
        select: { id: true, occurredAt: true, description: true },
      },
    },
    orderBy: { transaction: { occurredAt: 'asc' } },
  });

  // 同账户同金额分桶，桶内再按日期窗口两两比对；
  // 直接全量两两比对在万级流水下会退化成立方复杂度
  const buckets = new Map<string, Array<{ id: string; occurredAt: Date; description: string; amount: string }>>();

  for (const entry of entries) {
    if (!entry.accountId) continue;
    const amount = toDecimal(entry.amount.toString());
    // 同一交易的两条分录（A 账户 -100、B 账户 +100）不构成本账户内的重复
    const key = `${entry.accountId}|${amount.toFixed(6)}`;
    const list = buckets.get(key) ?? [];
    list.push({
      id: entry.transaction.id,
      occurredAt: entry.transaction.occurredAt,
      description: entry.transaction.description,
      amount: amount.toFixed(6),
    });
    buckets.set(key, list);
  }

  const seen = new Set<string>();
  const items: DuplicateCandidate[] = [];

  for (const [key, list] of buckets) {
    if (list.length < 2) continue;
    const [accountId] = key.split('|');

    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const left = list[i]!;
        const right = list[j]!;
        if (left.id === right.id) continue;

        const dayGap = Math.round(Math.abs(right.occurredAt.getTime() - left.occurredAt.getTime()) / DAY_MS);
        if (dayGap > windowDays) continue;

        const pairKey = left.id < right.id ? `${left.id}|${right.id}` : `${right.id}|${left.id}`;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        const [first, second] = left.occurredAt <= right.occurredAt ? [left, right] : [right, left];

        items.push({
          transactionId: first.id,
          accountId: accountId!,
          accountName: accountName.get(accountId!) ?? '',
          occurredAt: first.occurredAt.toISOString(),
          description: first.description,
          amount: moneyToString(toDecimal(first.amount)),
          currency: context.baseCurrency,
          conflictingTransactionId: second.id,
          conflictingOccurredAt: second.occurredAt.toISOString(),
          conflictingDescription: second.description,
          dayGap,
        });
      }
    }
  }

  items.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  return {
    items: items.slice(0, limit),
    total: items.length,
    truncated: items.length > limit,
  };
}

/**
 * 缺失月份：最近 N 个完整月中，某个启用账户整月没有任何流水。
 *
 * 只对有流水的账户判定：新开账户在开户前没有流水是正常的，
 * 用开户日过滤掉这段区间，否则每个新账户都会制造虚假缺失。
 */
export async function findMissingMonths(
  prisma: PrismaClient,
  context: QualityContext,
  options: { months?: number } = {},
): Promise<{ months: string[]; accounts: Array<{ accountId: string; name: string; missing: string[] }> }> {
  const months = options.months ?? QUALITY_LOOKBACK_MONTHS;
  const keys = recentMonthKeys(new Date(), months);

  const accounts = await prisma.account.findMany({
    where: { userId: context.userId, status: 'active' },
    select: { id: true, name: true, createdAt: true, openingBalanceDate: true },
  });

  if (accounts.length === 0) return { months: [], accounts: [] };

  const entries = await prisma.transactionEntry.findMany({
    where: {
      userId: context.userId,
      accountId: { in: accounts.map((account) => account.id) },
      transaction: { status: 'posted' },
    },
    select: {
      accountId: true,
      transaction: { select: { occurredAt: true } },
    },
  });

  const present = new Map<string, Set<string>>();
  const firstActivity = new Map<string, Date>();

  for (const entry of entries) {
    if (!entry.accountId) continue;
    const occurredAt = entry.transaction.occurredAt;
    const key = `${occurredAt.getUTCFullYear()}-${String(occurredAt.getUTCMonth() + 1).padStart(2, '0')}`;
    const set = present.get(entry.accountId) ?? new Set<string>();
    set.add(key);
    present.set(entry.accountId, set);

    const earliest = firstActivity.get(entry.accountId);
    if (!earliest || occurredAt < earliest) firstActivity.set(entry.accountId, occurredAt);
  }

  const allMissing = new Set<string>();
  const perAccount: Array<{ accountId: string; name: string; missing: string[] }> = [];

  for (const account of accounts) {
    // 从「开户日与首笔流水日取较晚者」所在月开始判定
    const anchor = firstActivity.get(account.id);
    if (!anchor) continue;

    const anchorKey = `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, '0')}`;
    const set = present.get(account.id) ?? new Set<string>();
    // 当前月不是完整月，不参与判定
    const missing = keys.filter((key) => key >= anchorKey && !set.has(key));

    if (missing.length > 0) {
      for (const key of missing) allMissing.add(key);
      perAccount.push({ accountId: account.id, name: account.name, missing });
    }
  }

  return { months: [...allMissing].sort(), accounts: perAccount };
}

/** 过期估值：组合最新估值日期距今超过阈值，或从未估值 */
export async function findStaleValuations(
  prisma: PrismaClient,
  context: QualityContext,
): Promise<{
  items: Array<{ portfolioId: string; name: string; priceDate: string | null; daysStale: number | null; missingSymbols: string[] }>;
  total: number;
}> {
  const summaries = await loadAllPortfolioValuations(prisma, {
    userId: context.userId,
    asOf: new Date(),
  });

  const items = summaries
    .filter((summary) => summary.stale || summary.missingSymbols.length > 0)
    .map((summary) => {
      const daysStale = summary.priceDate
        ? Math.floor((Date.now() - new Date(summary.priceDate).getTime()) / DAY_MS)
        : null;

      return {
        portfolioId: summary.portfolioId,
        name: summary.name,
        priceDate: summary.priceDate,
        daysStale,
        missingSymbols: summary.missingSymbols,
      };
    });

  return { items, total: items.length };
}

/**
 * 汇率滞后：账户币种与基准币种不同，但最新汇率早于阈值天数，或干脆没有。
 */
export async function findRateLag(
  prisma: PrismaClient,
  context: QualityContext,
): Promise<{
  items: Array<{ from: string; to: string; latestDate: string | null; daysLag: number | null }>;
  total: number;
}> {
  const accounts = await prisma.account.findMany({
    where: { userId: context.userId, status: 'active' },
    select: { currency: true },
  });
  const portfolios = await prisma.portfolio.findMany({
    where: { userId: context.userId, status: 'active' },
    select: { currency: true },
  });

  const currencies = new Set<string>();
  for (const account of accounts) currencies.add(account.currency);
  for (const portfolio of portfolios) currencies.add(portfolio.currency);
  currencies.delete(context.baseCurrency);

  const items: Array<{ from: string; to: string; latestDate: string | null; daysLag: number | null }> = [];

  for (const currency of currencies) {
    const latest = await prisma.exchangeRate.findFirst({
      where: {
        userId: context.userId,
        OR: [
          { baseCurrency: currency, quoteCurrency: context.baseCurrency },
          { baseCurrency: context.baseCurrency, quoteCurrency: currency },
        ],
      },
      orderBy: { rateDate: 'desc' },
      select: { rateDate: true },
    });

    const latestDate = latest ? latest.rateDate.toISOString().slice(0, 10) : null;
    const daysLag = latest
      ? Math.floor((Date.now() - latest.rateDate.getTime()) / DAY_MS)
      : null;

    if (daysLag === null || daysLag > RATE_STALE_DAYS) {
      items.push({ from: currency, to: context.baseCurrency, latestDate, daysLag });
    }
  }

  return { items, total: items.length };
}

/** 导入失败统计：只读导入批次，不触发任何重试 */
export async function countImportFailures(
  prisma: PrismaClient,
  context: QualityContext,
): Promise<{ batches: number; rows: number }> {
  const batches = await prisma.importBatch.findMany({
    where: { userId: context.userId, status: 'failed' },
    select: { invalidRows: true },
  });

  return {
    batches: batches.length,
    rows: batches.reduce((sum, batch) => sum + batch.invalidRows, 0),
  };
}

export async function getQualitySummary(
  prisma: PrismaClient,
  context: QualityContext,
): Promise<QualitySummary> {
  const [uncategorized, duplicates, missing, staleValuations, rateLag, importFailures] = await Promise.all([
    countUncategorized(prisma, context),
    findDuplicateCandidates(prisma, context, { limit: 1 }),
    findMissingMonths(prisma, context),
    findStaleValuations(prisma, context),
    findRateLag(prisma, context),
    countImportFailures(prisma, context),
  ]);

  const hasAnyAccount = await prisma.account.count({ where: { userId: context.userId } });

  const metrics: QualityMetric[] = [
    uncategorized,
    {
      key: 'duplicates',
      count: duplicates.total,
      rule: `same_account_amount_within_${DUPLICATE_WINDOW_DAYS}_days`,
      unavailableReason: null,
    },
    hasAnyAccount === 0
      ? {
          key: 'missing_months',
          count: null,
          rule: `complete_months_without_entries_${QUALITY_LOOKBACK_MONTHS}m`,
          unavailableReason: 'no_accounts',
        }
      : {
          key: 'missing_months',
          count: missing.months.length,
          rule: `complete_months_without_entries_${QUALITY_LOOKBACK_MONTHS}m`,
          unavailableReason: null,
        },
    {
      key: 'stale_valuations',
      count: staleValuations.total,
      rule: `price_age_over_${INVESTMENT_PRICE_STALE_DAYS}_days`,
      unavailableReason: null,
    },
    {
      key: 'rate_lag',
      count: rateLag.total,
      rule: `rate_age_over_${RATE_STALE_DAYS}_days`,
      unavailableReason: null,
    },
    {
      key: 'import_failures',
      count: importFailures.batches,
      rule: 'failed_import_batches',
      unavailableReason: null,
    },
  ];

  return {
    checkedAt: new Date().toISOString(),
    lookbackMonths: QUALITY_LOOKBACK_MONTHS,
    metrics,
    isComplete: metrics.every((metric) => metric.unavailableReason === null),
  };
}

export interface UncategorizedItem {
  transactionId: string;
  occurredAt: string;
  description: string;
  merchant: string | null;
  amount: string;
  currency: string;
  accountId: string | null;
  accountName: string | null;
  type: string;
  daysOld: number;
}

export async function listUncategorized(
  prisma: PrismaClient,
  context: QualityContext,
  options: { limit?: number; offset?: number } = {},
): Promise<{ items: UncategorizedItem[]; total: number }> {
  const limit = options.limit ?? QUALITY_ITEM_LIMIT;
  const offset = options.offset ?? 0;

  const [total, rows] = await Promise.all([
    prisma.transaction.count({
      where: {
        userId: context.userId,
        status: 'posted',
        type: { in: ['expense', 'income'] },
        categoryId: null,
      },
    }),
    prisma.transaction.findMany({
      where: {
        userId: context.userId,
        status: 'posted',
        type: { in: ['expense', 'income'] },
        categoryId: null,
      },
      orderBy: { occurredAt: 'asc' },
      skip: offset,
      take: limit,
      select: {
        id: true,
        occurredAt: true,
        description: true,
        merchant: true,
        type: true,
        entries: {
          select: {
            amount: true,
            currency: true,
            accountId: true,
            account: { select: { name: true } },
          },
          take: 1,
        },
      },
    }),
  ]);

  return {
    total,
    items: rows.map((row) => {
      const entry = row.entries[0];
      const amount = entry ? toDecimal(entry.amount.toString()).abs() : new Decimal(0);

      return {
        transactionId: row.id,
        occurredAt: row.occurredAt.toISOString(),
        description: row.description,
        merchant: row.merchant,
        amount: moneyToString(roundMoney(amount)),
        currency: entry?.currency ?? context.baseCurrency,
        accountId: entry?.accountId ?? null,
        accountName: entry?.account?.name ?? null,
        type: row.type,
        daysOld: Math.floor((Date.now() - row.occurredAt.getTime()) / DAY_MS),
      };
    }),
  };
}

/** 月份边界供报表与导出复用 */
export { monthEnd, monthStart };
