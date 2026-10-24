import type { Prisma, PrismaClient, TaskKind, TaskStatus } from '@prisma/client';
import { TASK_MAX_ATTEMPTS } from '../../config/constants.js';
import { errors } from '../../lib/errors.js';

export interface CreateTaskInput {
  userId: string;
  kind: TaskKind;
  targetType: string | null;
  targetId: string | null;
  summary?: Record<string, unknown>;
}

/**
 * 通用任务行。
 *
 * 与 monte_carlo_runs 分开：MC 有种子、路径数、假设快照等专用列，
 * 塞进通用表会让通用表长满业务字段。任务面板用读模型聚合两者。
 */
export async function createTask(prisma: PrismaClient, input: CreateTaskInput) {
  return prisma.jobTask.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      targetType: input.targetType,
      targetId: input.targetId,
      summary: (input.summary ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    select: { id: true, kind: true, status: true, progress: true, createdAt: true },
  });
}

export async function findTask(prisma: PrismaClient, userId: string, id: string) {
  const task = await prisma.jobTask.findFirst({ where: { id, userId } });
  if (!task) throw errors.taskNotFound();
  return task;
}

/** 取消：只有排队中与运行中的任务接受取消 */
export async function requestCancel(prisma: PrismaClient, userId: string, id: string) {
  const task = await findTask(prisma, userId, id);

  if (task.status !== 'queued' && task.status !== 'running') {
    throw errors.taskNotCancellable(task.status);
  }

  return prisma.jobTask.update({
    where: { id: task.id },
    data: { cancelRequestedAt: new Date() },
    select: { id: true, status: true, cancelRequestedAt: true },
  });
}

/** 重试：只有 failed 且未达次数上限的任务可重试，复用原行 */
export async function retryTask(prisma: PrismaClient, userId: string, id: string) {
  const task = await findTask(prisma, userId, id);

  if (task.status !== 'failed') {
    throw errors.taskNotRetryable(task.status, task.attempts);
  }
  if (task.attempts >= TASK_MAX_ATTEMPTS) {
    throw errors.taskNotRetryable(task.status, task.attempts);
  }

  return prisma.jobTask.update({
    where: { id: task.id },
    data: {
      status: 'queued',
      progress: 0,
      stage: null,
      failureCode: null,
      failureMessage: null,
      cancelRequestedAt: null,
      heartbeatAt: null,
      startedAt: null,
      finishedAt: null,
      attempts: task.attempts + 1,
    },
    select: { id: true, status: true, attempts: true },
  });
}

export function isTerminal(status: TaskStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}
