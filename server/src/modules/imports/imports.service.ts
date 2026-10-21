import type { PrismaClient } from '@prisma/client';
import { IMPORT_WRITE_CHUNK_SIZE } from '../../config/constants.js';
import { errors } from '../../lib/errors.js';
import type { ColumnMapping, NormalizedRow, ParsedFile } from './parser/index.js';

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  uploaded: ['parsed', 'failed', 'cancelled'],
  parsed: ['mapped', 'parsed', 'failed', 'cancelled'],
  mapped: ['validated', 'mapped', 'failed', 'cancelled'],
  validated: ['committing', 'mapped', 'validated', 'failed', 'cancelled'],
  committing: ['completed', 'validated'],
  completed: ['rolled_back'],
  failed: [],
  cancelled: [],
  rolled_back: [],
};

/** committing 超过阈值视为进程崩溃残留，回落到 validated 允许重试 */
export async function releaseStaleCommitting(prisma: PrismaClient, batchId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const result = await prisma.importBatch.updateMany({
    where: { id: batchId, status: 'committing', updatedAt: { lt: cutoff } },
    data: { status: 'validated', version: { increment: 1 } },
  });
  return result.count > 0;
}

export function assertTransition(from: string, to: string): void {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw errors.importStateConflict(`当前状态 ${from} 不允许变更为 ${to}`);
  }
}

/** 按批次统计各状态行数，保持批次统计与实际行一致 */
export async function refreshBatchCounts(prisma: PrismaClient, batchId: string): Promise<void> {
  const grouped = await prisma.importRow.groupBy({
    by: ['status'],
    where: { batchId },
    _count: { _all: true },
  });

  const counts: Record<string, number> = {};
  for (const item of grouped) counts[item.status] = item._count._all;

  await prisma.importBatch.update({
    where: { id: batchId },
    data: {
      validRows: counts.valid ?? 0,
      invalidRows: counts.invalid ?? 0,
      duplicateRows: counts.duplicate ?? 0,
      suspectedRows: counts.suspected ?? 0,
      skippedRows: counts.skipped ?? 0,
      importedRows: counts.imported ?? 0,
    },
  });
}

/** 分批写入，避免单条 SQL 参数过多 */
export async function insertRows(
  prisma: PrismaClient,
  batchId: string,
  userId: string,
  rows: NormalizedRow[],
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += IMPORT_WRITE_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + IMPORT_WRITE_CHUNK_SIZE);
    await prisma.importRow.createMany({
      data: chunk.map((row) => ({
        batchId,
        userId,
        rowNumber: row.rowNumber,
        cells: row.cells ?? [],
        raw: row.raw,
        occurredAt: row.occurredAt,
        amount: row.amount?.toString() ?? null,
        currency: row.currency,
        description: row.description,
        merchant: row.merchant,
        externalId: row.externalId,
        balanceAfter: row.balanceAfter?.toString() ?? null,
        direction: row.direction,
        fingerprint: row.fingerprint,
        status: row.errors.length > 0 ? ('invalid' as const) : ('pending' as const),
        errors: row.errors.length > 0 ? (row.errors.slice(0, 10) as unknown as object) : undefined,
      })),
      skipDuplicates: true,
    });
  }
}

export function batchActions(status: string): string[] {
  switch (status) {
    case 'uploaded':
      return ['cancel'];
    case 'parsed':
      return ['mapping', 'cancel'];
    case 'mapped':
      return ['mapping', 'validate', 'cancel'];
    case 'validated':
      return ['mapping', 'validate', 'commit', 'cancel'];
    case 'completed':
      return ['rollback', 'export-errors'];
    default:
      return [];
  }
}

export function toMappingDto(mapping: ColumnMapping) {
  return mapping;
}

export function parseMapping(value: unknown): ColumnMapping | null {
  if (!value || typeof value !== 'object') return null;
  return value as ColumnMapping;
}

export function parsedFileSummary(parsed: ParsedFile) {
  return {
    format: parsed.format,
    encoding: parsed.encoding,
    delimiter: parsed.delimiter ?? null,
    sheetName: parsed.sheetName ?? null,
    sheetNames: parsed.sheetNames ?? null,
    headerRow: parsed.headerRow,
    headers: parsed.headers,
    headerSignature: parsed.headerSignature,
    totalRows: parsed.rows.length,
  };
}
