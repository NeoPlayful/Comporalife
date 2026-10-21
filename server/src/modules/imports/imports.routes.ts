import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { buildPagination, ok, parsePageParams } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { moneyToString } from '../../lib/money.js';
import { sha256Hex } from '../../lib/file-storage.js';
import { requireAuth } from '../../plugins/auth.js';
import {
  importIdSchema,
  listImportsSchema,
  previewQuerySchema,
  rowsQuerySchema,
  setMappingSchema,
  uploadQuerySchema,
} from './imports.schema.js';
import {
  assertTransition,
  batchActions,
  insertRows,
  refreshBatchCounts,
  releaseStaleCommitting,
} from './imports.service.js';
import {
  buildHeaderSignature,
  buildRawRecord,
  normalizeRows,
  type ColumnMapping,
  type RawRow,
} from './parser/index.js';
import {
  assertFileSize,
  checkDuplicateFile,
  detectFormat,
  parseOrThrow,
  requireActiveAccount,
} from './upload.service.js';
import { saveEncrypted } from '../../lib/file-storage.js';
import { env } from '../../config/env.js';

export default async function importsRoutes(app: FastifyInstance) {
  // ===== 上传 =====
  app.post('/imports/upload', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const query = uploadQuerySchema.parse(request.query);
    const account = await requireActiveAccount(app.prisma, userId, query.accountId);

    const file = await request.file();
    if (!file) throw errors.importEmpty();

    const buffer = await file.toBuffer();
    assertFileSize(buffer);

    const format = detectFormat(file.filename, buffer);
    const sha256 = sha256Hex(buffer);
    await checkDuplicateFile(app.prisma, userId, sha256, query.force);

    const parsed = parseOrThrow(buffer, format, {
      ...(query.encoding ? { encoding: query.encoding } : {}),
      ...(query.sheetName ? { sheetName: query.sheetName } : {}),
    });
    if (parsed.rows.length === 0) throw errors.importEmpty();

    const batchId = randomUUID();
    const stored = await saveEncrypted(buffer, userId, batchId);

    const timezone = await readTimezone(app, userId);
    const headers = dedupeHeaders(parsed.headers);
    // 与模板保存时使用同一份去重表头计算签名，保证下次上传能命中
    const headerSignature = buildHeaderSignature(headers);

    const template = await app.prisma.importTemplate.findFirst({
      where: { userId, format, headerSignature },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, mapping: true },
    });

    const initialMapping = template ? (template.mapping as unknown as ColumnMapping) : null;

    await app.prisma.importBatch.create({
      data: {
        id: batchId,
        userId,
        accountId: account.id,
        status: 'parsed',
        originalFilename: file.filename.slice(0, 255),
        fileSize: buffer.length,
        fileSha256: sha256,
        storageKey: stored.storageKey,
        encryptionIv: stored.iv,
        encryptionTag: stored.tag,
        format,
        encoding: parsed.encoding,
        delimiter: parsed.delimiter ?? null,
        sheetName: parsed.sheetName ?? null,
        headerRow: parsed.headerRow,
        headers,
        templateId: template?.id ?? null,
        mapping: initialMapping ? (initialMapping as unknown as object) : undefined,
        totalRows: parsed.rows.length,
      },
    });

    await writeRows(app, {
      batchId,
      userId,
      accountId: account.id,
      accountCurrency: account.currency,
      timezone,
      headers,
      rows: parsed.rows,
      mapping: initialMapping,
    });

    const templateApplied = initialMapping !== null;
    if (templateApplied) await refreshBatchCounts(app.prisma, batchId);

    await app.prisma.$transaction(async (tx) => {
      await tx.importBatch.update({
        where: { id: batchId },
        data: { status: templateApplied ? 'mapped' : 'parsed' },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'import.uploaded',
          targetType: 'import_batch',
          targetId: batchId,
          metadata: { format, totalRows: parsed.rows.length },
        },
      });
    });

    const batch = await app.prisma.importBatch.findUniqueOrThrow({ where: { id: batchId }, select: batchSelect });

    return reply.status(201).send(
      ok(
        {
          batch: toBatchDto(batch),
          parsed: {
            format: parsed.format,
            encoding: parsed.encoding,
            delimiter: parsed.delimiter ?? null,
            sheetName: parsed.sheetName ?? null,
            sheetNames: parsed.sheetNames ?? null,
            headerRow: parsed.headerRow,
            headers,
            totalRows: parsed.rows.length,
          },
          template: template ? { id: template.id, name: template.name } : null,
        },
        request.id,
      ),
    );
  });

  // ===== 列表与详情 =====
  app.get('/imports', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = listImportsSchema.parse(request.query);
    const page = parsePageParams(query);

    const where = { userId, ...(query.status === 'all' ? {} : { status: query.status }) };

    const [total, batches] = await Promise.all([
      app.prisma.importBatch.count({ where }),
      app.prisma.importBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
        select: batchSelect,
      }),
    ]);

    return ok(
      { batches: batches.map(toBatchDto), pagination: buildPagination(page.page, page.pageSize, total) },
      request.id,
    );
  });

  app.get('/imports/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = importIdSchema.parse(request.params);

    if (await releaseStaleCommitting(app.prisma, id)) {
      request.log.warn({ batchId: id }, '导入批次处于 committing 超时，已回落为 validated');
    }

    const batch = await app.prisma.importBatch.findFirst({
      where: { id, userId },
      select: { ...batchSelect, mapping: true, failureReason: true, templateId: true, headers: true },
    });
    if (!batch) throw errors.notFound('导入批次不存在');

    return ok(
      {
        batch: {
          ...toBatchDto(batch),
          mapping: batch.mapping,
          headers: batch.headers,
          failureReason: batch.failureReason,
        },
        actions: batchActions(batch.status),
      },
      request.id,
    );
  });

  // ===== 预览与行 =====
  app.get('/imports/:id/preview', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = importIdSchema.parse(request.params);
    const query = previewQuerySchema.parse(request.query);
    const page = parsePageParams({ page: query.page, pageSize: query.pageSize ?? 100 });

    await requireBatch(app, userId, id);

    const [total, rows] = await Promise.all([
      app.prisma.importRow.count({ where: { batchId: id } }),
      app.prisma.importRow.findMany({
        where: { batchId: id },
        orderBy: { rowNumber: 'asc' },
        skip: page.skip,
        take: page.take,
        select: previewRowSelect,
      }),
    ]);

    return ok({ rows: rows.map(toPreviewRow), pagination: buildPagination(page.page, page.pageSize, total) }, request.id);
  });

  app.get('/imports/:id/rows', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = importIdSchema.parse(request.params);
    const query = rowsQuerySchema.parse(request.query);
    const page = parsePageParams(query);

    await requireBatch(app, userId, id);

    const where = { batchId: id, ...(query.status === 'all' ? {} : { status: query.status }) };

    const [total, rows] = await Promise.all([
      app.prisma.importRow.count({ where }),
      app.prisma.importRow.findMany({
        where,
        orderBy: { rowNumber: 'asc' },
        skip: page.skip,
        take: page.take,
        select: previewRowSelect,
      }),
    ]);

    return ok({ rows: rows.map(toPreviewRow), pagination: buildPagination(page.page, page.pageSize, total) }, request.id);
  });

  // ===== 映射 =====
  app.patch('/imports/:id/mapping', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = importIdSchema.parse(request.params);
    const body = setMappingSchema.parse(request.body);

    const batch = await app.prisma.importBatch.findFirst({
      where: { id, userId },
      select: { id: true, status: true, accountId: true, headerRow: true, headers: true, version: true },
    });
    if (!batch) throw errors.notFound('导入批次不存在');
    if (!['parsed', 'mapped', 'validated', 'failed'].includes(batch.status)) {
      throw errors.importStateConflict('当前状态不允许修改映射');
    }
    if (body.version !== undefined && body.version !== batch.version) {
      throw errors.conflict('批次已被其他操作修改，请刷新后重试');
    }

    const account = await requireActiveAccount(app.prisma, userId, batch.accountId);
    const timezone = await readTimezone(app, userId);
    const headers = (batch.headers as string[] | null) ?? [];
    const mapping = body.mapping as ColumnMapping;

    validateMappingColumns(mapping, headers.length);

    await applyMapping(app, { batchId: id, userId, accountId: account.id, accountCurrency: account.currency, timezone, mapping });
    await refreshBatchCounts(app.prisma, id);

    let templateId: string | undefined;
    if (body.templateName) {
      const batchMeta = await app.prisma.importBatch.findUniqueOrThrow({
        where: { id },
        select: { format: true, headers: true },
      });
      // 模板必须按表头签名索引，才能在不同文件之间自动复用；
      // 这里不能用文件哈希，否则同一格式的下一份文件永远匹配不上
      const headerSignature = buildHeaderSignature((batchMeta.headers as string[] | null) ?? []);

      const template = await app.prisma.importTemplate.upsert({
        where: { userId_name: { userId, name: body.templateName } },
        create: {
          userId,
          name: body.templateName,
          format: batchMeta.format,
          headerSignature,
          mapping: mapping as unknown as object,
        },
        update: { mapping: mapping as unknown as object, headerSignature },
        select: { id: true },
      });

      templateId = template.id;
      await app.prisma.importBatch.update({ where: { id }, data: { templateId } });
    }

    const updated = await app.prisma.importBatch.findUniqueOrThrow({ where: { id }, select: batchSelect });
    return ok({ batch: toBatchDto(updated), ...(templateId ? { templateId } : {}) }, request.id);
  });

  // ===== 校验 =====
  app.post('/imports/:id/validate', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = importIdSchema.parse(request.params);

    const batch = await app.prisma.importBatch.findFirst({
      where: { id, userId },
      select: { id: true, status: true, mapping: true, accountId: true, headers: true },
    });
    if (!batch) throw errors.notFound('导入批次不存在');
    if (!batch.mapping) throw errors.importNotReady('请先完成列映射');
    if (!['mapped', 'validated', 'parsed'].includes(batch.status)) {
      throw errors.importStateConflict('当前状态不允许校验');
    }

    const account = await requireActiveAccount(app.prisma, userId, batch.accountId);
    const timezone = await readTimezone(app, userId);
    const headers = (batch.headers as string[] | null) ?? [];
    const mapping = batch.mapping as unknown as ColumnMapping;

    const normalized = await applyMapping(app, {
      batchId: id,
      userId,
      accountId: account.id,
      accountCurrency: account.currency,
      timezone,
      mapping,
    });

    const existingByFp = await findExactDuplicates(app, userId, normalized);
    const suspected = await findSuspected(app, userId, account.id, normalized);

    await app.prisma.$transaction(async (tx) => {
      for (const row of normalized) {
        const current = await tx.importRow.findUnique({
          where: { batchId_rowNumber: { batchId: id, rowNumber: row.rowNumber } },
          select: { status: true },
        });
        if (current?.status === 'skipped') continue;

        let status: 'invalid' | 'duplicate' | 'suspected' | 'valid' = 'valid';
        let duplicateKind: 'exact' | 'suspected' | null = null;
        let duplicateOfId: string | null = null;

        if (row.errors.length > 0) {
          status = 'invalid';
        } else if (row.fingerprint && existingByFp.has(row.fingerprint)) {
          status = 'duplicate';
          duplicateKind = 'exact';
          duplicateOfId = existingByFp.get(row.fingerprint)!;
        } else if (suspected.has(row.rowNumber)) {
          status = 'suspected';
          duplicateKind = 'suspected';
          duplicateOfId = suspected.get(row.rowNumber)!;
        }

        await tx.importRow.update({
          where: { batchId_rowNumber: { batchId: id, rowNumber: row.rowNumber } },
          data: {
            status,
            errors: row.errors.length > 0 ? (row.errors.slice(0, 10) as unknown as object) : Prisma.DbNull,
            duplicateKind,
            duplicateOfId,
          },
        });
      }
    });

    await refreshBatchCounts(app.prisma, id);

    const validRows = await app.prisma.importRow.count({ where: { batchId: id, status: 'valid' } });

    await app.prisma.importBatch.update({
      where: { id },
      data: {
        status: validRows > 0 ? 'validated' : 'failed',
        ...(validRows > 0 ? {} : { failureReason: '没有可导入的有效行' }),
        version: { increment: 1 },
      },
    });

    const updated = await app.prisma.importBatch.findUniqueOrThrow({ where: { id }, select: batchSelect });

    return ok(
      {
        batch: toBatchDto(updated),
        errors: normalized
          .filter((row) => row.errors.length > 0)
          .slice(0, 50)
          .map((row) => ({ rowNumber: row.rowNumber, errors: row.errors })),
        headers,
      },
      request.id,
    );
  });

  // ===== 取消 =====
  app.post('/imports/:id/cancel', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = importIdSchema.parse(request.params);

    const batch = await app.prisma.importBatch.findFirst({
      where: { id, userId },
      select: { id: true, status: true },
    });
    if (!batch) throw errors.notFound('导入批次不存在');

    assertTransition(batch.status, 'cancelled');

    await app.prisma.importBatch.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: new Date(), version: { increment: 1 } },
    });

    return ok({ cancelled: true }, request.id);
  });

  // ===== 错误汇总 =====
  app.get('/imports/:id/errors', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = importIdSchema.parse(request.params);

    await requireBatch(app, userId, id);

    const rows = await app.prisma.importRow.findMany({
      where: { batchId: id, status: { in: ['invalid', 'failed'] } },
      orderBy: { rowNumber: 'asc' },
      take: 500,
      select: { rowNumber: true, errors: true },
    });

    const byCode = new Map<string, number>();
    for (const row of rows) {
      const list = (row.errors as Array<{ code: string }> | null) ?? [];
      for (const item of list) byCode.set(item.code, (byCode.get(item.code) ?? 0) + 1);
    }

    return ok(
      {
        total: rows.length,
        byCode: [...byCode.entries()].map(([code, count]) => ({ code, count })),
        rows: rows.slice(0, 50),
      },
      request.id,
    );
  });
}

