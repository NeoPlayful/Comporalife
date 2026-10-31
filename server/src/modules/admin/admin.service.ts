import type { Prisma, PrismaClient, UserRole } from '@prisma/client';
import { fromZonedTime } from 'date-fns-tz';
import { DELETION_COOLING_OFF_DAYS } from '../../config/constants.js';
import { errors } from '../../lib/errors.js';

/**
 * 管理后台取数。
 *
 * 硬约束：这里返回的任何结构都不得包含用户财务内容。
 * 账号元数据是白名单字段，任务统计是聚合计数，系统信息只读进程状态。
 */

const DAY_MS = 86_400_000;

export interface AdminUserListItem {
  id: string;
  email: string;
  nickname: string;
  role: UserRole;
  status: string;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  createdAt: string;
  /** 注销申请时间：管理端据此显示冷却期与审批按钮 */
  deletionRequestedAt: string | null;
  /** 已批准注销的时间：非空表示账号已软删除，不能重新启用 */
  deletedAt: string | null;
  /** 冷却期是否已满，由服务端算好，避免前后端各算一套 */
  coolingOffElapsed: boolean;
}

/** 审计里的操作者只给脱敏邮箱：定位到人即可，不需要明文 */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!name || !domain) return '***';
  return `${name.slice(0, 1)}***@${domain}`;
}

/** 登录 IP 只保留网段：排障不需要精确到主机 */
export function maskIp(ip: string | null): string | null {
  if (!ip) return null;
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

export function toAdminUser(user: {
  id: string;
  email: string;
  nickname: string;
  role: UserRole;
  status: string;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  lastLoginIp: string | null;
  createdAt: Date;
  deletionRequestedAt: Date | null;
  deletedAt: Date | null;
}): AdminUserListItem {
  const coolingOffEndsAt = user.deletionRequestedAt
    ? user.deletionRequestedAt.getTime() + DELETION_COOLING_OFF_DAYS * DAY_MS
    : null;

  return {
    id: user.id,
    // 后台默认展示完整账号：管理员要凭邮箱确认操作对象，脱敏只会放大误操作风险
    email: user.email,
    nickname: user.nickname,
    role: user.role,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    lastLoginIp: maskIp(user.lastLoginIp),
    createdAt: user.createdAt.toISOString(),
    deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
    deletedAt: user.deletedAt?.toISOString() ?? null,
    coolingOffElapsed: coolingOffEndsAt ? coolingOffEndsAt <= Date.now() : false,
  };
}

export type AdminDeletionFilter = 'pending' | 'ready' | 'deleted';

/**
 * 注销筛选转成 where 条件。
 *
 * 「冷却已满」按申请时间早于截止点计算，与 toAdminUser 的 coolingOffElapsed 保持同一口径，
 * 否则筛出来的行点进去会显示另一种状态。已注销的账号仍保留申请时间，
 * 所以 pending / ready 都要排除 deletedAt 非空的行。
 */
function deletionWhere(filter: AdminDeletionFilter): Prisma.UserWhereInput {
  const cutoff = new Date(Date.now() - DELETION_COOLING_OFF_DAYS * DAY_MS);

  if (filter === 'deleted') return { deletedAt: { not: null } };

  const base: Prisma.UserWhereInput = {
    deletionRequestedAt: { not: null },
    deletedAt: null,
  };

  return filter === 'ready'
    ? { ...base, deletionRequestedAt: { lte: cutoff } }
    : { ...base, deletionRequestedAt: { gt: cutoff } };
}

export async function listUsers(
  prisma: PrismaClient,
  params: {
    search?: string;
    role?: UserRole;
    status?: string;
    deletion?: AdminDeletionFilter;
    page: number;
    pageSize: number;
  },
): Promise<{ items: AdminUserListItem[]; total: number }> {
  const where: Prisma.UserWhereInput = {
    ...(params.role ? { role: params.role } : {}),
    ...(params.status ? { status: params.status as never } : {}),
    ...(params.search
      ? {
          OR: [
            { email: { contains: params.search, mode: 'insensitive' } },
            { nickname: { contains: params.search, mode: 'insensitive' } },
            // id 是 uuid 列：把任意字符串直接比较会触发数据库类型错误，
            // 只有形似 UUID 的搜索词才追加这一条
            ...(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.search)
              ? [{ id: params.search }]
              : []),
          ],
        }
      : {}),
    ...(params.deletion ? { ...deletionWhere(params.deletion) } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      select: {
        id: true,
        email: true,
        nickname: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        lastLoginIp: true,
        createdAt: true,
        deletionRequestedAt: true,
        deletedAt: true,
      },
    }),
  ]);

  return { items: rows.map((row) => toAdminUser(row)), total };
}

