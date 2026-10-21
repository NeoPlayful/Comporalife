import type { PrismaClient } from '@prisma/client';
import type Decimal from 'decimal.js';
import { IMPORT_WRITE_CHUNK_SIZE } from '../../config/constants.js';
import { errors } from '../../lib/errors.js';
import { roundMoney } from '../../lib/money.js';
import { buildEntries, assertBalanced } from '../ledger/entry.service.js';
import { applyRulesToTransactions } from '../rules/rules.service.js';

export interface CommitResult {
  importedRows: number;
  skippedRows: number;
  uncategorized: number;
  categoryMatched: number;
}

interface PendingRow {
  id: string;
  rowNumber: number;
  occurredAt: Date | null;
  amount: { toString(): string } | null;
  currency: string | null;
  description: string | null;
  merchant: string | null;
  externalId: string | null;
  balanceAfter: { toString(): string } | null;
  fingerprint: string | null;
  status: string;
}

/**
 * 提交导入：单个事务内写入全部交易与分录。
 * 任一行失败则整体回滚，不产生半成品批次。
 */
export async function commitBatch(
  prisma: PrismaClient,
  input: { batchId: string; userId: string; accountId: string; currency: string },
): Promise<CommitResult> {
  const rows = (await prisma.importRow.findMany({
    where: { batchId: input.batchId, status: 'valid' },
    orderBy: { rowNumber: 'asc' },
    select: {
      id: true,
      rowNumber: true,
      occurredAt: true,
      amount: true,
      currency: true,
      description: true,
      merchant: true,
      externalId: true,
      balanceAfter: true,
      fingerprint: true,
      status: true,
    },
  })) as PendingRow[];

  if (rows.length === 0) throw errors.importNotReady('没有可导入的有效行');

  const imported = await prisma.$transaction(async (tx) => {
    const created: Array<{ rowId: string; transactionId: string; type: 'income' | 'expense' }> = [];

    for (let offset = 0; offset < rows.length; offset += IMPORT_WRITE_CHUNK_SIZE) {
      const chunk = rows.slice(offset, offset + IMPORT_WRITE_CHUNK_SIZE);

      for (const row of chunk) {
        const magnitude = roundMoney(row.amount!.toString());
        const type = magnitude.isNegative() ? 'expense' : 'income';

        const entries = buildEntries({
          type,
          magnitude: magnitude.abs(),
          accountId: input.accountId,
          currency: input.currency,
        });
        assertBalanced(entries, type);

        const transaction = await tx.transaction.create({
          data: {
            userId: input.userId,
            type,
            occurredAt: row.occurredAt!,
            description: row.description ?? row.merchant ?? '银行账单导入',
            merchant: row.merchant,
            categoryId: null,
            source: 'import',
            importBatchId: input.batchId,
            importFingerprint: row.fingerprint,
            externalId: row.externalId,
            balanceAfter: row.balanceAfter?.toString() ?? null,
            entries: {
              create: entries.map((entry) => ({
                userId: input.userId,
                accountId: entry.accountId,
                amount: entry.amount.toString(),
                currency: entry.currency,
              })),
            },
          },
          select: { id: true },
        });

        created.push({ rowId: row.id, transactionId: transaction.id, type });
      }
    }

    for (const item of created) {
      await tx.importRow.update({
        where: { id: item.rowId },
        data: { status: 'imported', transactionId: item.transactionId },
      });
    }

    const uncategorizedBefore = created.length;
    const categoryMatched = await applyRulesToTransactions(
      tx,
      input.userId,
      created.map((item) => item.transactionId),
    );

    await tx.importBatch.update({
      where: { id: input.batchId },
      data: {
        status: 'completed',
        committedAt: new Date(),
        importedRows: created.length,
        version: { increment: 1 },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: 'import.committed',
        targetType: 'import_batch',
        targetId: input.batchId,
        metadata: { importedRows: created.length, categoryMatched },
      },
    });

    return { importedRows: created.length, categoryMatched, uncategorized: uncategorizedBefore - categoryMatched };
  });

  const skipped = await prisma.importRow.count({
    where: { batchId: input.batchId, status: { in: ['skipped', 'duplicate', 'suspected', 'invalid'] } },
  });

  return {
    importedRows: imported.importedRows,
    skippedRows: skipped,
    uncategorized: imported.uncategorized,
    categoryMatched: imported.categoryMatched,
  };
}

