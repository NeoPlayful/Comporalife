import type { FastifyInstance } from 'fastify';
import { ok } from '../../lib/api-utils.js';
import { requireAuth } from '../../plugins/auth.js';
import { updatePreferencesSchema, updateProfileSchema } from './profile.schema.js';

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
        createdAt: true,
      },
    });

    return ok({ user }, request.id);
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
}