/**
 * 账号详情：白名单字段。
 * 任何「顺手加一个余额」的改动都会破坏产品红线，因此这里显式列出每个字段。
 */
export async function getUserDetail(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      nickname: true,
      role: true,
      status: true,
      emailVerifiedAt: true,
      lastLoginAt: true,
      lastLoginIp: true,
      createdAt: true,
      deletionRequestedAt: true,
      deletedAt: true,
    },
  });

  if (!user) throw errors.notFound('用户不存在');

  const sessionCount = await prisma.userSession.count({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
  });

  return {
    ...toAdminUser(user),
    sessionCount,
  };
}

export interface AdminAuditQuery {
  action?: string;
  actorId?: string;
  targetId?: string;
  from?: string;
  to?: string;
  timezone: string;
  page: number;
  pageSize: number;
}

/**
 * 管理员操作审计。
 *
 * 与用户侧审计（quality 模块）分开：这里看的是「谁对谁做了什么」，
 * 因此必须带操作者；仍然只给脱敏邮箱，不给财务内容。
 */
export async function listAdminAuditLogs(prisma: PrismaClient, params: AdminAuditQuery) {
  const createdAt: Prisma.DateTimeFilter = {};
  // 按管理员所在时区切日：否则「查某天的操作」会差几个小时
  if (params.from) createdAt.gte = fromZonedTime(`${params.from}T00:00:00.000`, params.timezone);
  if (params.to) createdAt.lte = fromZonedTime(`${params.to}T23:59:59.999`, params.timezone);

  const where: Prisma.AuditLogWhereInput = {
    // 管理员操作审计只包含 admin.* 动作，业务审计由用户侧页面负责
    action: params.action ? params.action : { startsWith: 'admin.' },
    ...(params.actorId ? { userId: params.actorId } : {}),
    ...(params.targetId ? { targetId: params.targetId } : {}),
    ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        metadata: true,
        ip: true,
        createdAt: true,
        user: { select: { email: true } },
      },
    }),
  ]);

  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      // 审计元数据本身是受控写入的（只含动作参数），但仍只给标量，避免将来夹带明细
      metadata: pickAuditMetadata(row.metadata),
      ip: maskIp(row.ip),
      // 操作者只给脱敏邮箱：定位到人即可，不需要明文
      actorEmail: row.user?.email ? maskEmail(row.user.email) : null,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

const AUDIT_METADATA_ALLOWED_KEYS = new Set([
  'enabled',
  'count',
  'disposition',
  'reason',
  'action',
  'note',
  'attempts',
  'kind',
  'fields',
  'changedFields',
  // 永久删除会连同用户行一起消失，事后只能靠这条审计定位被清除的是哪个账号
  'targetEmail',
  'targetRole',
]);

function pickAuditMetadata(metadata: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;

  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!AUDIT_METADATA_ALLOWED_KEYS.has(key)) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) picked[key] = value;
  }

  return Object.keys(picked).length > 0 ? picked : null;
}

export async function getAdminTimezone(prisma: PrismaClient, userId: string): Promise<string> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  return settings?.timezone ?? 'UTC';
}

