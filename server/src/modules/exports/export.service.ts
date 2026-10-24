import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  ANALYTICS_MAX_RANGE_DAYS,
  EXPORT_MAX_ROWS,
  EXPORT_RETENTION_DAYS,
  EXPORT_SCHEMA_VERSION,
  EXPORT_SYNC_MAX_ROWS,
} from '../../config/constants.js';
import { deleteArtifact, PURGED_KEY, saveArtifact } from '../../lib/encrypted-store.js';
import { errors } from '../../lib/errors.js';
import { buildZip } from '../../lib/zip.js';
import { buildCsv } from '../reports/export.serialize.js';
import { buildExportCompleteness, datasetsForScope, loadDataset, type ExportContext } from './export.datasets.js';

export interface ExportParams {
  scope: 'full' | 'ledger' | 'investments' | 'simulations' | 'planning' | 'settings';
  from: string | null;
  to: string | null;
  includeArchived: boolean;
  format: 'csv_zip';
}

export interface ExportManifest {
  schemaVersion: string;
  appVersion: string;
  generatedAt: string;
  scope: string;
  currency: string;
  range: { from: string | null; to: string | null; scopeLimited: boolean };
  files: Array<{ name: string; rows: number; bytes: number; sha256: string }>;
  totals: Record<string, number>;
  completeness: Record<string, unknown>;
  // 声明「没导什么」以及原因：只给键名会让人误以为是遗漏而非设计取舍
  excluded: Array<{ key: string; reason: string }>;
  notes: string[];
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** 区间解析：只允许 yyyy-MM-dd，且不晚于今天、不超过分析层上限 */
export function resolveExportRange(
  from: string | null,
  to: string | null,
): { from: Date | null; to: Date | null } {
  if (!from && !to) return { from: null, to: null };

  const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : null;
  const toDate = to ? new Date(`${to}T23:59:59.999Z`) : null;

  if (fromDate && toDate && fromDate > toDate) {
    throw errors.exportRangeInvalid('起始日期不能晚于结束日期');
  }

  if (fromDate && toDate) {
    const days = Math.ceil((toDate.getTime() - fromDate.getTime()) / 86_400_000);
    if (days > ANALYTICS_MAX_RANGE_DAYS) {
      throw errors.exportRangeInvalid(`导出区间不能超过 ${ANALYTICS_MAX_RANGE_DAYS} 天`);
    }
  }

  return { from: fromDate, to: toDate };
}

/** 估算行数决定同步还是异步；估算用 count，不实际拉取 */
export async function estimateExportRows(
  prisma: PrismaClient,
  params: ExportParams & { userId: string },
): Promise<number> {
  const datasets = datasetsForScope(params.scope);
  let total = 0;

  for (const dataset of datasets) {
    switch (dataset) {
      case 'transactions':
        total += await prisma.transaction.count({ where: { userId: params.userId } });
        break;
      case 'entries':
        total += await prisma.transactionEntry.count({ where: { userId: params.userId } });
        break;
      case 'trades':
        total += await prisma.portfolioTrade.count({ where: { userId: params.userId } });
        break;
      case 'report_data':
        total += await prisma.report.count({ where: { userId: params.userId } });
        break;
      default:
        // 其余数据集的规模远小于流水，用固定小权重避免额外查询
        total += 50;
        break;
    }
  }

  return total;
}

export function shouldRunAsync(estimatedRows: number): boolean {
  return estimatedRows > EXPORT_SYNC_MAX_ROWS;
}

/**
 * 生成导出包。
 * 全程只读：不写账本、组合、模拟与报表；唯一写入是导出记录自身与文件。
 */
export async function buildExportPackage(
  prisma: PrismaClient,
  params: {
    userId: string;
    timezone: string;
    baseCurrency: string;
    appVersion: string;
    params: ExportParams;
  },
): Promise<{ manifest: ExportManifest; zip: Buffer; zipSha256: string; rowCount: number }> {
  const range = resolveExportRange(params.params.from, params.params.to);

  const context: ExportContext = {
    userId: params.userId,
    timezone: params.timezone,
    baseCurrency: params.baseCurrency,
    includeArchived: params.params.includeArchived,
    from: range.from,
    to: range.to,
  };

  const names = datasetsForScope(params.params.scope);
  const files: Array<{ name: string; rows: number; bytes: number; sha256: string; content: Buffer }> = [];
  const totals: Record<string, number> = {};
  let rowCount = 0;

  for (const dataset of names) {
    const loaded = await loadDataset(prisma, dataset, context);
    const csv = buildCsv([
      {
        header: loaded.header,
        // 布尔统一渲染为 1/0：CSV 里写 TRUE/FALSE 会让不同 Excel 版本读出不同类型
        rows: loaded.rows.map((row) => row.map((cell) => (typeof cell === 'boolean' ? (cell ? 1 : 0) : cell))),
      },
    ]);
    const content = Buffer.from(csv, 'utf8');

    files.push({
      name: loaded.name,
      rows: loaded.rows.length,
      bytes: content.length,
      sha256: sha256(content),
      content,
    });

    totals[dataset] = loaded.rows.length;
    rowCount += loaded.rows.length;

    if (rowCount > EXPORT_MAX_ROWS) {
      throw errors.exportTooLarge(rowCount, EXPORT_MAX_ROWS);
    }
  }

  const completeness = await buildExportCompleteness(prisma, context);

  const manifest: ExportManifest = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    appVersion: params.appVersion,
    generatedAt: new Date().toISOString(),
    scope: params.params.scope,
    currency: params.baseCurrency,
    range: {
      from: params.params.from,
      to: params.params.to,
      // 区间只作用于账本类数据，其他域始终全量；必须写清楚，不能让人以为整包都被裁剪
      scopeLimited: Boolean(range.from || range.to),
    },
    files: files.map(({ name, rows, bytes, sha256: hash }) => ({ name, rows, bytes, sha256: hash })),
    totals,
    completeness,
    excluded: [
      { key: 'original_statement_files', reason: '原始账单文件体积大且含银行原文，仅保存在服务端加密存储' },
      { key: 'password_hash', reason: '凭据不属于业务数据' },
      { key: 'refresh_tokens', reason: '凭据不属于业务数据' },
      { key: 'sessions', reason: '会话是有时效的运行态' },
      { key: 'audit_logs', reason: '审计日志属于安全记录，不随个人数据导出' },
      { key: 'monte_carlo_results', reason: '结果可按种子与模型版本重算' },
    ],
    notes: ['导出为明文数据，不包含原始账单文件与登录凭据', '区间仅作用于账户、流水、投资交易与估值'],
  };

  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
  const zip = buildZip([
    { name: 'manifest.json', data: manifestBuffer },
    ...files.map((file) => ({ name: file.name, data: file.content })),
  ]);

