import type { PrismaClient } from '@prisma/client';
import type { JobFailureCodeValue } from '../jobs/job.types.js';
import type { TaskHandler, TaskHooks } from '../jobs/task.executor.js';
import { createBackupArtifact } from './backup.service.js';

interface BackupPayload {
  backupId: string;
  userId: string;
  baseCurrency: string;
  includeRates: boolean;
}

/** 把备份接到通用任务执行器；加密写盘发生在 persist 阶段 */
export function createBackupHandler(prisma: PrismaClient): TaskHandler<BackupPayload, BackupPayload> {
  return {
    kind: 'backup',

    async load(taskId: string): Promise<BackupPayload | null> {
      const task = await prisma.jobTask.findUnique({
        where: { id: taskId },
        select: { targetId: true, summary: true },
      });
      if (!task?.targetId) return null;

      const backup = await prisma.backup.findUnique({
        where: { id: task.targetId },
        select: { id: true, userId: true },
      });
      if (!backup) return null;

      const settings = await prisma.userSettings.findUniqueOrThrow({
        where: { userId: backup.userId },
        select: { baseCurrency: true },
      });

      const summary = (task.summary ?? {}) as { includeRates?: boolean };

      return {
        backupId: backup.id,
        userId: backup.userId,
        baseCurrency: settings.baseCurrency,
        includeRates: summary.includeRates ?? true,
      };
    },

    async run(payload: BackupPayload, hooks: TaskHooks): Promise<BackupPayload> {
      await hooks.setStage('snapshotting', 0.2);
      return payload;
    },

    async persist(_taskId: string, result: BackupPayload): Promise<void> {
      await createBackupArtifact(prisma, {
        backupId: result.backupId,
        userId: result.userId,
        baseCurrency: result.baseCurrency,
        includeRates: result.includeRates,
      });
    },

    async fail(taskId: string, code: JobFailureCodeValue, message: string): Promise<void> {
      const task = await prisma.jobTask.findUnique({ where: { id: taskId }, select: { targetId: true } });

      if (task?.targetId) {
        await prisma.backup.updateMany({
          where: { id: task.targetId },
          data: { status: 'failed' },
        });
      }

      await prisma.jobTask.update({
        where: { id: taskId },
        data: { status: 'failed', failureCode: code, failureMessage: message, finishedAt: new Date() },
      });
    },
  };
}