export async function getDashboardOverview(prisma: PrismaClient) {
  const now = Date.now();
  const since24h = new Date(now - DAY_MS);
  const since7d = new Date(now - 7 * DAY_MS);

  const [total, active, disabled, newToday, newWeek] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: 'active' } }),
    prisma.user.count({ where: { status: 'disabled' } }),
    prisma.user.count({ where: { createdAt: { gte: since24h } } }),
    prisma.user.count({ where: { createdAt: { gte: since7d } } }),
  ]);

  return {
    users: { total, active, disabled, newLast24h: newToday, newLast7d: newWeek },
    // 只给聚合计数，不含任何用户维度的明细
    sessions: await prisma.userSession.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
  };
}

export async function getRegistrationTrend(prisma: PrismaClient, days = 30) {
  const since = new Date(Date.now() - days * DAY_MS);
  const rows = await prisma.user.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true },
  });

  const buckets = new Map<string, number>();
  for (const row of rows) {
    const key = row.createdAt.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return [...buckets.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getSecurityOverview(prisma: PrismaClient) {
  const since = new Date(Date.now() - 7 * DAY_MS);

  const [loginCount, failedLogins, disabledUsers] = await Promise.all([
    prisma.auditLog.count({ where: { action: 'auth.login', createdAt: { gte: since } } }),
    prisma.auditLog.count({ where: { action: 'auth.login_failed', createdAt: { gte: since } } }),
    prisma.user.count({ where: { status: 'disabled' } }),
  ]);

  return { window: '7d', loginCount, failedLogins, disabledUsers };
}

/**
 * 任务聚合。
 *
 * JobTask 与 MonteCarloRun 是两类独立实体，状态枚举也各自演进，
 * 过去把同名状态相加会让「进行中」的口径说不清，这里分开返回。
 */
export async function getJobOverview(prisma: PrismaClient) {
  const [tasks, runs] = await Promise.all([
    prisma.jobTask.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.monteCarloRun.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const countOf = (groups: Array<{ status: string; _count: { _all: number } }>) => {
    const counts: Record<string, number> = {};
    for (const group of groups) counts[group.status] = group._count._all;
    return counts;
  };

  const tasksByStatus = countOf(tasks);
  const runsByStatus = countOf(runs);
  const activeOf = (counts: Record<string, number>) =>
    (counts.queued ?? 0) + (counts.running ?? 0) + (counts.pending ?? 0);

  return {
    tasks: { counts: tasksByStatus, active: activeOf(tasksByStatus) },
    runs: { counts: runsByStatus, active: activeOf(runsByStatus) },
    // 兼容既有调用方：两者之和，仅用于「总共还有多少在跑」的粗口径
    active: activeOf(tasksByStatus) + activeOf(runsByStatus),
  };
}

/** 系统信息：只读进程与版本，不读数据库内容 */
export async function getSystemMetrics(prisma: PrismaClient, appVersion: string) {
  let databaseOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    databaseOk = false;
  }

  return {
    version: appVersion,
    node: process.version,
    uptimeSeconds: Math.floor(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    database: databaseOk ? 'ok' : 'fail',
  };
}

/**
 * 启用/禁用账号的保护规则集中在这里，避免每个路由各写一遍。
 * 最后一个超级管理员一旦被禁用，系统就永久失去管理入口。
 */
export async function assertRoleChangeAllowed(
  prisma: PrismaClient,
  params: { actorId: string; targetId: string; action: 'disable' },
): Promise<void> {
  if (params.actorId === params.targetId) {
    throw errors.adminSelfModification('不能修改自己的角色或状态');
  }

  const target = await prisma.user.findUnique({
    where: { id: params.targetId },
    select: { role: true, status: true },
  });

  if (!target) throw errors.notFound('用户不存在');

  // 禁用最后一个活跃超级管理员：直接拒绝
  if (target.role === 'super_admin') {
    const activeSuperAdmins = await prisma.user.count({
      where: { role: 'super_admin', status: 'active' },
    });

    if (activeSuperAdmins <= 1) {
      throw errors.adminLastSuperAdmin();
    }
  }
}
