import type { FastifyInstance } from 'fastify';
import { DELETION_COOLING_OFF_DAYS } from '../../config/constants.js';
import { ok } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { createNotification } from '../notifications/notification.service.js';
import { requireAuth } from '../../plugins/auth.js';
import { updatePreferencesSchema, updateProfileSchema } from './profile.schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function profileRoutes(app: FastifyInstance) {
  app.get('/profile', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);

    const user = await app.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        nickname: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        deletionRequestedAt: true,
        deletedAt: true,
        createdAt: true,
      },
    });

    // 冷却期与可批准性由服务端算好，前端不重复实现时间逻辑
    const coolingOffEndsAt = user.deletionRequestedAt
      ? new Date(user.deletionRequestedAt.getTime() + DELETION_COOLING_OFF_DAYS * DAY_MS)
      : null;

    return ok(
      {
        user: {
          ...user,
          coolingOffEndsAt: coolingOffEndsAt?.toISOString() ?? null,
          deletable: coolingOffEndsAt ? coolingOffEndsAt.getTime() <= Date.now() : false,
        },
      },
      request.id,
    );
  });

  app.patch('/profile', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const body = updateProfileSchema.parse(request.body);

    const user = await app.prisma.user.update({
      where: { id: userId },
      data: { nickname: body.nickname },
      select: { id: true, email: true, nickname: true },
    });

    return ok({ user }, request.id);
  });

  app.get('/profile/preferences', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);

    const settings = await app.prisma.userSettings.findUniqueOrThrow({
      where: { userId },
      select: {
        baseCurrency: true,
        timezone: true,
        dateFormat: true,
        theme: true,
        language: true,
        simulationDefaults: true,
      },
    });

    return ok({ preferences: settings }, request.id);
  });

  app.patch('/profile/preferences', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const body = updatePreferencesSchema.parse(request.body);

    const settings = await app.prisma.userSettings.update({
      where: { userId },
      data: body,
      select: {
        baseCurrency: true,
        timezone: true,
        dateFormat: true,
        theme: true,
        language: true,
      },
    });

    return ok({ preferences: settings }, request.id);
  });

  // ===== 注销申请 =====

  /**
   * 发起注销申请。
   * 只记录申请时间；真正的禁用发生在管理员批准之后，中间留冷却期供撤销。
   */
  app.post('/profile/delete-request', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);

    const user = await app.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { deletionRequestedAt: true, deletedAt: true },
    });

    if (user.deletedAt) {
      throw errors.deletionAlreadyRequested();
    }
    if (user.deletionRequestedAt) {
      throw errors.deletionAlreadyRequested();
    }

    const requestedAt = new Date();
    await app.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { deletionRequestedAt: requestedAt } });
      await tx.auditLog.create({
        data: { userId, action: 'user.deletion_requested', targetType: 'user', targetId: userId },
      });
    });

    const coolingOffEndsAt = new Date(requestedAt.getTime() + DELETION_COOLING_OFF_DAYS * DAY_MS);

    await createNotification(app.prisma, {
      userId,
      kind: 'deletion_requested',
      metadata: { coolingOffEndsAt: coolingOffEndsAt.toISOString() },
      link: '/profile',
    });

    return ok(
      { deletionRequestedAt: requestedAt.toISOString(), coolingOffEndsAt: coolingOffEndsAt.toISOString() },
      request.id,
    );
  });

  // 撤销申请：冷却期内随时可撤销，撤销后不影响账号
  app.post('/profile/delete-cancel', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);

    const user = await app.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { deletionRequestedAt: true },
    });

    if (!user.deletionRequestedAt) {
      throw errors.notFound('没有进行中的注销申请');
    }

    await app.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { deletionRequestedAt: null } });
      await tx.auditLog.create({
        data: { userId, action: 'user.deletion_cancelled', targetType: 'user', targetId: userId },
      });
    });

    return ok({ cancelled: true }, request.id);
  });
}
