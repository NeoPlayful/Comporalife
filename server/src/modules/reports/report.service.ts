import Decimal from 'decimal.js';
import type { PrismaClient, ReportType } from '@prisma/client';
import {
  ANALYTICS_MAX_RANGE_DAYS,
  REPORT_MAX_ROWS,
  REPORT_RETENTION,
} from '../../config/constants.js';
import { errors } from '../../lib/errors.js';
import { moneyToString, toDecimal } from '../../lib/money.js';
import { getUserAnalyticsContext, getCategoryAnalytics, getMerchants } from '../analytics/analytics.service.js';
import { computeCashflow } from '../analytics/cashflow.service.js';
import { resolveRate } from '../currencies/currency.service.js';
import { computeNetWorth } from '../analytics/networth.service.js';
import { loadAnalyticsRows } from '../analytics/query.service.js';
import { computeGoalProgress } from '../goals/goal.service.js';
import { computeAllocation } from '../portfolios/analytics.service.js';
import { computeReturns } from '../portfolios/analytics.service.js';
import { loadAllPortfolioValuations } from '../portfolios/valuation.service.js';
import { MODEL_VERSION as COMPOUND_MODEL_VERSION } from '../simulations/compound.engine.js';
import { MODEL_VERSION as MONTE_CARLO_MODEL_VERSION } from '../simulations/monte-carlo/monte-carlo.engine.js';
import type { ReportBasis, ReportPayload } from './report.types.js';

const DAY_MS = 86_400_000;

function dayDiff(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

function dayKey(value: string | Date): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/** 区间必须合法且不超过分析层上限，否则同一份数据在不同页面会被切成不同粒度 */
export function assertRange(from: string, to: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw errors.reportParametersInvalid('日期格式应为 YYYY-MM-DD');
  }
  if (from > to) throw errors.reportParametersInvalid('起始日期不能晚于结束日期');

  const days = dayDiff(from, to);
  if (days > ANALYTICS_MAX_RANGE_DAYS) {
    throw errors.reportRangeInvalid(`统计区间不得超过 ${ANALYTICS_MAX_RANGE_DAYS} 天`);
  }
}

function emptyCompleteness() {
  return {
    isComplete: true,
    missingMonths: [] as string[],
    missingRates: [] as string[],
    staleValuations: [] as Array<{ portfolioId: string; priceDate: string | null }>,
    unpricedSymbols: [] as string[],
  };
}

function buildBasis(params: {
  from: string;
  to: string;
  currency: string;
  accountCount: number;
  completeness: ReturnType<typeof emptyCompleteness>;
  modelVersions: Record<string, string>;
  notes?: string[];
}): ReportBasis {
  return {
    range: { from: params.from, to: params.to },
    currency: params.currency,
    rateDates: [params.to],
    accountScope: { mode: 'all', accounts: params.accountCount, excluded: [] },
    completeness: params.completeness,
    modelVersions: params.modelVersions,
    generatedAt: new Date().toISOString(),
    notes: params.notes ?? [],
  };
}

interface BuildContext {
  prisma: PrismaClient;
  userId: string;
  timezone: string;
  baseCurrency: string;
  from: string;
  to: string;
}

