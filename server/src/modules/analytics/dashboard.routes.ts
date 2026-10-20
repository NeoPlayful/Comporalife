import Decimal from 'decimal.js';
import { Prisma, type PrismaClient } from '@prisma/client';
import { eachDayOfInterval, eachMonthOfInterval, endOfMonth, format, startOfMonth } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LIABILITY_ACCOUNT_TYPES } from '../../config/constants.js';
import { errors } from '../../lib/errors.js';
import { moneyToString, rateToString, roundMoney, toDecimal } from '../../lib/money.js';
import { ok } from '../../lib/api-utils.js';
import { requireAuth } from '../../plugins/auth.js';
import { computeBalances } from '../accounts/balance.service.js';
import { convertMany } from '../currencies/currency.service.js';
import { computeCashflow } from './cashflow.service.js';
import { computeNetWorth } from './networth.service.js';

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
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          isComplete: cashflow.isComplete,
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

    const defaultFrom = new Date();
    defaultFrom.setMonth(defaultFrom.getMonth() - 11);
    const from = query.from ?? startOfMonth(defaultFrom);
    const to = query.to ?? new Date();

    if (from > to) throw errors.validation('起始日期不能晚于结束日期');

    const spanDays = (to.getTime() - from.getTime()) / 86_400_000;
    const granularity = spanDays <= 90 ? 'day' : 'month';

    const [series, granularityUsed] = await buildNetWorthSeries(app.prisma, {
      userId,
      baseCurrency: settings.baseCurrency,
      from,
      to,
      granularity,
    });

    return ok(
      {
        series: series.map((point) => ({ period: point.period, netWorth: moneyToString(point.value) })),
        granularity: granularityUsed,
        baseCurrency: settings.baseCurrency,
        basis: {
          from: from.toISOString(),
          to: to.toISOString(),
          note: '按日按分录重算，区间超过 90 天自动转为按月',
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
        userId,
        baseCurrency: settings.baseCurrency,
        asOf,
        items,
      });
      converted.push({ type, amount: result.total });
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

  app.get('/dashboard/data-quality', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const settings = await getUserContext(app, userId);
    const asOf = new Date();

    const [uncategorizedCount, accounts, lastReconciliations] = await Promise.all([
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
    ]);

    const missingRateCurrencies = new Set<string>();
    for (const account of accounts) {
      if (account.currency === settings.baseCurrency) continue;
      const conversion = await convertMany(app.prisma, {
        userId,
        baseCurrency: settings.baseCurrency,
        asOf,
        items: [{ amount: toDecimal(0), currency: account.currency }],
      });
      if (conversion.missingPairs.length > 0) {
        missingRateCurrencies.add(account.currency);
      }
    }

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

    return ok(
      {
        uncategorizedTransactions: uncategorizedCount,
        missingRateCurrencies: [...missingRateCurrencies],
        reconciliationDifferences: reconcileDifferences.map((record) => ({
          accountId: record.accountId,
          difference: moneyToString(record.difference.toString()),
          reconciledAt: record.reconciledAt,
        })),
        archivedWithNonZeroBalance: archivedNonZero.map((account) => account.name),
        baseCurrency: settings.baseCurrency,
      },
      request.id,
    );
  });
}

/**
 * 净资产趋势：对每个采样点按分录重算，不依赖余额快照表。
 * 采样点过多时降级为月度，避免大量聚合查询。
 */
async function buildNetWorthSeries(
  prisma: PrismaClient,
  params: { userId: string; baseCurrency: string; from: Date; to: Date; granularity: 'day' | 'month' },
): Promise<[Array<{ period: string; value: Decimal }>, 'day' | 'month']> {
  const periods =
    params.granularity === 'day'
      ? eachDayOfInterval({ start: params.from, end: params.to }).map((d) => ({
          key: format(d, 'yyyy-MM-dd'),
          asOf: d,
        }))
      : eachMonthOfInterval({ start: params.from, end: params.to }).map((d) => ({
          key: format(d, 'yyyy-MM'),
          asOf: endOfMonth(d),
        }));

  const accountCount = await prisma.account.count({
    where: { userId: params.userId, status: { in: ['active', 'archived'] } },
  });

  // 每个采样点都要做一次折算与聚合，规模过大时降级
  const estimatedWork = periods.length * Math.max(accountCount, 1);
  const granularity: 'day' | 'month' = estimatedWork > 200_000 ? 'month' : params.granularity;

  const finalPeriods =
    granularity === params.granularity
      ? periods
      : eachMonthOfInterval({ start: params.from, end: params.to }).map((d) => ({
          key: format(d, 'yyyy-MM'),
          asOf: endOfMonth(d),
        }));

  const series: Array<{ period: string; value: Decimal }> = [];

  for (const period of finalPeriods) {
    const result = await computeNetWorth(prisma, {
      userId: params.userId,
      baseCurrency: params.baseCurrency,
      asOf: period.asOf,
    });
    series.push({ period: period.key, value: result.netWorth });
  }

  return [series, granularity];
}
