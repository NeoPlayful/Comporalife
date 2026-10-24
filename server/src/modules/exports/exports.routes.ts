import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildPagination, ok, parsePageParams } from '../../lib/api-utils.js';
import { PURGED_KEY, readArtifact } from '../../lib/encrypted-store.js';
import { errors } from '../../lib/errors.js';
import { requireAuth } from '../../plugins/auth.js';
import { createTask } from '../jobs/task.repository.js';
import { contentDisposition } from '../reports/export.serialize.js';
import { createExportSchema, exportIdSchema, exportListSchema } from './export.schema.js';
import {
  buildExportPackage,
  estimateExportRows,
  persistExportArtifact,
  resolveExportRange,
  shouldRunAsync,
  type ExportParams,
} from './export.service.js';

const APP_VERSION = (() => {
  try {
    const pkgPath = fileURLToPath(new URL('../../../package.json', import.meta.url));
    return (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
})();

export default async function exportsRoutes(app: FastifyInstance) {
  // ===== 创建导出 =====
  app.post('/exports', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = createExportSchema.parse(request.body ?? {});
    const settings = await app.prisma.userSettings.findUniqueOrThrow({
      where: { userId },
      select: { timezone: true, baseCurrency: true },
    });

    // 区间在创建时校验，避免任务跑到一半才发现参数不对
    resolveExportRange(body.from ?? null, body.to ?? null);

    const params: ExportParams = {
      scope: body.scope,
      from: body.from ?? null,
      to: body.to ?? null,
      includeArchived: body.includeArchived,
      format: body.format,
    };

    const record = await app.prisma.dataExport.create({
      data: {
        userId,
        scope: body.scope,
        format: body.format,
        params: params as unknown as object,
      },
      select: { id: true, scope: true, status: true, createdAt: true },
    });

    const estimated = await estimateExportRows(app.prisma, { userId, ...params });
    const useAsync = shouldRunAsync(estimated);

    if (!useAsync) {
      // 小包同步生成：用户点击下载就该拿到文件，不该再去任务面板等
      const pkg = await buildExportPackage(app.prisma, {
        userId,
        timezone: settings.timezone,
        baseCurrency: settings.baseCurrency,
        appVersion: APP_VERSION,
        params,
      });

      await persistExportArtifact(app.prisma, {
        exportId: record.id,
        userId,
        zip: pkg.zip,
        zipSha256: pkg.zipSha256,
        manifest: pkg.manifest as never,
        rowCount: pkg.rowCount,
      });

      const ready = await app.prisma.dataExport.findUniqueOrThrow({
        where: { id: record.id },
        select: { id: true, status: true, rowCount: true, sizeBytes: true, expiresAt: true },
      });

      return reply.status(201).send(
        ok(
          {
            exportId: ready.id,
            status: ready.status,
            rowCount: ready.rowCount,
            sizeBytes: ready.sizeBytes ? Number(ready.sizeBytes) : null,
            expiresAt: ready.expiresAt?.toISOString() ?? null,
            async: false,
          },
          request.id,
        ),
      );
    }

    const task = await createTask(app.prisma, {
      userId,
      kind: 'export',
      targetType: 'data_exports',
      targetId: record.id,
      summary: { scope: body.scope },
    });

    await app.prisma.dataExport.update({
      where: { id: record.id },
      data: { status: 'queued' },
    });

    await app.prisma.jobTask.update({ where: { id: task.id }, data: { summary: { scope: body.scope, estimated } } });
    app.tasks.kick();

    return reply.status(202).send(
      ok({ exportId: record.id, taskId: task.id, status: 'queued', async: true, estimatedRows: estimated }, request.id),
    );
  });

  // ===== 列表 =====
  app.get('/exports', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = exportListSchema.parse(request.query);
    const page = parsePageParams({ page: query.page, pageSize: query.pageSize });

    const where = {
      userId,
      ...(query.scope ? { scope: query.scope } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [total, rows] = await Promise.all([
      app.prisma.dataExport.count({ where }),
      app.prisma.dataExport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          scope: true,
          format: true,
          status: true,
          rowCount: true,
          sizeBytes: true,
          sha256: true,
          failureCode: true,
          expiresAt: true,
          createdAt: true,
          completedAt: true,
        },
      }),
    ]);

    return ok(
      {
        exports: rows.map((row) => ({
          ...row,
          sizeBytes: row.sizeBytes ? Number(row.sizeBytes) : null,
          sha256: row.sha256,
          expiresAt: row.expiresAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null,
        })),
      },
      request.id,
      { pagination: buildPagination(page.page, page.pageSize, total) },
    );
  });

  // ===== 详情 =====
  app.get('/exports/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = exportIdSchema.parse(request.params);

    const row = await app.prisma.dataExport.findFirst({
      where: { id, userId },
      select: {
        id: true,
        scope: true,
        format: true,
        status: true,
        params: true,
        manifest: true,
        rowCount: true,
        sizeBytes: true,
        sha256: true,
        failureCode: true,
        expiresAt: true,
        createdAt: true,
        completedAt: true,
      },
    });

    if (!row) throw errors.exportNotFound();

    return ok(
      {
        export: {
          ...row,
          sizeBytes: row.sizeBytes ? Number(row.sizeBytes) : null,
          expiresAt: row.expiresAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null,
        },
      },
      request.id,
    );
  });

  // ===== 下载 =====
  app.get('/exports/:id/download', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = exportIdSchema.parse(request.params);

    const row = await app.prisma.dataExport.findFirst({
      where: { id, userId },
      select: { id: true, status: true, scope: true, fileKey: true, createdAt: true },
    });

    if (!row) throw errors.exportNotFound();
    if (row.status !== 'ready' || !row.fileKey || row.fileKey === PURGED_KEY) {
      throw errors.exportNotReady(row.status);
    }
    if (row.fileKey === PURGED_KEY) throw errors.exportNotReady('expired');

    let buffer: Buffer;
    try {
      buffer = await readArtifact(row.fileKey, userId, row.id);
    } catch {
      throw errors.exportNotReady('expired');
    }

    const datePart = row.createdAt.toISOString().slice(0, 10).replace(/-/g, '');
    const asciiName = `comporalife-export-${row.scope}-${datePart}.zip`;
    const utf8Name = `数据导出-${row.scope}-${datePart}.zip`;

    await app.prisma.auditLog.create({
      data: { userId, action: 'export.downloaded', targetType: 'data_export', targetId: row.id },
    });

    return reply
      .header('content-type', 'application/zip')
      .header('content-disposition', contentDisposition(asciiName, utf8Name))
      .send(buffer);
  });

  // ===== 删除 =====
  app.delete('/exports/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = exportIdSchema.parse(request.params);

    const row = await app.prisma.dataExport.findFirst({
      where: { id, userId },
      select: { id: true, fileKey: true },
    });

    if (!row) throw errors.exportNotFound();

    if (row.fileKey && row.fileKey !== PURGED_KEY) {
      const { deleteArtifact } = await import('../../lib/encrypted-store.js');
      await deleteArtifact(row.fileKey).catch(() => undefined);
    }

    await app.prisma.dataExport.delete({ where: { id: row.id } });

    await app.prisma.auditLog.create({
      data: { userId, action: 'export.deleted', targetType: 'data_export', targetId: row.id },
    });

    return ok({ deleted: true }, request.id);
  });
}
