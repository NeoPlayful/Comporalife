import type { FastifyInstance } from 'fastify';
import { buildPagination, ok, parsePageParams } from '../../lib/api-utils.js';
import { requireAuth } from '../../plugins/auth.js';
import { getUserAnalyticsContext } from '../analytics/analytics.service.js';
import { createTask } from '../jobs/task.repository.js';
import { getAuditLog, listAuditLogs } from './audit.service.js';
import { auditLogIdSchema, auditLogQuerySchema, missingMonthsSchema, qualityListSchema } from './quality.schema.js';
import {
  findDuplicateCandidates,
  findMissingMonths,
  findRateLag,
  findStaleValuations,
  getQualitySummary,
  listUncategorized,
} from './quality.service.js';

export default async function qualityRoutes(app: FastifyInstance) {
  // 质量接口全部实时计算：质量是账本的函数，落表必然与真实数据漂移

  app.get('/data-quality/summary', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    return ok(await getQualitySummary(app.prisma, context), request.id);
  });

  app.get('/data-quality/uncategorized', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = qualityListSchema.parse(request.query);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    const result = await listUncategorized(app.prisma, context, query);

    return ok(result, request.id);
  });

  app.get('/data-quality/duplicates', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = qualityListSchema.parse(request.query);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    const result = await findDuplicateCandidates(app.prisma, context, {
      limit: query.limit,
      windowDays: undefined,
    });

    return ok(result, request.id);
  });

  app.get('/data-quality/missing-months', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = missingMonthsSchema.parse(request.query);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    return ok(await findMissingMonths(app.prisma, context, { months: query.months }), request.id);
  });

  app.get('/data-quality/stale-valuations', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    return ok(await findStaleValuations(app.prisma, context), request.id);
  });

  app.get('/data-quality/rate-lag', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    return ok(await findRateLag(app.prisma, context), request.id);
  });

  // 重跑只是一个标记：结果始终实时算，任务行的意义是「用户知道它跑过了」
  app.post('/data-quality/recheck', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);

    const task = await createTask(app.prisma, {
      userId,
      kind: 'recheck',
      targetType: null,
      targetId: null,
      summary: { source: 'manual' },
    });

    return ok({ taskId: task.id, status: task.status }, request.id);
  });

  // ===== 审计读模型 =====

  app.get('/audit-logs', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = auditLogQuerySchema.parse(request.query);
    const settings = await app.prisma.userSettings.findUniqueOrThrow({
      where: { userId },
      select: { timezone: true },
    });
    const pageParams = parsePageParams(query);

    const result = await listAuditLogs(app.prisma, {
      userId,
      timezone: settings.timezone,
      page: pageParams.page,
      pageSize: pageParams.pageSize,
      ...(query.action ? { action: query.action } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
    });

    return ok(
      { items: result.items },
      request.id,
      { pagination: buildPagination(result.page, result.pageSize, result.total) },
    );
  });

  app.get('/audit-logs/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = auditLogIdSchema.parse(request.params);

    return ok({ auditLog: await getAuditLog(app.prisma, userId, id) }, request.id);
  });
}
