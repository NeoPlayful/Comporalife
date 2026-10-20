import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { ok } from '../../lib/api-utils.js';
import { requireAuth } from '../../plugins/auth.js';
import { updateSettingsSchema } from './settings.schema.js';

export default async function settingsRoutes(app: FastifyInstance) {
  app.get('/settings', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);

    const settings = await app.prisma.userSettings.findUniqueOrThrow({
      where: { userId },
      select: {
        baseCurrency: true,
        timezone: true,
        dateFormat: true,
        theme: true,
        simulationDefaults: true,
      },
    });

    return ok({ settings }, request.id);
  });

  app.patch('/settings', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const body = updateSettingsSchema.parse(request.body);

    const { simulationDefaults, ...rest } = body;

    const settings = await app.prisma.userSettings.update({
      where: { userId },
      data: {
        ...rest,
        ...(simulationDefaults === undefined
          ? {}
          : {
              simulationDefaults:
                simulationDefaults === null ? Prisma.JsonNull : simulationDefaults,
            }),
      },
      select: {
        baseCurrency: true,
        timezone: true,
        dateFormat: true,
        theme: true,
        simulationDefaults: true,
      },
    });

    return ok({ settings }, request.id);
  });

  app.get('/settings/security', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);

    const [user, activeSessions] = await Promise.all([
      app.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { lastLoginAt: true, lastLoginIp: true, passwordHash: true },
      }),
      app.prisma.userSession.count({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);

    return ok(
      {
        lastLoginAt: user.lastLoginAt,
        lastLoginIp: user.lastLoginIp,
        activeSessionCount: activeSessions,
        passwordSet: Boolean(user.passwordHash),
      },
      request.id,
    );
  });

}
