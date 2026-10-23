import { randomUUID } from 'node:crypto';
import type { PrismaClient, RunStage } from '@prisma/client';
import {
  MONTE_CARLO_CANCEL_POLL_MS,
  MONTE_CARLO_HEARTBEAT_TIMEOUT_SECONDS,
  MONTE_CARLO_PROGRESS_INTERVAL_MS,
  MONTE_CARLO_RUN_RETENTION,
} from '../../config/constants.js';
import { JobFailureCode, isFinalStatus } from './job.types.js';

/** 领取到的运行记录，只保留执行器需要的字段 */
export interface ClaimedRun {
  id: string;
  userId: string;
  scenarioId: string;
  attempts: number;
  startedAt: Date;
}

/**
 * 运行记录的读写。
 * 状态以 PostgreSQL 为唯一权威：不引入第二套 Redis 作业状态，
 * 否则取消与进度必须双向同步，必然出现不一致窗口。
 */
export class JobRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 排队中 + 运行中的总数，用于队列上限判断 */
  async countActive(): Promise<number> {
    return this.prisma.monteCarloRun.count({
      where: { status: { in: ['queued', 'running'] } },
    });
  }

  /** 某运行前方的排队数量，队首为 0 */
  async queuePosition(runId: string, createdAt: Date): Promise<number> {
    return this.prisma.monteCarloRun.count({
      where: {
        status: 'queued',
        OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: runId } }],
      },
    });
  }

  /**
   * 原子领取一条排队中的运行。
   * FOR UPDATE SKIP LOCKED 保证同进程多执行槽（以及将来可能的第二个进程）不会双跑；
   * 这里用原生 SQL 是因为 Prisma 的 update 无法表达 SKIP LOCKED 子查询。
   */
  async claimNext(): Promise<ClaimedRun | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; user_id: string; scenario_id: string; attempts: number }>
    >`
      UPDATE monte_carlo_runs
         SET status = 'running',
             stage = 'preparing',
             attempts = attempts + 1,
             started_at = now(),
             heartbeat_at = now(),
             progress = 0,
             failure_code = NULL,
             failure_message = NULL
       WHERE id = (
         SELECT id FROM monte_carlo_runs
          WHERE status = 'queued'
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
      RETURNING id, user_id, scenario_id, attempts
    `;

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      scenarioId: row.scenario_id,
      attempts: row.attempts,
      startedAt: this.now(),
    };
  }

  /**
   * 写入阶段与进度。
   * 进度单调不减由 SQL 的 GREATEST 保证——即便两个写入竞态，也不会回退。
   */
  async reportProgress(runId: string, stage: RunStage, progress: number): Promise<void> {
    const clamped = Math.min(1, Math.max(0, progress));
    await this.prisma.$executeRaw`
      UPDATE monte_carlo_runs
         SET stage = ${stage}::"RunStage",
             progress = GREATEST(progress, ${clamped}::numeric),
             heartbeat_at = now()
       WHERE id = ${runId}::uuid
         AND status = 'running'
    `;
  }

  /** 只刷新心跳，不改进度 */
  async touchHeartbeat(runId: string): Promise<void> {
    await this.prisma.monteCarloRun.updateMany({
      where: { id: runId, status: 'running' },
      data: { heartbeatAt: this.now() },
    });
  }

  /** 取消是幂等的：重复取消不会报错，也不会覆盖已终态 */
  async cancel(runId: string): Promise<'cancelled' | 'requested' | 'finished' | 'missing'> {
    const run = await this.prisma.monteCarloRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });

    if (!run) return 'missing';
    if (isFinalStatus(run.status)) return 'finished';

    if (run.status === 'queued') {
      const updated = await this.prisma.monteCarloRun.updateMany({
        where: { id: runId, status: 'queued' },
        data: { status: 'cancelled', stage: null, finishedAt: this.now(), cancelRequestedAt: this.now() },
      });
      // 竞态下可能已被执行器领走，此时退化为「请求取消」
      if (updated.count === 1) return 'cancelled';
    }

    await this.prisma.monteCarloRun.updateMany({
      where: { id: runId, status: 'running' },
      data: { cancelRequestedAt: this.now() },
    });
    return 'requested';
  }

  /** 片间检查取消标记；顺带返回是否已被外部置为终态 */
  async isCancelRequested(runId: string): Promise<boolean> {
    const run = await this.prisma.monteCarloRun.findUnique({
      where: { id: runId },
      select: { status: true, cancelRequestedAt: true },
    });

    if (!run) return true;
    if (isFinalStatus(run.status)) return true;
    return run.cancelRequestedAt !== null;
  }

  async finishCancelled(runId: string): Promise<void> {
    await this.prisma.monteCarloRun.updateMany({
      where: { id: runId, status: 'running' },
      data: { status: 'cancelled', stage: null, finishedAt: this.now(), result: undefined },
    });
  }

  async fail(runId: string, code: string, message: string): Promise<void> {
    await this.prisma.monteCarloRun.updateMany({
      where: { id: runId, status: 'running' },
      data: {
        status: 'failed',
        stage: null,
        finishedAt: this.now(),
        failureCode: code,
        failureMessage: message.slice(0, 300),
      },
    });
  }

  /** 结果内容由 handler.persist 写入，这里只负责置终态与耗时 */
  async succeed(runId: string, startedAt: Date): Promise<void> {
    await this.prisma.monteCarloRun.updateMany({
      where: { id: runId, status: 'running' },
      data: {
        status: 'succeeded',
        stage: null,
        progress: 1,
        finishedAt: this.now(),
        durationMs: Math.max(0, this.now().getTime() - startedAt.getTime()),
        failureCode: null,
        failureMessage: null,
      },
    });
  }

  /**
   * 启动恢复：心跳超时的 running 说明进程在计算中被终止。
   * 尝试次数未用尽则回到队列（种子未变，重算结果与首次一致）；
   * 已用尽则直接失败，避免坏参数反复烧 CPU。
   */
  async resumeInterrupted(maxAttempts: number): Promise<{ requeued: number; failed: number }> {
    const cutoff = new Date(this.now().getTime() - MONTE_CARLO_HEARTBEAT_TIMEOUT_SECONDS * 1000);

    const stale = await this.prisma.monteCarloRun.findMany({
      where: {
        status: 'running',
        OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: cutoff } }],
      },
      select: { id: true, attempts: true },
    });

    let requeued = 0;
    let failed = 0;

    for (const run of stale) {
      if (run.attempts >= maxAttempts) {
        await this.prisma.monteCarloRun.updateMany({
          where: { id: run.id, status: 'running' },
          data: {
            status: 'failed',
            stage: null,
            finishedAt: this.now(),
            failureCode: JobFailureCode.INTERRUPTED,
            failureMessage: '计算进程中断且重试次数已用尽',
          },
        });
        failed += 1;
      } else {
        await this.prisma.monteCarloRun.updateMany({
          where: { id: run.id, status: 'running' },
          data: { status: 'queued', stage: null, progress: 0, heartbeatAt: null },
        });
        requeued += 1;
      }
    }

    return { requeued, failed };
  }

  /**
   * 保留策略：每个方案只留最新 N 条终态运行。
   * 只删终态，绝不删 queued / running；删除在单事务内完成，避免删到查询中间态。
   */
  async pruneRuns(scenarioId: string, keep: number = MONTE_CARLO_RUN_RETENTION): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const survivors = await tx.monteCarloRun.findMany({
        where: { scenarioId, status: { in: ['succeeded', 'failed', 'cancelled'] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
        skip: keep,
      });

      if (survivors.length === 0) return 0;

      const deleted = await tx.monteCarloRun.deleteMany({
        where: { id: { in: survivors.map((s) => s.id) }, status: { in: ['succeeded', 'failed', 'cancelled'] } },
      });

      return deleted.count;
    });
  }
}

export const PROGRESS_INTERVAL_MS = MONTE_CARLO_PROGRESS_INTERVAL_MS;
export const CANCEL_POLL_MS = MONTE_CARLO_CANCEL_POLL_MS;

/** 运行记录建 id 的默认实现，供测试替换 */
export const newRunId = () => randomUUID();
