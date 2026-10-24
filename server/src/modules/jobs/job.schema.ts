import { z } from 'zod';
import { MONTE_CARLO_MAX_ATTEMPTS } from '../../config/constants.js';
import type { PrismaClient } from '@prisma/client';
import { errors } from '../../lib/errors.js';

export const jobListSchema = z.object({
  kind: z.enum(['export', 'backup', 'restore', 'recheck', 'monte-carlo']).optional(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']).optional(),
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const jobIdSchema = z.object({
  id: z.string().uuid('任务 ID 必须是 UUID'),
});

/**
 * 蒙特卡罗运行的重试：复用同一行与同一随机种子。
 * 种子不变意味着重算结果逐位一致，重试不会产生第二套口径。
 */
export async function retryMonteCarloRun(prisma: PrismaClient, userId: string, id: string) {
  const run = await prisma.monteCarloRun.findFirst({
    where: { id, userId },
    select: { id: true, status: true, attempts: true },
  });

  if (!run) throw errors.taskNotFound();
  if (run.status !== 'failed') throw errors.taskNotRetryable(run.status, run.attempts);
  if (run.attempts >= MONTE_CARLO_MAX_ATTEMPTS) throw errors.taskNotRetryable(run.status, run.attempts);

  return prisma.monteCarloRun.update({
    where: { id: run.id },
    data: {
      status: 'queued',
      stage: null,
      progress: 0,
      failureCode: null,
      failureMessage: null,
      cancelRequestedAt: null,
      heartbeatAt: null,
      startedAt: null,
      finishedAt: null,
    },
    select: { id: true, status: true, attempts: true },
  });
}

