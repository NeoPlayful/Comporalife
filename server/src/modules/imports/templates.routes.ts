import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildPagination, ok, parsePageParams } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { requireAuth } from '../../plugins/auth.js';
import { mappingSchema } from './imports.schema.js';

const templateIdSchema = z.object({ id: z.string().uuid('模板 ID 格式不正确') });

const createTemplateSchema = z.object({
  name: z.string().trim().min(1, '模板名称不能为空').max(80),
  bankName: z.string().trim().max(80).optional(),
  format: z.enum(['csv', 'xlsx']),
  headerSignature: z.string().trim().length(64, '表头签名格式不正确'),
  mapping: mappingSchema,
});

const updateTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    bankName: z.string().trim().max(80).nullable().optional(),
    mapping: mappingSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要修改一项字段');

const listTemplatesSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export default async function templatesRoutes(app: FastifyInstance) {
  app.get('/imports/templates', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = listTemplatesSchema.parse(request.query);
    const page = parsePageParams(query);

    const [total, templates] = await Promise.all([
      app.prisma.importTemplate.count({ where: { userId } }),
      app.prisma.importTemplate.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          name: true,
          bankName: true,
          format: true,
          headerSignature: true,
          mapping: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return ok(
      { templates, pagination: buildPagination(page.page, page.pageSize, total) },
      request.id,
    );
  });

  app.post('/imports/templates', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = createTemplateSchema.parse(request.body);

    const existing = await app.prisma.importTemplate.findUnique({
      where: { userId_name: { userId, name: body.name } },
      select: { id: true },
    });
    if (existing) throw errors.conflict('同名模板已存在');

    const template = await app.prisma.importTemplate.create({
      data: {
        userId,
        name: body.name,
        bankName: body.bankName ?? null,
        format: body.format,
        headerSignature: body.headerSignature,
        mapping: body.mapping as unknown as object,
      },
      select: {
        id: true,
        name: true,
        bankName: true,
        format: true,
        headerSignature: true,
        mapping: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return reply.status(201).send(ok({ template }, request.id));
  });

  app.patch('/imports/templates/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = templateIdSchema.parse(request.params);
    const body = updateTemplateSchema.parse(request.body);

    const existing = await app.prisma.importTemplate.findFirst({
      where: { id, userId },
      select: { id: true, name: true },
    });
    if (!existing) throw errors.notFound('模板不存在');

    if (body.name && body.name !== existing.name) {
      const duplicate = await app.prisma.importTemplate.findUnique({
        where: { userId_name: { userId, name: body.name } },
        select: { id: true },
      });
      if (duplicate) throw errors.conflict('同名模板已存在');
    }

    const template = await app.prisma.importTemplate.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.bankName !== undefined ? { bankName: body.bankName } : {}),
        ...(body.mapping ? { mapping: body.mapping as unknown as object } : {}),
      },
      select: {
        id: true,
        name: true,
        bankName: true,
        format: true,
        headerSignature: true,
        mapping: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return ok({ template }, request.id);
  });

  app.delete('/imports/templates/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = templateIdSchema.parse(request.params);

    const existing = await app.prisma.importTemplate.findFirst({ where: { id, userId }, select: { id: true } });
    if (!existing) throw errors.notFound('模板不存在');

    // 已使用该模板的批次通过 templateId 置空保持可用
    await app.prisma.importTemplate.delete({ where: { id } });
    return ok({ deleted: true }, request.id);
  });
}
