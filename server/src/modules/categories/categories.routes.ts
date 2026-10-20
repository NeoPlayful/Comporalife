import type { FastifyInstance } from 'fastify';
import { SUPPORTED_CURRENCIES, CURRENCY_DECIMALS, CURRENCY_SYMBOLS } from '../../config/constants.js';
import { ok } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { requireAuth } from '../../plugins/auth.js';
import {
  categoryIdSchema,
  createCategorySchema,
  listCategoriesSchema,
  reorderCategoriesSchema,
  updateCategorySchema,
} from './categories.schema.js';

interface CategoryNode {
  id: string;
  kind: 'income' | 'expense';
  name: string;
  parentId: string | null;
  sortOrder: number;
  archived: boolean;
  children: CategoryNode[];
}

export default async function categoriesRoutes(app: FastifyInstance) {
  app.get('/currencies', async (request) => {
    return ok(
      {
        currencies: SUPPORTED_CURRENCIES.map((code) => ({
          code,
          decimals: CURRENCY_DECIMALS[code] ?? 2,
          symbol: CURRENCY_SYMBOLS[code] ?? code,
        })),
      },
      request.id,
    );
  });

  app.get('/categories', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = listCategoriesSchema.parse(request.query);

    const categories = await app.prisma.category.findMany({
      where: {
        userId,
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.includeArchived ? {} : { archived: false }),
      },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        kind: true,
        name: true,
        parentId: true,
        sortOrder: true,
        archived: true,
      },
    });

    // 组装两级树：父级带 children，子级不重复出现
    const nodes = new Map<string, CategoryNode>();
    for (const category of categories) {
      nodes.set(category.id, { ...category, children: [] });
    }

    const roots: CategoryNode[] = [];
    for (const category of categories) {
      const node = nodes.get(category.id)!;
      if (category.parentId && nodes.has(category.parentId)) {
        nodes.get(category.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return ok({ categories: roots, flat: categories }, request.id);
  });

  app.post('/categories', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = createCategorySchema.parse(request.body);

    if (body.parentId) {
      const parent = await app.prisma.category.findFirst({
        where: { id: body.parentId, userId },
        select: { id: true, kind: true, parentId: true },
      });

      if (!parent) throw errors.notFound('父分类不存在');
      if (parent.kind !== body.kind) throw errors.validation('子分类类型必须与父分类一致');
      // 最多两级，禁止在二级分类下再挂子级
      if (parent.parentId) throw errors.validation('分类最多两级');
    }

    const duplicate = await app.prisma.category.findFirst({
      where: {
        userId,
        kind: body.kind,
        name: body.name,
        parentId: body.parentId ?? null,
      },
      select: { id: true },
    });
    if (duplicate) throw errors.conflict('同级已存在同名分类');

    const category = await app.prisma.category.create({
      data: {
        userId,
        kind: body.kind,
        name: body.name,
        parentId: body.parentId ?? null,
        sortOrder: body.sortOrder ?? 0,
      },
      select: { id: true, kind: true, name: true, parentId: true, sortOrder: true, archived: true },
    });

    return reply.status(201).send(ok({ category }, request.id));
  });

  app.get('/categories/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = categoryIdSchema.parse(request.params);

    const category = await app.prisma.category.findFirst({
      where: { id, userId },
      select: {
        id: true,
        kind: true,
        name: true,
        parentId: true,
        sortOrder: true,
        archived: true,
        createdAt: true,
      },
    });

    if (!category) throw errors.notFound('分类不存在');
    return ok({ category }, request.id);
  });

  app.patch('/categories/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = categoryIdSchema.parse(request.params);
    const body = updateCategorySchema.parse(request.body);

    const existing = await app.prisma.category.findFirst({ where: { id, userId } });
    if (!existing) throw errors.notFound('分类不存在');

    if (body.parentId !== undefined && body.parentId !== null) {
      if (body.parentId === id) throw errors.validation('分类不能以自己为父级');

      const parent = await app.prisma.category.findFirst({
        where: { id: body.parentId, userId },
        select: { id: true, kind: true, parentId: true },
      });

      if (!parent) throw errors.notFound('父分类不存在');
      if (parent.kind !== existing.kind) throw errors.validation('父分类类型必须一致');
      if (parent.parentId) throw errors.validation('分类最多两级');

      const hasChildren = await app.prisma.category.count({ where: { parentId: id } });
      if (hasChildren > 0) {
        throw errors.validation('该分类下仍有子分类，不能改为二级分类');
      }
    }

    const category = await app.prisma.category.update({
      where: { id },
      data: body,
      select: { id: true, kind: true, name: true, parentId: true, sortOrder: true, archived: true },
    });

    return ok({ category }, request.id);
  });

  app.delete('/categories/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = categoryIdSchema.parse(request.params);

    const existing = await app.prisma.category.findFirst({ where: { id, userId } });
    if (!existing) throw errors.notFound('分类不存在');

    const [txCount, childCount] = await Promise.all([
      app.prisma.transaction.count({ where: { categoryId: id, userId } }),
      app.prisma.category.count({ where: { parentId: id, userId } }),
    ]);

    if (txCount > 0 || childCount > 0) {
      throw errors.conflict(
        `该分类仍被引用（流水 ${txCount} 条，子分类 ${childCount} 个），请先迁移后再删除`,
        { transactionCount: txCount, childCount },
      );
    }

    // 归档而非物理删除，保留历史语义
    await app.prisma.category.update({ where: { id }, data: { archived: true } });
    return ok({ archived: true }, request.id);
  });

  app.post('/categories/reorder', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const body = reorderCategoriesSchema.parse(request.body);

    const ids = body.items.map((item) => item.id);
    const owned = await app.prisma.category.count({ where: { id: { in: ids }, userId } });
    if (owned !== ids.length) throw errors.notFound('分类不存在');

    await app.prisma.$transaction(
      body.items.map((item) =>
        app.prisma.category.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } }),
      ),
    );

    return ok({ updated: body.items.length }, request.id);
  });
}
