import type { FastifyInstance } from 'fastify';
import { ok } from '../../lib/api-utils.js';
import { requireAuth } from '../../plugins/auth.js';
import {
  categoryAnalyticsSchema,
  fixedVariableQuerySchema,
  largeExpensesSchema,
  merchantsQuerySchema,
  rangeQuerySchema,
  recurringQuerySchema,
  trendQuerySchema,
  periodComparisonSchema,
} from './analytics.schema.js';
import {
  getAccountAnalytics,
  getCategoryAnalytics,
  getIncomeExpense,
  getLargeExpenses,
  getMerchants,
  getPeriodComparison,
  getTrend,
  getUncategorized,
  getUserAnalyticsContext,
} from './analytics.service.js';
import { getFixedVariable, getRecurring } from './insights.service.js';

export default async function analyticsRoutes(app: FastifyInstance) {
  // 所有分析接口共用同一取数层，口径在 analytics/query.service.ts 统一定义

  app.get('/analytics/income-expense', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = rangeQuerySchema.parse(request.query);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    return ok(await getIncomeExpense(app.prisma, context, query.from, query.to), request.id);
  });

  app.get('/analytics/categories', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = categoryAnalyticsSchema.parse(request.query);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    return ok(
      await getCategoryAnalytics(app.prisma, context, {
        fromText: query.from,
        toText: query.to,
        kind: query.kind,
        level: query.level === 2 ? 2 : 1,
        previous: query.previous,
      }),
      request.id,
    );
  });

  app.get('/analytics/accounts', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = rangeQuerySchema.parse(request.query);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    return ok(await getAccountAnalytics(app.prisma, context, query.from, query.to), request.id);
  });

  app.get('/analytics/uncategorized', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = rangeQuerySchema.parse(request.query);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    return ok(await getUncategorized(app.prisma, context, query.from, query.to), request.id);
  });

  app.get('/analytics/merchants', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = merchantsQuerySchema.parse(request.query);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    return ok(
      await getMerchants(app.prisma, context, query.from, query.to, query.limit),
      request.id,
    );
  });

  app.get('/analytics/cashflow-trend', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = trendQuerySchema.parse(request.query);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    return ok(
      await getTrend(app.prisma, context, query.from, query.to, query.granularity),
      request.id,
    );
  });

  app.get('/analytics/period-comparison', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = periodComparisonSchema.parse(request.query);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    return ok(
      await getPeriodComparison(app.prisma, context, query.from, query.to, query.mode),
      request.id,
    );
  });

  app.get('/analytics/large-expenses', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = largeExpensesSchema.parse(request.query);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    return ok(
      await getLargeExpenses(app.prisma, context, query.from, query.to, query.threshold, query.limit),
      request.id,
    );
  });

  app.get('/analytics/recurring', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = recurringQuerySchema.parse(request.query);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    return ok(
      await getRecurring(app.prisma, context, {
        lookbackMonths: query.lookbackMonths,
        frequency: query.frequency,
      }),
      request.id,
    );
  });

  app.get('/analytics/fixed-variable', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = fixedVariableQuerySchema.parse(request.query);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    return ok(
      await getFixedVariable(app.prisma, context, query.from, query.to),
      request.id,
    );
  });
}
