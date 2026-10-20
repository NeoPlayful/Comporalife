import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { ok } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { requireAuth } from '../../plugins/auth.js';
import { categoryIdSchema, createTagSchema, tagIdSchema, updateTagSchema } from '../categories/categories.schema.js';

export default async function tagsRoutes(app: FastifyInstance) {
  app.get('/tags', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);

    const tags = await app.prisma.tag.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: { select: { transactions: true } },
      },
    });

    return ok(
      { tags: tags.map((tag) => ({ ...tag, transactionCount: tag._count.transactions })) },
      request.id,
    );
  });

  app.post('/tags', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = createTagSchema.parse(request.body);

    const existing = await app.prisma.tag.findFirst({ where: { userId, name: body.name } });
    if (existing) throw errors.conflict('标签已存在');

    const tag = await app.prisma.tag.create({
      data: { userId, name: body.name },
      select: { id: true, name: true, createdAt: true },
    });

    return reply.status(201).send(ok({ tag }, request.id));
  });

  app.patch('/tags/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = tagIdSchema.parse(request.params);
    const body = updateTagSchema.parse(request.body);

    const existing = await app.prisma.tag.findFirst({ where: { id, userId } });
    if (!existing) throw errors.notFound('标签不存在');

    const duplicate = await app.prisma.tag.findFirst({
      where: { userId, name: body.name, id: { not: id } },
    });
    if (duplicate) throw errors.conflict('标签已存在');

    const tag = await app.prisma.tag.update({
      where: { id },
      data: { name: body.name },
      select: { id: true, name: true },
    });

    return ok({ tag }, request.id);
  });

  app.delete('/tags/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = tagIdSchema.parse(request.params);

    const result = await app.prisma.tag.deleteMany({ where: { id, userId } });
    if (result.count === 0) throw errors.notFound('标签不存在');

    // 关联记录由外键级联删除
    return ok({ deleted: true }, request.id);
  });

  app.post('/transactions/:id/tags', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = categoryIdSchema.parse(request.params);
    const body = createTagSchema.parse(request.body);

    const transaction = await app.prisma.transaction.findFirst({ where: { id, userId }, select: { id: true } });
    if (!transaction) throw errors.notFound('交易不存在');

    // 标签按名称查找或创建，便于前端直接传标签名
    const tag = await app.prisma.tag.upsert({
      where: { userId_name: { userId, name: body.name } },
      create: { userId, name: body.name },
      update: {},
      select: { id: true, name: true },
    });

    try {
      await app.prisma.transactionTag.create({ data: { transactionId: id, tagId: tag.id } });
    } catch (err) {
      // 已绑定视为幂等成功，不报错
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
        throw err;
      }
    }

    return reply.status(201).send(ok({ tag }, request.id));
  });

  app.delete('/transactions/:id/tags/:tagId', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id, tagId } = request.params as { id: string; tagId: string };

    const transaction = await app.prisma.transaction.findFirst({ where: { id, userId }, select: { id: true } });
    if (!transaction) throw errors.notFound('交易不存在');

    const result = await app.prisma.transactionTag.deleteMany({
      where: { transactionId: id, tagId },
    });

    if (result.count === 0) throw errors.notFound('该交易未绑定此标签');
    return ok({ unbound: true }, request.id);
  });
}
