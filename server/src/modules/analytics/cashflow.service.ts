import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { roundMoney } from '../../lib/money.js';
import { resolveRate } from '../currencies/currency.service.js';

export interface CashflowPoint {
  period: string;
  income: Decimal;
  expense: Decimal;
  net: Decimal;
  /** 该月没有任何流水时可视为不完整，不能解释为零支出 */
  isComplete: boolean;
  /** 该月因缺汇率被排除的币种对，非空时金额偏低 */
  missingRates: string[];
}

export interface CashflowResult {
  points: CashflowPoint[];
  totalIncome: Decimal;
  totalExpense: Decimal;
  totalNet: Decimal;
  savingsRate: Decimal | null;
  transferTotal: Decimal;
  timezone: string;
  baseCurrency: string;
  missingRates: string[];
  isComplete: boolean;
}

/**
 * 现金流统计：
 * - 按用户时区划分自然月
 * - 转账与调整不计入收入或支出
 * - 收入为 0 时储蓄率返回 null，而不是 0
 * - 非基准币种的流水按交易日汇率折算；缺汇率时该笔排除并计入 missingRates，
 *   绝不把不同币种的金额直接相加
 */
export async function computeCashflow(
  prisma: PrismaClient,
  params: { userId: string; timezone: string; baseCurrency: string; from: Date; to: Date },
): Promise<CashflowResult> {
  const transactions = await prisma.transaction.findMany({
    where: {
      userId: params.userId,
      status: 'posted',
      occurredAt: { gte: params.from, lte: params.to },
      type: { in: ['income', 'expense', 'transfer', 'adjustment'] },
    },
    select: {
      type: true,
      occurredAt: true,
      entries: { where: { accountId: { not: null } }, select: { amount: true, currency: true } },
    },
  });

  // 同一币种在同一天只查一次汇率
  const rateCache = new Map<string, Decimal | null>();
  const allMissingRates = new Set<string>();

  async function toBase(amount: Decimal, currency: string, occurredAt: Date): Promise<Decimal | null> {
    if (currency === params.baseCurrency) return amount;

    const cacheKey = `${currency}|${formatInTimeZone(occurredAt, params.timezone, 'yyyy-MM-dd')}`;
    let rate = rateCache.get(cacheKey);

    if (rate === undefined) {
      const resolved = await resolveRate(prisma, {
        userId: params.userId,
        from: currency,
        to: params.baseCurrency,
        asOf: occurredAt,
      });
      rate = resolved ? resolved.rate : null;
      rateCache.set(cacheKey, rate);
    }

    if (rate === null) {
      allMissingRates.add(`${currency}->${params.baseCurrency}`);
      return null;
    }

    return amount.mul(rate);
  }

  const buckets = new Map<
    string,
    {
      income: Decimal;
      expense: Decimal;
      transfer: Decimal;
      count: number;
      missingRates: Set<string>;
    }
  >();

  function bucketOf(period: string) {
    let bucket = buckets.get(period);
    if (!bucket) {
      bucket = {
        income: new Decimal(0),
        expense: new Decimal(0),
        transfer: new Decimal(0),
        count: 0,
        missingRates: new Set<string>(),
      };
      buckets.set(period, bucket);
    }
    return bucket;
  }

  for (const transaction of transactions) {
    const period = formatInTimeZone(transaction.occurredAt, params.timezone, 'yyyy-MM');
    const bucket = bucketOf(period);

    if (transaction.type === 'adjustment') continue; // 影响余额但不进入收支统计

    if (transaction.type === 'transfer') {
      // 转账两侧一正一负、求和恒为零，必须取转出侧的绝对值才是划转金额
      for (const entry of transaction.entries) {
        const amount = new Decimal(entry.amount.toString());
        if (!amount.isNegative()) continue;
        const converted = await toBase(amount.abs(), entry.currency, transaction.occurredAt);
        if (converted === null) {
          bucket.missingRates.add(`${entry.currency}->${params.baseCurrency}`);
          continue;
        }
        bucket.transfer = bucket.transfer.plus(converted);
      }
      continue;
    }

    // 逐条腿先折算到基准币种再累加，避免不同币种的金额直接相加
    let converted = new Decimal(0);
    let excluded = false;
    for (const entry of transaction.entries) {
      const amount = new Decimal(entry.amount.toString()).abs();
      if (amount.isZero()) continue;
      const value = await toBase(amount, entry.currency, transaction.occurredAt);
      if (value === null) {
        excluded = true;
        bucket.missingRates.add(`${entry.currency}->${params.baseCurrency}`);
        continue;
      }
      converted = converted.plus(value);
    }

    if (excluded) continue;

    if (transaction.type === 'income') {
      bucket.income = bucket.income.plus(converted);
    } else {
      bucket.expense = bucket.expense.plus(converted);
    }
    bucket.count += 1;
  }

  const points: CashflowPoint[] = [];
  const months = enumerateMonths(params.from, params.to, params.timezone);

  let totalIncome = new Decimal(0);
  let totalExpense = new Decimal(0);
  let transferTotal = new Decimal(0);

  for (const period of months) {
    const bucket = buckets.get(period);
    const income = roundMoney(bucket?.income ?? 0);
    const expense = roundMoney(bucket?.expense ?? 0);

    totalIncome = totalIncome.plus(income);
    totalExpense = totalExpense.plus(expense);
    transferTotal = transferTotal.plus(bucket?.transfer ?? 0);

    points.push({
      period,
      income,
      expense,
      net: roundMoney(income.minus(expense)),
      // 缺汇率的月份金额偏低，不能当作完整数据参与均值或年化
      isComplete: (bucket?.count ?? 0) > 0 && (bucket?.missingRates.size ?? 0) === 0,
      missingRates: [...(bucket?.missingRates ?? [])],
    });
  }

  const totalNet = roundMoney(totalIncome.minus(totalExpense));

  return {
    points,
    totalIncome: roundMoney(totalIncome),
    totalExpense: roundMoney(totalExpense),
    totalNet,
    // 收入为零时储蓄率不可计算
    savingsRate: totalIncome.isZero() ? null : totalNet.div(totalIncome).toDecimalPlaces(4),
    transferTotal: roundMoney(transferTotal),
    timezone: params.timezone,
    baseCurrency: params.baseCurrency,
    missingRates: [...allMissingRates],
    isComplete: points.length > 0 && points.every((point) => point.isComplete),
  };
}

function enumerateMonths(from: Date, to: Date, timezone: string): string[] {
  const months: string[] = [];
  const startKey = formatInTimeZone(from, timezone, 'yyyy-MM');
  const endKey = formatInTimeZone(to, timezone, 'yyyy-MM');
  let cursor = startKey;

  // 逐月推进到区间终点所在月份；区间可以落在月中，不要求对齐自然月
  while (true) {
    months.push(cursor);
    if (cursor === endKey) break;

    const next = nextMonth(cursor);
    // 防御：区间终点早于起点或月份推进异常时终止
    if (next > endKey) break;
    cursor = next;
  }

  return months;
}

function nextMonth(period: string): string {
  const [yearPart, monthPart] = period.split('-');
  const year = Number(yearPart);
  const month = Number(monthPart);

  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
}

