import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient, RunStage } from '@prisma/client';
import {
  MONTE_CARLO_CANCEL_POLL_MS,
  MONTE_CARLO_CHUNK_MS,
  MONTE_CARLO_MAX_ATTEMPTS,
  MONTE_CARLO_MAX_CONCURRENT_RUNS,
  MONTE_CARLO_PROGRESS_INTERVAL_MS,
  MONTE_CARLO_TIMEOUT_SECONDS,
} from '../../config/constants.js';
import { JobRepository, type ClaimedRun } from './job.repository.js';
import { JobFailureCode, type JobHandler, type JobHooks, type JobPayload } from './job.types.js';

/**
 * 分片让出：每片执行完立即让出事件循环。
 * 单片时长由时间预算而非固定条数决定，小机器上也不会长时间占用主线程。
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export interface SliceOptions {
  /** 总工作量 */
  total: number;
  /** 每片最多处理的数量，配合时间预算共同决定实际切片 */
  chunkSize: number;
  /** 处理 [start, end) 区间 */
  process: (start: number, end: number) => void | Promise<void>;
  /** 每片结束时回调，返回值被忽略；可用于上报进度 */
  onSlice?: (processed: number) => void | Promise<void>;
  /** 返回 true 时中断循环 */
  shouldStop?: () => boolean | Promise<boolean>;
  /** 单片时间预算，默认取常量 */
  budgetMs?: number;
}

/**
 * 按「数量 + 时间预算」切片执行。
 * 放在执行器层而不是引擎里，引擎因此可以一次性跑完并做确定性断言。
 */
export async function runInSlices(options: SliceOptions): Promise<number> {
  const budgetMs = options.budgetMs ?? MONTE_CARLO_CHUNK_MS;
  let processed = 0;

  while (processed < options.total) {
    const sliceStart = Date.now();

    do {
      if (options.shouldStop && (await options.shouldStop())) return processed;

      const end = Math.min(options.total, processed + options.chunkSize);
      await options.process(processed, end);
      processed = end;

      if (Date.now() - sliceStart >= budgetMs) break;
    } while (processed < options.total);

    if (options.onSlice) await options.onSlice(processed);
    await yieldToEventLoop();
  }

  return processed;
}

interface RegisteredHandler {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: JobHandler<any, any>;
}

export interface ExecutorOptions {
  maxConcurrent?: number;
  timeoutSeconds?: number;
  now?: () => number;
}

/**
 * 单进程内有限并发的作业执行器。
 * 状态以数据库为唯一权威，因此没有任何跨线程通信：
 * 取消是一次 UPDATE，进度是节流后的 UPDATE，超时是本地时间比较。
 */
