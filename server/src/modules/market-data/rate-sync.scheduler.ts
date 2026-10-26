import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  RATE_SYNC_FREQUENCY_MS,
  type RateSyncFrequency,
} from '../../config/constants.js';
import { env } from '../../config/env.js';
import { getRateSyncFrequency } from '../settings/system-settings.service.js';
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
 * 调度器运行态。
 *
 * 频率可以在线修改，因此不能再用固定间隔的 setInterval：那样改完要等下一个
 * 周期才生效，管理员会以为设置没保存。这里改成「跑完再算下一次」，并把下次
 * 运行时刻记下来供接口展示，避免前端用环境变量现算一个与真实调度无关的估值。
 */
interface SchedulerState {
  frequency: RateSyncFrequency;
  nextRunAt: Date | null;
  started: boolean;
}

let state: SchedulerState = {
  frequency: 'daily',
  nextRunAt: null,
  started: false,
};

export function getRateSyncSchedule(): { frequency: RateSyncFrequency; nextRunAt: string | null } {
  return {
    frequency: state.frequency,
    nextRunAt: state.nextRunAt ? state.nextRunAt.toISOString() : null,
  };
}

/**
 * 汇率同步调度。
 *
 * 与既有清理任务同构：启动延迟一次、之后按配置的间隔执行，不阻塞服务就绪。
 * 读请求永远不触发抓取，因此这里的时间精度不影响用户看到的页面速度。
 *
 * 返回的句柄额外带 reschedule()：频率变更后立即按新间隔重排，不必等旧定时器
 * 到期，也不必重启进程。
 */
export function scheduleRateSync(
  app: FastifyInstance,
  onError: (err: unknown) => void,
): { stop: () => void; reschedule: () => Promise<void> } {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function intervalMs(): Promise<number> {
    const frequency = await getRateSyncFrequency(app.prisma);
    state.frequency = frequency;
    return RATE_SYNC_FREQUENCY_MS[frequency];
  }

  /** 按当前频率排下一次；停用或已停止时不排 */
  async function scheduleNext(delayMs?: number) {
    clearTimer();
    if (stopped) return;

    const enabled = await isRateSyncEnabled(app.prisma);
    const configured = await isRateProviderConfigured(app.prisma);
    if (!enabled || !configured) {
      state.nextRunAt = null;
      return;
    }

    const delay = delayMs ?? (await intervalMs());
    state.nextRunAt = new Date(Date.now() + delay);
    timer = setTimeout(() => {
      void tick().catch(onError);
    }, delay);
    timer.unref?.();
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    if (!(await isRateProviderConfigured(app.prisma))) {
      state.nextRunAt = null;
      return;
    }
    if (!(await isRateSyncEnabled(app.prisma))) {
      state.nextRunAt = null;
      return;
    }

    // 没有任何外币需求时连锁都不用拿，避免在空账户上打外部接口
    const { targets } = await collectRateDemand(app.prisma);
    if (targets.length === 0) {
      await scheduleNext();
      return;
    }

    const token = randomUUID();
    const acquired = await acquireSyncLock(app.redis, token);
    // 拿不到锁说明别的实例正在跑，这不算失败，照常排下一轮
    if (!acquired) {
      await scheduleNext();
      return;
    }

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
      await scheduleNext();
    }
  }

  /** 启动：先按启动延迟跑第一轮，之后链式自调度 */
  const startTimer = setTimeout(() => {
    void (async () => {
      state.started = true;
      await intervalMs();
      await tick();
    })().catch(onError);
  }, env.RATE_SYNC_STARTUP_DELAY_MS);
  startTimer.unref?.();

  // 启动时就给出一个预期的下次时间，避免首轮跑完前接口返回 null
  void intervalMs().then((delay) => {
    if (!state.started) state.nextRunAt = new Date(Date.now() + delay);
  });

  return {
    stop() {
      stopped = true;
      clearTimeout(startTimer);
      clearTimer();
      state.nextRunAt = null;
      state.started = false;
    },
    /** 频率或开关变更后调用：立即按最新配置重排 */
    async reschedule() {
      await scheduleNext();
    },
  };
}
