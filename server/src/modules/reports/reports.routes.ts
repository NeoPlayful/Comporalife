/**
 * 路由顺序：/reports/net-worth 等固定路径必须注册在 /reports/:id 之前，
 * 否则会被参数路由吞掉（与 /imports/templates、/budgets/summary 同一个坑）。
 */
import type { FastifyInstance } from 'fastify';
import type { ReportType } from '@prisma/client';
import { ok } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { requireAuth } from '../../plugins/auth.js';
import { downloadHeaders, renderCsv, renderXlsx, reportFilename } from './report.export.js';
import { generateReport, pruneReports } from './report.service.js';
import {
  analyticsReportSchema,
  cashflowReportSchema,
  createReportSchema,
  downloadQuerySchema,
  goalsReportSchema,
  investmentReportSchema,
  listReportsSchema,
  netWorthReportSchema,
  reportIdSchema,
  simulationReportSchema,
} from './reports.schema.js';

async function persistReport(
  app: FastifyInstance,
  params: {
    userId: string;
    type: ReportType;
    from: string;
    to: string;
    title?: string | null;
    rawParams?: Record<string, unknown>;
  },
) {
  const payload = await generateReport(app.prisma, {
    userId: params.userId,
    type: params.type,
    from: params.from,
    to: params.to,
    title: params.title ?? null,
    params: params.rawParams,
  });

  const report = await app.prisma.$transaction(async (tx) => {
    const created = await tx.report.create({
      data: {
        userId: params.userId,
        type: payload.type,
        title: payload.title,
        rangeFrom: new Date(`${payload.rangeFrom}T00:00:00.000Z`),
        rangeTo: new Date(`${payload.rangeTo}T00:00:00.000Z`),
        currency: payload.basis.currency,
        params: payload.params as never,
        basis: payload.basis as never,
        data: payload.data as never,
        rowCount: payload.rowCount,
        modelVersions: payload.modelVersions as never,
        generatedAt: new Date(payload.basis.generatedAt),
      },
    });

    await tx.auditLog.create({
      data: {
        userId: params.userId,
        action: 'report.generated',
        targetType: 'report',
        targetId: created.id,
        metadata: { type: payload.type, from: payload.rangeFrom, to: payload.rangeTo, rowCount: payload.rowCount },
      },
    });

    return created;
  });

  await pruneReports(app.prisma, params.userId);

  return report;
}

function summarize(report: {
  id: string;
  type: ReportType;
  title: string;
  rangeFrom: Date;
  rangeTo: Date;
  currency: string;
  rowCount: number;
  generatedAt: Date;
  createdAt: Date;
}) {
  return {
    id: report.id,
    type: report.type,
    title: report.title,
    rangeFrom: report.rangeFrom.toISOString().slice(0, 10),
    rangeTo: report.rangeTo.toISOString().slice(0, 10),
    currency: report.currency,
    rowCount: report.rowCount,
    generatedAt: report.generatedAt.toISOString(),
    createdAt: report.createdAt.toISOString(),
  };
}

function toExportable(report: {
  id: string;
  type: ReportType;
  title: string;
  rangeFrom: Date;
  rangeTo: Date;
  currency: string;
  basis: unknown;
  data: unknown;
}) {
  return {
    id: report.id,
    type: report.type,
    title: report.title,
    rangeFrom: report.rangeFrom.toISOString().slice(0, 10),
    rangeTo: report.rangeTo.toISOString().slice(0, 10),
    currency: report.currency,
    basis: report.basis as Record<string, unknown>,
    data: report.data as Record<string, unknown>,
  };
}

