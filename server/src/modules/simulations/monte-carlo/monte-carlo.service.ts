import { randomInt } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  MONTE_CARLO_DEFAULT_PATHS,
  MONTE_CARLO_PREVIEW_PATHS,
  MONTE_CARLO_QUEUE_LIMIT,
  MONTE_CARLO_SEED_MAX,
  MONTE_CARLO_TIMEOUT_SECONDS,
} from '../../../config/constants.js';
import { errors } from '../../../lib/errors.js';
import type { JobExecutor } from '../../jobs/job.executor.js';
import { MODEL_VERSION, simulateSinglePath, type MonteCarloInput } from './monte-carlo.engine.js';
import { buildAssumptions, serializeResult } from './monte-carlo.serialize.js';
import { toEngineInput, type MonteCarloPayload } from './monte-carlo.handler.js';
import { normalizeScenario, type RawScenario } from './scenario.validation.js';
import { simulate } from './monte-carlo.engine.js';

/**
 * 请求体或快照到校验层的形状转换：数字字符串 → number，并补齐默认值。
 * 快照里的 assets / settings 与请求体同形状，因此两者共用这一个入口。
 */
export function toRawScenario(body: Record<string, unknown>): RawScenario {
  const settings = (body.settings ?? {}) as Record<string, unknown>;
  const contribution = (settings.contribution ?? {}) as Record<string, unknown>;
  const withdrawal = (settings.withdrawal ?? {}) as Record<string, unknown>;

  return {
    years: Number(body.years),
    pathCount: Number(body.pathCount),
    rebalance: (body.rebalance ?? 'annual') as RawScenario['rebalance'],
    assets: ((body.assets ?? []) as Array<Record<string, string>>).map((asset) => ({
      key: asset.key!,
      label: asset.label ?? asset.key!,
      weight: Number(asset.weight),
      expectedAnnualReturn: Number(asset.expectedAnnualReturn),
      annualVolatility: Number(asset.annualVolatility),
    })),
    correlation: (body.correlation ?? []) as number[][],
    settings: {
      initialValue: Number(settings.initialValue ?? 0),
      contribution: {
        amount: Number(contribution.amount ?? 0),
        frequency: (contribution.frequency ?? 'monthly') as RawScenario['settings']['contribution']['frequency'],
        timing: (contribution.timing ?? 'end') as RawScenario['settings']['contribution']['timing'],
      },
      withdrawal: {
        amount: Number(withdrawal.amount ?? 0),
        frequency: (withdrawal.frequency ?? 'none') as RawScenario['settings']['withdrawal']['frequency'],
        startYear: Number(withdrawal.startYear ?? 1),
      },
      inflationRate: Number(settings.inflationRate ?? 0),
      feeRate: Number(settings.feeRate ?? 0),
      targetAmount: settings.targetAmount == null ? null : Number(settings.targetAmount),
    },
  };
}

/** 方案参数入库前的统一形状：比率保留字符串，避免浮点失真 */
export function toStoredScenario(
  body: Record<string, unknown>,
  normalized: ReturnType<typeof normalizeScenario>,
) {
  return {
    years: normalized.years,
    pathCount: normalized.pathCount,
    rebalance: normalized.rebalance,
    assets: (body.assets as Array<Record<string, string>>).map((asset) => ({
      key: asset.key!,
      label: asset.label ?? asset.key!,
      // 权重与收益保留 6 位字符串，与账本口径一致
      weight: Number(asset.weight).toFixed(6),
      expectedAnnualReturn: Number(asset.expectedAnnualReturn).toFixed(6),
      annualVolatility: Number(asset.annualVolatility).toFixed(6),
    })),
    correlation: normalized.correlation.map((row) => row.map((value) => value)),
    settings: {
      initialValue: (body.settings as Record<string, unknown>).initialValue as string,
      contribution: (body.settings as Record<string, Record<string, unknown>>).contribution,
      withdrawal: (body.settings as Record<string, Record<string, unknown>>).withdrawal,
      inflationRate: (body.settings as Record<string, unknown>).inflationRate as string,
      feeRate: (body.settings as Record<string, unknown>).feeRate as string,
      targetAmount: (body.settings as Record<string, unknown>).targetAmount as string | null,
    },
  };
}

