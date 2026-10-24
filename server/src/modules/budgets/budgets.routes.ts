import type { FastifyInstance } from 'fastify';
import { addMonths } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { ok } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { roundMoney } from '../../lib/money.js';
import { requireAuth } from '../../plugins/auth.js';
import { getUserAnalyticsContext } from '../analytics/analytics.service.js';
import {
  budgetSummarySchema,
  budgetIdSchema,
  copyBudgetSchema,
  createBudgetSchema,
  listBudgetsSchema,
  updateBudgetSchema,
} from './budgets.schema.js';
import {
  computeBudgetAlerts,
  computeBudgetProgress,
  validateBudgetItems,
  type BudgetProgressResponse,
} from './budget.service.js';

/**
 * 路由顺序：/budgets/summary、/budgets/alerts 必须在 /budgets/:id 之前注册，
 * 否则会被参数路由吞掉（与 /imports/templates 同一个坑）。
 */
export default async function budgetsRoutes(app: FastifyInstance) {
  app.get('/budgets', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = listBudgetsSchema.parse(request.query);

    const budgets = await app.prisma.budget.findMany({
      where: {
        userId,
        status: query.status,
        ...(query.year ? { year: query.year } : {}),
        ...(query.month !== undefined ? { month: query.month } : {}),
        ...(query.periodType ? { periodType: query.periodType } : {}),
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      select: {
        id: true,
        periodType: true,
        year: true,
        month: true,
        totalAmount: true,
        rollover: true,
        status: true,
        note: true,
        version: true,
        _count: { select: { items: true } },
      },
    });

    return ok(
      {
        budgets: budgets.map((budget) => ({
          id: budget.id,
          periodType: budget.periodType,
          year: budget.year,
          month: budget.month,
          totalAmount: budget.totalAmount ? roundMoney(budget.totalAmount.toString()).toFixed(6) : null,
          rollover: budget.rollover,
          status: budget.status,
          note: budget.note,
          version: budget.version,
          itemCount: budget._count.items,
        })),
      },
      request.id,
    );
  });

  app.get('/budgets/summary', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = budgetSummarySchema.parse(request.query);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    const budget = await app.prisma.budget.findUnique({
      where: {
        userId_periodType_year_month: {
          userId,
          periodType: query.periodType,
          year: query.year,
          month: query.month,
        },
      },
      select: { id: true },
    });

    if (!budget) throw errors.budgetNotFound();

    return ok(await computeBudgetProgress(app.prisma, context, budget.id), request.id);
  });

  app.get('/budgets/alerts', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    return ok({ alerts: await computeBudgetAlerts(app.prisma, context) }, request.id);
  });

  app.get('/budgets/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = budgetIdSchema.parse(request.params);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    return ok(await computeBudgetProgress(app.prisma, context, id), request.id);
  });

  app.get('/budgets/:id/progress', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = budgetIdSchema.parse(request.params);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    return ok(await computeBudgetProgress(app.prisma, context, id), request.id);
  });

  app.post('/budgets', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = createBudgetSchema.parse(request.body);

    if (body.periodType === 'yearly' && body.rollover) {
      throw errors.budgetRolloverUnsupported();
    }

    const existing = await app.prisma.budget.findUnique({
      where: {
        userId_periodType_year_month: {
          userId,
          periodType: body.periodType,
          year: body.year,
          month: body.month,
        },
      },
      select: { id: true },
    });

    if (existing) throw errors.budgetPeriodExists(existing.id);

    if (body.items && body.items.length > 0) {
      await validateBudgetItems(app.prisma, userId, body.items);
    }

    const created = await app.prisma.$transaction(async (tx) => {
      const budget = await tx.budget.create({
        data: {
          userId,
          periodType: body.periodType,
          year: body.year,
          month: body.month,
          totalAmount: body.totalAmount ?? null,
          rollover: body.rollover,
          note: body.note ?? null,
          items: body.items
            ? {
                create: body.items.map((item) => ({
                  userId,
                  categoryId: item.categoryId,
                  amount: item.amount,
                })),
              }
            : undefined,
        },
        select: { id: true, version: true },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'budget.created',
          targetType: 'budget',
          targetId: budget.id,
          metadata: {
            periodType: body.periodType,
            year: body.year,
            month: body.month,
            itemCount: body.items?.length ?? 0,
          },
        },
      });

      return budget;
    });

    const context = await getUserAnalyticsContext(app.prisma, userId);
    const progress = await computeBudgetProgress(app.prisma, context, created.id);

    return reply.status(201).send(ok(progress, request.id));
  });

  app.patch('/budgets/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = budgetIdSchema.parse(request.params);
    const body = updateBudgetSchema.parse(request.body);

    const budget = await app.prisma.budget.findFirst({
      where: { id, userId },
      select: { id: true, periodType: true, rollover: true, status: true, version: true },
    });

    if (!budget) throw errors.budgetNotFound();
    if (budget.status === 'archived') throw errors.budgetArchived();
    if (budget.version !== body.version) throw errors.conflict('预算已被修改，请刷新后重试');

    const nextRollover = body.rollover ?? budget.rollover;
    if (budget.periodType === 'yearly' && nextRollover) {
      throw errors.budgetRolloverUnsupported();
    }

    if (body.items && body.items.length > 0) {
      await validateBudgetItems(app.prisma, userId, body.items);
    }

    await app.prisma.$transaction(async (tx) => {
      await tx.budget.update({
        where: { id },
        data: {
          ...(body.totalAmount !== undefined ? { totalAmount: body.totalAmount } : {}),
          ...(body.rollover !== undefined ? { rollover: body.rollover } : {}),
          ...(body.note !== undefined ? { note: body.note } : {}),
          version: { increment: 1 },
        },
      });

      // items 为全量替换语义：未出现的分类额度会被删除
      if (body.items !== undefined) {
        await tx.budgetItem.deleteMany({ where: { budgetId: id } });
        if (body.items.length > 0) {
          await tx.budgetItem.createMany({
            data: body.items.map((item) => ({
              budgetId: id,
              userId,
              categoryId: item.categoryId,
              amount: item.amount,
            })),
          });
        }
      }

      await tx.auditLog.create({
        data: {
          userId,
          action: 'budget.updated',
          targetType: 'budget',
          targetId: id,
          metadata: { changedFields: Object.keys(body).filter((key) => key !== 'version') },
        },
      });
    });

    const context = await getUserAnalyticsContext(app.prisma, userId);
    return ok(await computeBudgetProgress(app.prisma, context, id), request.id);
  });

  app.delete('/budgets/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = budgetIdSchema.parse(request.params);

    const budget = await app.prisma.budget.findFirst({
      where: { id, userId },
      select: { id: true, periodType: true, year: true, month: true, status: true },
    });

    if (!budget) throw errors.budgetNotFound();
    if (budget.status === 'archived') throw errors.budgetArchived();

    await app.prisma.$transaction(async (tx) => {
      await tx.budget.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'budget.deleted',
          targetType: 'budget',
          targetId: id,
          metadata: { periodType: budget.periodType, year: budget.year, month: budget.month },
        },
      });
    });

    return ok({ id }, request.id);
  });

  app.post('/budgets/:id/copy', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = budgetIdSchema.parse(request.params);
    const body = copyBudgetSchema.parse(request.body ?? {});

    const source = await app.prisma.budget.findFirst({
      where: { id, userId },
      select: {
        periodType: true,
        year: true,
        month: true,
        totalAmount: true,
        rollover: true,
        note: true,
        items: { select: { categoryId: true, amount: true } },
      },
    });

    if (!source) throw errors.budgetNotFound();

    let targetYear: number;
    let targetMonth: number;

    if (source.periodType === 'yearly') {
      targetYear = body.year ?? source.year + 1;
      targetMonth = 0;
    } else {
      const anchor = new Date(Date.UTC(source.year, source.month - 1, 1));
      const next = addMonths(anchor, 1);
      targetYear = body.year ?? next.getUTCFullYear();
      targetMonth = body.month ?? next.getUTCMonth() + 1;
    }

    if (source.periodType === 'monthly' && (targetMonth < 1 || targetMonth > 12)) {
      throw errors.validation('目标月份应为 1–12');
    }
    if (source.periodType === 'yearly' && targetMonth !== 0) {
      throw errors.validation('年度预算的目标月份必须为 0');
    }

    const existing = await app.prisma.budget.findUnique({
      where: {
        userId_periodType_year_month: {
          userId,
          periodType: source.periodType,
          year: targetYear,
          month: targetMonth,
        },
      },
      select: { id: true },
    });

    if (existing) throw errors.budgetPeriodExists(existing.id);

    const created = await app.prisma.$transaction(async (tx) => {
      const budget = await tx.budget.create({
        data: {
          userId,
          periodType: source.periodType,
          year: targetYear,
          month: targetMonth,
          totalAmount: source.totalAmount,
          rollover: source.rollover,
          note: source.note,
          items: {
            create: source.items.map((item) => ({
              userId,
              categoryId: item.categoryId,
              amount: item.amount,
            })),
          },
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'budget.copied',
          targetType: 'budget',
          targetId: budget.id,
          metadata: { sourceBudgetId: id, year: targetYear, month: targetMonth },
        },
      });

      return budget;
    });

    const context = await getUserAnalyticsContext(app.prisma, userId);

    return reply.status(201).send(
      ok(await computeBudgetProgress(app.prisma, context, created.id), request.id),
    );
  });
}

export type { BudgetProgressResponse };
