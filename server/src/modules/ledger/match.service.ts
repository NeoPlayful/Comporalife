import type { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { errors } from '../../lib/errors.js';
import { normalizeDescription } from '../imports/parser/fingerprint.js';

/**
 * 转账匹配：把两条方向相反、金额相同的普通流水合并为一条转账交易。
 * 原交易一律冲正（不复活），匹配关系写入 note，保证审计链单向可追溯。
 */

const MATCH_WINDOW_DAYS = 3;

export interface MatchCandidate {
  outgoing: TransactionSummary;
  incoming: TransactionSummary;
  score: number;
  reasons: string[];
}

export interface TransactionSummary {
  id: string;
  type: string;
  occurredAt: Date;
  description: string;
  merchant: string | null;
  note: string | null;
  amount: string;
  currency: string;
  accountId: string;
  accountName: string;
  externalId: string | null;
}

interface LoadedTransaction {
  id: string;
  type: string;
  occurredAt: Date;
  description: string;
  merchant: string | null;
  note: string | null;
  externalId: string | null;
  status: string;
  entries: Array<{ accountId: string | null; amount: { toString(): string }; currency: string; account: { name: string } | null }>;
}

export async function loadUnmatchedTransactions(
  prisma: PrismaClient,
  userId: string,
  filter: { accountId?: string; from?: Date; to?: Date; limit: number },
): Promise<TransactionSummary[]> {
  const rows = (await prisma.transaction.findMany({
    where: {
      userId,
      status: 'posted',
      type: { in: ['income', 'expense'] },
      // SQL 中 NOT LIKE 对 NULL 求值为 NULL，必须显式包含无备注的交易
      OR: [{ note: null }, { note: { not: { contains: '已匹配为转账' } } }],
      ...(filter.from || filter.to
        ? {
            occurredAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
      ...(filter.accountId ? { entries: { some: { accountId: filter.accountId } } } : {}),
    },
    orderBy: { occurredAt: 'desc' },
    take: filter.limit,
    select: {
      id: true,
      type: true,
      occurredAt: true,
      description: true,
      merchant: true,
      note: true,
      externalId: true,
      status: true,
      entries: {
        where: { accountId: { not: null } },
        select: {
          accountId: true,
          amount: true,
          currency: true,
          account: { select: { name: true } },
        },
      },
    },
  })) as LoadedTransaction[];

  return rows
    .filter((row) => row.entries.length === 1)
    .map((row) => {
      const entry = row.entries[0]!;
      return {
        id: row.id,
        type: row.type,
        occurredAt: row.occurredAt,
        description: row.description,
        merchant: row.merchant,
        note: row.note,
        amount: entry.amount.toString(),
        currency: entry.currency,
        accountId: entry.accountId!,
        accountName: entry.account?.name ?? '',
        externalId: row.externalId,
      };
    });
}

/** 候选配对：不同账户、方向相反、金额相等、币种相同、日期相近 */
export function buildCandidates(transactions: TransactionSummary[]): MatchCandidate[] {
  const outgoing = transactions.filter((tx) => new Decimal(tx.amount).isNegative());
  const incoming = transactions.filter((tx) => !new Decimal(tx.amount).isNegative());
  const candidates: MatchCandidate[] = [];

  for (const out of outgoing) {
    for (const inc of incoming) {
      if (out.accountId === inc.accountId) continue;
      if (out.currency !== inc.currency) continue;

      const outMagnitude = new Decimal(out.amount).abs();
      const incMagnitude = new Decimal(inc.amount).abs();
      if (!outMagnitude.equals(incMagnitude)) continue;

      const dayDiff = Math.abs(out.occurredAt.getTime() - inc.occurredAt.getTime()) / 86_400_000;
      if (dayDiff > MATCH_WINDOW_DAYS) continue;

      const reasons: string[] = [];
      let score = 0;

      if (out.externalId && inc.externalId && out.externalId === inc.externalId) {
        score += 3;
        reasons.push('流水号相同');
      }
      if (dayDiff < 1) {
        score += 2;
        reasons.push('同一天');
      }

      const outText = normalizeDescription(`${out.description} ${out.merchant ?? ''}`);
      const incText = normalizeDescription(`${inc.description} ${inc.merchant ?? ''}`);

      if (outText.length > 0 && incText.length > 0 && (outText.includes(incText) || incText.includes(outText))) {
        score += 1;
        reasons.push('描述相似');
      }

      const outAccountName = normalizeDescription(out.accountName);
      const incAccountName = normalizeDescription(inc.accountName);
      if (outAccountName && incText.includes(outAccountName)) {
        score += 1;
        reasons.push('描述包含账户名');
      }
      if (incAccountName && outText.includes(incAccountName)) {
        score += 1;
        reasons.push('描述包含账户名');
      }

      candidates.push({ outgoing: out, incoming: inc, score, reasons });
    }
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 50);
}

function singleRealEntry(tx: LoadedTransaction) {
  const real = tx.entries.filter((entry) => entry.accountId !== null);
  if (real.length !== 1) throw errors.transferMatchInvalid('交易分录结构异常，无法匹配为转账');
  return real[0]!;
}

/**
 * 合并为转账：新建一条两腿转账，冲正两条原交易，并在原交易的 note 中标记。
 * 金额与账户以服务端数据为准，不信任客户端。
 */
export async function matchTransfer(
  prisma: PrismaClient,
  input: { userId: string; transactionIdA: string; transactionIdB: string },
): Promise<{ transferId: string }> {
  const rows = (await prisma.transaction.findMany({
    where: { id: { in: [input.transactionIdA, input.transactionIdB] }, userId: input.userId },
    select: {
      id: true,
      type: true,
      occurredAt: true,
      description: true,
      merchant: true,
      note: true,
      externalId: true,
      status: true,
      entries: {
        where: { accountId: { not: null } },
        select: { accountId: true, amount: true, currency: true, account: { select: { name: true } } },
      },
    },
  })) as LoadedTransaction[];

  if (rows.length !== 2) throw errors.notFound('交易不存在');

  for (const tx of rows) {
    if (tx.status !== 'posted') throw errors.conflict('已冲正的交易不能匹配为转账');
    if (tx.type === 'transfer') throw errors.conflict('该交易已经是转账');
    if (tx.note?.includes('已匹配为转账')) throw errors.conflict('该交易已匹配为转账');
  }

  const [first, second] = rows as [LoadedTransaction, LoadedTransaction];
  const firstEntry = singleRealEntry(first);
  const secondEntry = singleRealEntry(second);

  if (firstEntry.accountId === secondEntry.accountId) {
    throw errors.transferMatchInvalid('两条交易属于同一账户，不能作为转账配对');
  }
  if (firstEntry.currency !== secondEntry.currency) {
    throw errors.crossCurrencyTransfer();
  }

  const firstAmount = new Decimal(firstEntry.amount.toString());
  const secondAmount = new Decimal(secondEntry.amount.toString());

  if (firstAmount.isZero() || secondAmount.isZero()) {
    throw errors.transferMatchInvalid('金额为 0 的交易不能匹配为转账');
  }
  if (!firstAmount.abs().equals(secondAmount.abs())) {
    throw errors.transferMatchInvalid('两条交易金额不一致');
  }
  if (firstAmount.isNegative() === secondAmount.isNegative()) {
    throw errors.transferMatchInvalid('两条交易方向相同，不能构成转账');
  }

  const out = firstAmount.isNegative() ? first : second;
  const outEntry = firstAmount.isNegative() ? firstEntry : secondEntry;
  const inc = firstAmount.isNegative() ? second : first;
  const incEntry = firstAmount.isNegative() ? secondEntry : firstEntry;

  const magnitude = outEntry.amount.toString().startsWith('-')
    ? new Decimal(outEntry.amount.toString()).abs()
    : new Decimal(outEntry.amount.toString());

  return prisma.$transaction(async (tx) => {
    const transfer = await tx.transaction.create({
      data: {
        userId: input.userId,
        type: 'transfer',
        occurredAt: out.occurredAt,
        description: `转账：${outEntry.account?.name ?? '转出'} → ${incEntry.account?.name ?? '转入'}`,
        note: `由流水 ${out.id} 与 ${inc.id} 匹配生成`,
        categoryId: null,
        source: 'manual',
        entries: {
          create: [
            {
              userId: input.userId,
              accountId: outEntry.accountId,
              amount: magnitude.negated().toString(),
              currency: outEntry.currency,
            },
            {
              userId: input.userId,
              accountId: incEntry.accountId,
              amount: magnitude.toString(),
              currency: incEntry.currency,
            },
          ],
        },
      },
      select: { id: true },
    });

    for (const original of [out, inc]) {
      await tx.transaction.update({
        where: { id: original.id },
        data: {
          status: 'voided',
          voidedAt: new Date(),
          version: { increment: 1 },
          importFingerprint: null,
          note: `${original.note ? `${original.note}\n` : ''}已匹配为转账 ${transfer.id}`,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: 'transfer.matched',
        targetType: 'transaction',
        targetId: transfer.id,
        metadata: { sourceTransactions: [out.id, inc.id] },
      },
    });

    return { transferId: transfer.id };
  });
}

/**
 * 解除匹配：冲正转账，并按转账的两条分录重建两条普通交易。
 * 原交易已经冲正过，不再复活，避免 voidedAt 与审计自相矛盾。
 */
export async function unmatchTransfer(
  prisma: PrismaClient,
  input: { userId: string; transferId: string },
): Promise<{ created: string[] }> {
  const transfer = (await prisma.transaction.findFirst({
    where: { id: input.transferId, userId: input.userId },
    select: {
      id: true,
      type: true,
      status: true,
      occurredAt: true,
      description: true,
      merchant: true,
      note: true,
      externalId: true,
      entries: {
        where: { accountId: { not: null } },
        select: { accountId: true, amount: true, currency: true, account: { select: { name: true } } },
      },
    },
  })) as LoadedTransaction | null;

  if (!transfer) throw errors.notFound('转账记录不存在');
  if (transfer.type !== 'transfer') throw errors.transferMatchInvalid('该交易不是转账');
  if (transfer.status !== 'posted') throw errors.conflict('该转账已冲正');

  const entries = transfer.entries.filter((entry) => entry.accountId !== null);
  if (entries.length !== 2) throw errors.transferMatchInvalid('转账分录结构异常');

  return prisma.$transaction(async (tx) => {
    await tx.transaction.update({
      where: { id: transfer.id },
      data: { status: 'voided', voidedAt: new Date(), version: { increment: 1 } },
    });

    const created: string[] = [];

    for (const entry of entries) {
      const magnitude = new Decimal(entry.amount.toString());
      const type = magnitude.isNegative() ? 'expense' : 'income';

      const rebuilt = await tx.transaction.create({
        data: {
          userId: input.userId,
          type,
          occurredAt: transfer.occurredAt,
          description: `解除匹配：${transfer.description}`,
          note: `由转账 ${transfer.id} 解除匹配生成`,
          source: 'manual',
          entries: {
            create: [
              {
                userId: input.userId,
                accountId: entry.accountId,
                amount: magnitude.toString(),
                currency: entry.currency,
              },
              {
                userId: input.userId,
                accountId: null,
                amount: magnitude.negated().toString(),
                currency: entry.currency,
              },
            ],
          },
        },
        select: { id: true },
      });

      created.push(rebuilt.id);
    }

    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: 'transfer.unmatched',
        targetType: 'transaction',
        targetId: transfer.id,
        metadata: { created },
      },
    });

    return { created };
  });
}
