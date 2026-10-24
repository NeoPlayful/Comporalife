/**
 * 模拟方案与运行结果的导出。
 * 与报表导出分开注册：这里不落快照，数据来自模拟表本身。
 * 导出文件首行必须带 modelVersion 与 seed——脱离这两项，结果无法解读。
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ok } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { requireAuth } from '../../plugins/auth.js';
import { buildCsv, contentDisposition, sanitizeFilename, type CsvSection } from '../reports/export.serialize.js';
import { simulate, type CompoundInput } from './compound.engine.js';

const idSchema = z.object({ id: z.string().uuid() });
const runSchema = z.object({ id: z.string().uuid(), runId: z.string().uuid() });

function sendCsv(
  reply: { headers: (values: Record<string, string>) => { send: (body: string) => unknown } },
  sections: CsvSection[],
  ascii: string,
  utf8: string,
) {
  return reply
    .headers({
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': contentDisposition(ascii, utf8),
      'cache-control': 'no-store',
    })
    .send(buildCsv(sections));
}

export default async function simulationExportRoutes(app: FastifyInstance) {
  // 复利方案导出：年度明细 + 口径
  app.get('/simulations/compound/:id/export', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = idSchema.parse(request.params);

    const scenario = await app.prisma.simulationScenario.findFirst({ where: { id, userId } });
    if (!scenario) throw errors.notFound('场景不存在');

    const result = simulate({
      principal: scenario.principal.toString(),
      contributionAmount: scenario.contributionAmount.toString(),
      contributionFrequency: scenario.contributionFrequency,
      contributionTiming: scenario.contributionTiming,
      annualReturnRate: scenario.annualReturnRate.toString(),
      years: scenario.years,
      inflationRate: scenario.inflationRate.toString(),
      feeRate: scenario.feeRate.toString(),
    } as CompoundInput);

    const sections: CsvSection[] = [
      {
        title: '复利方案',
        header: ['参数', '值'],
        rows: [
          ['名称', scenario.name],
          ['模型版本', result.modelVersion],
          ['初始本金', scenario.principal.toFixed(6)],
          ['定期投入', scenario.contributionAmount.toFixed(6)],
          ['投入频率', scenario.contributionFrequency],
          ['投入时点', scenario.contributionTiming],
          ['年化收益', scenario.annualReturnRate.toFixed(6)],
          ['年限', scenario.years],
          ['通胀率', scenario.inflationRate.toFixed(6)],
          ['费用率', scenario.feeRate.toFixed(6)],
          ['期末名义值', result.finalNominalValue.toFixed(6)],
          ['期末实际值', result.finalRealValue.toFixed(6)],
          ['累计投入', result.totalContributed.toFixed(6)],
        ],
      },
      {
        title: '年度明细',
        header: ['年度', '当年投入', '累计投入', '名义值', '实际值', '累计收益'],
        rows: result.yearlySchedule.map((row) => [
          row.year,
          row.contributedThisYear.toFixed(6),
          row.totalContributed.toFixed(6),
          row.nominalValue.toFixed(6),
          row.realValue.toFixed(6),
          row.cumulativeGain.toFixed(6),
        ]),
      },
    ];

    const ascii = sanitizeFilename(`compound-${scenario.name}`).replace(/[^\x20-\x7e]/g, '-') + '.csv';
    const utf8 = sanitizeFilename(`${scenario.name}-复利模拟.csv`);

    return sendCsv(reply, sections, ascii, utf8);
  });

  // 蒙特卡罗运行导出：首区块即模型版本与种子
  app.get(
    '/simulations/monte-carlo/:id/runs/:runId/export',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { userId } = requireAuth(request);
      const { id, runId } = runSchema.parse(request.params);

      const run = await app.prisma.monteCarloRun.findFirst({ where: { id: runId, scenarioId: id, userId } });
      if (!run) throw errors.mcRunNotFound();

      if (run.status !== 'succeeded' || !run.result) throw errors.mcRunFailed();

      const result = run.result as Record<string, unknown>;
      const assumptions = run.assumptions as Record<string, unknown>;
      const terminal = (result.terminal ?? {}) as Record<string, Record<string, unknown>>;
      const probabilities = (result.probabilities ?? {}) as Record<string, unknown>;
      const drawdown = (result.drawdown ?? {}) as Record<string, unknown>;

      const sections: CsvSection[] = [
        {
          title: '可复现信息（缺失则结果无法解读）',
          header: ['项目', '值'],
          rows: [
            ['modelVersion', run.modelVersion],
            ['seed', run.seed],
            ['scenarioName', run.scenarioName],
            ['pathCount', run.pathCount],
            ['years', run.years],
            ['returnModel', String(assumptions.returnModel ?? '')],
            ['deterministic', String(result.deterministic ?? false)],
          ],
        },
        {
          title: '终值分位数（名义）',
          header: ['分位', '金额'],
          rows: Object.entries(terminal.nominal ?? {}).map(([key, value]) => [key, String(value)]),
        },
        {
          title: '终值分位数（实际）',
          header: ['分位', '金额'],
          rows: Object.entries(terminal.real ?? {}).map(([key, value]) => [key, String(value)]),
        },
        {
          title: '概率',
          header: ['指标', '值'],
          rows: [
            ['亏损概率', String(probabilities.loss ?? '')],
            ['实际亏损概率', String(probabilities.realLoss ?? '')],
            ['达标概率', probabilities.target === null ? '' : String(probabilities.target)],
            ['破产概率', String(probabilities.ruin ?? '')],
          ],
        },
        {
          title: '最大回撤',
          header: ['分位', '值'],
          rows: Object.entries(drawdown).map(([key, value]) => [key, String(value)]),
        },
        {
          title: '参数快照',
          header: ['项目', '值'],
          rows: [
            ['initialValue', String(assumptions.initialValue ?? '')],
            ['inflationRate', String(assumptions.inflationRate ?? '')],
            ['feeRate', String(assumptions.feeRate ?? '')],
            ['rebalance', String(assumptions.rebalance ?? '')],
            ['targetAmount', assumptions.targetAmount === null ? '' : String(assumptions.targetAmount ?? '')],
            ['stressPreset', String(assumptions.stressPreset ?? '')],
          ],
        },
        {
          title: '说明',
          header: ['项目', '内容'],
          rows: [
            ['免责声明', 'simulation_not_forecast'],
            ['口径', 'results_require_model_version_and_seed'],
          ],
        },
      ];

      const ascii = `monte-carlo-${run.id.slice(0, 8)}-seed${run.seed}.csv`;
      const utf8 = sanitizeFilename(`${run.scenarioName}-模拟结果-${run.seed}.csv`);

      return sendCsv(reply, sections, ascii, utf8);
    },
  );

  // 方案导出为 JSON：参数 + 最近运行摘要，便于迁移与复现
  app.get('/simulations/monte-carlo/:id/export', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = idSchema.parse(request.params);

    const scenario = await app.prisma.monteCarloScenario.findFirst({
      where: { id, userId },
      include: {
        runs: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            status: true,
            seed: true,
            pathCount: true,
            years: true,
            modelVersion: true,
            createdAt: true,
            finishedAt: true,
          },
        },
      },
    });

    if (!scenario) throw errors.mcScenarioNotFound();

    return ok(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        scenario: {
          name: scenario.name,
          currency: scenario.currency,
          years: scenario.years,
          pathCount: scenario.pathCount,
          rebalance: scenario.rebalance,
          returnModel: scenario.returnModel,
          modelVersion: scenario.modelVersion,
          assets: scenario.assets,
          correlation: scenario.correlation,
          settings: scenario.settings,
          note: scenario.note,
        },
        recentRuns: scenario.runs,
        note: 'result_requires_model_version_and_seed',
      },
      request.id,
    );
  });
}
