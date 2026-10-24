import type { PrismaClient } from '@prisma/client';
import { MONTE_CARLO_CHUNK_MS, MONTE_CARLO_SAMPLE_PATHS } from '../../../config/constants.js';
import { JobFailureCode, type JobFailureCodeValue, type JobHandler, type JobHooks, type JobPayload } from '../../jobs/job.types.js';
import {
  aggregatePaths,
  simulatePaths,
  type MonteCarloInput,
  type MonteCarloResult,
  type PathBatch,
} from './monte-carlo.engine.js';
import { serializeResult } from './monte-carlo.serialize.js';
import { toRawScenario } from './monte-carlo.service.js';
import { findPreset, simulateStress } from './stress.js';
import { normalizeScenario } from './scenario.validation.js';

export interface MonteCarloPayload extends JobPayload {
  assumptions: Record<string, unknown>;
  modelVersion: string;
  pathCount: number;
  seed: number;
  stressPreset: string | null;
}

/**
 * 把蒙特卡罗接到通用执行器上。
 * 执行器不认识蒙特卡罗；这里负责「读快照 → 归一化 → 分片模拟 → 统一聚合 → 落库」。
 */
export function createMonteCarloHandler(prisma: PrismaClient): JobHandler<MonteCarloPayload, MonteCarloResult> {
  return {
    kind: 'monte-carlo',

    async load(runId: string): Promise<MonteCarloPayload | null> {
      const run = await prisma.monteCarloRun.findUnique({
        where: { id: runId },
        select: { id: true, assumptions: true, modelVersion: true, pathCount: true, seed: true },
      });

      if (!run) return null;

      const assumptions = run.assumptions as Record<string, unknown>;

      return {
        runId: run.id,
        startedAt: new Date(),
        assumptions,
        modelVersion: run.modelVersion,
        pathCount: run.pathCount,
        seed: run.seed,
        stressPreset: (assumptions.stressPreset as string | null | undefined) ?? null,
      };
    },

    async run(payload: MonteCarloPayload, hooks: JobHooks): Promise<MonteCarloResult> {
      const input = toEngineInput(payload);

      await hooks.setStage('simulating');

      // 压力情景是确定性单路径，不分片也不需要分位数
      if (payload.stressPreset) {
        const preset = findPreset(payload.stressPreset);
        if (!preset) throw new Error(`未知的压力情景：${payload.stressPreset}`);
        await hooks.setStage('aggregating');
        return simulateStress(input, preset);
      }

      const batches: PathBatch[] = [];
      let cursor = 0;

      // 每轮最多占用一个时间预算窗口，到点立即让出事件循环
      while (cursor < input.pathCount) {
        if (await hooks.isCancelRequested()) throw new CancelSignal();
        if (hooks.isExpired()) throw new TimeoutSignal();

        const sliceStart = Date.now();

        do {
          const step = Math.min(input.pathCount, cursor + 25);
          batches.push(simulatePaths(input, cursor, step));
          cursor = step;

          if (Date.now() - sliceStart >= MONTE_CARLO_CHUNK_MS) break;
        } while (cursor < input.pathCount);

        await hooks.reportProgress(0.05 + (cursor / input.pathCount) * 0.8);
        await new Promise((resolve) => setImmediate(resolve));
      }

      await hooks.setStage('aggregating');
      return aggregatePaths(input, batches);
    },

    async persist(runId: string, result: MonteCarloResult): Promise<void> {
      await prisma.monteCarloRun.update({
        where: { id: runId },
        data: {
          result: serializeResult(result) as never,
          samplePaths: result.samplePaths.slice(0, MONTE_CARLO_SAMPLE_PATHS) as never,
        },
      });
    },

    async fail(runId: string, code: JobFailureCodeValue, message: string): Promise<void> {
      await prisma.monteCarloRun.updateMany({
        where: { id: runId, status: 'running' },
        data: {
          status: 'failed',
          stage: null,
          finishedAt: new Date(),
          failureCode: code,
          failureMessage: message.slice(0, 300),
          result: undefined,
        },
      });
    },
  };
}

export class CancelSignal extends Error {
  constructor() {
    super('运行已取消');
    this.name = 'CancelSignal';
  }
}

export class TimeoutSignal extends Error {
  constructor() {
    super('计算超过时限');
    this.name = 'TimeoutSignal';
  }
}

/** 从运行快照还原并重新校验引擎输入 */
export function toEngineInput(payload: MonteCarloPayload): MonteCarloInput {
  // 快照里的金额与比率以字符串保存，必须走同一个入口转成数值后再校验
  const normalized = normalizeScenario(toRawScenario(payload.assumptions));

  return {
    years: normalized.years,
    pathCount: normalized.pathCount,
    seed: payload.seed,
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
}

export { JobFailureCode };
