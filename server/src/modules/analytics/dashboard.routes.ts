import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LIABILITY_ACCOUNT_TYPES } from '../../config/constants.js';
import { errors } from '../../lib/errors.js';
import { moneyToString, rateToString, roundMoney, toDecimal } from '../../lib/money.js';
import { ok } from '../../lib/api-utils.js';
import { requireAuth } from '../../plugins/auth.js';
import { computeBalances } from '../accounts/balance.service.js';
import { computeBudgetAlerts } from '../budgets/budget.service.js';
import { convertMany } from '../currencies/currency.service.js';
import { computeGoalProgress } from '../goals/goal.service.js';
import { findStaleValuations } from '../quality/quality.service.js';
import { computeCashflow } from './cashflow.service.js';
import { buildNetWorthSamples, buildNetWorthSeries, computeNetWorth } from './networth.service.js';

const LIABILITY_TYPES = new Set<string>(LIABILITY_ACCOUNT_TYPES);

const rangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

async function getUserContext(app: FastifyInstance, userId: string) {
  const settings = await app.prisma.userSettings.findUniqueOrThrow({
    where: { userId },
    select: { baseCurrency: true, timezone: true },
  });
  return settings;
}

/** 默认区间：本月 1 日至今天；统一按用户时区计算 */
function defaultRange(timezone: string) {
  const today = new Date();
  const monthKey = formatInTimeZone(today, timezone, 'yyyy-MM');
  const from = new Date(`${monthKey}-01T00:00:00Z`);
  return { from, to: today };
}