export class JobExecutor {
  private readonly handlers = new Map<string, RegisteredHandler>();
  private readonly active = new Set<Promise<void>>();
  private readonly repo: JobRepository;
  private readonly maxConcurrent: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private stopped = true;
  private kickScheduled = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly log: FastifyBaseLogger,
    options: ExecutorOptions = {},
  ) {
    this.repo = new JobRepository(prisma, () => new Date(this.now()));
    this.maxConcurrent = options.maxConcurrent ?? MONTE_CARLO_MAX_CONCURRENT_RUNS;
    this.timeoutMs = (options.timeoutSeconds ?? MONTE_CARLO_TIMEOUT_SECONDS) * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  get repository(): JobRepository {
    return this.repo;
  }

  register(kind: string, handler: RegisteredHandler['handler']): void {
    this.handlers.set(kind, { handler });
  }

  /** 启动时调用：恢复中断运行并开始消费队列 */
  async start(): Promise<void> {
    this.stopped = false;

    const { requeued, failed } = await this.repo.resumeInterrupted(MONTE_CARLO_MAX_ATTEMPTS);
    if (requeued > 0 || failed > 0) {
      this.log.warn({ requeued, failed }, '恢复被中断的模拟运行');
    }

    this.kick();
  }

  /** 停止消费；已在执行的运行会跑完当前分片后自然结束 */
  stop(): void {
    this.stopped = true;
  }

  /** 有新作业入队时调用，空闲槽立即开始领取 */
  kick(): void {
    if (this.stopped) return;
    // 多个入队请求可能在同一 tick 内触发，合并为一次调度
    if (this.kickScheduled) return;
    this.kickScheduled = true;

    setImmediate(() => {
      this.kickScheduled = false;
      void this.fillSlots();
    });
  }

  /** 测试辅助：等待当前所有活动作业结束 */
  async drain(timeoutMs = 30_000): Promise<void> {
    const deadline = this.now() + timeoutMs;
    while (this.active.size > 0 && this.now() < deadline) {
      await Promise.allSettled([...this.active]);
    }
  }

  private async fillSlots(): Promise<void> {
    if (this.stopped) return;

    while (this.active.size < this.maxConcurrent) {
      let run: ClaimedRun | null;
      try {
        run = await this.repo.claimNext();
      } catch (err) {
        this.log.error({ err }, '领取作业失败');
        return;
      }

      if (!run) return;

      const task = this.execute(run).finally(() => {
        this.active.delete(task);
        this.kick();
      });
      this.active.add(task);
    }
  }

  private async execute(run: ClaimedRun): Promise<void> {
    const kind = 'monte-carlo';
    const registered = this.handlers.get(kind);

    if (!registered) {
      await this.repo.fail(run.id, JobFailureCode.INTERNAL, '执行器未注册对应的作业类型');
      return;
    }

    const handler = registered.handler;
    let payload: JobPayload | null;

    try {
      payload = (await handler.load(run.id)) as JobPayload | null;
    } catch (err) {
      this.log.error({ err, runId: run.id }, '读取作业数据失败');
      await handler.fail(run.id, JobFailureCode.INTERNAL, '读取运行数据失败');
      return;
    }

    // 记录已被删除：无需写终态，直接结束本次执行
    if (!payload) return;

    const hooks = this.createHooks(run);
    let cancelled = false;

    try {
      const result = await handler.run(payload, hooks);

      if (await this.repo.isCancelRequested(run.id)) {
        cancelled = true;
        await this.repo.finishCancelled(run.id);
        return;
      }

      await hooks.setStage('finalizing');
      await handler.persist(run.id, result);
      await this.repo.succeed(run.id, run.startedAt);
    } catch (err) {
      if (cancelled) return;

      if (hooks.isExpired()) {
        await handler.fail(run.id, JobFailureCode.TIMEOUT, '计算超过时限');
      } else {
        this.log.error({ err, runId: run.id }, '模拟执行失败');
        await handler.fail(run.id, JobFailureCode.INTERNAL, '计算过程中发生错误');
      }
    } finally {
      try {
        await this.repo.pruneRuns(run.scenarioId);
      } catch (err) {
        // 保留策略失败不影响本次结果，下一轮继续尝试
        this.log.warn({ err, runId: run.id }, '清理历史运行失败');
      }
    }
  }

  private createHooks(run: ClaimedRun): JobHooks {
    const startedAt = this.now();
    let lastProgressWrite = 0;
    let lastCancelPoll = 0;
    let cancelRequested = false;

    return {
      setStage: async (stage: RunStage) => {
        await this.repo.reportProgress(run.id, stage, this.stageFloor(stage));
        lastProgressWrite = this.now();
      },

      reportProgress: async (value: number) => {
        if (this.now() - lastProgressWrite < MONTE_CARLO_PROGRESS_INTERVAL_MS) return;
        lastProgressWrite = this.now();
        await this.repo.reportProgress(run.id, 'simulating', value);
      },

      isCancelRequested: async () => {
        if (cancelRequested) return true;
        if (this.now() - lastCancelPoll < MONTE_CARLO_CANCEL_POLL_MS) return false;

        lastCancelPoll = this.now();
        cancelRequested = await this.repo.isCancelRequested(run.id);
        return cancelRequested;
      },

      isExpired: () => this.now() - startedAt >= this.timeoutMs,
    };
  }

  /** 阶段起点的进度下限，保证阶段切换时进度不倒退 */
  private stageFloor(stage: RunStage): number {
    switch (stage) {
      case 'preparing':
        return 0.01;
      case 'simulating':
        return 0.05;
      case 'aggregating':
        return 0.85;
      case 'finalizing':
        return 0.97;
      default:
        return 0;
    }
  }
}