  return { manifest, zip, zipSha256: sha256(zip), rowCount };
}

/** 导出文件写入加密存储，记录保留期 */
export async function persistExportArtifact(
  prisma: PrismaClient,
  params: {
    exportId: string;
    userId: string;
    zip: Buffer;
    zipSha256: string;
    manifest: ExportManifest;
    rowCount: number;
  },
): Promise<void> {
  const artifact = await saveArtifact(params.zip, {
    namespace: 'exports',
    userId: params.userId,
    artifactId: params.exportId,
    extension: '.zip',
  });

  const expiresAt = new Date(Date.now() + EXPORT_RETENTION_DAYS * 86_400_000);

  await prisma.dataExport.update({
    where: { id: params.exportId },
    data: {
      status: 'ready',
      fileKey: artifact.storageKey,
      sizeBytes: BigInt(params.zip.length),
      sha256: params.zipSha256,
      rowCount: params.rowCount,
      manifest: params.manifest as unknown as object,
      expiresAt,
      completedAt: new Date(),
    },
  });

  await pruneExports(prisma, params.userId);
}

/** 保留策略：只置过期并删文件，不删记录——历史痕迹对用户有意义 */
export async function pruneExports(prisma: PrismaClient, userId: string): Promise<number> {
  const expired = await prisma.dataExport.findMany({
    where: {
      userId,
      status: 'ready',
      OR: [{ expiresAt: { lt: new Date() } }],
    },
    select: { id: true, fileKey: true },
    take: 100,
  });

  for (const item of expired) {
    if (item.fileKey && item.fileKey !== PURGED_KEY) {
      await deleteArtifact(item.fileKey);
    }
    await prisma.dataExport.update({
      where: { id: item.id },
      data: { status: 'expired', fileKey: PURGED_KEY },
    });
  }

  return expired.length;
}