/** 各类型报表的构建：只读，不写任何业务表 */
async function buildNetWorth(ctx: BuildContext) {
  const asOf = new Date(`${ctx.to}T23:59:59.999Z`);
  const netWorth = await computeNetWorth(ctx.prisma, {
    userId: ctx.userId,
    baseCurrency: ctx.baseCurrency,
    asOf,
  });

  const accounts = await ctx.prisma.account.findMany({
    where: { userId: ctx.userId, status: 'active' },
    select: { id: true, name: true, type: true, currency: true },
    orderBy: { createdAt: 'asc' },
  });

  const { computeBalances } = await import('../accounts/balance.service.js');
  const balances = await computeBalances(ctx.prisma, {
    userId: ctx.userId,
    accountIds: accounts.map((account) => account.id),
    asOf,
  });

  const valuations = await loadAllPortfolioValuations(ctx.prisma, { userId: ctx.userId, asOf });

  const completeness = emptyCompleteness();
  completeness.missingRates = netWorth.missingPairs.map((pair) => `${pair}@${ctx.to}`);
  completeness.staleValuations = netWorth.staleValuations.map((item) => ({
    portfolioId: item.portfolioId,
    priceDate: item.priceDate,
  }));
  completeness.unpricedSymbols = netWorth.unpriced.flatMap((item) => item.symbols);

  // 明细行的折算必须与合计行同口径，否则「明细之和 ≠ 合计」
  const convertedByAccount = new Map<string, Decimal>();
  const rateCache = new Map<string, Decimal | null>();

  for (const account of accounts) {
    const balance = balances.get(account.id) ?? toDecimal(0);
    if (account.currency === ctx.baseCurrency) {
      convertedByAccount.set(account.id, balance);
      continue;
    }

    let rate = rateCache.get(account.currency);
    if (rate === undefined) {
      const resolved = await resolveRate(ctx.prisma, {
        from: account.currency,
        to: ctx.baseCurrency,
        asOf,
      });
      rate = resolved ? resolved.rate : null;
      rateCache.set(account.currency, rate);
    }

    if (rate === null) {
      const pair = `${account.currency}->${ctx.baseCurrency}@${ctx.to}`;
      if (!completeness.missingRates.includes(pair)) completeness.missingRates.push(pair);
      continue;
    }

    convertedByAccount.set(account.id, balance.mul(rate));
  }

  completeness.isComplete =
    completeness.missingRates.length === 0 &&
    completeness.staleValuations.length === 0 &&
    completeness.unpricedSymbols.length === 0;

  const data = {
    asOf: ctx.to,
    accounts: accounts.map((account) => {
      const balance = balances.get(account.id) ?? toDecimal(0);
      const baseBalance = convertedByAccount.get(account.id);
      return {
        accountId: account.id,
        name: account.name,
        type: account.type,
        currency: account.currency,
        balance: moneyToString(balance),
        // 缺汇率时留空，不能用原币冒充基准币种金额
        baseBalance: baseBalance === undefined ? null : moneyToString(baseBalance),
        isLiability: account.type === 'credit_card' || account.type === 'loan',
      };
    }),
    securities: valuations.map((item) => ({
      portfolioId: item.portfolioId,
      name: item.name,
      marketValue: moneyToString(item.marketValue),
      priceDate: item.priceDate,
      isStale: item.stale,
    })),
    totals: {
      assets: moneyToString(netWorth.totalAssets),
      liabilities: moneyToString(netWorth.totalLiabilities),
      netWorth: moneyToString(netWorth.netWorth),
      securitiesValue: moneyToString(netWorth.securitiesValue),
    },
  };

  return {
    data,
    rowCount: accounts.length + valuations.length,
    completeness: {
      ...completeness,
      staleValuations: completeness.staleValuations,
    },
  };
}

async function buildCashflow(ctx: BuildContext) {
  const cashflow = await computeCashflow(ctx.prisma, {
    userId: ctx.userId,
    timezone: ctx.timezone,
    baseCurrency: ctx.baseCurrency,
    from: new Date(`${ctx.from}T00:00:00.000Z`),
    to: new Date(`${ctx.to}T23:59:59.999Z`),
  });

  const missingMonths = cashflow.points.filter((point) => !point.isComplete).map((point) => point.period);

  const completeness = emptyCompleteness();
  completeness.missingMonths = missingMonths;
  completeness.missingRates = cashflow.missingRates.map((pair) => `${pair}@${ctx.to}`);
  completeness.isComplete = missingMonths.length === 0 && completeness.missingRates.length === 0;

  return {
    data: {
      points: cashflow.points.map((point) => ({
        period: point.period,
        income: moneyToString(point.income),
        expense: moneyToString(point.expense),
        net: moneyToString(point.net),
        isComplete: point.isComplete,
      })),
      totals: {
        income: moneyToString(cashflow.totalIncome),
        expense: moneyToString(cashflow.totalExpense),
        net: moneyToString(cashflow.totalNet),
        savingsRate: cashflow.savingsRate === null ? null : cashflow.savingsRate.toFixed(6),
      },
      transferTotal: moneyToString(cashflow.transferTotal),
    },
    rowCount: cashflow.points.length,
    completeness,
  };
}

