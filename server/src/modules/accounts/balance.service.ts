import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { errors } from '../../lib/errors.js';
import { roundMoney, toDecimal } from '../../lib/money.js';

export interface BalanceResult {
  accountId: string;
  balance: Decimal;
  openingBalance: Decimal;
  openingBalanceDate: Date;
  entryCount: number;
  asOf: Date | null;
  currency: string;
}

/**
 * 账户余额口径：期初余额 + 所有已入账分录之和。
 * 不冗余存储余额字段，避免与分录出现两套权威数据。
 */
export async function computeBalance(
  prisma: PrismaClient,
  params: { userId: string; accountId: string; asOf?: Date | null },
): Promise<BalanceResult> {
  const account = await prisma.account.findFirst({
    where: { id: params.accountId, userId: params.userId },
    select: {
      id: true,
      currency: true,
      openingBalance: true,
      openingBalanceDate: true,
    },
  });

  // 不存在与不属于当前用户返回同一结果，避免账户 ID 枚举
  if (!account) {
    throw errors.notFound('账户不存在');
  }

  const aggregate = await prisma.transactionEntry.aggregate({
    where: {
      accountId: params.accountId,
      userId: params.userId,
      transaction: {
        status: 'posted',
        ...(params.asOf ? { occurredAt: { lte: params.asOf } } : {}),
      },
    },
    _sum: { amount: true },
    _count: { id: true },
  });

  const opening = toDecimal(account.openingBalance.toString());
  const movement = toDecimal(aggregate._sum.amount?.toString() ?? '0');

  return {
    accountId: account.id,
    balance: roundMoney(opening.plus(movement)),
    openingBalance: opening,
    openingBalanceDate: account.openingBalanceDate,
    entryCount: aggregate._count.id,
    asOf: params.asOf ?? null,
    currency: account.currency,
  };
}

/** 批量计算多个账户余额，供列表与 Dashboard 使用 */
export async function computeBalances(
  prisma: PrismaClient,
  params: { userId: string; accountIds: string[]; asOf?: Date | null },
): Promise<Map<string, Decimal>> {
  const result = new Map<string, Decimal>();
  if (params.accountIds.length === 0) return result;

  const accounts = await prisma.account.findMany({
    where: { userId: params.userId, id: { in: params.accountIds } },
    select: { id: true, openingBalance: true },
  });

  const grouped = await prisma.transactionEntry.groupBy({
    by: ['accountId'],
    where: {
      userId: params.userId,
      accountId: { in: params.accountIds },
      transaction: {
        status: 'posted',
        ...(params.asOf ? { occurredAt: { lte: params.asOf } } : {}),
      },
    },
    _sum: { amount: true },
  });

  const movements = new Map<string, Decimal>();
  for (const row of grouped) {
    if (row.accountId) {
      movements.set(row.accountId, toDecimal(row._sum.amount?.toString() ?? '0'));
    }
  }

  for (const account of accounts) {
    const opening = toDecimal(account.openingBalance.toString());
    const movement = movements.get(account.id) ?? new Decimal(0);
    result.set(account.id, roundMoney(opening.plus(movement)));
  }

  return result;
}
