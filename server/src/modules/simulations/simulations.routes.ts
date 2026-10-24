import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { ok } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { requireAuth } from '../../plugins/auth.js';
import { simulate, type CompoundResult, type CompoundV2Input } from './compound.engine.js';
import {
  calculateSchema,
  solveSchema,
  compareSchema,
  saveScenarioSchema,
  scenarioIdSchema,
  updateScenarioSchema,
} from './simulations.schema.js';

type ScenarioRow = {
  id: string;
  name: string;
  principal: { toString(): string };
  contributionAmount: { toString(): string };
  contributionFrequency: string;
  contributionTiming: string;
  annualReturnRate: { toString(): string };
  years: number;
  inflationRate: { toString(): string };
  feeRate: { toString(): string };
  annualContributionIncrease: { toString(): string };
  withdrawalAmount: { toString(): string };
  withdrawalFrequency: string;
  withdrawalStartYear: number;
  taxRate: { toString(): string };
  modelVersion: string;
  createdAt: Date;
  updatedAt: Date;
};

const scenarioSelect = {
  id: true,
  name: true,
  principal: true,
  contributionAmount: true,
  contributionFrequency: true,
  contributionTiming: true,
  annualReturnRate: true,
  years: true,
  inflationRate: true,
  feeRate: true,
  annualContributionIncrease: true,
  withdrawalAmount: true,
  withdrawalFrequency: true,
  withdrawalStartYear: true,
  taxRate: true,
  modelVersion: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toEngineInput(row: ScenarioRow): CompoundV2Input {
  return {
    principal: row.principal.toString(),
    contributionAmount: row.contributionAmount.toString(),
    contributionFrequency: row.contributionFrequency as CompoundV2Input['contributionFrequency'],
    contributionTiming: row.contributionTiming as CompoundV2Input['contributionTiming'],
    annualReturnRate: row.annualReturnRate.toString(),
    years: row.years,
    inflationRate: row.inflationRate.toString(),
    feeRate: row.feeRate.toString(),
    annualContributionIncrease: row.annualContributionIncrease.toString(),
    withdrawalAmount: row.withdrawalAmount.toString(),
    withdrawalFrequency: row.withdrawalFrequency as CompoundV2Input['withdrawalFrequency'],
    withdrawalStartYear: row.withdrawalStartYear,
    taxRate: row.taxRate.toString(),
  };
}

/** 只透传用户实际提供的进阶参数，缺省交给引擎默认值 */
function advancedFields(body: {
  annualContributionIncrease?: string;
  withdrawalAmount?: string;
  withdrawalFrequency?: 'none' | 'monthly' | 'annual';
  withdrawalStartYear?: number;
  taxRate?: string;
}): Partial<CompoundV2Input> {
  return {
    ...(body.annualContributionIncrease !== undefined
      ? { annualContributionIncrease: body.annualContributionIncrease }
      : {}),
    ...(body.withdrawalAmount !== undefined ? { withdrawalAmount: body.withdrawalAmount } : {}),
    ...(body.withdrawalFrequency !== undefined ? { withdrawalFrequency: body.withdrawalFrequency } : {}),
    ...(body.withdrawalStartYear !== undefined ? { withdrawalStartYear: body.withdrawalStartYear } : {}),
    ...(body.taxRate !== undefined ? { taxRate: body.taxRate } : {}),
  };
}

function serializeScenario(row: ScenarioRow) {
  return {
    id: row.id,
    name: row.name,
    principal: row.principal.toString(),
    contributionAmount: row.contributionAmount.toString(),
    contributionFrequency: row.contributionFrequency,
    contributionTiming: row.contributionTiming,
    annualReturnRate: row.annualReturnRate.toString(),
    years: row.years,
    inflationRate: row.inflationRate.toString(),
    feeRate: row.feeRate.toString(),
    annualContributionIncrease: row.annualContributionIncrease.toString(),
    withdrawalAmount: row.withdrawalAmount.toString(),
    withdrawalFrequency: row.withdrawalFrequency,
    withdrawalStartYear: row.withdrawalStartYear,
    taxRate: row.taxRate.toString(),
    modelVersion: row.modelVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeResult(result: CompoundResult) {
  return {
    totalContributed: result.totalContributed.toString(),
    finalNominalValue: result.finalNominalValue.toString(),
    totalGain: result.totalGain.toString(),
    finalRealValue: result.finalRealValue.toString(),
    effectiveAnnualReturn: result.effectiveAnnualReturn.toString(),
    modelVersion: result.modelVersion,
    assumptions: result.assumptions,
    yearlySchedule: result.yearlySchedule.map((row) => ({
      year: row.year,
      contributedThisYear: row.contributedThisYear.toString(),
      totalContributed: row.totalContributed.toString(),
      nominalValue: row.nominalValue.toString(),
      realValue: row.realValue.toString(),
      cumulativeGain: row.cumulativeGain.toString(),
    })),
  };
}

export default async function simulationsRoutes(app: FastifyInstance) {
  app.get('/simulations/compound', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);

    const scenarios = await app.prisma.simulationScenario.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: scenarioSelect,
    });

    return ok({ scenarios: scenarios.map(serializeScenario) }, request.id);
  });

  app.post('/simulations/compound/calculate', { preHandler: app.authenticate }, async (request) => {
    const body = calculateSchema.parse(request.body);

    // 先试算一次再返回，任何参数问题都在这里暴露
    const result = simulate({
      principal: body.principal,
      contributionAmount: body.contributionAmount,
      contributionFrequency: body.contributionFrequency,
      contributionTiming: body.contributionTiming,
      annualReturnRate: body.annualReturnRate,
      years: body.years,
      inflationRate: body.inflationRate,
      feeRate: body.feeRate,
      ...advancedFields(body),
    });

    return ok({ result: serializeResult(result), input: body }, request.id);
  });

  /**
   * 目标反推：给定目标金额，二分求所需定期投入额或所需年限。
   * 迭代上限 60 次，精度按求解维度决定；不可达时返回 422 而不是无限循环。
   */
  app.post('/simulations/compound/solve', { preHandler: app.authenticate }, async (request) => {
    const body = solveSchema.parse(request.body);
    const advanced = advancedFields(body);

    const evaluate = (contributionAmount: string, years: number) =>
      simulate({
        principal: body.principal,
        contributionAmount,
        contributionFrequency: body.contributionFrequency,
        contributionTiming: body.contributionTiming,
        annualReturnRate: body.annualReturnRate,
        years,
        inflationRate: body.inflationRate,
        feeRate: body.feeRate,
        ...advanced,
      });

    const target = Number(body.targetAmount);
    const MAX_ITERATIONS = 60;

    if (body.solveFor === 'contribution') {
      const years = body.years;
      let low = 0;
      let high = Math.max(target, 1) * 2;
      let iterations = 0;

      // 先确认上界可达，否则无论投多少都到不了
      while (Number(evaluate(String(high), years).finalNominalValue) < target && iterations < MAX_ITERATIONS) {
        high *= 2;
        iterations += 1;
        if (high > 1e12) throw errors.solveUnreachable('在给定年限与收益率下，目标金额不可达');
      }

      for (; iterations < MAX_ITERATIONS; iterations += 1) {
        const mid = (low + high) / 2;
        const reached = Number(evaluate(mid.toFixed(2), years).finalNominalValue);
        if (reached >= target) high = mid;
        else low = mid;
        if (Math.abs(reached - target) < 0.01) break;
      }

      const required = high.toFixed(2);
      const actual = Number(evaluate(required, years).finalNominalValue);

      return ok(
        {
          solveFor: 'contribution',
          requiredContribution: required,
          years,
          targetAmount: body.targetAmount,
          actualValue: actual.toFixed(6),
          difference: (actual - target).toFixed(6),
          iterations: iterations + 1,
        },
        request.id,
      );
    }

    // 按年限反推：投入额固定，二分所需年数
    const contributionAmount = body.contributionAmount!;
    let low = 1;
    let high = Math.max(body.years, 1);
    let iterations = 0;

    while (Number(evaluate(contributionAmount, high).finalNominalValue) < target && iterations < MAX_ITERATIONS) {
      high *= 2;
      iterations += 1;
      if (high >= 100) throw errors.solveUnreachable('在给定投入下，100 年内目标不可达');
    }

    for (; iterations < MAX_ITERATIONS; iterations += 1) {
      const mid = Math.floor((low + high) / 2);
      const reached = Number(evaluate(contributionAmount, mid).finalNominalValue);
      if (reached >= target) high = mid;
      else low = mid;
      if (high - low <= 1) break;
    }

    const actual = Number(evaluate(contributionAmount, high).finalNominalValue);

    return ok(
      {
        solveFor: 'years',
        requiredYears: high,
        contributionAmount,
        targetAmount: body.targetAmount,
        actualValue: actual.toFixed(6),
        difference: (actual - target).toFixed(6),
        iterations: iterations + 1,
      },
      request.id,
    );
  });

  app.post('/simulations/compound/compare', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const body = compareSchema.parse(request.body);

    const entries: Array<{ label: string; input: CompoundV2Input }> = [];

    if (body.scenarioIds) {
      const scenarios = await app.prisma.simulationScenario.findMany({
        where: { userId, id: { in: body.scenarioIds } },
        select: scenarioSelect,
      });

      if (scenarios.length !== body.scenarioIds.length) {
        throw errors.notFound('部分场景不存在');
      }

      // 保持请求顺序，便于前端按顺序着色
      for (const id of body.scenarioIds) {
        const scenario = scenarios.find((item) => item.id === id)!;
        entries.push({ label: scenario.name, input: toEngineInput(scenario) });
      }
    } else if (body.params) {
      body.params.forEach((params, index) => {
        entries.push({
          label: `方案 ${index + 1}`,
          input: {
            principal: params.principal,
            contributionAmount: params.contributionAmount,
            contributionFrequency: params.contributionFrequency,
            contributionTiming: params.contributionTiming,
            annualReturnRate: params.annualReturnRate,
            years: params.years,
            inflationRate: params.inflationRate,
            feeRate: params.feeRate,
          },
        });
      });
    }

    const results = entries.map((entry) => {
      const result = simulate(entry.input);
      return {
        label: entry.label,
        finalNominalValue: result.finalNominalValue.toString(),
        totalContributed: result.totalContributed.toString(),
        totalGain: result.totalGain.toString(),
        yearSeries: result.yearlySchedule.map((row) => ({
          year: row.year,
          nominalValue: row.nominalValue.toString(),
        })),
      };
    });

    return ok({ comparisons: results }, request.id);
  });

  app.post('/simulations/compound', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = saveScenarioSchema.parse(request.body);

    const existing = await app.prisma.simulationScenario.findFirst({
      where: { userId, name: body.name },
      select: { id: true },
    });
    if (existing) throw errors.conflict('已存在同名场景');

    const scenario = await app.prisma.simulationScenario.create({
      data: {
        userId,
        name: body.name,
        principal: body.principal,
        contributionAmount: body.contributionAmount,
        contributionFrequency: body.contributionFrequency,
        contributionTiming: body.contributionTiming,
        annualReturnRate: body.annualReturnRate,
        years: body.years,
        inflationRate: body.inflationRate,
        feeRate: body.feeRate,
        annualContributionIncrease: body.annualContributionIncrease ?? '0',
        withdrawalAmount: body.withdrawalAmount ?? '0',
        withdrawalFrequency: body.withdrawalFrequency ?? 'none',
        withdrawalStartYear: body.withdrawalStartYear ?? 1,
        taxRate: body.taxRate ?? '0',
      },
      select: scenarioSelect,
    });

    return reply.status(201).send(ok({ scenario: serializeScenario(scenario) }, request.id));
  });

  app.get('/simulations/compound/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = scenarioIdSchema.parse(request.params);

    const scenario = await app.prisma.simulationScenario.findFirst({
      where: { id, userId },
      select: scenarioSelect,
    });
    if (!scenario) throw errors.notFound('场景不存在');

    // 结果不落库：参数确定则结果确定，读取时实时计算避免两者不一致
    // 按场景记录的版本重算：旧场景结果不得因引擎升级而改变
    const result = simulate(toEngineInput(scenario), scenario.modelVersion);

    return ok({ scenario: serializeScenario(scenario), result: serializeResult(result) }, request.id);
  });

  app.patch('/simulations/compound/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = scenarioIdSchema.parse(request.params);
    const body = updateScenarioSchema.parse(request.body);

    const existing = await app.prisma.simulationScenario.findFirst({ where: { id, userId } });
    if (!existing) throw errors.notFound('场景不存在');

    if (body.name && body.name !== existing.name) {
      const duplicate = await app.prisma.simulationScenario.findFirst({
        where: { userId, name: body.name, id: { not: id } },
        select: { id: true },
      });
      if (duplicate) throw errors.conflict('已存在同名场景');
    }

    const data: Prisma.SimulationScenarioUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.principal !== undefined) data.principal = body.principal;
    if (body.contributionAmount !== undefined) data.contributionAmount = body.contributionAmount;
    if (body.contributionFrequency !== undefined) data.contributionFrequency = body.contributionFrequency;
    if (body.contributionTiming !== undefined) data.contributionTiming = body.contributionTiming;
    if (body.annualReturnRate !== undefined) data.annualReturnRate = body.annualReturnRate;
    if (body.years !== undefined) data.years = body.years;
    if (body.inflationRate !== undefined) data.inflationRate = body.inflationRate;
    if (body.feeRate !== undefined) data.feeRate = body.feeRate;

    const scenario = await app.prisma.simulationScenario.update({
      where: { id },
      data,
      select: scenarioSelect,
    });

    // 按场景记录的版本重算：旧场景结果不得因引擎升级而改变
    const result = simulate(toEngineInput(scenario), scenario.modelVersion);

    return ok({ scenario: serializeScenario(scenario), result: serializeResult(result) }, request.id);
  });

  app.delete('/simulations/compound/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = scenarioIdSchema.parse(request.params);

    const deleted = await app.prisma.simulationScenario.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) throw errors.notFound('场景不存在');

    return ok({ deleted: true }, request.id);
  });

  app.post('/simulations/compound/:id/duplicate', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = scenarioIdSchema.parse(request.params);

    const source = await app.prisma.simulationScenario.findFirst({ where: { id, userId } });
    if (!source) throw errors.notFound('场景不存在');

    // 名称冲突时追加序号，避免复制失败打断用户流程
    let name = `${source.name} 副本`;
    let attempt = 2;
    while (await app.prisma.simulationScenario.findFirst({ where: { userId, name } })) {
      name = `${source.name} 副本 ${attempt}`;
      attempt += 1;
    }

    const scenario = await app.prisma.simulationScenario.create({
      data: {
        userId,
        name,
        principal: source.principal,
        contributionAmount: source.contributionAmount,
        contributionFrequency: source.contributionFrequency,
        contributionTiming: source.contributionTiming,
        annualReturnRate: source.annualReturnRate,
        years: source.years,
        inflationRate: source.inflationRate,
        feeRate: source.feeRate,
      },
      select: scenarioSelect,
    });

    return reply.status(201).send(ok({ scenario: serializeScenario(scenario) }, request.id));
  });
}