async function buildAnalytics(ctx: BuildContext) {
  const context = { userId: ctx.userId, timezone: ctx.timezone, baseCurrency: ctx.baseCurrency };

  const [expenses, incomes, merchants] = await Promise.all([
    getCategoryAnalytics(ctx.prisma, context, { fromText: ctx.from, toText: ctx.to, kind: 'expense', level: 1, previous: false }),
    getCategoryAnalytics(ctx.prisma, context, { fromText: ctx.from, toText: ctx.to, kind: 'income', level: 1, previous: false }),
    getMerchants(ctx.prisma, context, ctx.from, ctx.to, 50),
  ]);

  const completeness = emptyCompleteness();
  // 覆盖率不足说明存在未分类流水，报表必须把它显式标成不完整
  const expenseCoverage = expenses.coverage as unknown as { categorizedRatio?: string };
  if (expenseCoverage?.categorizedRatio && Number(expenseCoverage.categorizedRatio) < 1) {
    completeness.isComplete = false;
  }

  return {
    data: {
      byCategory: {
        expense: expenses.items.map((item) => ({
          categoryId: item.categoryId,
          name: item.name,
          kind: 'expense',
          amount: item.amount,
          share: item.ratio,
          count: item.count,
        })),
        income: incomes.items.map((item) => ({
          categoryId: item.categoryId,
          name: item.name,
          kind: 'income',
          amount: item.amount,
          share: item.ratio,
          count: item.count,
        })),
      },
      byMerchant: merchants.items.map((item) => ({
        merchant: item.merchant,
        amount: item.amount,
        count: item.count,
      })),
      uncategorized: {
        count: merchants.unattributed.count,
        amount: merchants.unattributed.amount,
      },
      coverage: {
        expenseCategorizedRatio: expenseCoverage?.categorizedRatio ?? null,
      },
    },
    rowCount: expenses.items.length + incomes.items.length + merchants.items.length,
    completeness,
  };
}

async function buildInvestment(ctx: BuildContext) {
  const portfolios = await ctx.prisma.portfolio.findMany({
    where: { userId: ctx.userId, status: 'active' },
    select: { id: true, name: true, currency: true },
    orderBy: { createdAt: 'asc' },
  });

  const asOf = new Date(`${ctx.to}T23:59:59.999Z`);
  const valuations = await loadAllPortfolioValuations(ctx.prisma, { userId: ctx.userId, asOf });

  const completeness = emptyCompleteness();
  const rows: Array<Record<string, unknown>> = [];

  for (const portfolio of portfolios) {
    const valuation = valuations.find((item) => item.portfolioId === portfolio.id);

    let twr: { value: Decimal | null; reason: string | null } = { value: null, reason: 'not_available' };
    let xirr: { value: Decimal | null; reason: string | null } = { value: null, reason: 'not_available' };

    try {
      const returns = await computeReturns(ctx.prisma, {
        userId: ctx.userId,
        portfolioId: portfolio.id,
        timezone: ctx.timezone,
        fromText: ctx.from,
        toText: ctx.to,
      });
      twr = returns.twr;
      xirr = returns.xirr;
      if (!returns.isComplete) completeness.isComplete = false;
    } catch {
      // 单个组合收益不可计算不影响整份报表，原因码会写进该行
    }

    if (valuation?.stale) {
      completeness.staleValuations.push({ portfolioId: portfolio.id, priceDate: valuation.priceDate });
      completeness.isComplete = false;
    }
    for (const symbol of valuation?.missingSymbols ?? []) {
      if (!completeness.unpricedSymbols.includes(symbol)) completeness.unpricedSymbols.push(symbol);
    }

    rows.push({
      portfolioId: portfolio.id,
      name: portfolio.name,
      currency: portfolio.currency,
      marketValue: moneyToString(valuation?.marketValue ?? toDecimal(0)),
      twr: twr.value === null ? null : twr.value.toFixed(6),
      twrUnavailableReason: twr.value === null ? twr.reason : null,
      xirr: xirr.value === null ? null : xirr.value.toFixed(6),
      xirrUnavailableReason: xirr.value === null ? xirr.reason : null,
      valuationDate: valuation?.priceDate ?? null,
      isStale: valuation?.stale ?? false,
    });
  }

  if (completeness.unpricedSymbols.length > 0) completeness.isComplete = false;

  // 配置按资产类别汇总到用户维度，而不是每个组合各自一张表
  const allocationMap = new Map<string, Decimal>();
  for (const portfolio of portfolios) {
    try {
      const allocation = await computeAllocation(ctx.prisma, {
        userId: ctx.userId,
        portfolioId: portfolio.id,
        dimension: 'asset_class',
      });
      for (const item of allocation.items) {
        allocationMap.set(item.key, (allocationMap.get(item.key) ?? toDecimal(0)).plus(item.value));
      }
    } catch {
      // 单个组合无法计算配置时跳过，不影响其他组合
    }
  }

  const allocationTotal = [...allocationMap.values()].reduce((sum, value) => sum.plus(value), toDecimal(0));

  const allocation = [...allocationMap.entries()].map(([key, value]) => ({
    dimension: 'asset_class',
    key,
    marketValue: moneyToString(value),
    weight: allocationTotal.isZero() ? null : value.div(allocationTotal).toFixed(6),
  }));

  return {
    data: {
      portfolios: rows,
      allocation,
    },
    rowCount: rows.length + allocation.length,
    completeness,
  };
}