export default async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard/overview', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const settings = await getUserContext(app, userId);
    const asOf = new Date();
    const range = defaultRange(settings.timezone);

    const [netWorth, cashflow] = await Promise.all([
      computeNetWorth(app.prisma, {
        userId,
        baseCurrency: settings.baseCurrency,
        asOf,
      }),
      computeCashflow(app.prisma, {
        userId,
        timezone: settings.timezone,
        baseCurrency: settings.baseCurrency,
        from: range.from,
        to: range.to,
      }),
    ]);

    return ok(
      {
        netWorth: moneyToString(netWorth.netWorth),
        totalAssets: moneyToString(netWorth.totalAssets),
        totalLiabilities: moneyToString(netWorth.totalLiabilities),
        baseCurrency: settings.baseCurrency,
        monthIncome: moneyToString(cashflow.totalIncome),
        monthExpense: moneyToString(cashflow.totalExpense),
        monthNet: moneyToString(cashflow.totalNet),
        savingsRate: cashflow.savingsRate === null ? null : cashflow.savingsRate.toFixed(4),
        // 六项分项：让用户看到钱落在哪一栏，发现重复建账可自行纠正
        breakdown: {
          accountAssets: moneyToString(netWorth.accountAssets),
          securitiesValue: moneyToString(netWorth.securitiesValue),
          otherAssets: moneyToString(netWorth.otherAssets),
          accountLiabilities: moneyToString(netWorth.accountLiabilities),
          otherLiabilities: moneyToString(netWorth.otherLiabilities),
        },
        unpricedAssets: netWorth.unpricedAssets,
        unpricedLiabilities: netWorth.unpricedLiabilities,
        // 口径必须随数值返回
        basis: {
          asOf: asOf.toISOString(),
          period: { from: range.from.toISOString(), to: range.to.toISOString() },
          timezone: settings.timezone,
          baseCurrency: settings.baseCurrency,
          missingRates: netWorth.missingPairs,
          excludedAccounts: netWorth.excludedAccounts,
          isComplete: cashflow.isComplete,
        },
      },
      request.id,
    );
  });

  app.get('/dashboard/cashflow', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const settings = await getUserContext(app, userId);
    const query = rangeSchema.parse(request.query);
    const range = query.from && query.to ? { from: query.from, to: query.to } : defaultRange(settings.timezone);

    if (range.from > range.to) throw errors.validation('起始日期不能晚于结束日期');

    const cashflow = await computeCashflow(app.prisma, {
      userId,
      timezone: settings.timezone,
      baseCurrency: settings.baseCurrency,
      from: range.from,
      to: range.to,
    });

    return ok(
      {
        points: cashflow.points.map((point) => ({
          period: point.period,
          income: moneyToString(point.income),
          expense: moneyToString(point.expense),
          net: moneyToString(point.net),
          isComplete: point.isComplete,
        })),
        totalIncome: moneyToString(cashflow.totalIncome),
        totalExpense: moneyToString(cashflow.totalExpense),
        totalNet: moneyToString(cashflow.totalNet),
        transferTotal: moneyToString(cashflow.transferTotal),
        savingsRate: cashflow.savingsRate === null ? null : cashflow.savingsRate.toFixed(4),
        basis: {
          timezone: settings.timezone,
          baseCurrency: settings.baseCurrency,
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          isComplete: cashflow.isComplete,
          // 缺汇率的流水被排除，金额偏低必须显式告知
          missingRates: cashflow.missingRates,
          // 转账不计入收支，单独统计
          note: '内部转账与余额调整不计入收入或支出',
        },
      },
      request.id,
    );
  });

  app.get('/dashboard/net-worth-trend', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const settings = await getUserContext(app, userId);
    const query = rangeSchema.parse(request.query);

    const now = new Date();
    const to = query.to ?? now;
    // 默认看最近 30 天：这个图回答的是「最近怎么样」，一年的默认值反而看不出变化
    const from = query.from ?? addDays(to, -29);

    if (from > to) throw errors.validation('起始日期不能晚于结束日期');

    const requestedGranularity: 'day' | 'month' =
      (to.getTime() - from.getTime()) / 86_400_000 <= 90 ? 'day' : 'month';

    const samples = buildNetWorthSamples({
      from,
      to,
      granularity: requestedGranularity,
      timezone: settings.timezone,
      now,
    });

    const { series, usedRateFallback } = await buildNetWorthSeries(app.prisma, {
      userId,
      baseCurrency: settings.baseCurrency,
      samples,
    });

    return ok(
      {
        series: series.map((point) => ({ period: point.period, netWorth: moneyToString(point.value) })),
        granularity: requestedGranularity,
        baseCurrency: settings.baseCurrency,
        rateFallback: usedRateFallback,
        basis: {
          from: from.toISOString(),
          to: to.toISOString(),
          timezone: settings.timezone,
          note:
            requestedGranularity === 'day'
              ? '按日按分录累计，每个点含当日全部已入账流水'
              : '按月采样，每个点含当月全部已入账流水',
        },
      },
      request.id,
    );
  });

  app.get('/dashboard/account-balances', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const settings = await getUserContext(app, userId);
    const asOf = new Date();

    const accounts = await app.prisma.account.findMany({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, type: true, currency: true },
    });

    const balances = await computeBalances(app.prisma, {
      userId,
      accountIds: accounts.map((a) => a.id),
      asOf,
    });

    return ok(
      {
        accounts: accounts.map((account) => ({
          ...account,
          balance: moneyToString(balances.get(account.id) ?? toDecimal(0)),
          isLiability: LIABILITY_TYPES.has(account.type),
        })),
        asOf: asOf.toISOString(),
        baseCurrency: settings.baseCurrency,
      },
      request.id,
    );
  });

  app.get('/dashboard/asset-allocation', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const settings = await getUserContext(app, userId);
    const asOf = new Date();

    const accounts = await app.prisma.account.findMany({
      where: { userId, status: 'active' },
      select: { id: true, type: true, currency: true },
    });

    const balances = await computeBalances(app.prisma, {
      userId,
      accountIds: accounts.map((a) => a.id),
      asOf,
    });

    // 按币种汇总（原币金额）与按类型汇总（折算到基准币种）两个维度
    const byCurrency = new Map<string, Decimal>();
    const itemsByType = new Map<string, Array<{ amount: Decimal; currency: string }>>();

    for (const account of accounts) {
      const balance = balances.get(account.id) ?? toDecimal(0);

      byCurrency.set(
        account.currency,
        (byCurrency.get(account.currency) ?? toDecimal(0)).plus(balance),
      );

      const items = itemsByType.get(account.type) ?? [];
      items.push({ amount: balance, currency: account.currency });
      itemsByType.set(account.type, items);
    }

    // 逐账户折算，而不是把不同币种的金额先相加再折算
    const converted: Array<{ type: string; amount: Decimal }> = [];
    for (const [type, items] of itemsByType) {
      const result = await convertMany(app.prisma, {
        baseCurrency: settings.baseCurrency,
        asOf,
        items,
      });
      converted.push({ type, amount: result.total });
    }

    // 非交易型资产单列为 other 维度：它们不进账户体系，但同样是资产配置的一部分
    const assets = await app.prisma.asset.findMany({
      where: { userId, status: 'active' },
      select: {
        currency: true,
        valuations: {
          orderBy: { valuationDate: 'desc' },
          select: { valuationDate: true, value: true },
        },
      },
    });

    const assetItems: Array<{ amount: Decimal; currency: string }> = [];
    for (const asset of assets) {
      const latest = asset.valuations.find((item) => item.valuationDate.getTime() <= asOf.getTime());
      if (!latest) continue;
      assetItems.push({ amount: toDecimal(latest.value.toString()), currency: asset.currency });
    }

    if (assetItems.length > 0) {
      const result = await convertMany(app.prisma, {
        baseCurrency: settings.baseCurrency,
        asOf,
        items: assetItems,
      });
      if (!result.total.isZero()) {
        converted.push({ type: 'other_assets', amount: result.total });
      }
    }

    const total = converted.reduce((sum, item) => sum.plus(item.amount), toDecimal(0));

    return ok(
      {
        byType: converted.map((item) => ({
          type: item.type,
          amount: moneyToString(item.amount),
          ratio: total.isZero() ? null : rateToString(item.amount.div(total).toDecimalPlaces(10)),
        })),
        byCurrency: [...byCurrency.entries()].map(([currency, amount]) => ({
          currency,
          amount: moneyToString(amount),
        })),
        total: moneyToString(total),
        baseCurrency: settings.baseCurrency,
        basis: { asOf: asOf.toISOString(), note: '按账户类型折算到基准币种；按币种展示原币金额' },
      },
      request.id,
    );
  });

  app.get('/dashboard/recent-transactions', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const limitRaw = (request.query as { limit?: string }).limit;
    const limit = Math.min(Math.max(Number(limitRaw ?? 10) || 10, 1), 50);

    const transactions = await app.prisma.transaction.findMany({
      where: { userId, status: 'posted' },
      orderBy: { occurredAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        occurredAt: true,
        description: true,
        category: { select: { id: true, name: true, kind: true } },
        entries: { where: { accountId: { not: null } }, select: { amount: true, currency: true } },
      },
    });

    return ok(
      {
        transactions: transactions.map((tx) => {
          const movement = tx.entries.reduce(
            (sum, entry) => sum.plus(entry.amount.toString()),
            toDecimal(0),
          );
          return {
            id: tx.id,
            type: tx.type,
            occurredAt: tx.occurredAt,
            description: tx.description,
            category: tx.category,
            amount: moneyToString(roundMoney(movement)),
            currency: tx.entries[0]?.currency ?? 'CNY',
          };
        }),
      },
      request.id,
    );
  });

  // ===== 预算预警聚合：复用预算口径，只做裁剪 =====
  app.get('/dashboard/budget-alerts', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const settings = await getUserContext(app, userId);
    const alerts = await computeBudgetAlerts(app.prisma, {
      userId,
      timezone: settings.timezone,
      baseCurrency: settings.baseCurrency,
    });

    const exceeded = alerts.filter((item) => item.level === 'exceeded').length;
    const warning = alerts.filter((item) => item.level === 'warning').length;

    return ok(
      {
        // 仪表板只要前 5 条，完整列表在预算页
        alerts: alerts.slice(0, 5),
        counts: { total: alerts.length, exceeded, warning },
      },
      request.id,
    );
  });

  // ===== 目标进度聚合：按进度与期限排序取前 5 =====
  app.get('/dashboard/goal-progress', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const settings = await app.prisma.userSettings.findUniqueOrThrow({
      where: { userId },
      select: { timezone: true, baseCurrency: true },
    });
    const asOf = formatInTimeZone(new Date(), settings.timezone, 'yyyy-MM-dd');

    const goals = await app.prisma.financialGoal.findMany({
      where: { userId, status: { in: ['active', 'achieved'] } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      take: 20,
      // 进度计算需要完整的口径字段，缺一个就会在 toCoreInput 里报错
      select: {
        id: true,
        name: true,
        targetAmount: true,
        currency: true,
        targetDate: true,
        startedAt: true,
        initialAmount: true,
        inflationAdjusted: true,
        inflationRate: true,
        expectedAnnualReturn: true,
        monthlyContribution: true,
        fundingSource: true,
        accountId: true,
        portfolioId: true,
        achievedAt: true,
        status: true,
      },
    });

    const items: Array<{
      id: string;
      name: string;
      currency: string;
      targetAmount: string;
      progress: string | null;
      isAchieved: boolean;
      targetDate: string | null;
      monthsRemaining: number | null;
    }> = [];

    for (const goal of goals) {
      const progress = await computeGoalProgress(app.prisma, { userId, goal: goal as never, asOf });
      items.push({
        id: goal.id,
        name: goal.name,
        currency: goal.currency,
        targetAmount: moneyToString(goal.targetAmount),
        progress: progress.progress,
        isAchieved: progress.isAchieved,
        targetDate: goal.targetDate ? goal.targetDate.toISOString().slice(0, 10) : null,
        monthsRemaining: progress.monthsRemaining,
      });
    }

    // 已达成排后；其余按「剩余月数升序」——临近期限的最需要提醒
    const sorted = [...items].sort((a, b) => {
      if (a.isAchieved !== b.isAchieved) return a.isAchieved ? 1 : -1;
      return (a.monthsRemaining ?? Number.MAX_SAFE_INTEGER) - (b.monthsRemaining ?? Number.MAX_SAFE_INTEGER);
    });

    return ok(
      {
        goals: sorted.slice(0, 5),
        counts: {
          active: items.filter((item) => !item.isAchieved).length,
          achieved: items.filter((item) => item.isAchieved).length,
        },
      },
      request.id,
    );
  });

  app.get('/dashboard/data-quality', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const settings = await getUserContext(app, userId);
    const asOf = new Date();

    const [uncategorizedCount, accounts, lastReconciliations, assets, liabilities, portfolios] = await Promise.all([
      app.prisma.transaction.count({
        where: {
          userId,
          status: 'posted',
          categoryId: null,
          type: { in: ['income', 'expense'] },
        },
      }),
      app.prisma.account.findMany({
        where: { userId, status: 'active' },
        select: { id: true, name: true, currency: true, status: true },
      }),
      app.prisma.accountReconciliation.findMany({
        where: { userId },
        orderBy: { reconciledAt: 'desc' },
        distinct: ['accountId'],
        select: { accountId: true, difference: true, reconciledAt: true },
      }),
      app.prisma.asset.findMany({
        where: { userId, status: 'active' },
        select: { currency: true },
      }),
      app.prisma.liability.findMany({
        where: { userId, status: 'active' },
        select: { currency: true },
      }),
      app.prisma.portfolio.findMany({
        where: { userId, status: 'active' },
        select: { currency: true },
      }),
    ]);

    // 四类实体的币种都要检查，只查账户会漏掉外币资产与外币负债
    const missingRateCurrencies = new Set<string>();
    const involvedCurrencies = new Set<string>([
      ...accounts.map((item) => item.currency),
      ...assets.map((item) => item.currency),
      ...liabilities.map((item) => item.currency),
      ...portfolios.map((item) => item.currency),
    ]);
    involvedCurrencies.delete(settings.baseCurrency);

    for (const currency of involvedCurrencies) {
      const conversion = await convertMany(app.prisma, {
        baseCurrency: settings.baseCurrency,
        asOf,
        items: [{ amount: toDecimal(0), currency }],
      });
      if (conversion.missingPairs.length > 0) {
        missingRateCurrencies.add(currency);
      }
    }

    // 同步失败与「从未录入」的处置不同：前者要去后台看供应商，后者要补录
    const lastSync = await app.prisma.rateSyncRun.findFirst({
      orderBy: { startedAt: 'desc' },
      select: { failures: true },
    });
    const failedPairs = new Set(
      Array.isArray(lastSync?.failures)
        ? (lastSync!.failures as Array<{ pair?: string }>).map((item) => item.pair ?? '')
        : [],
    );
    const syncFailedCurrencies = [...missingRateCurrencies].filter((currency) =>
      failedPairs.has(`${currency}->${settings.baseCurrency}`),
    );

    const archivedWithBalance = await app.prisma.account.findMany({
      where: { userId, status: 'archived' },
      select: { id: true, name: true, currency: true },
    });

    const archivedBalances = await computeBalances(app.prisma, {
      userId,
      accountIds: archivedWithBalance.map((a) => a.id),
    });

    const archivedNonZero = archivedWithBalance.filter((account) => {
      const balance = archivedBalances.get(account.id) ?? toDecimal(0);
      return !balance.isZero();
    });

    const reconcileDifferences = lastReconciliations.filter(
      (record) => !new Prisma.Decimal(record.difference).isZero(),
    );

    // 行情侧与汇率侧同等对待：过期估值和无价标的必须出现在总览里，
    // 否则用户会以为净资产是完整的
    const staleValuations = await findStaleValuations(app.prisma, {
      userId,
      timezone: settings.timezone,
      baseCurrency: settings.baseCurrency,
    });

    return ok(
      {
        uncategorizedTransactions: uncategorizedCount,
        missingRateCurrencies: [...missingRateCurrencies],
        syncFailedRateCurrencies: syncFailedCurrencies,
        reconciliationDifferences: reconcileDifferences.map((record) => ({
          accountId: record.accountId,
          difference: moneyToString(record.difference.toString()),
          reconciledAt: record.reconciledAt,
        })),
        archivedWithNonZeroBalance: archivedNonZero.map((account) => account.name),
        // 有价格日期但已过期 → 过期；无价格日期或存在无价标的 → 未定价
        staleValuations: staleValuations.items.filter(
          (item) => item.priceDate !== null && item.missingSymbols.length === 0,
        ),
        unpricedInvestments: staleValuations.items.filter(
          (item) => item.priceDate === null || item.missingSymbols.length > 0,
        ),
        baseCurrency: settings.baseCurrency,
      },
      request.id,
    );
  });
}
