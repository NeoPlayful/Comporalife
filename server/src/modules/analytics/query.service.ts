import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { ANALYTICS_MAX_RANGE_DAYS } from '../../config/constants.js';
import { errors } from '../../lib/errors.js';
import { roundMoney, toDecimal } from '../../lib/money.js';
import { resolveRate } from '../currencies/currency.service.js';
import { dayKeyOf, periodKeyOf, resolveRange } from './period.js';

export type AnalyticsTransactionType = 'income' | 'expense' | 'transfer' | 'adjustment';

export interface AnalyticsRow {
  transactionId: string;
  type: AnalyticsTransactionType;
  occurredAt: Date;
  dayKey: string;
  periodKey: string;
  description: string;
  merchant: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryParentId: string | null;
  categoryParentName: string | null;
  categoryKind: 'income' | 'expense' | null;
  /** 账户腿绝对值，原币 */
  originalAmount: Decimal;
  /** 账户腿带符号金额，原币；转账方向由此判断 */
  signedAmount: Decimal;
  currency: string;
  /** 折合基准币种，按交易日汇率 */
  amountBase: Decimal;
  accountId: string;
  accountName: string;
  accountType: string;
  importBatchId: string | null;
}

export interface MissingRate {
  currency: string;
  date: string;
}

export interface AnalyticsResult {
  rows: AnalyticsRow[];
  missingRates: MissingRate[];
  excludedCount: number;
  isComplete: boolean;
  range: { from: string; to: string; days: number };
}

export interface AnalyticsQuery {
  userId: string;
  /** 用户时区下的自然日 yyyy-MM-dd */
  fromText: string;
  toText: string;
  timezone: string;
  baseCurrency: string;
  accountIds?: string[];
}

/**
 * 分析取数层：所有分析接口的唯一数据来源。
 *
 * 口径要点：
 * - 只取 posted，冲正交易一律排除
 * - 每笔取「账户腿」绝对值作为金额，转账只算单腿
 * - 逐笔按交易日汇率折算，绝不用当前汇率回算历史区间
 * - 缺汇率的流水被剔除并记录，不按 1:1 静默处理
 */
export async function loadAnalyticsRows(
  prisma: PrismaClient,
  query: AnalyticsQuery,
): Promise<AnalyticsResult> {
  const { from, to, days } = resolveRange(query.fromText, query.toText, query.timezone);

  if (from > to) {
    throw errors.analyticsRangeInvalid('起始日期不能晚于结束日期');
  }
  if (days > ANALYTICS_MAX_RANGE_DAYS) {
    throw errors.analyticsRangeTooLarge(ANALYTICS_MAX_RANGE_DAYS);
  }

  const transactions = await prisma.transaction.findMany({
    where: {
      userId: query.userId,
      status: 'posted',
      occurredAt: { gte: from, lte: to },
      ...(query.accountIds && query.accountIds.length > 0
        ? { entries: { some: { accountId: { in: query.accountIds } } } }
        : {}),
    },
    orderBy: { occurredAt: 'asc' },
    select: {
      id: true,
      type: true,
      occurredAt: true,
      description: true,
      merchant: true,
      importBatchId: true,
      category: {
        select: {
          id: true,
          name: true,
          kind: true,
          parentId: true,
          parent: { select: { name: true } },
        },
      },
      entries: {
        where: { accountId: { not: null } },
        select: {
          accountId: true,
          amount: true,
          currency: true,
          account: { select: { name: true, type: true } },
        },
      },
    },
  });

  const rows: AnalyticsRow[] = [];
  const missingRates = new Map<string, MissingRate>();
  let excludedCount = 0;

  // 同一币种在同一天多次出现时只查一次汇率
  const rateCache = new Map<string, Decimal | null>();

  for (const tx of transactions) {
    // 收入/支出只有一个账户腿，取首条；转账与调整有两条真实腿，
    // 逐腿生成一行，账户维度才能同时看到转出与转入
    const entries =
      tx.type === 'transfer' || tx.type === 'adjustment'
        ? tx.entries
        : tx.entries.slice(0, 1);

    for (const entry of entries) {
      if (!entry.accountId) continue;

      const currency = entry.currency;
      const signedAmount = roundMoney(toDecimal(entry.amount.toString()));
      const originalAmount = signedAmount.abs();
      const dayKey = dayKeyOf(tx.occurredAt, query.timezone);

      let amountBase = originalAmount;
      if (currency !== query.baseCurrency) {
        const cacheKey = `${currency}|${dayKey}`;
        let rate = rateCache.get(cacheKey);

        if (rate === undefined) {
          const resolved = await resolveRate(prisma, {
            userId: query.userId,
            from: currency,
            to: query.baseCurrency,
            asOf: tx.occurredAt,
          });
          rate = resolved ? resolved.rate : null;
          rateCache.set(cacheKey, rate);
        }

        if (rate === null) {
          missingRates.set(cacheKey, { currency, date: dayKey });
          excludedCount += 1;
          continue;
        }

        amountBase = roundMoney(originalAmount.mul(rate));
      }

      rows.push({
        transactionId: tx.id,
        type: tx.type,
        occurredAt: tx.occurredAt,
        dayKey,
        periodKey: periodKeyOf(tx.occurredAt, query.timezone, 'month'),
        description: tx.description,
        merchant: tx.merchant,
        categoryId: tx.category?.id ?? null,
        categoryName: tx.category?.name ?? null,
        categoryParentId: tx.category?.parentId ?? null,
        categoryParentName: tx.category?.parent?.name ?? null,
        categoryKind: tx.category?.kind ?? null,
        originalAmount,
        signedAmount,
        currency,
        amountBase,
        accountId: entry.accountId,
        accountName: entry.account?.name ?? '',
        accountType: entry.account?.type ?? '',
        importBatchId: tx.importBatchId,
      });
    }
  }

  const missingRateList = [...missingRates.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency),
  );

  return {
    rows,
    missingRates: missingRateList,
    excludedCount,
    isComplete: missingRateList.length === 0,
    range: {
      from: formatInTimeZone(from, query.timezone, 'yyyy-MM-dd'),
      to: formatInTimeZone(to, query.timezone, 'yyyy-MM-dd'),
      days,
    },
  };
}

/** 只有收入与支出进入收支统计；转账与调整永远不是消费 */
export function isConsumption(row: AnalyticsRow): boolean {
  return row.type === 'income' || row.type === 'expense';
}

export function sumBy(rows: AnalyticsRow[], selector: (row: AnalyticsRow) => Decimal): Decimal {
  return roundMoney(rows.reduce((sum, row) => sum.plus(selector(row)), new Decimal(0)));
}
