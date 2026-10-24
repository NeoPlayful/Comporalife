import type { FastifyInstance } from 'fastify';
import { ok } from '../../lib/api-utils.js';
import { requireAuth } from '../../plugins/auth.js';
import { getJob, listJobs, resolveJobSource } from './job.service.js';
import { jobIdSchema, jobListSchema, retryMonteCarloRun } from './job.schema.js';
import { requestCancel as cancelTask, retryTask } from './task.repository.js';

export default async function jobsRoutes(app: FastifyInstance) {
  // 任务面板读模型：通用任务与蒙特卡罗运行合并，写路径分派到各自实现

  app.get('/jobs', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = jobListSchema.parse(request.query);

    return ok(
      await listJobs(app.prisma, {
        userId,
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        limit: query.limit,
      }),
      request.id,
    );
  });

  app.get('/jobs/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = jobIdSchema.parse(request.params);

    return ok({ job: await getJob(app.prisma, userId, id) }, request.id);
  });

  app.post('/jobs/:id/cancel', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = jobIdSchema.parse(request.params);

    const source = await resolveJobSource(app.prisma, userId, id);

    if (source === 'monte-carlo') {
      // 复用 Phase 5 的取消实现：状态机与幂等语义完全不变
      const outcome = await app.jobs.repository.cancel(id);
      if (outcome === 'finished') {
        return ok({ id, status: 'finished', cancelled: false }, request.id);
      }

      const run = await app.prisma.monteCarloRun.findUniqueOrThrow({
        where: { id },
        select: { status: true, cancelRequestedAt: true },
      });

      return ok(
        { id, status: run.status, cancelled: run.status === 'cancelled', requestedAt: run.cancelRequestedAt },
        request.id,
      );
    }

    const task = await cancelTask(app.prisma, userId, id);
    return ok({ id: task.id, status: task.status, cancelRequestedAt: task.cancelRequestedAt }, request.id);
  });

  app.post('/jobs/:id/retry', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = jobIdSchema.parse(request.params);

    const source = await resolveJobSource(app.prisma, userId, id);

    if (source === 'monte-carlo') {
      const run = await retryMonteCarloRun(app.prisma, userId, id);
      app.jobs.kick();
      return ok({ id: run.id, status: run.status, attempts: run.attempts }, request.id);
    }

    const task = await retryTask(app.prisma, userId, id);
    app.tasks.kick();
    return ok({ id: task.id, status: task.status, attempts: task.attempts }, request.id);
  });
}
