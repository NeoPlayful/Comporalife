import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { roundMoney } from '../../lib/money.js';

export interface CashflowPoint {
  period: string;
  income: Decimal;
  expense: Decimal;
  net: Decimal;
  /** 该月没有任何流水时可视为不完整，不能解释为零支出 */
  isComplete: boolean;
}

export interface CashflowResult {
  points: CashflowPoint[];
  totalIncome: Decimal;
  totalExpense: Decimal;
  totalNet: Decimal;
  savingsRate: Decimal | null;
  transferTotal: Decimal;
  timezone: string;
  isComplete: boolean;
}

/**
 * 现金流统计：
 * - 按用户时区划分自然月
 * - 转账与调整不计入收入或支出
 * - 收入为 0 时储蓄率返回 null，而不是 0
 */
export async function computeCashflow(
  prisma: PrismaClient,
  params: { userId: string; timezone: string; from: Date; to: Date },
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
      entries: { where: { accountId: { not: null } }, select: { amount: true } },
    },
  });

  const buckets = new Map<string, { income: Decimal; expense: Decimal; transfer: Decimal; count: number }>();

  for (const transaction of transactions) {
    const period = formatInTimeZone(transaction.occurredAt, params.timezone, 'yyyy-MM');
    const bucket = buckets.get(period) ?? {
      income: new Decimal(0),
      expense: new Decimal(0),
      transfer: new Decimal(0),
      count: 0,
    };

    // 账户腿金额：收入为正，支出为负
    const movement = transaction.entries.reduce(
      (sum, entry) => sum.plus(entry.amount.toString()),
      new Decimal(0),
    );

    if (transaction.type === 'income') {
      bucket.income = bucket.income.plus(movement.abs());
      bucket.count += 1;
    } else if (transaction.type === 'expense') {
      bucket.expense = bucket.expense.plus(movement.abs());
      bucket.count += 1;
    } else if (transaction.type === 'transfer') {
      // 转账两侧一正一负、求和恒为零，必须取转出侧绝对值才是划转金额
      const outflow = transaction.entries.reduce(
        (sum, entry) => {
          const amount = new Decimal(entry.amount.toString());
          return amount.isNegative() ? sum.plus(amount.abs()) : sum;
        },
        new Decimal(0),
      );
      bucket.transfer = bucket.transfer.plus(outflow);
    }
    // adjustment 计入余额变化但不进入收支统计

    buckets.set(period, bucket);
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
      isComplete: (bucket?.count ?? 0) > 0,
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

