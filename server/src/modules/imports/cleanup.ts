import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';
import { deleteStored, PURGED_KEY } from '../../lib/file-storage.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const FAILED_FILE_RETENTION_DAYS = 7;
const INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface CleanupResult {
  purgedFiles: number;
  purgedBatches: number;
  deletedRows: number;
}

/**
 * 按保留策略清理原始文件与行记录。
 * 文件删除后批次与交易仍完整，仅无法重新解析原文件。
 */
export async function runImportCleanup(prisma: PrismaClient): Promise<CleanupResult> {
  const now = Date.now();
  const fileCutoff = new Date(now - env.IMPORT_FILE_RETENTION_DAYS * DAY_MS);
  const rowCutoff = new Date(now - env.IMPORT_ROW_RETENTION_DAYS * DAY_MS);
  const failedCutoff = new Date(now - FAILED_FILE_RETENTION_DAYS * DAY_MS);

  const expiredFiles = await prisma.importBatch.findMany({
    where: {
      storageKey: { not: PURGED_KEY },
      OR: [
        { status: 'completed', committedAt: { lt: fileCutoff } },
        { status: 'failed', createdAt: { lt: failedCutoff } },
      ],
    },
    select: { id: true, storageKey: true },
    take: 500,
  });

  let purgedFiles = 0;
  for (const batch of expiredFiles) {
    try {
      await deleteStored(batch.storageKey);
      await prisma.importBatch.update({ where: { id: batch.id }, data: { storageKey: PURGED_KEY } });
      purgedFiles += 1;
    } catch {
      // 单个文件删除失败不影响其他批次，下一轮继续尝试
    }
  }

  const deletedRows = await prisma.importRow.deleteMany({
    where: { createdAt: { lt: rowCutoff } },
  });

  const purgedBatches = await prisma.importBatch.deleteMany({
    where: {
      status: { in: ['failed', 'cancelled'] },
      storageKey: PURGED_KEY,
      createdAt: { lt: failedCutoff },
    },
  });

  return {
    purgedFiles,
    purgedBatches: purgedBatches.count,
    deletedRows: deletedRows.count,
  };
}

/** 启动时立即清理一次并注册每日定时任务；返回停止函数 */
export function scheduleImportCleanup(prisma: PrismaClient, onError: (err: unknown) => void): () => void {
  const tick = () => {
    void runImportCleanup(prisma).catch(onError);
  };

  tick();
  const timer = setInterval(tick, INTERVAL_MS);
  // 不阻止进程退出
  timer.unref?.();

  return () => clearInterval(timer);
}
