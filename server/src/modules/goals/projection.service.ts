import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { errors } from '../../lib/errors.js';
import { moneyToString, toDecimal } from '../../lib/money.js';
import { MODEL_VERSION as COMPOUND_MODEL_VERSION } from '../simulations/compound.engine.js';
import { computeGoalProgress, toCoreInput } from './goal.service.js';

import { buildTimeline, solveEta, solveRequiredMonthly } from './projection.engine.js';

export interface ProjectionParams {
  expectedAnnualReturn?: string;
  monthlyContribution?: string;
  feeRate?: string;
  includeProbabilistic: boolean;
  maxRequiredMonthly: string;
}

export interface ProbabilisticMatch {
  runId: string;
  seed: number;
  pathCount: number;
  probability: string;
  p10: string;
  p50: string;
  p90: string;
  assumptionsDigest: string;
  matchedOn: 'target_amount_and_years';
}

export interface ProjectionView {
  goalId: string;
  asOf: string;
  targetAmount: string;
  currentAmount: string | null;
  deterministic: {
    projectedValue: string;
    requiredMonthly: string | null;
    etaMonths: number | null;
    etaDate: string | null;
    timeline: Array<{ month: string; value: string }>;
    feasible: boolean;
    basis: {
      engine: string;
      expectedAnnualReturn: string;
      monthlyContribution: string;
      inflationRate: string;
      feeRate: string;
      contributionTiming: string;
    };
  } | null;
  probabilistic: ProbabilisticMatch | null;
  matchedExpected: { targetAmount: string; years: number; currency: string } | null;
  unavailableReasons: string[];
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addMonthsKey(asOf: string, months: number): string {
  const [y, m] = asOf.split('-').map(Number) as [number, number];
  const total = m - 1 + months;
  return `${y + Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/**
 * 目标当前金额与调整后目标金额必须来自同一处计算，
 * 否则概率匹配会把"没调整通胀的目标"对到"调整后的运行"上。
 */
async function loadGoalContext(
  prisma: PrismaClient,
  userId: string,
  goalId: string,
  asOf: string,
) {
  const goal = await prisma.financialGoal.findFirst({ where: { id: goalId, userId } });
  if (!goal) throw errors.goalNotFound();

  const progress = await computeGoalProgress(prisma, { userId, goal, asOf });

  return { goal, progress, core: toCoreInput(goal) };
}

/**
 * 概率只取"目标金额、年限、币种三者都匹配"的最近一次成功运行。
 * 借用不匹配的运行会把 A 目标的概率贴到 B 目标上，这是产品事故，
 * 因此这里宁可返回 null 让前端引导用户去创建一次匹配的模拟。
 */
async function findMatchingRun(params: {
  prisma: PrismaClient;
  userId: string;
  targetAmount: string;
  years: number;
  currency: string;
}): Promise<ProbabilisticMatch | null> {
  const runs = await params.prisma.monteCarloRun.findMany({
    where: { userId: params.userId, status: 'succeeded' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      seed: true,
      pathCount: true,
      years: true,
      assumptions: true,
      result: true,
      // 币种记在方案上，不重复写进快照
      scenario: { select: { currency: true } },
    },
  });

  const target = new Decimal(params.targetAmount);

  for (const run of runs) {
    if (run.years !== params.years) continue;
    if (run.scenario.currency !== params.currency) continue;
    const assumptions = run.assumptions as Record<string, unknown>;
    const runTarget = assumptions.targetAmount;
    if (runTarget == null) continue;

    // 金额按 6 位小数比较：快照存的是字符串，必须统一解析后再比
    if (!new Decimal(String(runTarget)).eq(target)) continue;

    const result = run.result as Record<string, unknown> | null;
    if (!result) continue;

    const probabilities = result.probabilities as Record<string, unknown> | undefined;
    const terminal = result.terminal as Record<string, Record<string, unknown>> | undefined;
    const nominal = terminal?.nominal;

    if (probabilities?.target == null || !nominal) continue;

    return {
      runId: run.id,
      seed: run.seed,
      pathCount: run.pathCount,
      probability: String(probabilities.target),
      p10: String(nominal.p10),
      p50: String(nominal.p50),
      p90: String(nominal.p90),
      assumptionsDigest: `pathCount=${run.pathCount};years=${run.years};modelVersion=${String(assumptions.modelVersion ?? 'unknown')}`,
      matchedOn: 'target_amount_and_years',
    };
  }

  return null;
}

export async function projectGoal(
  prisma: PrismaClient,
  params: { userId: string; goalId: string; asOf: string; body: ProjectionParams },
): Promise<ProjectionView> {
  const { goal, progress, core } = await loadGoalContext(prisma, params.userId, params.goalId, params.asOf);

  const unavailableReasons: string[] = [];

  const expectedReturnText = params.body.expectedAnnualReturn ?? core.expectedAnnualReturn;
  const monthlyText = params.body.monthlyContribution ?? core.monthlyContribution;
  const feeRate = toDecimal(params.body.feeRate ?? '0');
  const inflation = toDecimal(core.inflationRate ?? '0');

  const yearsRemaining = progress.monthsRemaining === null ? null : progress.monthsRemaining / 12;
  const matchedExpected =
    yearsRemaining === null
      ? null
      : {
          targetAmount: progress.targetAmount,
          years: Math.max(1, Math.ceil(yearsRemaining)),
          currency: goal.currency,
        };

  if (!progress.currentAmount) {
    unavailableReasons.push(progress.funding.unavailableReason ?? 'funding_unavailable');
  }

  if (expectedReturnText === null) {
    unavailableReasons.push('no_expected_return');
  }

  let deterministic: ProjectionView['deterministic'] = null;

  if (expectedReturnText !== null && progress.currentAmount !== null) {
    const expectedReturn = toDecimal(expectedReturnText);
    const currentAmount = toDecimal(progress.currentAmount);
    const targetAmount = toDecimal(progress.targetAmount);
    const months = progress.monthsRemaining;

    // 无期限目标：用最大预测跨度做外推，仅用于展示曲线
    const horizonMonths = months === null ? 120 : months;

    const eta = solveEta({
      targetAmount,
      currentAmount,
      monthlyContribution: toDecimal(monthlyText ?? '0'),
      annualReturn: expectedReturn,
      inflationRate: inflation,
      feeRate,
    });

    const required =
      months === null
        ? { requiredMonthly: null, infeasible: false, reason: null }
        : solveRequiredMonthly({
            targetAmount,
            currentAmount,
            months,
            annualReturn: expectedReturn,
            inflationRate: inflation,
            feeRate,
            maxMonthly: toDecimal(params.body.maxRequiredMonthly),
          });

    const etaMonths = eta.etaMonths ?? horizonMonths;
    const timeline = buildTimeline({
      startMonth: params.asOf.slice(0, 7),
      currentAmount,
      monthlyContribution: toDecimal(monthlyText ?? '0'),
      annualReturn: expectedReturn,
      inflationRate: inflation,
      feeRate,
      months: Math.min(etaMonths, 600),
    });

    const projectedValue = timeline.length > 0 ? timeline[timeline.length - 1]!.value : moneyToString(currentAmount);

    deterministic = {
      projectedValue,
      requiredMonthly: required.requiredMonthly ? moneyToString(required.requiredMonthly) : null,
      etaMonths: eta.etaMonths,
      etaDate: eta.etaMonths === null ? null : addMonthsKey(params.asOf.slice(0, 7), eta.etaMonths),
      timeline,
      feasible: !required.infeasible && eta.etaMonths !== null,
      basis: {
        engine: COMPOUND_MODEL_VERSION,
        expectedAnnualReturn: expectedReturn.toFixed(6),
        monthlyContribution: toDecimal(monthlyText ?? '0').toFixed(6),
        inflationRate: inflation.toFixed(6),
        feeRate: feeRate.toFixed(6),
        contributionTiming: 'end',
      },
    };

    if (required.infeasible && required.reason) unavailableReasons.push(required.reason);
  }

  let probabilistic: ProbabilisticMatch | null = null;

  if (params.body.includeProbabilistic && matchedExpected) {
    probabilistic = await findMatchingRun({
      prisma,
      userId: params.userId,
      targetAmount: matchedExpected.targetAmount,
      years: matchedExpected.years,
      currency: matchedExpected.currency,
    });

    if (!probabilistic) unavailableReasons.push('no_matching_run');
  }

  if (matchedExpected === null) unavailableReasons.push('no_target_date');

  return {
    goalId: goal.id,
    asOf: params.asOf,
    targetAmount: progress.targetAmount,
    currentAmount: progress.currentAmount,
    deterministic,
    probabilistic,
    matchedExpected,
    unavailableReasons,
  };
}

export { dayKey };