// ===== 内部工具 =====

async function readTimezone(app: FastifyInstance, userId: string): Promise<string> {
  const settings = await app.prisma.userSettings.findUnique({ where: { userId }, select: { timezone: true } });
  return settings?.timezone ?? 'Asia/Shanghai';
}

async function requireBatch(app: FastifyInstance, userId: string, id: string) {
  const batch = await app.prisma.importBatch.findFirst({ where: { id, userId }, select: { id: true, status: true } });
  if (!batch) throw errors.notFound('导入批次不存在');
  return batch;
}

/** 重名表头追加序号，保证 raw 键唯一且与 cells 位置对应 */
function dedupeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header.trim().length > 0 ? header.trim() : `列${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${index + 1}`;
  });
}

async function writeRows(
  app: FastifyInstance,
  input: {
    batchId: string;
    userId: string;
    accountId: string;
    accountCurrency: string;
    timezone: string;
    headers: string[];
    rows: RawRow[];
    mapping: ColumnMapping | null;
  },
): Promise<void> {
  const { rows, headers, mapping } = input;

  if (!mapping) {
    await insertRows(
      app.prisma,
      input.batchId,
      input.userId,
      rows.map((row) => ({
        rowNumber: row.rowNumber,
        cells: row.cells,
        raw: buildRawRecord(headers, row.cells),
        occurredAt: null,
        amount: null,
        currency: null,
        description: null,
        merchant: null,
        externalId: null,
        balanceAfter: null,
        direction: null,
        fingerprint: null,
        errors: [],
      })),
    );
    return;
  }

  const normalized = normalizeRows(
    { format: 'csv', encoding: 'utf-8', headerRow: 1, headers, headerSignature: '', rows, truncated: false },
    mapping,
    {
      userId: input.userId,
      accountId: input.accountId,
      accountCurrency: input.accountCurrency,
      timezone: input.timezone,
    },
  );

  await insertRows(app.prisma, input.batchId, input.userId, normalized);
}

