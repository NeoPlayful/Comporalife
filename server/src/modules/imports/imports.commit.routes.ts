import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { IDEMPOTENCY_TTL_SECONDS } from '../../config/constants.js';
import { ok } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { requireAuth } from '../../plugins/auth.js';
import { duplicateDecisionSchema, importIdSchema } from './imports.schema.js';
import { refreshBatchCounts, releaseStaleCommitting } from './imports.service.js';
import {
  commitBatch,
  findRollbackBlocks,
  refreshDuplicateStatus,
  rollbackBatch,
} from './commit.service.js';
import { requireActiveAccount } from './upload.service.js';

async function readIdempotency(request: FastifyRequest, redis: FastifyInstance['redis'], userId: string) {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length === 0) return null;

  const cacheKey = `idem:${userId}:${request.url}:${key}`;
  return { cacheKey, cached: await redis.get(cacheKey) };
}

export default async function importsCommitRoutes(app: FastifyInstance) {
  // ===== 重复清单 =====
  app.get('/imports/:id/duplicates', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = importIdSchema.parse(request.params);

    const batch = await requireBatch(app, userId, id);

    const rows = await app.prisma.importRow.findMany({
      where: { batchId: id, status: { in: ['duplicate', 'suspected'] } },
      orderBy: { rowNumber: 'asc' },
      select: {
        id: true,
        rowNumber: true,
        occurredAt: true,
        amount: true,
        description: true,
        direction: true,
        status: true,
        duplicateKind: true,
        duplicateOfId: true,
      },
    });

    const counterpartIds = rows.map((row) => row.duplicateOfId).filter((value): value is string => value !== null);
    const counterparts = counterpartIds.length
      ? await app.prisma.transaction.findMany({
          where: { id: { in: counterpartIds }, userId },
          select: {
            id: true,
            type: true,
            occurredAt: true,
            description: true,
            merchant: true,
            entries: { select: { accountId: true, amount: true, account: { select: { name: true } } } },
          },
        })
      : [];

    const counterpartById = new Map(counterparts.map((item) => [item.id, item]));

    const toRow = (row: (typeof rows)[number]) => {
      const counterpart = row.duplicateOfId ? counterpartById.get(row.duplicateOfId) : undefined;
      return {
        id: row.id,
        rowNumber: row.rowNumber,
        occurredAt: row.occurredAt,
        amount: row.amount ? row.amount.toString() : null,
        description: row.description,
        direction: row.direction,
        status: row.status,
        duplicateKind: row.duplicateKind,
        counterpart: counterpart
          ? {
              id: counterpart.id,
              type: counterpart.type,
              occurredAt: counterpart.occurredAt,
              description: counterpart.description,
              merchant: counterpart.merchant,
              accountName: counterpart.entries.find((entry) => entry.accountId !== null)?.account?.name ?? null,
            }
          : null,
      };
    };

    return ok(
      {
        batch: { id: batch.id, status: batch.status },
        exact: rows.filter((row) => row.duplicateKind === 'exact').map(toRow),
        suspected: rows.filter((row) => row.duplicateKind === 'suspected').map(toRow),
      },
      request.id,
    );
  });

  // ===== 重复确认 =====
  app.patch('/imports/:id/duplicates', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = importIdSchema.parse(request.params);
    const body = duplicateDecisionSchema.parse(request.body);

    const batch = await requireBatch(app, userId, id);
    if (!['validated', 'mapped'].includes(batch.status)) {
      throw errors.importStateConflict('当前状态不允许确认重复行');
    }

    const rowIds = body.decisions.map((item) => item.rowId);
    const rows = await app.prisma.importRow.findMany({
      where: { id: { in: rowIds }, batchId: id },
      select: { id: true, status: true, duplicateKind: true },
    });

    if (rows.length !== rowIds.length) throw errors.notFound('部分导入行不存在');

    const unusable = rows.filter((row) => !['duplicate', 'suspected'].includes(row.status));
    if (unusable.length > 0) throw errors.validation('只能处理重复与疑似重复行');

    let forcedExact = 0;

    await app.prisma.$transaction(async (tx) => {
      for (const decision of body.decisions) {
        const row = rows.find((item) => item.id === decision.rowId)!;

        if (decision.action === 'skip') {
          await tx.importRow.update({ where: { id: decision.rowId }, data: { status: 'skipped' } });
          continue;
        }

        if (row.duplicateKind === 'exact') forcedExact += 1;
        await tx.importRow.update({ where: { id: decision.rowId }, data: { status: 'valid' } });
      }
    });

    await refreshBatchCounts(app.prisma, id);

    const validCount = await app.prisma.importRow.count({ where: { batchId: id, status: 'valid' } });
    if (batch.status === 'validated' && validCount === 0) {
      await app.prisma.importBatch.update({
        where: { id },
        data: { status: 'failed', failureReason: '确认重复后没有可导入的有效行' },
      });
    }

    return ok(
      {
        applied: body.decisions.length,
        forcedExact,
        ...(forcedExact > 0 ? { warning: '部分行与已有交易完全一致，仍按要求保留' } : {}),
      },
      request.id,
    );
  });

  // ===== 提交 =====
  app.post('/imports/:id/commit', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = importIdSchema.parse(request.params);

    const idem = await readIdempotency(request, app.redis, userId);
    if (!idem) throw errors.validation('提交导入必须携带 Idempotency-Key');

    if (idem.cached) return reply.status(200).send(ok(JSON.parse(idem.cached), request.id));

    await releaseStaleCommitting(app.prisma, id);

    const batch = await app.prisma.importBatch.findFirst({
      where: { id, userId },
      select: { id: true, status: true, accountId: true, committedAt: true },
    });
    if (!batch) throw errors.notFound('导入批次不存在');
    if (batch.status !== 'validated') {
      throw batch.status === 'completed'
        ? errors.importStateConflict('该批次已提交')
        : errors.importNotReady('批次尚未通过校验');
    }

    const unconfirmed = await app.prisma.importRow.count({ where: { batchId: id, status: 'suspected' } });
    if (unconfirmed > 0) {
      const rows = await app.prisma.importRow.findMany({
        where: { batchId: id, status: 'suspected' },
        select: { rowNumber: true },
        take: 100,
      });
      throw errors.importDuplicateConfirmation(rows.map((row) => row.rowNumber));
    }

    const account = await requireActiveAccount(app.prisma, userId, batch.accountId);

    // 抢占 committing：只有从 validated 出发的那一次请求可以继续
    const claimed = await app.prisma.importBatch.updateMany({
      where: { id, userId, status: 'validated' },
      data: { status: 'committing', version: { increment: 1 } },
    });
    if (claimed.count === 0) throw errors.importStateConflict('批次状态已变化，请刷新后重试');

    try {
      await refreshDuplicateStatus(app.prisma, id, userId);

      const remaining = await app.prisma.importRow.count({ where: { batchId: id, status: 'valid' } });
      if (remaining === 0) {
        await app.prisma.importBatch.update({
          where: { id },
          data: { status: 'validated', failureReason: '全部行已被判定为重复' },
        });
        throw errors.importNotReady('没有可导入的有效行');
      }

      const result = await commitBatch(app.prisma, {
        batchId: id,
        userId,
        accountId: account.id,
        currency: account.currency,
      });

      await app.redis.set(idem.cacheKey, JSON.stringify(result), 'EX', IDEMPOTENCY_TTL_SECONDS);
      return reply.status(201).send(ok(result, request.id));
    } catch (err) {
      // 事务已回滚，把抢占的状态放回去，允许用户修正后重试
      await app.prisma.importBatch.updateMany({
        where: { id, status: 'committing' },
        data: { status: 'validated' },
      });
      throw err;
    }
  });

  // ===== 撤销 =====
  app.post('/imports/:id/rollback', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = importIdSchema.parse(request.params);

    const batch = await app.prisma.importBatch.findFirst({
      where: { id, userId },
      select: { id: true, status: true, accountId: true, committedAt: true },
    });
    if (!batch) throw errors.notFound('导入批次不存在');
    if (batch.status !== 'completed') throw errors.importStateConflict('只有已完成的批次可以撤销');

    const blocks = await findRollbackBlocks(app.prisma, {
      batchId: id,
      userId,
      accountId: batch.accountId,
      committedAt: batch.committedAt,
    });

    if (blocks.length > 0) throw errors.importRollbackBlocked(blocks);

    const result = await rollbackBatch(app.prisma, { batchId: id, userId });
    return ok(result, request.id);
  });

  // ===== 错误行导出 =====
  app.get('/imports/:id/errors/export', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = importIdSchema.parse(request.params);

    await requireBatch(app, userId, id);

    const rows = await app.prisma.importRow.findMany({
      where: { batchId: id, status: { in: ['invalid', 'failed'] } },
      orderBy: { rowNumber: 'asc' },
      take: 20_000,
      select: { rowNumber: true, raw: true, errors: true },
    });

    const lines = ['行号,错误码,错误说明,原始值'];

    for (const row of rows) {
      const errors = (row.errors as Array<{ code: string; message: string }> | null) ?? [];
      const raw = Object.values(row.raw as Record<string, string>).join(' | ');
      const cells = errors.length > 0 ? errors : [{ code: 'UNKNOWN', message: '未知错误' }];

      for (const item of cells) {
        lines.push(
          [
            String(row.rowNumber),
            escapeCsv(item.code),
            escapeCsv(item.message),
            escapeCsv(raw),
          ].join(','),
        );
      }
    }

    // BOM 让 Excel 正确识别 UTF-8 中文
    const body = '﻿' + lines.join('\r\n');
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="import-errors-${id}.csv"`);
    return reply.send(body);
  });
}

async function requireBatch(app: FastifyInstance, userId: string, id: string) {
  const batch = await app.prisma.importBatch.findFirst({
    where: { id, userId },
    select: { id: true, status: true },
  });
  if (!batch) throw errors.notFound('导入批次不存在');
  return batch;
}

/** 公式注入防护：以 = + - @ 开头的值前置单引号，并按 CSV 规则转义引号 */
function escapeCsv(value: string): string {
  const dangerous = /^[=+\-@]/.test(value);
  const text = dangerous ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}

export { Prisma };
