import type { FastifyInstance, FastifyRequest } from 'fastify';
import argon2 from 'argon2';
import { fromZonedTime } from 'date-fns-tz';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AUDIT_LOG_RETENTION_DAYS, DELETION_COOLING_OFF_DAYS } from '../../config/constants.js';
import { buildPagination, ok, parsePageParams } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { isMailConfigured } from '../../lib/mailer.js';
import { retryTask } from '../jobs/task.repository.js';
import { AuthService } from '../auth/auth.service.js';
import { createNotification } from '../notifications/notification.service.js';
import { requireAuth, type AuthContext } from '../../plugins/auth.js';
import {
  isAdminUserCreateEnabled,
  isEmailVerificationEnabled,
  isRegistrationEnabled,
  setAdminUserCreateEnabled,
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
  adminUserCreateSchema,
  adminUserCreateToggleSchema,
  adminUserIdSchema,
  adminUserListSchema,
  adminUserDeleteQuerySchema,
  adminUserUpdateSchema,
  adminUserRoleSchema,
  adminUserPasswordSchema,
} from './admin.schema.js';
import {
  assertRoleChangeAllowed,
  getAdminTimezone,
  getDashboardOverview,
  getJobOverview,
  getRegistrationTrend,
  getSecurityOverview,
  getSystemMetrics,
  getUserDetail,
  listAdminAuditLogs,
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
  // 红线：管理接口不返回任何用户的余额、流水、持仓、目标、报表、导入内容。
  // 汇率与标的元数据属于系统参考数据，后台可见可维护；标的价格仍属持仓上下文，不暴露。

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
      ...(query.deletion ? { deletion: query.deletion } : {}),
      page: page.page,
      pageSize: page.pageSize,
    });

    return ok({ users: result.items }, request.id, {
      pagination: buildPagination(page.page, page.pageSize, result.total),
    });
  });

  /**
   * 后台代建账号。
   *
   * 与前台注册完全隔离：注册开关关闭时这里仍可用，但本接口受独立开关控制；
   * 且不签发会话、不写 refresh cookie——管理员建号后自己不能被切换成新账号。
   * 角色高于 user 属于提权，与 grant 接口同口径，仅超管可用。
   */
  app.post('/admin/users', { preHandler: app.authenticate }, async (request, reply) => {
    const actor = requireAdmin(request);

    if (!(await isAdminUserCreateEnabled(app.prisma))) {
      throw errors.forbidden('后台代建账号已关闭');
    }

    const body = adminUserCreateSchema.parse(request.body);
    if (body.role !== 'user') {
      requireSuperAdmin(request);
    }

    const service = new AuthService(app.prisma, app.redis);
    const { user } = await service.register(
      {
        email: body.email,
        password: body.password,
        nickname: body.nickname,
        ...(body.language ? { language: body.language } : {}),
      },
      {
        role: body.role,
        emailVerified: true,
        audit: { action: 'admin.user_created', actorId: actor.userId },
      },
    );

    const detail = await getUserDetail(app.prisma, user.id);
    return reply.status(201).send(ok({ user: detail }, request.id));
  });

  app.get('/admin/users/:id', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);
    const { id } = adminUserIdSchema.parse(request.params);

    return ok({ user: await getUserDetail(app.prisma, id) }, request.id);
  });

  /**
   * 后台修改账号资料。
   *
   * 只开放昵称、邮箱、语言三项：密码走重置邮件，角色走 grant/revoke，状态走 disable/enable，
   * 这三条路径都各有自己的审计与安全前提，不能塞进一个「顺手全改」的接口里。
   * 改邮箱必须同时标记已验证——新地址没有走过验证流程，留着未验证状态只会让账号卡在提示里，
   * 而登录本身又不校验这一点，等于形同虚设。
   */
  app.patch('/admin/users/:id', { preHandler: app.authenticate }, async (request) => {
    const actor = requireAdmin(request);
    const { id } = adminUserIdSchema.parse(request.params);
    const body = adminUserUpdateSchema.parse(request.body ?? {});

    const target = await app.prisma.user.findUnique({
      where: { id },
      select: { email: true, nickname: true, deletedAt: true },
    });
    if (!target) throw errors.notFound('用户不存在');
    if (target.deletedAt) throw errors.conflict('该账号已注销，不能修改', { reason: 'account_deleted' });

    if (body.email && body.email !== target.email) {
      const taken = await app.prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
      if (taken) throw errors.emailExists();
    }

    const profilePatch = {
      ...(body.nickname !== undefined && body.nickname !== target.nickname ? { nickname: body.nickname } : {}),
      ...(body.email !== undefined && body.email !== target.email
        ? { email: body.email, emailVerifiedAt: new Date() }
        : {}),
    };
    const languagePatch = body.language !== undefined;

    if (Object.keys(profilePatch).length === 0 && !languagePatch) {
      // 与库中值完全相同：不写库也不写审计，避免审计里堆满「改了但没变」的记录
      return ok({ user: await getUserDetail(app.prisma, id) }, request.id);
    }

    await app.prisma.$transaction(async (tx) => {
      if (Object.keys(profilePatch).length > 0) {
        await tx.user.update({ where: { id }, data: profilePatch });
      }
      if (languagePatch) {
        // 语言偏好存在 settings 里；账号可能因历史原因没有 settings 行，用 upsert 兜住
        await tx.userSettings.upsert({
          where: { userId: id },
          create: { userId: id, language: body.language! },
          update: { language: body.language! },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'admin.user_updated',
          targetType: 'user',
          targetId: id,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          // 只记改过哪些字段，不记具体值：审计日志的读取方不需要昵称与邮箱原文。
          // 这里必须写成逗号分隔的字符串——metadata 白名单只保留标量，数组会被整段丢弃。
          metadata: {
            changedFields: [...Object.keys(profilePatch), ...(languagePatch ? ['language'] : [])].join(','),
          },
        },
      });
    });

    return ok({ user: await getUserDetail(app.prisma, id) }, request.id);
  });

  /**
   * 后台删除账号。
   *
   * 默认软删除：置 deletedAt、禁用、撤会话，数据保留，可留待审计或恢复。
   * `?permanent=true` 改为物理删除，连同该用户的全部财务数据一并清除，不可恢复。
   *
   * 两条路径都不要求用户先发起注销申请，因此冷却期规则不适用——这是管理员的直接处置。
   * 但仍禁止删自己和删最后一个活跃超管，否则会把系统锁死。
   *
   * 永久删除的审计记录在删除之前写：用户行一旦消失，外键 SetNull 会让
   * 审计里的 actor 之外的信息更难追溯，所以把邮箱留在 metadata 里，
   * 事后仍能查出「谁的账号被彻底清掉了」。
   */
  app.delete('/admin/users/:id', { preHandler: app.authenticate }, async (request) => {
    const actor = requireAdmin(request);
    const { id } = adminUserIdSchema.parse(request.params);
    const query = adminUserDeleteQuerySchema.parse(request.query ?? {});
    const permanent = query.permanent === 'true';

    await assertRoleChangeAllowed(app.prisma, { actorId: actor.userId, targetId: id, action: 'disable' });

    const target = await app.prisma.user.findUnique({
      where: { id },
      select: { email: true, role: true, deletedAt: true },
    });
    if (!target) throw errors.notFound('用户不存在');
    // 永久删除允许对已软删除的账号再执行一次，这正是「先软删、观察后再彻底清掉」的用法；
    // 软删除则不能重复执行
    if (!permanent && target.deletedAt) {
      throw errors.conflict('该账号已注销', { reason: 'account_deleted' });
    }

    if (permanent) {
      // 永久删除必须是超管：它会绕过注销冷却期，直接销毁用户全部财务数据
      requireSuperAdmin(request);

      await app.prisma.$transaction(async (tx) => {
        await tx.auditLog.create({
          data: {
            userId: actor.userId,
            action: 'admin.user_purged',
            targetType: 'user',
            targetId: id,
            ip: request.ip,
            userAgent: request.headers['user-agent'],
            metadata: { disposition: 'permanent', targetEmail: target.email, targetRole: target.role },
          },
        });
        // 关联数据全部 onDelete: Cascade；审计日志的 userId 是 SetNull，会保留下来
        await tx.user.delete({ where: { id } });
      });

      return ok({ id, deleted: true, disposition: 'permanent' }, request.id);
    }

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
          action: 'admin.user_deleted',
          targetType: 'user',
          targetId: id,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          metadata: { disposition: 'soft_deleted' },
        },
      });
    });

    return ok({ id, deleted: true, disposition: 'soft_deleted' }, request.id);
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

    const user = await app.prisma.user.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
    if (!user) throw errors.notFound('用户不存在');

    // 已批准注销的账号不能再启用：否则「注销」变成可撤销的普通禁用，
    // 用户数据保留的前提也就不成立了。需要恢复请走独立的数据恢复流程。
    if (user.deletedAt) {
      throw errors.conflict('该账号已注销，不能重新启用', { reason: 'account_deleted' });
    }

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

  /**
   * 修改角色（仅超管）。
   *
   * 角色是提权操作：普通 admin 若能改角色，就能把自己提成超管，
   * 因此这里必须走 requireSuperAdmin，而不是 requireAdmin。
   * 两条硬约束：不能改自己（避免自锁或自我提权），不能把最后一个活跃超管降级
   * （否则系统永久失去管理入口）。改动会递增 sessionVersion，旧令牌立即失效。
   */
  app.patch('/admin/users/:id/role', { preHandler: app.authenticate }, async (request) => {
    const actor = requireSuperAdmin(request);
    const { id } = adminUserIdSchema.parse(request.params);
    const { role } = adminUserRoleSchema.parse(request.body);

    if (actor.userId === id) throw errors.adminSelfModification('不能修改自己的角色');

    const target = await app.prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!target) throw errors.notFound('用户不存在');

    if (target.role === role) {
      // 角色未变：不写库也不写审计，避免堆满「改了但没变」的记录
      return ok({ user: await getUserDetail(app.prisma, id) }, request.id);
    }

    // 降级最后一个活跃超管会让系统失去管理入口，直接拒绝
    if (target.role === 'super_admin') {
      const activeSuperAdmins = await app.prisma.user.count({
        where: { role: 'super_admin', status: 'active' },
      });
      if (activeSuperAdmins <= 1) {
        throw errors.adminLastSuperAdmin();
      }
    }

    await app.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { role, sessionVersion: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'admin.role_changed',
          targetType: 'user',
          targetId: id,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          metadata: { from: target.role, to: role },
        },
      });
    });

    return ok({ user: await getUserDetail(app.prisma, id) }, request.id);
  });

  /**
   * 直接设置新密码。
   *
   * 管理员无需知道旧密码：这是「账号被锁、用户联系不上」时的处置手段。
   * 改密会递增 sessionVersion 并撤销该用户全部会话——否则旧令牌仍能继续使用，
   * 等于改了密码却没把人踢下线。审计只记「改过密码」，绝不记录密码本身。
   */
  app.post('/admin/users/:id/password', { preHandler: app.authenticate }, async (request) => {
    const actor = requireAdmin(request);
    const { id } = adminUserIdSchema.parse(request.params);
    const { password } = adminUserPasswordSchema.parse(request.body);

    const target = await app.prisma.user.findUnique({
      where: { id },
      select: { deletedAt: true },
    });
    if (!target) throw errors.notFound('用户不存在');
    if (target.deletedAt) throw errors.conflict('该账号已注销，不能修改密码', { reason: 'account_deleted' });

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    await app.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash, sessionVersion: { increment: 1 } },
      });
      await tx.userSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'admin.password_set',
          targetType: 'user',
          targetId: id,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        },
      });
    });

    await createNotification(app.prisma, {
      userId: id,
      kind: 'admin_action',
      metadata: { action: 'password_set' },
      link: null,
    });

    return ok({ id, updated: true }, request.id);
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
    const actor = requireAdmin(request);
    const { id } = adminUserIdSchema.parse(request.params);
    const query = adminLoginLogSchema.parse(request.query);
    const page = parsePageParams({ page: query.page, pageSize: query.pageSize });
    const timezone = await getAdminTimezone(app.prisma, actor.userId);

    const where = {
      userId: id,
      action: { in: ['auth.login', 'auth.login_failed'] },
      // 日期按管理员时区切日，前后端看到的是同一天
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: fromZonedTime(`${query.from}T00:00:00.000`, timezone) } : {}),
              ...(query.to ? { lte: fromZonedTime(`${query.to}T23:59:59.999`, timezone) } : {}),
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
    const actor = requireAdmin(request);
    const query = adminAuditQuerySchema.parse(request.query);
    const page = parsePageParams({ page: query.page, pageSize: query.pageSize });
    const timezone = await getAdminTimezone(app.prisma, actor.userId);

    const result = await listAdminAuditLogs(app.prisma, {
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      timezone,
      page: page.page,
      pageSize: page.pageSize,
    });

    return ok(
      { logs: result.items },
      request.id,
      { pagination: buildPagination(page.page, page.pageSize, result.total) },
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

  /**
   * 部署级设置总览。
   * 只读，且不含任何密钥：密钥类配置永远只来自环境变量，不在界面上展示。
   */
  app.get('/admin/settings', { preHandler: app.authenticate }, async (request) => {
    const actor = requireAdmin(request);
    const [registration, emailVerification, adminUserCreate, permissions] = await Promise.all([
      isRegistrationEnabled(app.prisma),
      isEmailVerificationEnabled(app.prisma),
      isAdminUserCreateEnabled(app.prisma),
      Promise.resolve(
        actor.role === 'super_admin'
          ? ['dashboard:read', 'users:read', 'users:write', 'admins:read', 'admins:write', 'system:read', 'settings:write']
          : ['dashboard:read', 'users:read', 'users:write', 'system:read'],
      ),
    ]);

    return ok(
      {
        registrationEnabled: registration,
        emailVerificationEnabled: emailVerification,
        adminUserCreateEnabled: adminUserCreate,
        // 只报「有没有配」这个事实，绝不回显主机名、账号或密码
        mailConfigured: isMailConfigured(),
        deletionCoolingOffDays: DELETION_COOLING_OFF_DAYS,
        auditLogRetentionDays: AUDIT_LOG_RETENTION_DAYS,
        capabilities: {
          canWriteSettings: permissions.includes('settings:write'),
          canManageAdmins: permissions.includes('admins:write'),
        },
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

  // ===== 后台代建账号开关 =====
  // 后端也做一次超管限制：前端隐藏入口不算权限控制
  app.get('/admin/settings/user-creation', { preHandler: app.authenticate }, async (request) => {
    requireSuperAdmin(request);
    return ok({ enabled: await isAdminUserCreateEnabled(app.prisma) }, request.id);
  });

  app.patch('/admin/settings/user-creation', { preHandler: app.authenticate }, async (request) => {
    const actor = requireSuperAdmin(request);
    const body = adminUserCreateToggleSchema.parse(request.body);

    await setAdminUserCreateEnabled(app.prisma, body.enabled, actor.userId);

    await app.prisma.auditLog.create({
      data: {
        userId: actor.userId,
        action: 'admin.user_creation_toggled',
        targetType: 'system_setting',
        metadata: { enabled: body.enabled },
      },
    });

    return ok({ enabled: body.enabled }, request.id);
  });
}
