import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { ok } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { requireAuth } from '../../plugins/auth.js';
import { simulate, type CompoundInput, type CompoundResult } from './compound.engine.js';
import {
  calculateSchema,
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
  modelVersion: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toEngineInput(row: ScenarioRow): CompoundInput {
  return {
    principal: row.principal.toString(),
    contributionAmount: row.contributionAmount.toString(),
    contributionFrequency: row.contributionFrequency as CompoundInput['contributionFrequency'],
    contributionTiming: row.contributionTiming as CompoundInput['contributionTiming'],
    annualReturnRate: row.annualReturnRate.toString(),
    years: row.years,
    inflationRate: row.inflationRate.toString(),
    feeRate: row.feeRate.toString(),
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
    });

    return ok({ result: serializeResult(result), input: body }, request.id);
  });

  app.post('/simulations/compound/compare', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const body = compareSchema.parse(request.body);

    const entries: Array<{ label: string; input: CompoundInput }> = [];

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
    const result = simulate(toEngineInput(scenario));

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

    const result = simulate(toEngineInput(scenario));

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