/** 用批次持久化的表头与单元格重新规范化全部行，返回结果供去重使用 */
async function applyMapping(
  app: FastifyInstance,
  input: {
    batchId: string;
    userId: string;
    accountId: string;
    accountCurrency: string;
    timezone: string;
    mapping: ColumnMapping;
  },
) {
  const stored = await app.prisma.importRow.findMany({
    where: { batchId: input.batchId },
    orderBy: { rowNumber: 'asc' },
    select: { rowNumber: true, cells: true, status: true },
  });

  const headers = ((await app.prisma.importBatch
    .findUniqueOrThrow({ where: { id: input.batchId }, select: { headers: true } })
    .then((batch) => batch.headers)) as string[] | null) ?? [];

  const normalized = normalizeRows(
    {
      format: 'csv',
      encoding: 'utf-8',
      headerRow: 1,
      headers,
      headerSignature: '',
      rows: stored.map((row) => ({ rowNumber: row.rowNumber, cells: (row.cells as string[]) ?? [] })),
      truncated: false,
    },
    input.mapping,
    {
      userId: input.userId,
      accountId: input.accountId,
      accountCurrency: input.accountCurrency,
      timezone: input.timezone,
    },
  );

  for (const row of normalized) {
    const previous = stored.find((item) => item.rowNumber === row.rowNumber);
    const status = previous?.status === 'skipped' ? 'skipped' : row.errors.length > 0 ? 'invalid' : 'pending';

    await app.prisma.importRow.update({
      where: { batchId_rowNumber: { batchId: input.batchId, rowNumber: row.rowNumber } },
      data: {
        occurredAt: row.occurredAt,
        amount: row.amount?.toString() ?? null,
        currency: row.currency,
        description: row.description,
        merchant: row.merchant,
        externalId: row.externalId,
        balanceAfter: row.balanceAfter?.toString() ?? null,
        direction: row.direction,
        fingerprint: row.fingerprint,
        status,
        errors: row.errors.length > 0 ? (row.errors.slice(0, 10) as unknown as object) : Prisma.DbNull,
        duplicateKind: null,
        duplicateOfId: null,
      },
    });
  }

  await app.prisma.importBatch.update({
    where: { id: input.batchId },
    data: { status: 'mapped', mapping: input.mapping as unknown as object, version: { increment: 1 } },
  });

  return normalized;
}