async function buildGoals(ctx: BuildContext) {
  const goals = await ctx.prisma.financialGoal.findMany({
    where: { userId: ctx.userId, status: { in: ['active', 'achieved'] } },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });

  const rows: Array<Record<string, unknown>> = [];
  let totalGap = toDecimal(0);
  let requiredMonthlyTotal = toDecimal(0);

  for (const goal of goals) {
    // 进度一律按报表的截止日重算，保证"这份报表里写的进度"可复现
    const progress = await computeGoalProgress(ctx.prisma, { userId: ctx.userId, goal, asOf: ctx.to });

    const row = {
      goalId: goal.id,
      name: goal.name,
      type: goal.type,
      currency: goal.currency,
      targetAmount: progress.targetAmount,
      currentAmount: progress.currentAmount,
      progress: progress.progress,
      gap: progress.gap,
      isAchieved: progress.isAchieved,
      achievedAt: progress.achievedAt,
      etaMonths: null,
      requiredMonthly: goal.monthlyContribution ? moneyToString(goal.monthlyContribution) : null,
      probability: null as string | null,
      probabilityUnavailableReason: 'no_matching_run' as string | null,
    };

    if (progress.gap) totalGap = totalGap.plus(progress.gap);
    if (goal.monthlyContribution) requiredMonthlyTotal = requiredMonthlyTotal.plus(goal.monthlyContribution.toString());

    rows.push(row);
  }

  return {
    data: {
      goals: rows,
      summary: {
        activeCount: rows.length,
        totalGap: moneyToString(totalGap),
        requiredMonthlyTotal: moneyToString(requiredMonthlyTotal),
      },
    },
    rowCount: rows.length,
    completeness: emptyCompleteness(),
  };
}

async function buildSimulation(ctx: BuildContext) {
  const compounds = await ctx.prisma.simulationScenario.findMany({
    where: { userId: ctx.userId },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });

  const runs = await ctx.prisma.monteCarloRun.findMany({
    where: { userId: ctx.userId, status: 'succeeded' },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      scenarioName: true,
      seed: true,
      pathCount: true,
      years: true,
      modelVersion: true,
      result: true,
    },
  });

  // 模拟与真实必须在结构上分开，且各自带模型版本与免责声明键
  const data = {
    compound: compounds.map((scenario) => ({
      scenarioId: scenario.id,
      name: scenario.name,
      years: scenario.years,
      annualReturnRate: scenario.annualReturnRate.toFixed(6),
      modelVersion: scenario.modelVersion,
    })),
    monteCarlo: runs.map((run) => {
      const result = (run.result ?? {}) as Record<string, unknown>;
      const terminal = (result.terminal ?? {}) as Record<string, Record<string, unknown>>;
      const probabilities = (result.probabilities ?? {}) as Record<string, unknown>;

      return {
        runId: run.id,
        scenarioName: run.scenarioName,
        seed: run.seed,
        pathCount: run.pathCount,
        years: run.years,
        terminal: {
          p10: terminal.nominal?.p10 ?? null,
          p50: terminal.nominal?.p50 ?? null,
          p90: terminal.nominal?.p90 ?? null,
        },
        probabilities: {
          loss: probabilities.loss ?? null,
          target: probabilities.target ?? null,
          ruin: probabilities.ruin ?? null,
        },
        modelVersion: run.modelVersion,
        resultDisclaimer: 'simulation_not_forecast',
      };
    }),
  };

  return {
    data,
    rowCount: compounds.length + runs.length,
    completeness: emptyCompleteness(),
  };
}

