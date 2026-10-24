import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { GOAL_HISTORY_MAX_MONTHS } from '../../config/constants.js';
import { moneyToString, roundMoney, toDecimal } from '../../lib/money.js';
import { computeBalances } from '../accounts/balance.service.js';
import { computeNetWorth } from '../analytics/networth.service.js';
import { loadAllPortfolioValuations } from '../portfolios/valuation.service.js';
import { computeProgress, findFirstAchieved, type GoalCoreInput, type GoalCurvePoint } from './goal.engine.js';

export interface GoalFundingView {
  source: 'net_worth' | 'account' | 'portfolio';
  accountId: string | null;
  portfolioId: string | null;
  /** 绑定对象不可用时为 false，此时当前金额必然为 null */
  available: boolean;
  unavailableReason: string | null;
}

export interface GoalAmountResult {
  available: boolean;
  unavailableReason: string | null;
  /** 绑定口径下的"持有金额"，已折算目标币种 */
  amount: Decimal | null;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function monthEndKey(year: number, monthIndex: number): string {
  // monthIndex 为 0 基；下个月 0 号即本月最后一天
  const d = new Date(Date.UTC(year, monthIndex + 1, 0));
  return dayKey(d);
}

export function monthStartKey(year: number, monthIndex: number): string {
  return dayKey(new Date(Date.UTC(year, monthIndex, 1)));
}

function asOfDate(text: string): Date {
  return new Date(`${text}T23:59:59.999Z`);
}

/**
 * 按绑定口径取"目标当前持有金额"。
 * 三种口径与净资产/账户/组合的既有定义完全一致，不另立一套公式：
 * 否则目标页与净资产页会给出两个数，用户无法判断哪个是对的。
 */
export async function resolveGoalAmount(
  prisma: PrismaClient,
  params: {
    userId: string;
    goal: {
      currency: string;
      fundingSource: 'net_worth' | 'account' | 'portfolio';
      accountId: string | null;
      portfolioId: string | null;
      startedAt: Date;
      initialAmount: Decimal;
    };
    asOf: string;
    /** net_worth 口径下的起算日基线，调用方按需缓存避免重复重算 */
    baseline?: Decimal | null;
  },
): Promise<GoalAmountResult> {
  const asOf = asOfDate(params.asOf);

  if (params.goal.fundingSource === 'account') {
    if (!params.goal.accountId) {
      return { available: false, unavailableReason: 'funding_missing', amount: null };
    }

    const account = await prisma.account.findFirst({
      where: { id: params.goal.accountId, userId: params.userId },
      select: { id: true, currency: true, status: true },
    });

    if (!account) return { available: false, unavailableReason: 'funding_not_found', amount: null };
    if (account.status !== 'active') {
      return { available: false, unavailableReason: 'account_archived', amount: null };
    }
    if (account.currency !== params.goal.currency) {
      return { available: false, unavailableReason: 'currency_mismatch', amount: null };
    }

    const balances = await computeBalances(prisma, {
      userId: params.userId,
      accountIds: [account.id],
      asOf,
    });

    const balance = balances.get(account.id) ?? toDecimal(0);
    return { available: true, unavailableReason: null, amount: roundMoney(balance.plus(params.goal.initialAmount)) };
  }

  if (params.goal.fundingSource === 'portfolio') {
    if (!params.goal.portfolioId) {
      return { available: false, unavailableReason: 'funding_missing', amount: null };
    }

    const portfolio = await prisma.portfolio.findFirst({
      where: { id: params.goal.portfolioId, userId: params.userId },
      select: { id: true, currency: true, status: true, accountId: true },
    });

    if (!portfolio) return { available: false, unavailableReason: 'funding_not_found', amount: null };
    if (portfolio.status !== 'active') {
      return { available: false, unavailableReason: 'portfolio_archived', amount: null };
    }
    if (portfolio.currency !== params.goal.currency) {
      return { available: false, unavailableReason: 'currency_mismatch', amount: null };
    }

    // 组合价值 = 绑定账户现金 + 证券市值，与净资产口径一致，避免现金被计两次
    const valuations = await loadAllPortfolioValuations(prisma, { userId: params.userId, asOf });
    const valuation = valuations.find((item) => item.portfolioId === portfolio.id);
    const securities = valuation?.marketValue ?? toDecimal(0);

    const balances = await computeBalances(prisma, {
      userId: params.userId,
      accountIds: [portfolio.accountId],
      asOf,
    });
    const cash = balances.get(portfolio.accountId) ?? toDecimal(0);

    return {
      available: true,
      unavailableReason: null,
      amount: roundMoney(cash.plus(securities).plus(params.goal.initialAmount)),
    };
  }

  // net_worth：用增量而不是绝对值，避免目标创建前就存在的房贷把进度拉成负数
  const baseline =
    params.baseline !== undefined && params.baseline !== null
      ? params.baseline
      : (await computeNetWorth(prisma, { userId: params.userId, baseCurrency: params.goal.currency, asOf: params.goal.startedAt }))
          .netWorth;

  const current = await computeNetWorth(prisma, {
    userId: params.userId,
    baseCurrency: params.goal.currency,
    asOf,
  });

  const delta = current.netWorth.minus(baseline);
  return {
    available: true,
    unavailableReason: null,
    amount: roundMoney(delta.plus(params.goal.initialAmount)),
  };
}

export interface GoalProgressView {
  asOf: string;
  currentAmount: string | null;
  targetAmount: string;
  originalTargetAmount: string;
  progress: string | null;
  gap: string | null;
  isAchieved: boolean;
  achievedAt: string | null;
  monthsRemaining: number | null;
  funding: GoalFundingView;
}

export function toCoreInput(goal: {
  targetAmount: Decimal;
  currency: string;
  targetDate: Date | null;
  startedAt: Date;
  initialAmount: Decimal;
  inflationAdjusted: boolean;
  inflationRate: Decimal | null;
  expectedAnnualReturn: Decimal | null;
  monthlyContribution: Decimal | null;
}): GoalCoreInput {
  return {
    targetAmount: goal.targetAmount.toString(),
    currency: goal.currency,
    targetDate: goal.targetDate ? dayKey(goal.targetDate) : null,
    startedAt: dayKey(goal.startedAt),
    initialAmount: goal.initialAmount.toString(),
    inflationAdjusted: goal.inflationAdjusted,
    inflationRate: goal.inflationRate ? goal.inflationRate.toString() : null,
    expectedAnnualReturn: goal.expectedAnnualReturn ? goal.expectedAnnualReturn.toString() : null,
    monthlyContribution: goal.monthlyContribution ? goal.monthlyContribution.toString() : null,
  };
}

export async function computeGoalProgress(
  prisma: PrismaClient,
  params: {
    userId: string;
    goal: Parameters<typeof toCoreInput>[0] & {
      id: string;
      fundingSource: 'net_worth' | 'account' | 'portfolio';
      accountId: string | null;
      portfolioId: string | null;
      achievedAt: Date | null;
    };
    asOf: string;
  },
): Promise<GoalProgressView> {
  const core = toCoreInput(params.goal);

  const funding: GoalFundingView = {
    source: params.goal.fundingSource,
    accountId: params.goal.accountId,
    portfolioId: params.goal.portfolioId,
    available: true,
    unavailableReason: null,
  };

  const resolved = await resolveGoalAmount(prisma, {
    userId: params.userId,
    goal: {
      currency: params.goal.currency,
      fundingSource: params.goal.fundingSource,
      accountId: params.goal.accountId,
      portfolioId: params.goal.portfolioId,
      startedAt: params.goal.startedAt,
      initialAmount: params.goal.initialAmount,
    },
    asOf: params.asOf,
  });

  funding.available = resolved.available;
  funding.unavailableReason = resolved.unavailableReason;

  const progress = computeProgress({
    input: core,
    currentAmount: resolved.amount ?? toDecimal(0),
    asOf: params.asOf,
  });

  return {
    asOf: params.asOf,
    currentAmount: resolved.available ? moneyToString(progress.currentAmount) : null,
    targetAmount: moneyToString(progress.targetAmount),
    originalTargetAmount: moneyToString(progress.originalTargetAmount),
    progress: resolved.available ? progress.progress.toFixed(6) : null,
    gap: resolved.available ? moneyToString(progress.gap) : null,
    isAchieved: resolved.available ? progress.isAchieved : false,
    achievedAt: params.goal.achievedAt ? dayKey(params.goal.achievedAt) : null,
    monthsRemaining: progress.monthsRemaining,
    funding,
  };
}

/**
 * 按月重算历史曲线。
 * 每个采样点只做一次 as-of 取数，最多 GOAL_HISTORY_MAX_MONTHS 个点，
 * 不做逐日重放——日粒度对目标追踪没有实际价值，成本却是数量级差异。
 */
export async function computeGoalHistory(
  prisma: PrismaClient,
  params: {
    userId: string;
    goal: Parameters<typeof toCoreInput>[0] & {
      fundingSource: 'net_worth' | 'account' | 'portfolio';
      accountId: string | null;
      portfolioId: string | null;
    };
    asOf: string;
    maxMonths?: number;
  },
): Promise<{ points: GoalCurvePoint[]; firstAchievedAt: string | null; truncated: boolean }> {
  const core = toCoreInput(params.goal);
  const maxMonths = params.maxMonths ?? GOAL_HISTORY_MAX_MONTHS;

  const end = asOfDate(params.asOf);
  const startKey = dayKey(params.goal.startedAt);

  const monthKeys: string[] = [];
  const cursor = new Date(`${dayKey(params.goal.startedAt).slice(0, 8)}01T00:00:00.000Z`);
  // 先判断再追加：起始月本身要算一个点，但总数不能超过 maxMonths
  while (cursor <= end && monthKeys.length < maxMonths) {
    monthKeys.push(monthEndKey(cursor.getUTCFullYear(), cursor.getUTCMonth()));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  // 起点月可能早于起算日，首个采样点至少要是起算日当天
  if (monthKeys.length > 0 && monthKeys[0]! < startKey) monthKeys[0] = startKey;

  const truncated = cursor <= end;

  const baseline =
    params.goal.fundingSource === 'net_worth'
      ? (
          await computeNetWorth(prisma, {
            userId: params.userId,
            baseCurrency: params.goal.currency,
            asOf: params.goal.startedAt,
          })
        ).netWorth
      : null;

  const points: GoalCurvePoint[] = [];
  for (const key of monthKeys) {
    const amount = await resolveGoalAmount(prisma, {
      userId: params.userId,
      goal: {
        currency: params.goal.currency,
        fundingSource: params.goal.fundingSource,
        accountId: params.goal.accountId,
        portfolioId: params.goal.portfolioId,
        startedAt: params.goal.startedAt,
        initialAmount: params.goal.initialAmount,
      },
      asOf: key,
      baseline,
    });

    if (!amount.available || amount.amount === null) {
      // 历史某月资金不可用时跳过该点，而不是补 0
      continue;
    }

    const progress = computeProgress({ input: core, currentAmount: amount.amount, asOf: key });
    points.push({
      asOf: key,
      currentAmount: moneyToString(progress.currentAmount),
      progress: progress.progress.toFixed(6),
      isAchieved: progress.isAchieved,
    });
  }

  return { points, firstAchievedAt: findFirstAchieved(points), truncated };
}
