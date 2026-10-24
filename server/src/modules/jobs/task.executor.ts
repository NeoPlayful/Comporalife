import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient, TaskKind } from '@prisma/client';
import {
  TASK_HEARTBEAT_TIMEOUT_SECONDS,
  TASK_MAX_ATTEMPTS,
  TASK_MAX_CONCURRENT,
  TASK_PROGRESS_INTERVAL_MS,
  TASK_TIMEOUT_SECONDS,
} from '../../config/constants.js';
import { createNotification } from '../notifications/notification.service.js';
import type { JobFailureCodeValue } from './job.types.js';

/**
 * 通用任务执行器。
 *
 * 与蒙特卡罗执行器并列而不是替换：MC 运行有专用表、专用状态机与分片聚合语义，
 * 把它塞进通用执行器只会把两条不同的生命周期揉在一起。
 * 任务面板通过读模型聚合两者，写路径互不影响。
 */
export interface TaskHooks {
  setStage(stage: string, progress: number): Promise<void>;
  reportProgress(value: number): Promise<void>;
  isCancelRequested(): Promise<boolean>;
  isExpired(): boolean;
}

export interface TaskHandler<TPayload, TResult> {
  readonly kind: TaskKind;
  load(taskId: string): Promise<TPayload | null>;
  run(payload: TPayload & { taskId: string }, hooks: TaskHooks): Promise<TResult>;
  persist(taskId: string, result: TResult): Promise<void>;
  fail(taskId: string, code: JobFailureCodeValue, message: string): Promise<void>;
}

export interface TaskExecutorOptions {
  maxConcurrent?: number;
  timeoutSeconds?: number;
  now?: () => number;
}

