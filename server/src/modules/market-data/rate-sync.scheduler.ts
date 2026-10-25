import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import {
  acquireSyncLock,
  collectRateDemand,
  isRateProviderConfigured,
  isRateSyncEnabled,
  releaseSyncLock,
  runRateSync,
  setRateSyncEnabled,
  shouldAutoDisable,
} from './rate-sync.service.js';

/**
 * 汇率同步调度。
 *
 * 与既有清理任务同构：启动延迟一次、之后按固定间隔执行，不阻塞服务就绪。
 * 读请求永远不触发抓取，因此这里的时间精度不影响用户看到的页面速度。
 */
export function scheduleRateSync(
  app: FastifyInstance,
  onError: (err: unknown) => void,
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function tick(): Promise<void> {
    if (stopped) return;
    if (!isRateProviderConfigured()) return;
    if (!(await isRateSyncEnabled(app.prisma))) return;

    // 没有任何外币需求时连锁都不用拿，避免在空账户上打外部接口
    const { targets } = await collectRateDemand(app.prisma);
    if (targets.length === 0) return;

    const token = randomUUID();
    const acquired = await acquireSyncLock(app.redis, token);
    // 拿不到锁说明别的实例正在跑，这不算失败
    if (!acquired) return;

    try {
      const summary = await runRateSync(app.prisma, { trigger: 'scheduled' });
      app.log.info(
        {
          status: summary.status,
          written: summary.writtenRows,
          skipped: summary.skippedManual,
          fetched: summary.fetchedPairs,
        },
        '汇率同步完成',
      );

      // 连续失败自动停用：无限重试只会持续消耗配额并把问题埋进日志
      if (summary.status === 'failed' && (await shouldAutoDisable(app.prisma))) {
        await setRateSyncEnabled(app.prisma, false, null);
        app.log.warn('汇率同步连续失败，已自动停用');
      }
    } finally {
      await releaseSyncLock(app.redis, token);
    }
  }

  const startTimer = setTimeout(() => {
    void tick().catch(onError);
    timer = setInterval(() => {
      void tick().catch(onError);
    }, env.RATE_SYNC_INTERVAL_MS);
    timer.unref?.();
  }, env.RATE_SYNC_STARTUP_DELAY_MS);
  startTimer.unref?.();

  return () => {
    stopped = true;
    clearTimeout(startTimer);
    if (timer) clearInterval(timer);
  };
}
