import type { PrismaClient } from '@prisma/client';
import type { JobFailureCodeValue } from '../jobs/job.types.js';
import type { TaskHandler, TaskHooks } from '../jobs/task.executor.js';
import { buildExportPackage, persistExportArtifact, type ExportParams } from './export.service.js';

interface ExportPayload {
  exportId: string;
  userId: string;
  timezone: string;
  baseCurrency: string;
  appVersion: string;
  params: ExportParams;
}

interface ExportResult {
  exportId: string;
  userId: string;
  rowCount: number;
  zip: Buffer;
  sha256: string;
  manifest: Record<string, unknown>;
}

async function loadPayload(prisma: PrismaClient, taskId: string): Promise<ExportPayload | null> {
  const task = await prisma.jobTask.findUnique({
    where: { id: taskId },
    select: { targetId: true },
  });

  if (!task?.targetId) return null;

  const record = await prisma.dataExport.findUnique({
    where: { id: task.targetId },
    select: { id: true, userId: true, params: true },
  });

  if (!record) return null;

  const settings = await prisma.userSettings.findUniqueOrThrow({
    where: { userId: record.userId },
    select: { timezone: true, baseCurrency: true },
  });

  return {
    exportId: record.id,
    userId: record.userId,
    timezone: settings.timezone,
    baseCurrency: settings.baseCurrency,
    appVersion: 'unknown',
    params: record.params as unknown as ExportParams,
  };
}

/** 把导出接到通用任务执行器；执行器只认任务，不认导出 */
export function createExportHandler(prisma: PrismaClient): TaskHandler<ExportPayload, ExportResult> {
  return {
    kind: 'export',

    load: (taskId: string) => loadPayload(prisma, taskId),

    async run(payload: ExportPayload, hooks: TaskHooks): Promise<ExportResult> {
      await hooks.setStage('collecting', 0.1);

      const pkg = await buildExportPackage(prisma, {
        userId: payload.userId,
        timezone: payload.timezone,
        baseCurrency: payload.baseCurrency,
        appVersion: payload.appVersion,
        params: payload.params,
      });

      await hooks.setStage('packaging', 0.8);

      return {
        exportId: payload.exportId,
        userId: payload.userId,
        rowCount: pkg.rowCount,
        zip: pkg.zip,
        sha256: pkg.zipSha256,
        manifest: pkg.manifest as unknown as Record<string, unknown>,
      };
    },

    async persist(_taskId: string, result: ExportResult): Promise<void> {
      await persistExportArtifact(prisma, {
        exportId: result.exportId,
        userId: result.userId,
        zip: result.zip,
        zipSha256: result.sha256,
        manifest: result.manifest as never,
        rowCount: result.rowCount,
      });
    },

    async fail(taskId: string, code: JobFailureCodeValue, message: string): Promise<void> {
      const task = await prisma.jobTask.findUnique({
        where: { id: taskId },
        select: { targetId: true },
      });

      if (task?.targetId) {
        await prisma.dataExport.updateMany({
          where: { id: task.targetId },
          data: { status: 'failed', failureCode: code },
        });
      }

      await prisma.jobTask.update({
        where: { id: taskId },
        data: {
          status: 'failed',
          failureCode: code,
          failureMessage: message,
          finishedAt: new Date(),
        },
      });
    },
  };
}