export default async function reportsRoutes(app: FastifyInstance) {
  // ===== 固定路径：必须先于 /:id 注册 =====

  const typedBuilders: Array<{ path: string; type: ReportType; schema: typeof netWorthReportSchema }> = [
    { path: '/reports/net-worth', type: 'net_worth', schema: netWorthReportSchema },
    { path: '/reports/cashflow', type: 'cashflow', schema: cashflowReportSchema },
    { path: '/reports/analytics', type: 'analytics', schema: analyticsReportSchema },
    { path: '/reports/investment', type: 'investment', schema: investmentReportSchema },
    { path: '/reports/goals', type: 'goals', schema: goalsReportSchema },
    { path: '/reports/simulation', type: 'simulation', schema: simulationReportSchema },
  ];

  for (const builder of typedBuilders) {
    app.post(builder.path, { preHandler: app.authenticate }, async (request, reply) => {
      const { userId } = requireAuth(request);
      const body = builder.schema.parse(request.body ?? {});
      const raw = request.body as Record<string, unknown> | undefined;

      const report = await persistReport(app, {
        userId,
        type: builder.type,
        from: body.from,
        to: body.to,
        title: body.title ?? null,
        rawParams: (raw?.params as Record<string, unknown> | undefined) ?? {},
      });

      reply.status(201);
      return ok({ report: summarize(report) }, request.id);
    });
  }

  // ===== 通用 =====

  app.get('/reports', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = listReportsSchema.parse(request.query);

    const reports = await app.prisma.report.findMany({
      where: { userId, ...(query.type ? { type: query.type } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        type: true,
        title: true,
        rangeFrom: true,
        rangeTo: true,
        currency: true,
        rowCount: true,
        generatedAt: true,
        createdAt: true,
      },
    });

    return ok({ reports: reports.map(summarize) }, request.id);
  });

  app.post('/reports', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = createReportSchema.parse(request.body ?? {});

    const report = await persistReport(app, {
      userId,
      type: body.type,
      from: body.from,
      to: body.to,
      title: body.title ?? null,
      rawParams: body.params,
    });

    reply.status(201);
    return ok({ report: summarize(report) }, request.id);
  });

  app.get('/reports/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = reportIdSchema.parse(request.params);

    const report = await app.prisma.report.findFirst({ where: { id, userId } });
    if (!report) throw errors.reportNotFound();

    return ok(
      {
        report: {
          ...summarize(report),
          params: report.params,
          basis: report.basis,
          modelVersions: report.modelVersions,
        },
      },
      request.id,
    );
  });

  app.get('/reports/:id/data', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = reportIdSchema.parse(request.params);

    // 快照冻结：这里只读 data，绝不重新取数
    const report = await app.prisma.report.findFirst({ where: { id, userId } });
    if (!report) throw errors.reportNotFound();

    return ok(
      {
        reportId: report.id,
        type: report.type,
        data: report.data,
        basis: report.basis,
        generatedAt: report.generatedAt.toISOString(),
      },
      request.id,
    );
  });

  app.post('/reports/:id/regenerate', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = reportIdSchema.parse(request.params);

    const existing = await app.prisma.report.findFirst({ where: { id, userId } });
    if (!existing) throw errors.reportNotFound();

    const params = existing.params as Record<string, unknown>;

    const payload = await generateReport(app.prisma, {
      userId,
      type: existing.type,
      from: existing.rangeFrom.toISOString().slice(0, 10),
      to: existing.rangeTo.toISOString().slice(0, 10),
      title: existing.title,
      params,
    });

    const updated = await app.prisma.$transaction(async (tx) => {
      const result = await tx.report.update({
        where: { id: existing.id },
        data: {
          currency: payload.basis.currency,
          params: payload.params as never,
          basis: payload.basis as never,
          data: payload.data as never,
          rowCount: payload.rowCount,
          modelVersions: payload.modelVersions as never,
          generatedAt: new Date(payload.basis.generatedAt),
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'report.regenerated',
          targetType: 'report',
          targetId: existing.id,
          metadata: { type: existing.type, rowCount: payload.rowCount },
        },
      });

      return result;
    });

    return ok({ report: summarize(updated) }, request.id);
  });

  app.get('/reports/:id/download', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = reportIdSchema.parse(request.params);
    const query = downloadQuerySchema.parse(request.query);

    const report = await app.prisma.report.findFirst({ where: { id, userId } });
    if (!report) throw errors.reportNotFound();

    const exportable = toExportable(report);
    const filename = reportFilename(exportable, query.format);

    await app.prisma.auditLog.create({
      data: {
        userId,
        action: 'report.exported',
        targetType: 'report',
        targetId: report.id,
        metadata: { format: query.format, rowCount: report.rowCount },
      },
    });

    const headers = downloadHeaders(filename.ascii, filename.utf8, query.format);

    if (query.format === 'csv') {
      const body = renderCsv(exportable);
      return reply.headers(headers).send(body);
    }

    const body = renderXlsx(exportable);
    return reply.headers(headers).send(body);
  });

  app.delete('/reports/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = reportIdSchema.parse(request.params);

    const report = await app.prisma.report.findFirst({ where: { id, userId } });
    if (!report) throw errors.reportNotFound();

    await app.prisma.$transaction(async (tx) => {
      await tx.report.delete({ where: { id: report.id } });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'report.deleted',
          targetType: 'report',
          targetId: report.id,
          metadata: { type: report.type },
        },
      });
    });

    reply.status(204);
    return null;
  });
}