export interface RollbackBlock {
  transactionId: string;
  reason: string;
}

/** 撤销前检查依赖：手工改过、被匹配为转账、批次后有对账记录 */
export async function findRollbackBlocks(
  prisma: PrismaClient,
  input: { batchId: string; userId: string; accountId: string; committedAt: Date | null },
): Promise<RollbackBlock[]> {
  const transactions = await prisma.transaction.findMany({
    where: { importBatchId: input.batchId, userId: input.userId },
    select: { id: true, status: true, version: true, note: true },
  });

  if (transactions.length === 0) return [];

  const active = transactions.filter((tx) => tx.status === 'posted');
  const blocks: RollbackBlock[] = [];

  for (const tx of active) {
    if (tx.version > 1) {
      blocks.push({ transactionId: tx.id, reason: '该交易在导入后被手工修改' });
      continue;
    }
    if (tx.note?.includes('已匹配为转账')) {
      blocks.push({ transactionId: tx.id, reason: '该交易已被匹配为转账，请先解除匹配' });
    }
  }

  if (input.committedAt) {
    const reconciliation = await prisma.accountReconciliation.findFirst({
      where: {
        userId: input.userId,
        accountId: input.accountId,
        createdAt: { gte: input.committedAt },
      },
      select: { id: true },
    });

    if (reconciliation) {
      blocks.push({
        transactionId: reconciliation.id,
        reason: '该账户在导入后已产生对账记录',
      });
    }
  }

  return blocks;
}

export interface RollbackResult {
  voided: number;
  alreadyVoided: number;
}

/** 整批撤销：冲正全部交易并释放指纹，允许重新导入同一文件 */
export async function rollbackBatch(
  prisma: PrismaClient,
  input: { batchId: string; userId: string },
): Promise<RollbackResult> {
  return prisma.$transaction(async (tx) => {
    const transactions = await tx.transaction.findMany({
      where: { importBatchId: input.batchId, userId: input.userId },
      select: { id: true, status: true },
    });

    const posted = transactions.filter((item) => item.status === 'posted');

    if (posted.length > 0) {
      await tx.transaction.updateMany({
        where: { id: { in: posted.map((item) => item.id) } },
        data: {
          status: 'voided',
          voidedAt: new Date(),
          version: { increment: 1 },
          // 释放唯一索引，使同一笔账单可以再次导入
          importFingerprint: null,
        },
      });
    }

    await tx.importBatch.update({
      where: { id: input.batchId },
      data: { status: 'rolled_back', rolledBackAt: new Date(), version: { increment: 1 } },
    });

    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: 'import.rolled_back',
        targetType: 'import_batch',
        targetId: input.batchId,
        metadata: { voided: posted.length },
      },
    });

    return { voided: posted.length, alreadyVoided: transactions.length - posted.length };
  });
}

/** 提交后重新判定重复，防止校验与提交之间的账本变化 */
export async function refreshDuplicateStatus(
  prisma: PrismaClient,
  batchId: string,
  userId: string,
): Promise<void> {
  const rows = await prisma.importRow.findMany({
    where: { batchId, status: { in: ['valid', 'pending'] }, fingerprint: { not: null } },
    select: { id: true, fingerprint: true },
  });

  if (rows.length === 0) return;

  const existing = await prisma.transaction.findMany({
    where: {
      userId,
      status: 'posted',
      importFingerprint: { in: rows.map((row) => row.fingerprint!) },
    },
    select: { id: true, importFingerprint: true },
  });

  const byFp = new Map(existing.map((item) => [item.importFingerprint!, item.id]));

  for (const row of rows) {
    const hit = byFp.get(row.fingerprint!);
    if (!hit) continue;

    await prisma.importRow.update({
      where: { id: row.id },
      data: { status: 'duplicate', duplicateKind: 'exact', duplicateOfId: hit },
    });
  }
}

export function unconfirmedSuspectedRows(rows: Array<{ rowNumber: number; status: string }>): number[] {
  return rows.filter((row) => row.status === 'suspected').map((row) => row.rowNumber);
}

export type { Decimal };
