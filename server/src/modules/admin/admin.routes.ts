import type { FastifyInstance, FastifyRequest } from 'fastify';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DELETION_COOLING_OFF_DAYS } from '../../config/constants.js';
import { buildPagination, ok, parsePageParams } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { retryTask } from '../jobs/task.repository.js';
import { AuthService } from '../auth/auth.service.js';
import { createNotification } from '../notifications/notification.service.js';
import { requireAuth, type AuthContext } from '../../plugins/auth.js';
import {
  isEmailVerificationEnabled,
  isRegistrationEnabled,
  setEmailVerificationEnabled,
  setRegistrationEnabled,
} from '../settings/system-settings.service.js';
import {
  adminAuditQuerySchema,
  adminEmailVerificationSchema,
  adminJobIdSchema,
  adminJobListSchema,
  adminLoginLogSchema,
  adminRegistrationSchema,
  deletionReviewSchema,
  adminUserDetailSchema,
  adminUserIdSchema,
  adminUserListSchema,
  normalizeReveal,
} from './admin.schema.js';
import {
  assertRoleChangeAllowed,
  getDashboardOverview,
  getJobOverview,
  getRegistrationTrend,
  getSecurityOverview,
  getSystemMetrics,
  getUserDetail,
  listUsers,
  maskIp,
} from './admin.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const APP_VERSION = (() => {
  try {
    const pkgPath = fileURLToPath(new URL('../../../package.json', import.meta.url));
    return (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
})();

/** 管理员守卫：user 一律 403；需要 super_admin 的再叠一层 */
function requireAdmin(request: FastifyRequest): AuthContext {
  const auth = requireAuth(request);
  if (auth.role !== 'admin' && auth.role !== 'super_admin') {
    throw errors.adminForbidden();
  }
  return auth;
}

function requireSuperAdmin(request: FastifyRequest): AuthContext {
  const auth = requireAdmin(request);
  if (auth.role !== 'super_admin') {
    throw errors.forbidden('仅超级管理员可执行该操作');
  }
  return auth;
}

