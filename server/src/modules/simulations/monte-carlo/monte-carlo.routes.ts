/**
 * 路由顺序：/calculate、/compare、/presets、/suggestions 等固定路径
 * 必须注册在 /:id 之前，否则会被参数路由吞掉
 * （与 /imports/templates、/budgets/summary、/portfolios/summary 同一个坑）。
 */
import type { FastifyInstance } from 'fastify';
import { ok } from '../../../lib/api-utils.js';
import { errors } from '../../../lib/errors.js';
import { requireAuth } from '../../../plugins/auth.js';
import {
  compareSchema,
  createRunSchema,
  createScenarioSchema,
  duplicateScenarioSchema,
  listRunsSchema,
  pathsSchema,
  previewSchema,
  runIdSchema,
  scenarioIdSchema,
  suggestionsSchema,
  updateScenarioSchema,
} from './monte-carlo.schema.js';
import { MonteCarloService } from './monte-carlo.service.js';
import { STRESS_PRESETS } from './stress.js';
import { suggestFromPortfolio } from './suggestions.service.js';

export default async function monteCarloRoutes(app: FastifyInstance) {
  const service = new MonteCarloService(app.prisma, app.jobs);

  // ===== 固定路径：必须先于 /:id 注册 =====

  app.post('/simulations/monte-carlo/calculate', { preHandler: app.authenticate }, async (request) => {
    requireAuth(request);
    const body = previewSchema.parse(request.body ?? {});
    return ok(await service.preview(body as Record<string, unknown>), request.id);
  });

  app.post('/simulations/monte-carlo/compare', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const body = compareSchema.parse(request.body ?? {});
    return ok(await service.compare(userId, body), request.id);
  });

  app.get('/simulations/monte-carlo/presets', { preHandler: app.authenticate }, async (request) => {
    requireAuth(request);
    // 只返回键与文案键，中文/英文文案由前端语言文件提供
    return ok(
      {
        presets: STRESS_PRESETS.map((preset) => ({
          key: preset.key,
          labelKey: preset.labelKey,
          descriptionKey: preset.descriptionKey,
          assumption: preset.assumption,
        })),
      },
      request.id,
    );
  });

  app.get('/simulations/monte-carlo/suggestions', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = suggestionsSchema.parse(request.query);
    return ok(await suggestFromPortfolio(app.prisma, userId, query.portfolioId), request.id);
  });

  // ===== 方案 =====

  app.get('/simulations/monte-carlo', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    return ok({ items: await service.listScenarios(userId) }, request.id);
  });

  app.post('/simulations/monte-carlo', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = createScenarioSchema.parse(request.body ?? {});
    const scenario = await service.createScenario(userId, body as Record<string, unknown>);

    await app.prisma.auditLog.create({
      data: {
        userId,
        action: 'monte_carlo.scenario.created',
        targetType: 'monte_carlo_scenario',
        targetId: scenario.id,
        metadata: { assetCount: (body.assets as unknown[]).length, years: scenario.years, pathCount: scenario.pathCount },
      },
    });

    return reply.status(201).send(ok(scenario, request.id));
  });

  app.get('/simulations/monte-carlo/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = scenarioIdSchema.parse(request.params);
    return ok(await service.getScenario(userId, id), request.id);
  });

  app.patch('/simulations/monte-carlo/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = scenarioIdSchema.parse(request.params);
    const body = updateScenarioSchema.parse(request.body ?? {});
    const scenario = await service.updateScenario(userId, id, body as Record<string, unknown>);

    await app.prisma.auditLog.create({
      data: {
        userId,
        action: 'monte_carlo.scenario.updated',
        targetType: 'monte_carlo_scenario',
        targetId: id,
        metadata: { fields: Object.keys(body) },
      },
    });

    return ok(scenario, request.id);
  });

  app.delete('/simulations/monte-carlo/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = scenarioIdSchema.parse(request.params);
    await service.deleteScenario(userId, id);

    await app.prisma.auditLog.create({
      data: {
        userId,
        action: 'monte_carlo.scenario.deleted',
        targetType: 'monte_carlo_scenario',
        targetId: id,
      },
    });

    return ok({ deleted: true }, request.id);
  });

  app.post('/simulations/monte-carlo/:id/duplicate', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = scenarioIdSchema.parse(request.params);
    const body = duplicateScenarioSchema.parse(request.body ?? {});
    const scenario = await service.duplicateScenario(userId, id, body.name);
    return reply.status(201).send(ok(scenario, request.id));
  });

  // ===== 运行 =====

  app.post('/simulations/monte-carlo/:id/runs', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = scenarioIdSchema.parse(request.params);
    const body = createRunSchema.parse(request.body ?? {});
    const run = await service.createRun(userId, id, body);

    const queuePosition = await app.jobs.repository.queuePosition(run.id, run.createdAt);

    await app.prisma.auditLog.create({
      data: {
        userId,
        action: 'monte_carlo.run.queued',
        targetType: 'monte_carlo_run',
        targetId: run.id,
        metadata: { scenarioId: id, pathCount: run.pathCount, seed: run.seed },
      },
    });

    return reply.status(202).send(
      ok(
        {
          id: run.id,
          scenarioId: run.scenarioId,
          status: run.status,
          stage: run.stage,
          progress: run.progress.toString(),
          queuePosition,
          seed: run.seed,
          pathCount: run.pathCount,
          years: run.years,
          modelVersion: run.modelVersion,
          createdAt: run.createdAt,
        },
        request.id,
      ),
    );
  });

  app.get('/simulations/monte-carlo/:id/runs', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = scenarioIdSchema.parse(request.params);
    const query = listRunsSchema.parse(request.query);
    const runs = await service.listRuns(userId, id, query.limit);

    return ok(
      {
        items: runs.map((run) => ({
          ...run,
          progress: run.progress.toString(),
        })),
      },
      request.id,
    );
  });

  app.get('/simulations/monte-carlo/:id/runs/:runId', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id, runId } = runIdSchema.parse(request.params);
    const { run, queuePosition } = await service.getRun(userId, id, runId);

    return ok(
      {
        run: {
          id: run.id,
          scenarioId: run.scenarioId,
          scenarioName: run.scenarioName,
          status: run.status,
          stage: run.stage,
          progress: run.progress.toString(),
          queuePosition,
          attempts: run.attempts,
          seed: run.seed,
          pathCount: run.pathCount,
          years: run.years,
          modelVersion: run.modelVersion,
          createdAt: run.createdAt,
          startedAt: run.startedAt,
          heartbeatAt: run.heartbeatAt,
          finishedAt: run.finishedAt,
          durationMs: run.durationMs,
          failureCode: run.failureCode,
          failureMessage: run.failureMessage,
        },
        assumptions: run.assumptions,
      },
      request.id,
    );
  });

  app.get('/simulations/monte-carlo/:id/runs/:runId/results', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id, runId } = runIdSchema.parse(request.params);
    return ok(await service.getRunResult(userId, id, runId), request.id);
  });

  app.get('/simulations/monte-carlo/:id/runs/:runId/paths', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id, runId } = runIdSchema.parse(request.params);
    const query = pathsSchema.parse(request.query);
    return ok(await service.getPaths(userId, id, runId, query), request.id);
  });

  app.post('/simulations/monte-carlo/:id/runs/:runId/cancel', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id, runId } = runIdSchema.parse(request.params);
    const run = await service.cancelRun(userId, id, runId);

    if (!run) throw errors.mcRunNotFound();

    await app.prisma.auditLog.create({
      data: {
        userId,
        action: 'monte_carlo.run.cancelled',
        targetType: 'monte_carlo_run',
        targetId: runId,
      },
    });

    return ok(
      {
        id: run.id,
        status: run.status,
        stage: run.stage,
        progress: run.progress.toString(),
        finishedAt: run.finishedAt,
      },
      request.id,
    );
  });
}
