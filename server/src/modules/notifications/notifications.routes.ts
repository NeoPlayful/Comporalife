import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildPagination, ok, parsePageParams } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { requireAuth } from '../../plugins/auth.js';
import { countUnread } from './notification.service.js';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  unreadOnly: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => value === true || value === 'true' || value === '1'),
});

const notificationIdSchema = z.object({ id: z.string().uuid('通知 ID 格式不正确') });

export default async function notificationsRoutes(app: FastifyInstance) {
  app.get('/notifications', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = listSchema.parse(request.query);
    const page = parsePageParams({ page: query.page, pageSize: query.pageSize });

    const where = { userId, ...(query.unreadOnly ? { readAt: null } : {}) };

    const [total, unreadCount, rows] = await Promise.all([
      app.prisma.notification.count({ where }),
      countUnread(app.prisma, userId),
      app.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
        select: { id: true, kind: true, metadata: true, link: true, readAt: true, createdAt: true },
      }),
    ]);

    return ok(
      {
        // 文案由前端按 kind + metadata 渲染，随语言切换
        notifications: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          metadata: row.metadata,
          link: row.link,
          readAt: row.readAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        })),
        unreadCount,
      },
      request.id,
      { pagination: buildPagination(page.page, page.pageSize, total) },
    );
  });

  app.patch('/notifications/:id/read', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = notificationIdSchema.parse(request.params);

    const row = await app.prisma.notification.findFirst({
      where: { id, userId },
      select: { id: true, readAt: true },
    });
    if (!row) throw errors.notificationNotFound();

    // 已读时间只写一次，重复标记不覆盖首次时间
    if (!row.readAt) {
      await app.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    }

    return ok({ read: true, unreadCount: await countUnread(app.prisma, userId) }, request.id);
  });

  app.post('/notifications/read-all', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);

    const result = await app.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    return ok({ marked: result.count, unreadCount: 0 }, request.id);
  });
}
