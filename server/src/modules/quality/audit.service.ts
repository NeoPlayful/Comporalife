import type { Prisma, PrismaClient } from '@prisma/client';
import { AUDIT_LOG_PAGE_SIZE } from '../../config/constants.js';
import { errors } from '../../lib/errors.js';
import { fromZonedTime } from 'date-fns-tz';

/**
 * 审计读模型。
 *
 * 只返回白名单字段：审计日志里可能有其他业务写入的自由结构 metadata，
 * 这里按允许键过滤，避免把金额、名称或流水内容泄漏给调用方。
 */
const METADATA_ALLOWED_KEYS = new Set([
  'format',
  'totalRows',
  'importedRows',
  'categoryMatched',
  'voided',
  'fields',
  'changedFields',
  'created',
  'itemCount',
  'dimension',
  'type',
  'kind',
  'count',
  'rows',
  'status',
  'reason',
  'sourceTransactions',
  'cashflowId',
  'tradeId',
  'instrumentId',
  'accountId',
  'costBasisMethod',
  'periodType',
  'year',
  'month',
  'sourceBudgetId',
  'targetYear',
  'targetMonth',
  'goalId',
  'reportId',
  'backupId',
  'exportId',
  'taskId',
  'domains',
  'conflict',
  'rowsWritten',
  'fileCount',
  // 汇率变更只暴露币种对与生效日期，汇率数值本身不进审计视图
  'baseCurrency',
  'quoteCurrency',
  'rateDate',
]);

export interface AuditLogItem {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

function maskIp(ip: string | null): string | null {
  if (!ip) return null;

  // IPv4 保留前三段（/24 网段），IPv6 保留前两组：既能定位来源网段，又不落原始地址
  if (ip.includes('.')) {
    const parts = ip.split('.');
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.x` : null;
  }

  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean);
    return parts.length >= 2 ? `${parts[0]}:${parts[1]}::` : null;
  }

  return null;
}

function pickMetadata(metadata: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;

  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!METADATA_ALLOWED_KEYS.has(key)) continue;
    // 只保留标量与标量数组，嵌套对象一律丢弃，避免夹带明细
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      picked[key] = value;
    } else if (Array.isArray(value) && value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
      picked[key] = value;
    }
  }

  return Object.keys(picked).length > 0 ? picked : null;
}

function toItem(row: {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Prisma.JsonValue | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}): AuditLogItem {
  return {
    id: row.id,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: pickMetadata(row.metadata),
    ip: maskIp(row.ip),
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listAuditLogs(
  prisma: PrismaClient,
  params: {
    userId: string;
    timezone: string;
    page?: number;
    pageSize?: number;
    action?: string;
    from?: string;
    to?: string;
  },
): Promise<{ items: AuditLogItem[]; total: number; page: number; pageSize: number }> {
  const page = params.page ?? 1;
  const pageSize = Math.min(params.pageSize ?? AUDIT_LOG_PAGE_SIZE, 200);

  const createdAt: Prisma.DateTimeFilter = {};
  if (params.from) createdAt.gte = fromZonedTime(`${params.from}T00:00:00.000`, params.timezone);
  if (params.to) createdAt.lte = fromZonedTime(`${params.to}T23:59:59.999`, params.timezone);

  const where: Prisma.AuditLogWhereInput = {
    userId: params.userId,
    ...(params.action ? { action: params.action } : {}),
    ...(params.from || params.to ? { createdAt } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        metadata: true,
        ip: true,
        userAgent: true,
        createdAt: true,
      },
    }),
  ]);

  return { items: rows.map(toItem), total, page, pageSize };
}

export async function getAuditLog(
  prisma: PrismaClient,
  userId: string,
  id: string,
): Promise<AuditLogItem> {
  const row = await prisma.auditLog.findFirst({
    where: { id, userId },
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      metadata: true,
      ip: true,
      userAgent: true,
      createdAt: true,
    },
  });

  if (!row) throw errors.notFound('审计事件不存在');

  return toItem(row);
}
