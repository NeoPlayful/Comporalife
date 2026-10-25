import type { PrismaClient } from '@prisma/client';
import {
  AUDIT_LOG_RETENTION_DAYS,
  NOTIFICATION_RETENTION_DAYS,
  RATE_SYNC_RUN_RETENTION_DAYS,
} from '../../config/constants.js';
import { pruneBackups } from '../backups/backup.service.js';
import { pruneExports } from '../exports/export.service.js';

const INTERVAL_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 每批处理的用户数：避免一次扫全表把连接池占满 */
const USER_BATCH_SIZE = 100;

export interface DataRetentionResult {
  usersScanned: number;
  backupsExpired: number;
  exportsExpired: number;
  notificationsDeleted: number;
  auditLogsDeleted: number;
  rateSyncRunsDeleted: number;
}

/**
 * 备份与导出的保留清理。
 *
 * 这两类产物原先只在用户新建时才顺带清理，一旦用户不再产生新备份，
 * 过期文件就永远留在磁盘上。这里改为按用户游标分批扫描，与导入清理并列调度。
 */
export async function runDataRetentionCleanup(prisma: PrismaClient): Promise<DataRetentionResult> {
  const result: DataRetentionResult = {
    usersScanned: 0,
    backupsExpired: 0,
    exportsExpired: 0,
    notificationsDeleted: 0,
    auditLogsDeleted: 0,
    rateSyncRunsDeleted: 0,
  };

  let cursor: string | undefined;

  for (;;) {
    // 只取「有可清理产物」的用户，避免扫描全部账号
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { backups: { some: { status: 'ready' } } },
          { dataExports: { some: { status: 'ready' } } },
        ],
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: USER_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (users.length === 0) break;

    for (const user of users) {
      try {
        result.backupsExpired += await pruneBackups(prisma, user.id);
        result.exportsExpired += await pruneExports(prisma, user.id);
        result.usersScanned += 1;
      } catch {
        // 单个用户失败不影响其他人；下一轮继续
      }
    }

    cursor = users[users.length - 1]!.id;
    if (users.length < USER_BATCH_SIZE) break;
  }

  // 通知过期与用户无关，一次全表按时间删除即可
  const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * DAY_MS);
  const deleted = await prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
  result.notificationsDeleted = deleted.count;

  // 审计日志保留期内无限增长会拖慢按时间倒序的查询，超期后按时间清理
  const auditCutoff = new Date(Date.now() - AUDIT_LOG_RETENTION_DAYS * DAY_MS);
  const auditDeleted = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: auditCutoff } } });
  result.auditLogsDeleted = auditDeleted.count;

  // 汇率同步运行记录属于运维元数据，保留期内足够排查，超期清理
  const syncCutoff = new Date(Date.now() - RATE_SYNC_RUN_RETENTION_DAYS * DAY_MS);
  const syncDeleted = await prisma.rateSyncRun.deleteMany({ where: { startedAt: { lt: syncCutoff } } });
  result.rateSyncRunsDeleted = syncDeleted.count;

  return result;
}

/** 启动时立即清理一次并注册每日定时任务；返回停止函数 */
export function scheduleDataRetention(prisma: PrismaClient, onError: (err: unknown) => void): () => void {
  const tick = () => {
    void runDataRetentionCleanup(prisma).catch(onError);
  };

  tick();
  const timer = setInterval(tick, INTERVAL_MS);
  // 不阻止进程退出
  timer.unref?.();

  return () => clearInterval(timer);
}
