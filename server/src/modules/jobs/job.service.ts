import type { Prisma, PrismaClient } from '@prisma/client';
import { errors } from '../../lib/errors.js';

export interface JobListItem {
  id: string;
  kind: string;
  status: string;
  progress: string;
  stage: string | null;
  targetType: string | null;
  targetId: string | null;
  failureCode: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  source: 'task' | 'monte-carlo';
}

export interface JobListQuery {
  userId: string;
  kind?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}

interface CursorPayload {
  createdAt: string;
  id: string;
}

function encodeCursor(item: { createdAt: string; id: string }): string {
  return Buffer.from(`${item.createdAt}|${item.id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** 游标条件：(createdAt, id) 严格小于游标，避免大偏移与并发插入导致重复 */
function cursorFilter(cursor: CursorPayload | null): { OR: Prisma.JsonObject[] } | null {
  if (!cursor) return null;
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

/** 用一个永远不存在的合法 UUID 代表「不回任何行」，不能用非 UUID 字符串 */
const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000';

const TASK_KIND_MAP: Record<string, string> = {
  export: 'export',
  backup: 'backup',
  restore: 'restore',
  recheck: 'recheck',
};

/**
 * 统一任务读模型：通用任务与蒙特卡罗运行合并后按时间倒序。
 * 只读，不改变两条写路径。
 */
export async function listJobs(
  prisma: PrismaClient,
  query: JobListQuery,
): Promise<{ items: JobListItem[]; nextCursor: string | null; counts: Record<string, number> }> {
  const limit = Math.min(query.limit ?? 20, 100);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const order = cursorFilter(cursor);

  const taskWhere: Prisma.JobTaskWhereInput = {
    userId: query.userId,
    ...(query.kind && query.kind !== 'monte-carlo'
      ? { kind: query.kind as Prisma.EnumTaskKindFilter['equals'] }
      : {}),
    ...(query.status ? { status: query.status as Prisma.EnumTaskStatusFilter['equals'] } : {}),
    ...(order ?? {}),
  };

  const runWhere: Prisma.MonteCarloRunWhereInput = {
    userId: query.userId,
    ...(query.kind && query.kind !== 'monte-carlo' ? { id: NO_MATCH_ID } : {}),
    ...(query.status ? { status: query.status as Prisma.EnumRunStatusFilter['equals'] } : {}),
    ...(order ?? {}),
  };

  // 多取一条用于判断是否还有下一页
  const [tasks, runs, taskCounts, runCounts] = await Promise.all([
    prisma.jobTask.findMany({
      where: taskWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        kind: true,
        status: true,
        progress: true,
        stage: true,
        targetType: true,
        targetId: true,
        failureCode: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
      },
    }),
    prisma.monteCarloRun.findMany({
      where: runWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        status: true,
        stage: true,
        progress: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        failureCode: true,
        scenarioId: true,
      },
    }),
    prisma.jobTask.groupBy({
      by: ['status'],
      where: { userId: query.userId, ...(query.kind && query.kind !== 'monte-carlo' ? { kind: query.kind as 'export' } : {}) },
      _count: { _all: true },
    }),
    prisma.monteCarloRun.groupBy({
      by: ['status'],
      where: { userId: query.userId, ...(query.kind && query.kind !== 'monte-carlo' ? { id: NO_MATCH_ID } : {}) },
      _count: { _all: true },
    }),
  ]);

  const merged: JobListItem[] = [
    ...tasks.map((task) => ({
      id: task.id,
      kind: TASK_KIND_MAP[task.kind] ?? task.kind,
      status: task.status,
      progress: task.progress.toFixed(4),
      stage: task.stage,
      targetType: task.targetType,
      targetId: task.targetId,
      failureCode: task.failureCode,
      createdAt: task.createdAt.toISOString(),
      startedAt: task.startedAt?.toISOString() ?? null,
      finishedAt: task.finishedAt?.toISOString() ?? null,
      source: 'task' as const,
    })),
    ...runs.map((run) => ({
      id: run.id,
      kind: 'monte-carlo',
      status: run.status,
      progress: run.progress.toFixed(4),
      stage: run.stage,
      targetType: 'monte_carlo_runs',
      targetId: run.scenarioId,
      failureCode: run.failureCode,
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      source: 'monte-carlo' as const,
    })),
  ];

  merged.sort((a, b) => {
    const byTime = b.createdAt.localeCompare(a.createdAt);
    return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
  });

  const page = merged.slice(0, limit);
  const hasMore = merged.length > limit;
  const last = page[page.length - 1];

  const counts: Record<string, number> = {};
  for (const group of taskCounts) counts[group.status] = (counts[group.status] ?? 0) + group._count._all;
  for (const group of runCounts) counts[group.status] = (counts[group.status] ?? 0) + group._count._all;

  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
    counts,
  };
}

export async function getJob(prisma: PrismaClient, userId: string, id: string): Promise<JobListItem> {
  const task = await prisma.jobTask.findFirst({
    where: { id, userId },
    select: {
      id: true,
      kind: true,
      status: true,
      progress: true,
      stage: true,
      targetType: true,
      targetId: true,
      failureCode: true,
      failureMessage: true,
      attempts: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      summary: true,
    },
  });

  if (task) {
    return {
      id: task.id,
      kind: TASK_KIND_MAP[task.kind] ?? task.kind,
      status: task.status,
      progress: task.progress.toFixed(4),
      stage: task.stage,
      targetType: task.targetType,
      targetId: task.targetId,
      failureCode: task.failureCode,
      createdAt: task.createdAt.toISOString(),
      startedAt: task.startedAt?.toISOString() ?? null,
      finishedAt: task.finishedAt?.toISOString() ?? null,
      source: 'task',
      // 详情额外字段：失败说明与尝试次数，列表不需要
      ...({
        failureMessage: task.failureMessage,
        attempts: task.attempts,
        summary: task.summary,
      } as object),
    } as JobListItem;
  }

  const run = await prisma.monteCarloRun.findFirst({
    where: { id, userId },
    select: {
      id: true,
      status: true,
      stage: true,
      progress: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      failureCode: true,
      failureMessage: true,
      attempts: true,
      scenarioId: true,
    },
  });

  if (!run) throw errors.taskNotFound();

  return {
    id: run.id,
    kind: 'monte-carlo',
    status: run.status,
    progress: run.progress.toFixed(4),
    stage: run.stage,
    targetType: 'monte_carlo_runs',
    targetId: run.scenarioId,
    failureCode: run.failureCode,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    source: 'monte-carlo',
    ...({
      failureMessage: run.failureMessage,
      attempts: run.attempts,
    } as object),
  } as JobListItem;
}

/** 该任务是否为蒙特卡罗运行，取消与重试要分派到 Phase 5 的实现 */
export async function resolveJobSource(
  prisma: PrismaClient,
  userId: string,
  id: string,
): Promise<'task' | 'monte-carlo'> {
  const task = await prisma.jobTask.findFirst({ where: { id, userId }, select: { id: true } });
  if (task) return 'task';

  const run = await prisma.monteCarloRun.findFirst({ where: { id, userId }, select: { id: true } });
  if (run) return 'monte-carlo';

  throw errors.taskNotFound();
}
