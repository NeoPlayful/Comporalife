import type { Prisma, PrismaClient, UserRole } from '@prisma/client';
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
  /** 冷却期是否已满，由服务端算好，避免前后端各算一套 */
  coolingOffElapsed: boolean;
}

/** 邮箱与昵称默认脱敏：管理后台的常见操作不需要看到完整值 */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!name || !domain) return '***';
  return `${name.slice(0, 1)}***@${domain}`;
}

export function maskNickname(nickname: string): string {
  return nickname.length <= 1 ? '*' : `${nickname.slice(0, 1)}***`;
}

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

export function toAdminUser(
  user: {
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
  },
  options: { reveal?: boolean } = {},
): AdminUserListItem {
  const coolingOffEndsAt = user.deletionRequestedAt
    ? user.deletionRequestedAt.getTime() + DELETION_COOLING_OFF_DAYS * DAY_MS
    : null;

  return {
    id: user.id,
    email: options.reveal ? user.email : maskEmail(user.email),
    nickname: options.reveal ? user.nickname : maskNickname(user.nickname),
    role: user.role,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    lastLoginIp: maskIp(user.lastLoginIp),
    createdAt: user.createdAt.toISOString(),
    deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
    coolingOffElapsed: coolingOffEndsAt ? coolingOffEndsAt <= Date.now() : false,
  };
}

export async function listUsers(
  prisma: PrismaClient,
  params: {
    search?: string;
    role?: UserRole;
    status?: string;
    page: number;
    pageSize: number;
    reveal?: boolean;
  },
): Promise<{ items: AdminUserListItem[]; total: number }> {
  const where: Prisma.UserWhereInput = {
    ...(params.role ? { role: params.role } : {}),
    ...(params.status ? { status: params.status as never } : {}),
    ...(params.search
      ? {
          OR: [
            { email: { contains: params.search, mode: 'insensitive' } },
            { id: params.search },
          ],
        }
      : {}),
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
      },
    }),
  ]);

  return { items: rows.map((row) => toAdminUser(row, { reveal: params.reveal })), total };
}

/**
 * 账号详情：白名单字段。
 * 任何「顺手加一个余额」的改动都会破坏产品红线，因此这里显式列出每个字段。
 */
export async function getUserDetail(
  prisma: PrismaClient,
  userId: string,
  options: { reveal?: boolean } = {},
) {
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
    },
  });

  if (!user) throw errors.notFound('用户不存在');

  const sessionCount = await prisma.userSession.count({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
  });

  return {
    ...toAdminUser(user, options),
    sessionCount,
  };
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

export async function getJobOverview(prisma: PrismaClient) {
  const [tasks, runs] = await Promise.all([
    prisma.jobTask.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.monteCarloRun.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const counts: Record<string, number> = {};
  for (const group of tasks) counts[group.status] = group._count._all;
  for (const group of runs) counts[group.status] = (counts[group.status] ?? 0) + group._count._all;

  return { counts, active: (counts.queued ?? 0) + (counts.running ?? 0) };
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
 * 角色变更的保护规则集中在这里，避免每个路由各写一遍。
 * 最后一个超级管理员一旦被降级，系统就永久失去管理入口。
 */
export async function assertRoleChangeAllowed(
  prisma: PrismaClient,
  params: { actorId: string; targetId: string; action: 'grant' | 'revoke' | 'disable' },
): Promise<void> {
  if (params.actorId === params.targetId) {
    throw errors.adminSelfModification('不能修改自己的角色或状态');
  }

  const target = await prisma.user.findUnique({
    where: { id: params.targetId },
    select: { role: true, status: true },
  });

  if (!target) throw errors.notFound('用户不存在');

  // 撤销权限对 admin 与 super_admin 都适用：后者是降级回普通用户
  if (params.action === 'revoke' && target.role === 'user') {
    throw errors.validation('目标用户不是管理员');
  }

  // 降级或禁用最后一个活跃超级管理员：直接拒绝
  if (target.role === 'super_admin') {
    const activeSuperAdmins = await prisma.user.count({
      where: { role: 'super_admin', status: 'active' },
    });

    if (activeSuperAdmins <= 1) {
      throw errors.adminLastSuperAdmin();
    }
  }
}