export default async function adminRoutes(app: FastifyInstance) {
  // 所有管理接口都不返回任何用户财务内容；这是产品红线，测试逐字段断言

  // ===== 仪表板 =====
  app.get('/admin/dashboard/overview', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);
    return ok(await getDashboardOverview(app.prisma), request.id);
  });

  app.get('/admin/dashboard/registrations', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);
    return ok({ points: await getRegistrationTrend(app.prisma) }, request.id);
  });

  app.get('/admin/dashboard/security', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);
    return ok(await getSecurityOverview(app.prisma), request.id);
  });

  app.get('/admin/dashboard/jobs', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);
    return ok(await getJobOverview(app.prisma), request.id);
  });

  // ===== 用户管理 =====
  app.get('/admin/users', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);
    const query = adminUserListSchema.parse(request.query);
    const page = parsePageParams({ page: query.page, pageSize: query.pageSize });

    const result = await listUsers(app.prisma, {
      ...(query.search ? { search: query.search } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      page: page.page,
      pageSize: page.pageSize,
      reveal: normalizeReveal(query.reveal),
    });

    return ok({ users: result.items }, request.id, {
      pagination: buildPagination(page.page, page.pageSize, result.total),
    });
  });

  app.get('/admin/users/:id', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);
    const { id } = adminUserIdSchema.parse(request.params);
    const query = adminUserDetailSchema.parse(request.query);

    return ok(
      { user: await getUserDetail(app.prisma, id, { reveal: normalizeReveal(query.reveal) }) },
      request.id,
    );
  });

  app.post('/admin/users/:id/disable', { preHandler: app.authenticate }, async (request) => {
    const actor = requireAdmin(request);
    const { id } = adminUserIdSchema.parse(request.params);

    await assertRoleChangeAllowed(app.prisma, { actorId: actor.userId, targetId: id, action: 'disable' });

    // 禁用与撤会话必须原子：先禁用再撤，否则中间窗口里旧令牌仍可用
    await app.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status: 'disabled', sessionVersion: { increment: 1 } } });
      await tx.userSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({
        data: { userId: actor.userId, action: 'admin.user_disabled', targetType: 'user', targetId: id },
      });
    });

    await createNotification(app.prisma, {
      userId: id,
      kind: 'admin_action',
      metadata: { action: 'user_disabled' },
      link: null,
    });

    return ok({ id, status: 'disabled' }, request.id);
  });

  app.post('/admin/users/:id/enable', { preHandler: app.authenticate }, async (request) => {
    const actor = requireAdmin(request);
    const { id } = adminUserIdSchema.parse(request.params);

    const user = await app.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw errors.notFound('用户不存在');

    await app.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status: 'active' } });
      await tx.auditLog.create({
        data: { userId: actor.userId, action: 'admin.user_enabled', targetType: 'user', targetId: id },
      });
    });

    await createNotification(app.prisma, {
      userId: id,
      kind: 'admin_action',
      metadata: { action: 'user_enabled' },
      link: null,
    });

    return ok({ id, status: 'active' }, request.id);
  });

  app.post('/admin/users/:id/revoke-sessions', { preHandler: app.authenticate }, async (request) => {
    const actor = requireAdmin(request);
    const { id } = adminUserIdSchema.parse(request.params);

    const user = await app.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw errors.notFound('用户不存在');

    const revoked = await app.prisma.$transaction(async (tx) => {
      // sessionVersion 递增让已签发的 access token 立即失效，
      // 仅标 revokedAt 只能挡住刷新，挡不住手上已经拿到的 access token
      await tx.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
      const result = await tx.userSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'admin.sessions_revoked',
          targetType: 'user',
          targetId: id,
          metadata: { count: result.count },
        },
      });
      return result.count;
    });

    return ok({ id, revoked }, request.id);
  });

  app.get('/admin/users/:id/login-logs', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);
    const { id } = adminUserIdSchema.parse(request.params);
    const query = adminLoginLogSchema.parse(request.query);
    const page = parsePageParams({ page: query.page, pageSize: query.pageSize });

    const where = {
      userId: id,
      action: { in: ['auth.login', 'auth.login_failed'] },
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      app.prisma.auditLog.count({ where }),
      app.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
        select: { id: true, action: true, ip: true, createdAt: true },
      }),
    ]);

    return ok(
      {
        logs: rows.map((row) => ({
          id: row.id,
          action: row.action,
          // IP 只给网段：登录排障不需要精确到主机
          ip: maskIp(row.ip),
          createdAt: row.createdAt.toISOString(),
        })),
      },
      request.id,
      { pagination: buildPagination(page.page, page.pageSize, total) },
    );
  });

  app.get('/admin/users/:id/audit-logs', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);
    const { id } = adminUserIdSchema.parse(request.params);
    const page = parsePageParams({ page: 1, pageSize: 20 });

    // 只返回「针对该账号的管理操作」，不含用户自己产生的业务审计
    const [total, rows] = await Promise.all([
      app.prisma.auditLog.count({ where: { targetType: 'user', targetId: id, action: { startsWith: 'admin.' } } }),
      app.prisma.auditLog.findMany({
        where: { targetType: 'user', targetId: id, action: { startsWith: 'admin.' } },
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
        select: { id: true, action: true, createdAt: true, metadata: true },
      }),
    ]);

    return ok(
      {
        logs: rows.map((row) => ({
          id: row.id,
          action: row.action,
          createdAt: row.createdAt.toISOString(),
        })),
      },
      request.id,
      { pagination: buildPagination(page.page, page.pageSize, total) },
    );
  });

  /**
   * 注销申请审批。
   * 批准 = 软删除（禁用 + 记录 deletedAt），绝不物理删除：
   * 数据行保留，历史审计与备份仍可追溯。
   */
  app.post('/admin/users/:id/deletion-review', { preHandler: app.authenticate }, async (request) => {
    const actor = requireAdmin(request);
    const { id } = adminUserIdSchema.parse(request.params);
    const body = deletionReviewSchema.parse(request.body ?? {});

    const target = await app.prisma.user.findUnique({
      where: { id },
      select: { deletionRequestedAt: true, deletedAt: true },
    });

    if (!target) throw errors.notFound('用户不存在');
    if (!target.deletionRequestedAt) {
      throw errors.deletionNotReviewable('no_pending_request');
    }

    if (body.decision === 'reject') {
      await app.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id },
          data: { deletionRequestedAt: null, deletionReviewedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            userId: actor.userId,
            action: 'admin.deletion_rejected',
            targetType: 'user',
            targetId: id,
            metadata: body.note ? { note: body.note } : undefined,
          },
        });
      });

      await createNotification(app.prisma, {
        userId: id,
        kind: 'admin_action',
        metadata: { action: 'deletion_rejected' },
        link: '/profile',
      });

      return ok({ id, decision: 'reject', status: 'unchanged' }, request.id);
    }

    // 冷却期未满不得批准：给用户留出反悔窗口，也防止管理员误操作
    const coolingOffEndsAt = target.deletionRequestedAt.getTime() + DELETION_COOLING_OFF_DAYS * DAY_MS;
    if (Date.now() < coolingOffEndsAt) {
      throw errors.deletionNotReviewable('cooling_off_not_elapsed');
    }

    await assertRoleChangeAllowed(app.prisma, { actorId: actor.userId, targetId: id, action: 'disable' });

    await app.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          status: 'disabled',
          deletedAt: new Date(),
          deletionReviewedAt: new Date(),
          sessionVersion: { increment: 1 },
        },
      });
      await tx.userSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'admin.deletion_approved',
          targetType: 'user',
          targetId: id,
          metadata: { disposition: 'soft_deleted', ...(body.note ? { note: body.note } : {}) },
        },
      });
    });

    await createNotification(app.prisma, {
      userId: id,
      kind: 'deletion_approved',
      metadata: {},
      link: null,
    });

    return ok({ id, decision: 'approve', status: 'disabled', disposition: 'soft_deleted' }, request.id);
  });

  // ===== 管理员权限（仅 super_admin） =====
  app.get('/admin/admins', { preHandler: app.authenticate }, async (request) => {
    requireSuperAdmin(request);

    const rows = await app.prisma.user.findMany({
      where: { role: { in: ['admin', 'super_admin'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, nickname: true, role: true, status: true, createdAt: true },
    });

    return ok(
      {
        admins: rows.map((row) => ({
          id: row.id,
          email: row.email.replace(/(.).*(@.*)/, '$1***$2'),
          nickname: row.nickname,
          role: row.role,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
        })),
      },
      request.id,
    );
  });

  app.post('/admin/admins/:id/grant', { preHandler: app.authenticate }, async (request) => {
    const actor = requireSuperAdmin(request);
    const { id } = adminUserIdSchema.parse(request.params);

    if (actor.userId === id) throw errors.adminSelfModification('不能给自己授予管理员权限');

    const target = await app.prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!target) throw errors.notFound('用户不存在');
    if (target.role === 'super_admin') throw errors.validation('目标用户已是超级管理员');

    await app.prisma.$transaction(async (tx) => {
      // 提权必须让现有会话失效：否则旧令牌仍带 user 角色
      await tx.user.update({
        where: { id },
        data: { role: 'admin', sessionVersion: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: { userId: actor.userId, action: 'admin.role_granted', targetType: 'user', targetId: id },
      });
    });

    return ok({ id, role: 'admin' }, request.id);
  });

  app.post('/admin/admins/:id/revoke', { preHandler: app.authenticate }, async (request) => {
    const actor = requireSuperAdmin(request);
    const { id } = adminUserIdSchema.parse(request.params);

    if (actor.userId === id) throw errors.adminSelfModification('不能撤销自己的管理员权限');

    await assertRoleChangeAllowed(app.prisma, { actorId: actor.userId, targetId: id, action: 'revoke' });

    await app.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { role: 'user', sessionVersion: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: { userId: actor.userId, action: 'admin.role_revoked', targetType: 'user', targetId: id },
      });
    });

    return ok({ id, role: 'user' }, request.id);
  });

  app.get('/admin/permissions/me', { preHandler: app.authenticate }, async (request) => {
    const actor = requireAdmin(request);

    const permissions =
      actor.role === 'super_admin'
        ? ['dashboard:read', 'users:read', 'users:write', 'admins:read', 'admins:write', 'system:read', 'settings:write']
        : ['dashboard:read', 'users:read', 'users:write', 'system:read'];

    return ok({ role: actor.role, permissions }, request.id);
  });

  // ===== 安全与运维 =====
  app.get('/admin/audit-logs', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);
    const query = adminAuditQuerySchema.parse(request.query);
    const page = parsePageParams({ page: query.page, pageSize: query.pageSize });

    const where = {
      action: query.action ? query.action : { startsWith: 'admin.' },
    };

    const [total, rows] = await Promise.all([
      app.prisma.auditLog.count({ where }),
      app.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
        select: { id: true, action: true, targetType: true, targetId: true, createdAt: true, ip: true },
      }),
    ]);

    return ok(
      {
        logs: rows.map((row) => ({
          id: row.id,
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          ip: maskIp(row.ip),
          createdAt: row.createdAt.toISOString(),
        })),
      },
      request.id,
      { pagination: buildPagination(page.page, page.pageSize, total) },
    );
  });

  app.get('/admin/jobs', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);
    const query = adminJobListSchema.parse(request.query);
    const page = parsePageParams({ page: query.page, pageSize: query.pageSize });

    const where = query.status ? { status: query.status } : {};

    const [total, rows] = await Promise.all([
      app.prisma.jobTask.count({ where }),
      app.prisma.jobTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          kind: true,
          status: true,
          progress: true,
          failureCode: true,
          createdAt: true,
          finishedAt: true,
        },
      }),
    ]);

    return ok(
      {
        jobs: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          status: row.status,
          progress: row.progress.toFixed(4),
          failureCode: row.failureCode,
          createdAt: row.createdAt.toISOString(),
          finishedAt: row.finishedAt?.toISOString() ?? null,
        })),
      },
      request.id,
      { pagination: buildPagination(page.page, page.pageSize, total) },
    );
  });

  app.get('/admin/jobs/:id', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);
    const { id } = adminJobIdSchema.parse(request.params);

    const task = await app.prisma.jobTask.findUnique({
      where: { id },
      select: {
        id: true,
        kind: true,
        status: true,
        progress: true,
        stage: true,
        attempts: true,
        failureCode: true,
        failureMessage: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
      },
    });

    if (!task) throw errors.taskNotFound();

    return ok(
      {
        job: {
          ...task,
          progress: task.progress.toFixed(4),
          createdAt: task.createdAt.toISOString(),
          startedAt: task.startedAt?.toISOString() ?? null,
          finishedAt: task.finishedAt?.toISOString() ?? null,
        },
      },
      request.id,
    );
  });

  // 任务重试：仅失败且未达次数上限的任务可重试，复用与用户侧相同的仓储函数
  app.post('/admin/jobs/:id/retry', { preHandler: app.authenticate }, async (request) => {
    const actor = requireAdmin(request);
    const { id } = adminJobIdSchema.parse(request.params);

    const task = await app.prisma.jobTask.findUnique({
      where: { id },
      select: { id: true, kind: true, userId: true, status: true, attempts: true, targetId: true },
    });
    if (!task) throw errors.taskNotFound();

    if (task.status !== 'failed') {
      throw errors.taskNotRetryable(task.status, task.attempts);
    }

    const retried = await retryTask(app.prisma, task.userId, id);
    app.tasks.kick();

    await app.prisma.auditLog.create({
      data: {
        userId: actor.userId,
        action: 'admin.job_retried',
        targetType: 'job_task',
        targetId: id,
        metadata: { taskKind: task.kind, attempts: retried.attempts },
      },
    });

    return ok({ id: retried.id, status: retried.status, attempts: retried.attempts }, request.id);
  });

  // 重发重置邮件：不返回令牌，只确认已触发
  app.post('/admin/users/:id/send-password-reset', { preHandler: app.authenticate }, async (request) => {
    const actor = requireAdmin(request);
    const { id } = adminUserIdSchema.parse(request.params);

    const user = await app.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, status: true },
    });
    if (!user) throw errors.notFound('用户不存在');
    if (user.status !== 'active') {
      throw errors.validation('只能对启用中的账号触发密码重置');
    }

    const service = new AuthService(app.prisma, app.redis);
    await service.requestPasswordReset(user.email, request.log);

    await app.prisma.auditLog.create({
      data: {
        userId: actor.userId,
        action: 'admin.password_reset_triggered',
        targetType: 'user',
        targetId: id,
      },
    });

    return ok({ triggered: true }, request.id);
  });

  app.get('/admin/system/info', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);
    return ok(await getSystemMetrics(app.prisma, APP_VERSION), request.id);
  });

  app.get('/admin/system/metrics', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);

    const [jobs, sessions] = await Promise.all([
      getJobOverview(app.prisma),
      app.prisma.userSession.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
    ]);

    return ok(
      {
        jobs,
        sessions,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      request.id,
    );
  });

  // ===== 注册开关 =====
  app.get('/admin/settings/registration', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);
    return ok({ enabled: await isRegistrationEnabled(app.prisma) }, request.id);
  });

  app.patch('/admin/settings/registration', { preHandler: app.authenticate }, async (request) => {
    const actor = requireAdmin(request);
    const body = adminRegistrationSchema.parse(request.body);

    await setRegistrationEnabled(app.prisma, body.enabled, actor.userId);

    await app.prisma.auditLog.create({
      data: {
        userId: actor.userId,
        action: 'admin.registration_toggled',
        targetType: 'system_setting',
        metadata: { enabled: body.enabled },
      },
    });

    return ok({ enabled: body.enabled }, request.id);
  });

  // ===== 邮箱验证开关 =====
  app.get('/admin/settings/email-verification', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);
    return ok({ enabled: await isEmailVerificationEnabled(app.prisma) }, request.id);
  });

  app.patch('/admin/settings/email-verification', { preHandler: app.authenticate }, async (request) => {
    const actor = requireAdmin(request);
    const body = adminEmailVerificationSchema.parse(request.body);

    await setEmailVerificationEnabled(app.prisma, body.enabled, actor.userId);

    await app.prisma.auditLog.create({
      data: {
        userId: actor.userId,
        action: 'admin.email_verification_toggled',
        targetType: 'system_setting',
        metadata: { enabled: body.enabled },
      },
    });

    return ok({ enabled: body.enabled }, request.id);
  });
}