function validateMappingColumns(mapping: ColumnMapping, columnCount: number): void {
  const indexes = [
    mapping.occurredAt,
    mapping.amount,
    mapping.debit,
    mapping.credit,
    mapping.currency,
    mapping.description,
    mapping.merchant,
    mapping.externalId,
    mapping.balanceAfter,
  ].filter((item): item is number => item !== undefined);

  const outOfRange = indexes.filter((index) => index >= columnCount);
  if (outOfRange.length > 0) {
    throw errors.importMappingInvalid('列索引超出表头范围', { outOfRange, columnCount });
  }
}

async function findExactDuplicates(
  app: FastifyInstance,
  userId: string,
  rows: Array<{ fingerprint: string | null; errors: unknown[] }>,
): Promise<Map<string, string>> {
  const fps = rows
    .filter((row) => row.errors.length === 0 && row.fingerprint)
    .map((row) => row.fingerprint!);

  if (fps.length === 0) return new Map();

  const existing = await app.prisma.transaction.findMany({
    where: { userId, status: 'posted', importFingerprint: { in: fps } },
    select: { id: true, importFingerprint: true },
  });

  return new Map(existing.map((item) => [item.importFingerprint!, item.id]));
}

/** 近似重复：同账户、同方向、同绝对值金额、日期相差 3 天内 */
async function findSuspected(
  app: FastifyInstance,
  userId: string,
  accountId: string,
  rows: Array<{ rowNumber: number; occurredAt: Date | null; amount: Decimal | null; errors: unknown[] }>,
): Promise<Map<number, string>> {
  const candidates = rows.filter((row) => row.errors.length === 0 && row.occurredAt && row.amount);
  if (candidates.length === 0) return new Map();

  const times = candidates.map((row) => row.occurredAt!.getTime());
  const window = 3 * 24 * 60 * 60 * 1000;

  const existing = await app.prisma.transaction.findMany({
    where: {
      userId,
      status: 'posted',
      type: { in: ['income', 'expense'] },
      occurredAt: { gte: new Date(Math.min(...times) - window), lte: new Date(Math.max(...times) + window) },
      entries: { some: { accountId } },
    },
    select: {
      id: true,
      occurredAt: true,
      type: true,
      entries: { where: { accountId }, select: { amount: true } },
    },
  });

  const result = new Map<number, string>();

  for (const row of candidates) {
    const expectedType = row.amount!.isNegative() ? 'expense' : 'income';

    const hit = existing.find((item) => {
      if (item.type !== expectedType) return false;
      if (Math.abs(item.occurredAt.getTime() - row.occurredAt!.getTime()) > window) return false;
      return item.entries.some((entry) => new Decimal(entry.amount.toString()).abs().equals(row.amount!.abs()));
    });

    if (hit) result.set(row.rowNumber, hit.id);
  }

  return result;
}

