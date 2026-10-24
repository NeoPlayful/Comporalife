import type { FastifyInstance } from 'fastify';
import { BACKUP_SCHEMA_VERSION, RESTORE_CONFIRM_TOKEN } from '../../config/constants.js';
import { buildPagination, ok, parsePageParams } from '../../lib/api-utils.js';
import { PURGED_KEY, readArtifactRaw } from '../../lib/encrypted-store.js';
import { errors } from '../../lib/errors.js';
import { requireAuth } from '../../plugins/auth.js';
import { createTask } from '../jobs/task.repository.js';
import { createNotification } from '../notifications/notification.service.js';
import { contentDisposition } from '../reports/export.serialize.js';
import { loadVerifiedBackup } from './backup.service.js';
import { backupIdSchema, backupListSchema, createBackupSchema, restorePreviewSchema, restoreSchema } from './backup.schema.js';
import { executeRestore, previewRestore, type ConflictPolicy } from './restore.service.js';
import { type BackupDomain } from './backup.package.js';

export default async function backupsRoutes(app: FastifyInstance) {
  // ===== 创建 =====
  app.post('/backups', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = createBackupSchema.parse(request.body ?? {});

    const backup = await app.prisma.backup.create({
      data: {
        userId,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        // fileKey/sizeBytes/sha256 在完成后才写入，这里先占位
        scope: {},
        fileKey: '',
        sizeBytes: 0n,
        sha256: '',
        status: 'creating',
      },
      select: { id: true, status: true, createdAt: true },
    });

    const task = await createTask(app.prisma, {
      userId,
      kind: 'backup',
      targetType: 'backups',
      targetId: backup.id,
      // 采集参数随任务走：任务重试时仍按用户当时的选项生成
      summary: { includeRates: body.includeRates },
    });

    app.tasks.kick();

    return reply.status(202).send(
      ok(
        { backupId: backup.id, taskId: task.id, status: 'creating', createdAt: backup.createdAt.toISOString() },
        request.id,
      ),
    );
  });

  // ===== 列表 =====
  app.get('/backups', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = backupListSchema.parse(request.query);
    const page = parsePageParams({ page: query.page, pageSize: query.pageSize });

    const where = { userId, ...(query.status ? { status: query.status } : {}) };

    const [total, rows] = await Promise.all([
      app.prisma.backup.count({ where }),
      app.prisma.backup.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          format: true,
          schemaVersion: true,
          scope: true,
          sizeBytes: true,
          sha256: true,
          status: true,
          restoreCount: true,
          lastRestoredAt: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
    ]);

    return ok(
      {
        backups: rows.map((row) => ({
          ...row,
          sizeBytes: Number(row.sizeBytes),
          lastRestoredAt: row.lastRestoredAt?.toISOString() ?? null,
          expiresAt: row.expiresAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        })),
      },
      request.id,
      { pagination: buildPagination(page.page, page.pageSize, total) },
    );
  });

  // ===== 详情 =====
  app.get('/backups/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = backupIdSchema.parse(request.params);

    const row = await app.prisma.backup.findFirst({
      where: { id, userId },
      select: {
        id: true,
        format: true,
        schemaVersion: true,
        scope: true,
        sizeBytes: true,
        sha256: true,
        status: true,
        restoreCount: true,
        lastRestoredAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    if (!row) throw errors.backupNotFound();

    return ok(
      {
        backup: {
          ...row,
          sizeBytes: Number(row.sizeBytes),
          lastRestoredAt: row.lastRestoredAt?.toISOString() ?? null,
          expiresAt: row.expiresAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        },
      },
      request.id,
    );
  });

  // ===== 下载 =====
  app.get('/backups/:id/download', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = backupIdSchema.parse(request.params);

    const row = await app.prisma.backup.findFirst({
      where: { id, userId },
      select: { id: true, status: true, fileKey: true, createdAt: true },
    });

    if (!row) throw errors.backupNotFound();
    if (row.status !== 'ready' || !row.fileKey || row.fileKey === PURGED_KEY) {
      throw errors.backupNotReady(row.status);
    }

    let buffer: Buffer;
    try {
      // 备份下载给的是密文本身：拿到密钥的人才能还原，服务端只做归属与状态校验
      buffer = await readArtifactRaw(row.fileKey);
    } catch {
      throw errors.backupNotReady('expired');
    }

    const datePart = row.createdAt.toISOString().slice(0, 10).replace(/-/g, '');
    const asciiName = `comporalife-backup-${datePart}.json.enc`;
    const utf8Name = `数据备份-${datePart}.json.enc`;

    await app.prisma.auditLog.create({
      data: { userId, action: 'backup.downloaded', targetType: 'backup', targetId: row.id },
    });

    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', contentDisposition(asciiName, utf8Name))
      .send(buffer);
  });

  // ===== 恢复预览 =====
  app.post('/backups/:id/restore-preview', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = backupIdSchema.parse(request.params);
    restorePreviewSchema.parse(request.body ?? {});

    const pkg = await loadVerifiedBackup(app.prisma, { userId, backupId: id });
    const preview = await previewRestore(app.prisma, { userId, backupId: id, pkg });

    return ok({ preview }, request.id);
  });

  // ===== 执行恢复 =====
  app.post('/backups/:id/restore', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = backupIdSchema.parse(request.params);
    const body = restoreSchema.parse(request.body ?? {});

    if (body.confirm !== RESTORE_CONFIRM_TOKEN) {
      throw errors.restoreParametersInvalid(`确认标记必须为 ${RESTORE_CONFIRM_TOKEN}`);
    }

    const pkg = await loadVerifiedBackup(app.prisma, { userId, backupId: id });

    let result;
    try {
      result = await executeRestore(app.prisma, {
        userId,
        pkg,
        domains: body.domains as BackupDomain[],
        policy: body.conflict as ConflictPolicy,
      });
    } catch (err) {
      // 事务已回滚；这里只补一条失败审计，不写恢复次数
      await app.prisma.auditLog.create({
        data: {
          userId,
          action: 'backup.restore_failed',
          targetType: 'backup',
          targetId: id,
          metadata: { domains: body.domains, reason: 'transaction_rolled_back' },
        },
      });
      throw err instanceof Error && 'statusCode' in err ? err : errors.restoreFailed();
    }

    const updated = await app.prisma.backup.update({
      where: { id },
      data: { restoreCount: { increment: 1 }, lastRestoredAt: new Date() },
      select: { restoreCount: true, lastRestoredAt: true },
    });

    await app.prisma.auditLog.create({
      data: {
        userId,
        action: 'backup.restored',
        targetType: 'backup',
        targetId: id,
        metadata: {
          domains: body.domains,
          conflict: body.conflict,
          rowsWritten: result.domains.reduce((sum, item) => sum + item.written, 0),
        },
      },
    });

    await createNotification(app.prisma, {
      userId,
      kind: 'restore_done',
      metadata: {
        backupId: id,
        domains: body.domains,
        rowsWritten: result.domains.reduce((sum, item) => sum + item.written, 0),
      },
      link: '/data?tab=backup',
    });

    return ok(
      {
        backupId: id,
        domains: result.domains,
        restoreCount: updated.restoreCount,
        lastRestoredAt: updated.lastRestoredAt?.toISOString() ?? null,
      },
      request.id,
    );
  });

  // ===== 删除 =====
  app.delete('/backups/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = backupIdSchema.parse(request.params);

    const row = await app.prisma.backup.findFirst({
      where: { id, userId },
      select: { id: true, fileKey: true },
    });
    if (!row) throw errors.backupNotFound();

    if (row.fileKey && row.fileKey !== PURGED_KEY) {
      const { deleteArtifact } = await import('../../lib/encrypted-store.js');
      await deleteArtifact(row.fileKey).catch(() => undefined);
    }

    await app.prisma.backup.delete({ where: { id: row.id } });

    await app.prisma.auditLog.create({
      data: { userId, action: 'backup.deleted', targetType: 'backup', targetId: row.id },
    });

    return ok({ deleted: true }, request.id);
  });
}