export class TaskExecutor {
  private readonly handlers = new Map<TaskKind, TaskHandler<unknown, unknown>>();
  private readonly active = new Set<Promise<void>>();
  private readonly maxConcurrent: number;
  private readonly timeoutMs: number;
  private now: () => number;
  private stopped = true;
  private kickScheduled = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly log: FastifyBaseLogger,
    options: TaskExecutorOptions = {},
  ) {
    this.maxConcurrent = options.maxConcurrent ?? TASK_MAX_CONCURRENT;
    this.timeoutMs = (options.timeoutSeconds ?? TASK_TIMEOUT_SECONDS) * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  register<TPayload, TResult>(handler: TaskHandler<TPayload, TResult>): void {
    this.handlers.set(handler.kind, handler as TaskHandler<unknown, unknown>);
  }

  async start(): Promise<void> {
    this.stopped = false;

    // 进程重启后，心跳过期仍处于 running 的任务回队；超过次数的置失败
    const stale = await this.prisma.jobTask.findMany({
      where: {
        status: 'running',
        OR: [
          { heartbeatAt: null },
          { heartbeatAt: { lt: new Date(this.now() - TASK_HEARTBEAT_TIMEOUT_SECONDS * 1000) } },
        ],
      },
      select: { id: true, attempts: true },
    });

    for (const task of stale) {
      if (task.attempts >= TASK_MAX_ATTEMPTS) {
        await this.prisma.jobTask.update({
          where: { id: task.id },
          data: {
            status: 'failed',
            failureCode: 'TASK_INTERRUPTED',
            failureMessage: '任务被中断且超过重试次数',
            finishedAt: new Date(this.now()),
          },
        });
      } else {
        await this.prisma.jobTask.update({
          where: { id: task.id },
          data: { status: 'queued', stage: null, progress: 0 },
        });
      }
    }

    if (stale.length > 0) this.log.warn({ recovered: stale.length }, '恢复被中断的通用任务');

    this.kick();
  }

  stop(): void {
    this.stopped = true;
  }

  kick(): void {
    if (this.stopped) return;
    if (this.kickScheduled) return;

    this.kickScheduled = true;
    setImmediate(() => {
      this.kickScheduled = false;
      void this.fillSlots();
    });
  }

  async drain(timeoutMs = 30_000): Promise<void> {
    const deadline = this.now() + timeoutMs;
    while (this.active.size > 0 && this.now() < deadline) {
      await Promise.allSettled([...this.active]);
    }
  }

  private async fillSlots(): Promise<void> {
    if (this.stopped) return;

    while (this.active.size < this.maxConcurrent) {
      const claimed = await this.claimNext();
      if (!claimed) return;

      const task = this.execute(claimed).finally(() => {
        this.active.delete(task);
        this.kick();
      });
      this.active.add(task);
    }
  }

  /** 原子领取：与 MC 一致用 SKIP LOCKED，避免多槽双跑 */
  private async claimNext(): Promise<{ id: string; kind: TaskKind; startedAt: number } | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; kind: TaskKind }>>`
      UPDATE job_tasks
         SET status = 'running',
             attempts = attempts + 1,
             started_at = now(),
             heartbeat_at = now(),
             progress = 0,
             failure_code = NULL,
             failure_message = NULL
       WHERE id = (
         SELECT id FROM job_tasks
          WHERE status = 'queued'
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
      RETURNING id, kind
    `;

    const row = rows[0];
    if (!row) return null;

    return { id: row.id, kind: row.kind, startedAt: this.now() };
  }

  private async execute(claimed: { id: string; kind: TaskKind; startedAt: number }): Promise<void> {
    const handler = this.handlers.get(claimed.kind);

    if (!handler) {
      await this.failTask(claimed.id, 'TASK_INTERNAL', '执行器未注册该任务类型');
      return;
    }

    let payload: unknown;
    try {
      payload = await handler.load(claimed.id);
    } catch (err) {
      this.log.error({ err, taskId: claimed.id }, '读取任务数据失败');
      await handler.fail(claimed.id, 'TASK_INTERNAL', '读取任务数据失败');
      return;
    }

    if (!payload) return;

    const hooks = this.createHooks(claimed);

    try {
      const result = await handler.run({ ...(payload as object), taskId: claimed.id } as never, hooks);

      if (await this.isCancelRequested(claimed.id)) {
        await this.prisma.jobTask.update({
          where: { id: claimed.id },
          data: { status: 'cancelled', finishedAt: new Date(this.now()) },
        });
        return;
      }

      await handler.persist(claimed.id, result);
      await this.prisma.jobTask.update({
        where: { id: claimed.id },
        data: {
          status: 'succeeded',
          progress: 1,
          finishedAt: new Date(this.now()),
          heartbeatAt: new Date(this.now()),
        },
      });

      await this.notifyTerminal(claimed.id, claimed.kind, 'succeeded');
    } catch (err) {
      if (hooks.isExpired()) {
        await handler.fail(claimed.id, 'TASK_TIMEOUT', '任务超过时限');
        await this.notifyTerminal(claimed.id, claimed.kind, 'failed');
      } else {
        this.log.error({ err, taskId: claimed.id }, '任务执行失败');
        await handler.fail(claimed.id, 'TASK_INTERNAL', '任务执行过程中发生错误');
        await this.notifyTerminal(claimed.id, claimed.kind, 'failed');
      }
    }
  }

  /**
   * 任务终态通知。
   * 导出与备份各自有专属 kind；其余任务失败统一走 job_failed。
   * 通知失败不影响任务状态，只记一条 warn。
   */
  private async notifyTerminal(taskId: string, kind: TaskKind, outcome: 'succeeded' | 'failed'): Promise<void> {
    try {
      const task = await this.prisma.jobTask.findUnique({
        where: { id: taskId },
        select: { userId: true, targetId: true, failureMessage: true },
      });
      if (!task) return;

      if (outcome === 'failed') {
        await createNotification(this.prisma, {
          userId: task.userId,
          kind: 'job_failed',
          metadata: { taskId, taskKind: kind, reason: task.failureMessage ?? null },
          link: '/data?tab=jobs',
        });
        return;
      }

      if (kind === 'export') {
        await createNotification(this.prisma, {
          userId: task.userId,
          kind: 'export_ready',
          metadata: { exportId: task.targetId },
          link: '/data?tab=export',
        });
        return;
      }

      if (kind === 'backup') {
        await createNotification(this.prisma, {
          userId: task.userId,
          kind: 'backup_ready',
          metadata: { backupId: task.targetId },
          link: '/data?tab=backup',
        });
      }
    } catch (err) {
      this.log.warn({ err, taskId }, '任务终态通知写入失败');
    }
  }

  private createHooks(claimed: { id: string; startedAt: number }): TaskHooks {
    let lastWrite = 0;
    let lastCancelPoll = 0;
    let cancelRequested = false;

    return {
      setStage: async (stage: string, progress: number) => {
        lastWrite = this.now();
        await this.writeProgress(claimed.id, stage, progress);
      },
      reportProgress: async (value: number) => {
        if (this.now() - lastWrite < TASK_PROGRESS_INTERVAL_MS) return;
        lastWrite = this.now();
        await this.writeProgress(claimed.id, null, value);
      },
      isCancelRequested: async () => {
        if (cancelRequested) return true;
        if (this.now() - lastCancelPoll < 500) return false;
        lastCancelPoll = this.now();
        cancelRequested = await this.isCancelRequested(claimed.id);
        return cancelRequested;
      },
      isExpired: () => this.now() - claimed.startedAt >= this.timeoutMs,
    };
  }

  private async writeProgress(taskId: string, stage: string | null, progress: number): Promise<void> {
    const clamped = Math.min(1, Math.max(0, progress));
    await this.prisma.$executeRaw`
      UPDATE job_tasks
         SET stage = COALESCE(${stage}::text, stage),
             progress = GREATEST(progress, ${clamped}::numeric),
             heartbeat_at = now()
       WHERE id = ${taskId}::uuid
         AND status = 'running'
    `;
  }

  async isCancelRequested(taskId: string): Promise<boolean> {
    const task = await this.prisma.jobTask.findUnique({
      where: { id: taskId },
      select: { cancelRequestedAt: true },
    });
    return task?.cancelRequestedAt !== null && task?.cancelRequestedAt !== undefined;
  }

  private async failTask(taskId: string, code: string, message: string): Promise<void> {
    await this.prisma.jobTask.update({
      where: { id: taskId },
      data: {
        status: 'failed',
        failureCode: code,
        failureMessage: message,
        finishedAt: new Date(this.now()),
      },
    });
  }
}