const batchSelect = {
  id: true,
  accountId: true,
  status: true,
  originalFilename: true,
  fileSize: true,
  format: true,
  encoding: true,
  sheetName: true,
  headerRow: true,
  totalRows: true,
  validRows: true,
  invalidRows: true,
  duplicateRows: true,
  suspectedRows: true,
  skippedRows: true,
  importedRows: true,
  committedAt: true,
  rolledBackAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  version: true,
  account: { select: { name: true, currency: true } },
} as const;

const previewRowSelect = {
  id: true,
  rowNumber: true,
  occurredAt: true,
  amount: true,
  currency: true,
  description: true,
  merchant: true,
  externalId: true,
  direction: true,
  status: true,
  errors: true,
  duplicateKind: true,
} as const;

type BatchRow = {
  id: string;
  accountId: string;
  status: string;
  originalFilename: string;
  fileSize: number;
  format: string;
  encoding: string;
  sheetName: string | null;
  headerRow: number | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  suspectedRows: number;
  skippedRows: number;
  importedRows: number;
  committedAt: Date | null;
  rolledBackAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  account: { name: string; currency: string };
};

function toBatchDto(batch: BatchRow) {
  return {
    id: batch.id,
    accountId: batch.accountId,
    accountName: batch.account.name,
    currency: batch.account.currency,
    status: batch.status,
    originalFilename: batch.originalFilename,
    fileSize: batch.fileSize,
    format: batch.format,
    encoding: batch.encoding,
    sheetName: batch.sheetName,
    headerRow: batch.headerRow,
    counts: {
      total: batch.totalRows,
      valid: batch.validRows,
      invalid: batch.invalidRows,
      duplicate: batch.duplicateRows,
      suspected: batch.suspectedRows,
      skipped: batch.skippedRows,
      imported: batch.importedRows,
    },
    committedAt: batch.committedAt,
    rolledBackAt: batch.rolledBackAt,
    cancelledAt: batch.cancelledAt,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    version: batch.version,
  };
}

function toPreviewRow(row: {
  id: string;
  rowNumber: number;
  occurredAt: Date | null;
  amount: { toString(): string } | null;
  currency: string | null;
  description: string | null;
  merchant: string | null;
  externalId: string | null;
  direction: string | null;
  status: string;
  errors: unknown;
  duplicateKind: string | null;
}) {
  return {
    id: row.id,
    rowNumber: row.rowNumber,
    occurredAt: row.occurredAt,
    amount: row.amount ? moneyToString(row.amount.toString()) : null,
    currency: row.currency,
    description: row.description,
    merchant: row.merchant,
    externalId: row.externalId,
    direction: row.direction,
    status: row.status,
    errors: row.errors ?? [],
    duplicateKind: row.duplicateKind,
  };
}