const BUILDERS: Record<
  ReportType,
  (ctx: BuildContext) => Promise<{
    data: Record<string, unknown>;
    rowCount: number;
    completeness: ReturnType<typeof emptyCompleteness>;
  }>
> = {
  net_worth: buildNetWorth,
  cashflow: buildCashflow,
  analytics: buildAnalytics,
  investment: buildInvestment,
  goals: buildGoals,
  simulation: buildSimulation,
};

export const REPORT_TYPE_KEYS = Object.keys(BUILDERS) as ReportType[];

const DEFAULT_TITLES: Record<ReportType, string> = {
  net_worth: '资产负债报表',
  cashflow: '现金流量报表',
  analytics: '收支分析报表',
  investment: '投资绩效报表',
  goals: '目标进度报表',
  simulation: '模拟分析报表',
};

export async function generateReport(
  prisma: PrismaClient,
  params: {
    userId: string;
    type: ReportType;
    from: string;
    to: string;
    title?: string | null;
    params?: Record<string, unknown>;
  },
): Promise<ReportPayload> {
  const builder = BUILDERS[params.type];
  if (!builder) throw errors.reportTypeUnsupported(String(params.type));

  assertRange(params.from, params.to);

  const context = await getUserAnalyticsContext(prisma, params.userId);

  const ctx: BuildContext = {
    prisma,
    userId: params.userId,
    timezone: context.timezone,
    baseCurrency: context.baseCurrency,
    from: params.from,
    to: params.to,
  };

  const { data, rowCount, completeness } = await builder(ctx);

  if (rowCount > REPORT_MAX_ROWS) throw errors.reportTooLarge(rowCount, REPORT_MAX_ROWS);

  const accountCount = await prisma.account.count({ where: { userId: params.userId, status: 'active' } });

  const modelVersions: Record<string, string> = {
    compound: COMPOUND_MODEL_VERSION,
    monteCarlo: MONTE_CARLO_MODEL_VERSION,
  };

  const basis = buildBasis({
    from: params.from,
    to: params.to,
    currency: context.baseCurrency,
    accountCount,
    completeness,
    modelVersions,
    notes:
      params.type === 'simulation'
        ? ['simulation_results_are_not_forecasts', 'real_and_simulated_are_separated']
        : ['transfers_investments_and_adjustments_excluded'],
  });

  return {
    type: params.type,
    title: (params.title ?? DEFAULT_TITLES[params.type]).slice(0, 120),
    rangeFrom: params.from,
    rangeTo: params.to,
    params: params.params ?? {},
    basis,
    data,
    rowCount,
    modelVersions,
  };
}

/** 保留策略：每用户只留最新 N 份，且只删 reports 行 */
export async function pruneReports(prisma: PrismaClient, userId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const stale = await tx.report.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
      skip: REPORT_RETENTION,
    });

    if (stale.length === 0) return 0;

    const deleted = await tx.report.deleteMany({ where: { id: { in: stale.map((item) => item.id) } } });
    return deleted.count;
  });
}

/** 分析层取数在报表里只用来算行数上限，避免重复查询大表 */
export async function estimateAnalyticsRows(
  prisma: PrismaClient,
  params: { userId: string; from: string; to: string; timezone: string; baseCurrency: string },
): Promise<number> {
  const result = await loadAnalyticsRows(prisma, {
    userId: params.userId,
    fromText: params.from,
    toText: params.to,
    timezone: params.timezone,
    baseCurrency: params.baseCurrency,
  });
  return result.rows.length;
}

export { dayKey, buildBasis, emptyCompleteness, DEFAULT_TITLES };