export class MonteCarloService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly executor: JobExecutor,
  ) {}

  async listScenarios(userId: string) {
    const scenarios = await this.prisma.monteCarloScenario.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        currency: true,
        years: true,
        pathCount: true,
        rebalance: true,
        updatedAt: true,
        runs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            stage: true,
            progress: true,
            finishedAt: true,
            createdAt: true,
          },
        },
      },
    });

    return scenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      currency: scenario.currency,
      years: scenario.years,
      pathCount: scenario.pathCount,
      rebalance: scenario.rebalance,
      updatedAt: scenario.updatedAt,
      latestRun: scenario.runs[0] ?? null,
    }));
  }

  async getScenario(userId: string, scenarioId: string) {
    const scenario = await this.prisma.monteCarloScenario.findFirst({
      where: { id: scenarioId, userId },
      include: {
        runs: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            status: true,
            stage: true,
            progress: true,
            seed: true,
            pathCount: true,
            createdAt: true,
            finishedAt: true,
            durationMs: true,
            failureCode: true,
          },
        },
      },
    });

    if (!scenario) throw errors.mcScenarioNotFound();
    return scenario;
  }

  /** 创建前先试算一次参数，校验不通过就不入库 */
  async createScenario(userId: string, body: Record<string, unknown>) {
    const name = body.name as string;
    const normalized = normalizeScenario(toRawScenario(body));
    const stored = toStoredScenario(body, normalized);

    const existing = await this.prisma.monteCarloScenario.findFirst({
      where: { userId, name },
      select: { id: true },
    });
    if (existing) throw errors.mcScenarioNameExists();

    return this.prisma.monteCarloScenario.create({
      data: {
        userId,
        name,
        currency: (body.currency as string | undefined) ?? 'CNY',
        years: normalized.years,
        pathCount: normalized.pathCount,
        rebalance: normalized.rebalance,
        assets: stored.assets as never,
        correlation: stored.correlation as never,
        settings: stored.settings as never,
        modelVersion: MODEL_VERSION,
        note: (body.note as string | null | undefined) ?? null,
      },
    });
  }

  async updateScenario(userId: string, scenarioId: string, body: Record<string, unknown>) {
    const current = await this.prisma.monteCarloScenario.findFirst({
      where: { id: scenarioId, userId },
    });
    if (!current) throw errors.mcScenarioNotFound();

    if (body.name && body.name !== current.name) {
      const clash = await this.prisma.monteCarloScenario.findFirst({
        where: { userId, name: body.name as string, id: { not: scenarioId } },
        select: { id: true },
      });
      if (clash) throw errors.mcScenarioNameExists();
    }

    // 更新为整体替换语义：缺省字段沿用当前值，避免出现半套参数
    const merged = {
      years: body.years ?? current.years,
      pathCount: body.pathCount ?? current.pathCount,
      rebalance: body.rebalance ?? current.rebalance,
      assets: body.assets ?? current.assets,
      correlation: body.correlation ?? current.correlation,
      settings: body.settings ?? current.settings,
      currency: body.currency ?? current.currency,
      name: body.name ?? current.name,
      note: body.note === undefined ? current.note : body.note,
    };

    const normalized = normalizeScenario(toRawScenario(merged as Record<string, unknown>));
    const stored = toStoredScenario(merged as Record<string, unknown>, normalized);

    // 方案版本随参数变化递增，历史运行的快照不受影响
    return this.prisma.monteCarloScenario.update({
      where: { id: scenarioId },
      data: {
        name: merged.name as string,
        currency: merged.currency as string,
        years: normalized.years,
        pathCount: normalized.pathCount,
        rebalance: normalized.rebalance,
        assets: stored.assets as never,
        correlation: stored.correlation as never,
        settings: stored.settings as never,
        note: merged.note as string | null,
      },
    });
  }

  async deleteScenario(userId: string, scenarioId: string) {
    const current = await this.prisma.monteCarloScenario.findFirst({
      where: { id: scenarioId, userId },
      select: { id: true },
    });
    if (!current) throw errors.mcScenarioNotFound();
    // 方案删除时运行级联删除（外键 onDelete: Cascade）
    await this.prisma.monteCarloScenario.delete({ where: { id: scenarioId } });
  }

  async duplicateScenario(userId: string, scenarioId: string, name: string) {
    const current = await this.prisma.monteCarloScenario.findFirst({
      where: { id: scenarioId, userId },
    });
    if (!current) throw errors.mcScenarioNotFound();

    const clash = await this.prisma.monteCarloScenario.findFirst({
      where: { userId, name },
      select: { id: true },
    });
    if (clash) throw errors.mcScenarioNameExists();

    return this.prisma.monteCarloScenario.create({
      data: {
        userId,
        name,
        currency: current.currency,
        years: current.years,
        pathCount: current.pathCount,
        rebalance: current.rebalance,
        returnModel: current.returnModel,
        assets: current.assets as never,
        correlation: current.correlation as never,
        settings: current.settings as never,
        modelVersion: current.modelVersion,
        note: current.note,
      },
    });
  }

  /** 发起运行：冻结参数快照，入队后立即返回 */
  async createRun(
    userId: string,
    scenarioId: string,
    override: { pathCount?: number; seed?: number; stressPreset?: string },
  ) {
    const scenario = await this.prisma.monteCarloScenario.findFirst({
      where: { id: scenarioId, userId },
    });
    if (!scenario) throw errors.mcScenarioNotFound();

    const active = await this.executor.repository.countActive();
    if (active >= MONTE_CARLO_QUEUE_LIMIT) throw errors.mcQueueFull(MONTE_CARLO_QUEUE_LIMIT);

    const pathCount = override.pathCount ?? scenario.pathCount ?? MONTE_CARLO_DEFAULT_PATHS;
    const seed = override.seed ?? randomInt(0, MONTE_CARLO_SEED_MAX + 1);

    // 快照用当前方案参数，之后改方案不影响这次运行
    const snapshotRaw = {
      years: scenario.years,
      pathCount,
      rebalance: scenario.rebalance,
      assets: scenario.assets,
      correlation: scenario.correlation,
      settings: scenario.settings,
    };

    const normalized = normalizeScenario(toRawScenario(snapshotRaw as Record<string, unknown>));
    const modelVersion = override.stressPreset
      ? `${scenario.modelVersion}+stress:${override.stressPreset}`
      : scenario.modelVersion;

    const assumptions = {
      ...buildAssumptions(normalized, { seed, modelVersion, stressPreset: override.stressPreset ?? null }),
      // 执行器按这个形状还原输入，与展示用的 assumptions 分开维护
      years: normalized.years,
      pathCount,
      rebalance: normalized.rebalance,
      assets: scenario.assets,
      correlation: scenario.correlation,
      settings: scenario.settings,
      stressPreset: override.stressPreset ?? null,
    };

    const run = await this.prisma.monteCarloRun.create({
      data: {
        userId,
        scenarioId,
        scenarioName: scenario.name,
        status: 'queued',
        assumptions: assumptions as never,
        seed,
        modelVersion,
        pathCount,
        years: normalized.years,
      },
    });

    this.executor.kick();
    return run;
  }

  async listRuns(userId: string, scenarioId: string, limit: number) {
    const scenario = await this.prisma.monteCarloScenario.findFirst({
      where: { id: scenarioId, userId },
      select: { id: true },
    });
    if (!scenario) throw errors.mcScenarioNotFound();

    return this.prisma.monteCarloRun.findMany({
      where: { scenarioId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        status: true,
        stage: true,
        progress: true,
        seed: true,
        pathCount: true,
        years: true,
        modelVersion: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
        failureCode: true,
        failureMessage: true,
      },
    });
  }

  async getRun(userId: string, scenarioId: string, runId: string) {
    const run = await this.prisma.monteCarloRun.findFirst({
      where: { id: runId, scenarioId, userId },
    });
    if (!run) throw errors.mcRunNotFound();

    const queuePosition = run.status === 'queued'
      ? await this.executor.repository.queuePosition(run.id, run.createdAt)
      : 0;

    return { run, queuePosition };
  }

  async getRunResult(userId: string, scenarioId: string, runId: string) {
    const run = await this.prisma.monteCarloRun.findFirst({
      where: { id: runId, scenarioId, userId },
      select: { id: true, status: true, result: true, assumptions: true },
    });
    if (!run) throw errors.mcRunNotFound();

    if (run.status === 'queued' || run.status === 'running') throw errors.mcRunNotReady();
    if (run.status !== 'succeeded' || !run.result) throw errors.mcRunFailed();

    return { runId: run.id, status: run.status, result: run.result, assumptions: run.assumptions };
  }

  async cancelRun(userId: string, scenarioId: string, runId: string) {
    const run = await this.prisma.monteCarloRun.findFirst({
      where: { id: runId, scenarioId, userId },
      select: { id: true },
    });
    if (!run) throw errors.mcRunNotFound();

    const outcome = await this.executor.repository.cancel(runId);
    if (outcome === 'finished') throw errors.mcRunAlreadyFinished();

    return this.prisma.monteCarloRun.findUnique({ where: { id: runId } });
  }

  /**
   * 同步预览：同请求内直接算完，不走队列。
   * 只返回终值分位数与亏损概率，且路径数受上限约束，用于参数面板即时反馈。
   */
  async preview(body: Record<string, unknown>) {
    const raw = toRawScenario(body);
    const normalized = normalizeScenario(raw);
    const seed = Number(body.seed ?? randomInt(0, MONTE_CARLO_SEED_MAX + 1));

    const input: MonteCarloInput = {
      years: normalized.years,
      pathCount: normalized.pathCount,
      seed,
      rebalance: normalized.rebalance,
      assets: normalized.assets,
      cholesky: normalized.cholesky,
      initialValue: normalized.initialValue,
      contribution: normalized.contribution,
      withdrawal: normalized.withdrawal,
      inflationRate: normalized.inflationRate,
      feeRate: normalized.feeRate,
      targetAmount: normalized.targetAmount,
    };

    const startedAt = Date.now();
    const outcome = await simulate(input, {
      shouldCancel: () => Date.now() - startedAt > MONTE_CARLO_TIMEOUT_SECONDS * 1000,
    });

    if (!outcome.ok) throw errors.mcPreviewLimitExceeded(MONTE_CARLO_PREVIEW_PATHS);

    return {
      seed,
      pathCount: normalized.pathCount,
      terminal: serializeResult(outcome.result).terminal,
      probabilities: serializeResult(outcome.result).probabilities,
      standardError: serializeResult(outcome.result).standardError,
    };
  }

  /** 路径再生成：只算所需索引，不读 samplePaths，保证任意历史运行都能下钻 */
  async getPaths(
    userId: string,
    scenarioId: string,
    runId: string,
    options: { count: number; resolution: 'monthly' | 'yearly'; indexes?: string },
  ) {
    const run = await this.prisma.monteCarloRun.findFirst({
      where: { id: runId, scenarioId, userId },
      select: { id: true, status: true, assumptions: true, seed: true, pathCount: true, samplePaths: true },
    });
    if (!run) throw errors.mcRunNotFound();
    if (run.status !== 'succeeded') throw errors.mcRunNotReady();

    const payload: MonteCarloPayload = {
      runId: run.id,
      startedAt: new Date(),
      assumptions: run.assumptions as Record<string, unknown>,
      modelVersion: '',
      pathCount: run.pathCount,
      seed: run.seed,
      stressPreset: null,
    };

    const input = toEngineInput(payload);

    const indexes = options.indexes
      ? options.indexes.split(',').map((value) => Number(value))
      : defaultIndexes(run.pathCount, options.count);

    for (const index of indexes) {
      if (!Number.isInteger(index) || index < 0 || index >= run.pathCount) {
        throw errors.mcPathIndexInvalid(run.pathCount);
      }
    }

    const paths: Array<{ index: number; values: number[] }> = [];

    for (const index of indexes) {
      const path = simulateSinglePath(input, index);
      paths.push({
        index,
        values: options.resolution === 'yearly' ? path.yearly : path.monthly,
      });
    }

    return { resolution: options.resolution, paths };
  }

  /** 对比：只允许同年限，避免把 10 年与 30 年并排误导用户 */
  async compare(userId: string, body: { runIds?: string[]; scenarioIds?: string[]; metrics?: string[] }) {
    const ids = body.runIds ?? [];

    if (ids.length > 0) {
      const runs = await this.prisma.monteCarloRun.findMany({
        where: { id: { in: ids }, userId },
        select: {
          id: true,
          scenarioName: true,
          status: true,
          seed: true,
          pathCount: true,
          years: true,
          modelVersion: true,
          result: true,
          createdAt: true,
        },
      });

      if (runs.length !== ids.length) throw errors.mcRunNotFound();

      const yearsSet = new Set(runs.map((run) => run.years));
      if (yearsSet.size > 1) throw errors.mcCompareIncompatible('different_years');

      const versions = new Set(runs.map((run) => run.modelVersion));
      if (versions.size > 1) throw errors.mcCompareIncompatible('different_model_version');

      return runs.map((run) => ({
        runId: run.id,
        scenarioName: run.scenarioName,
        runStatus: run.status,
        seed: run.seed,
        pathCount: run.pathCount,
        years: run.years,
        result: run.status === 'succeeded' ? run.result : null,
      }));
    }

    // 方案模式取每个方案最近一次成功运行
    const scenarioIds = body.scenarioIds ?? [];
    const scenarios = await this.prisma.monteCarloScenario.findMany({
      where: { id: { in: scenarioIds }, userId },
      select: {
        id: true,
        name: true,
        years: true,
        runs: {
          where: { status: 'succeeded' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, seed: true, pathCount: true, years: true, modelVersion: true, result: true },
        },
      },
    });

    if (scenarios.length !== scenarioIds.length) throw errors.mcScenarioNotFound();

    const yearsSet = new Set(scenarios.map((scenario) => scenario.years));
    if (yearsSet.size > 1) throw errors.mcCompareIncompatible('different_years');

    return scenarios.map((scenario) => {
      const latest = scenario.runs[0];
      return {
        runId: latest?.id ?? null,
        scenarioName: scenario.name,
        runStatus: latest ? 'succeeded' : 'missing',
        seed: latest?.seed ?? null,
        pathCount: latest?.pathCount ?? null,
        years: scenario.years,
        result: latest?.result ?? null,
      };
    });
  }
}

function defaultIndexes(pathCount: number, count: number): number[] {
  const total = Math.min(count, pathCount);
  return Array.from({ length: total }, (_, i) => Math.floor((i * pathCount) / total));
}
