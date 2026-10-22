/**
 * 路由顺序：列表、汇总等固定路径必须注册在 /:id 之前，
 * 否则会被参数路由吞掉（与 /imports/templates、/budgets/summary 同一个坑）。
 */
import type { FastifyInstance } from 'fastify';
import { ok } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { moneyToString, roundMoney, toDecimal } from '../../lib/money.js';
import { requireAuth } from '../../plugins/auth.js';
import { getUserAnalyticsContext } from '../analytics/analytics.service.js';
import {
  assertPortfolioAccount,
  assertPortfolioActive,
  getPortfolioContext,
  summarizePortfolio,
  voidLedgerTransaction,
  writeCashflowLedger,
} from './portfolio.service.js';
import {
  computeAllocation,
  computeDrift,
  computePerformance,
  computeRealizedGains,
  computeReturns,
  computeRiskSummary,
  assertTargetsSum,
  getTargets,
  listCashflows,
  previewRebalance,
} from './analytics.service.js';
import {
  createCashflowSchema,
  createInstrumentSchema,
  createPortfolioSchema,
  createPriceSchema,
  createValuationSchema,
  instrumentIdSchema,
  listInstrumentsSchema,
  listPortfoliosSchema,
  listPricesSchema,
  portfolioIdSchema,
  priceIdSchema,
  rebalancePreviewSchema,
  returnsSchema,
  targetsSchema,
  updateInstrumentSchema,
  updatePortfolioSchema,
  valuationIdSchema,
  cashflowIdSchema,
} from './portfolios.schema.js';

export default async function portfoliosRoutes(app: FastifyInstance) {
  // ===== 投资标的 =====

  app.get('/instruments', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = listInstrumentsSchema.parse(request.query);

    const instruments = await app.prisma.instrument.findMany({
      where: {
        userId,
        ...(query.assetClass ? { assetClass: query.assetClass } : {}),
        ...(query.q
          ? {
              OR: [
                { symbol: { contains: query.q, mode: 'insensitive' } },
                { name: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { symbol: 'asc' },
      select: {
        id: true,
        symbol: true,
        name: true,
        assetClass: true,
        currency: true,
        note: true,
        createdAt: true,
      },
    });

    const latestPrices = await app.prisma.instrumentPrice.findMany({
      where: { userId, instrumentId: { in: instruments.map((item) => item.id) } },
      orderBy: [{ instrumentId: 'asc' }, { priceDate: 'desc' }],
      select: { instrumentId: true, price: true, priceDate: true },
    });

    const priceById = new Map<string, { price: string; priceDate: string }>();
    for (const row of latestPrices) {
      if (priceById.has(row.instrumentId)) continue;
      priceById.set(row.instrumentId, {
        price: moneyToString(toDecimal(row.price.toString())),
        priceDate: row.priceDate.toISOString().slice(0, 10),
      });
    }

    return ok(
      {
        items: instruments.map((item) => ({
          ...item,
          latestPrice: priceById.get(item.id) ?? null,
        })),
      },
      request.id,
    );
  });

  app.post('/instruments', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = createInstrumentSchema.parse(request.body);

    const existing = await app.prisma.instrument.findFirst({
      where: { userId, symbol: body.symbol },
      select: { id: true },
    });
    if (existing) throw errors.instrumentSymbolExists();

    const instrument = await app.prisma.instrument.create({
      data: {
        userId,
        symbol: body.symbol,
        name: body.name,
        assetClass: body.assetClass,
        currency: body.currency,
        note: body.note ?? null,
      },
      select: {
        id: true,
        symbol: true,
        name: true,
        assetClass: true,
        currency: true,
        note: true,
        createdAt: true,
      },
    });

    return reply.status(201).send(ok(instrument, request.id));
  });

  app.get('/instruments/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = instrumentIdSchema.parse(request.params);

    const instrument = await app.prisma.instrument.findFirst({
      where: { id, userId },
      select: {
        id: true,
        symbol: true,
        name: true,
        assetClass: true,
        currency: true,
        note: true,
        createdAt: true,
      },
    });
    if (!instrument) throw errors.instrumentNotFound();

    const latest = await app.prisma.instrumentPrice.findFirst({
      where: { userId, instrumentId: id },
      orderBy: { priceDate: 'desc' },
      select: { price: true, priceDate: true, source: true },
    });

    return ok(
      {
        ...instrument,
        latestPrice: latest
          ? {
              price: moneyToString(toDecimal(latest.price.toString())),
              priceDate: latest.priceDate.toISOString().slice(0, 10),
              source: latest.source,
            }
          : null,
      },
      request.id,
    );
  });

  app.patch('/instruments/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = instrumentIdSchema.parse(request.params);
    const body = updateInstrumentSchema.parse(request.body);

    const instrument = await app.prisma.instrument.findFirst({
      where: { id, userId },
      select: { id: true, currency: true },
    });
    if (!instrument) throw errors.instrumentNotFound();

    // 有交易后再改币种会让历史成本与市值口径断裂
    if (body.currency && body.currency !== instrument.currency) {
      const tradeCount = await app.prisma.portfolioTrade.count({
        where: { userId, instrumentId: id, voidedAt: null },
      });
      if (tradeCount > 0) {
        throw errors.instrumentCurrencyMismatch('标的已有交易，不能修改币种');
      }
    }

    const updated = await app.prisma.instrument.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.assetClass !== undefined ? { assetClass: body.assetClass } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
      },
      select: {
        id: true,
        symbol: true,
        name: true,
        assetClass: true,
        currency: true,
        note: true,
        createdAt: true,
      },
    });

    return ok(updated, request.id);
  });

  app.delete('/instruments/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = instrumentIdSchema.parse(request.params);

    const instrument = await app.prisma.instrument.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!instrument) throw errors.instrumentNotFound();

    const tradeCount = await app.prisma.portfolioTrade.count({
      where: { userId, instrumentId: id },
    });
    // 物理删除会连带删掉交易，历史收益无法复现
    if (tradeCount > 0) throw errors.instrumentInUse();

    await app.prisma.instrument.delete({ where: { id } });
    return ok({ deleted: true }, request.id);
  });

  app.get('/instruments/:id/prices', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = instrumentIdSchema.parse(request.params);
    const query = listPricesSchema.parse(request.query);

    const instrument = await app.prisma.instrument.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!instrument) throw errors.instrumentNotFound();

    const prices = await app.prisma.instrumentPrice.findMany({
      where: {
        userId,
        instrumentId: id,
        ...(query.from || query.to
          ? {
              priceDate: {
                ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
                ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
              },
            }
          : {}),
      },
      orderBy: { priceDate: 'desc' },
      select: { id: true, price: true, priceDate: true, source: true, note: true },
    });

    return ok(
      {
        items: prices.map((row) => ({
          id: row.id,
          price: moneyToString(toDecimal(row.price.toString())),
          priceDate: row.priceDate.toISOString().slice(0, 10),
          source: row.source,
          note: row.note,
        })),
      },
      request.id,
    );
  });

  app.post('/instruments/:id/prices', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = instrumentIdSchema.parse(request.params);
    const body = createPriceSchema.parse(request.body);

    const instrument = await app.prisma.instrument.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!instrument) throw errors.instrumentNotFound();

    const priceDate = new Date(`${body.priceDate}T00:00:00.000Z`);
    // 未来价格会让"最新价"失真，直接拒绝
    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    if (body.priceDate > todayKey) {
      throw errors.priceDateInvalid('价格日期不能晚于今天');
    }

    const earlier = await app.prisma.instrumentPrice.findFirst({
      where: { instrumentId: id, priceDate },
      select: { id: true },
    });

    const result = await app.prisma.instrumentPrice.upsert({
      where: { instrumentId_priceDate: { instrumentId: id, priceDate } },
      create: {
        userId,
        instrumentId: id,
        priceDate,
        price: toDecimal(body.price),
        source: 'manual',
        note: body.note ?? null,
      },
      update: {
        price: toDecimal(body.price),
        source: 'manual',
        note: body.note ?? null,
      },
      select: { id: true, price: true, priceDate: true, source: true, note: true },
    });

    return reply.status(201).send(
      ok(
        {
          id: result.id,
          price: moneyToString(toDecimal(result.price.toString())),
          priceDate: result.priceDate.toISOString().slice(0, 10),
          source: result.source,
          note: result.note,
          created: earlier === null,
        },
        request.id,
      ),
    );
  });

  app.delete('/instruments/:id/prices/:priceId', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id, priceId } = priceIdSchema.parse(request.params);

    const price = await app.prisma.instrumentPrice.findFirst({
      where: { id: priceId, instrumentId: id, userId },
      select: { id: true },
    });
    if (!price) throw errors.priceNotFound();

    await app.prisma.instrumentPrice.delete({ where: { id: priceId } });

    // 依赖该价格的历史估值缓存必须失效，否则收益会用不存在的价格
    await app.prisma.portfolioValuation.deleteMany({
      where: { userId, source: 'computed' },
    });

    return ok({ deleted: true }, request.id);
  });

  // ===== 投资组合 =====

  app.get('/portfolios', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const context = await getUserAnalyticsContext(app.prisma, userId);
    const query = listPortfoliosSchema.parse(request.query);

    const portfolios = await app.prisma.portfolio.findMany({
      where: {
        userId,
        // 未指定 status 时只返回活跃组合，归档的不出现在默认列表
        ...(query.status === 'all' ? {} : { status: query.status ?? 'active' }),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        currency: true,
        accountId: true,
        status: true,
        note: true,
        version: true,
        account: { select: { name: true } },
      },
    });

    const items = [];

    for (const portfolio of portfolios) {
      if (portfolio.status === 'archived') {
        items.push({
          id: portfolio.id,
          name: portfolio.name,
          currency: portfolio.currency,
          accountId: portfolio.accountId,
          accountName: portfolio.account.name,
          status: portfolio.status,
          note: portfolio.note,
          version: portfolio.version,
          marketValue: null,
          cash: null,
          portfolioValue: null,
          totalPnl: null,
          priceDate: null,
          stale: false,
          isComplete: true,
        });
        continue;
      }

      const summary = await summarizePortfolio(app.prisma, {
        userId,
        portfolioId: portfolio.id,
      });

      items.push({
        id: portfolio.id,
        name: portfolio.name,
        currency: portfolio.currency,
        accountId: portfolio.accountId,
        accountName: portfolio.account.name,
        status: portfolio.status,
        note: portfolio.note,
        version: portfolio.version,
        marketValue: moneyToString(summary.marketValue),
        cash: moneyToString(summary.cash),
        portfolioValue: moneyToString(summary.portfolioValue),
        totalPnl: moneyToString(summary.totalPnl),
        priceDate: summary.priceDate,
        stale: summary.stale,
        isComplete: summary.isComplete,
      });
    }

    return ok({ items, timezone: context.timezone }, request.id);
  });

  app.post('/portfolios', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = createPortfolioSchema.parse(request.body);

    const account = await assertPortfolioAccount(app.prisma, {
      userId,
      accountId: body.accountId,
    });

    const nameTaken = await app.prisma.portfolio.findFirst({
      where: { userId, name: body.name },
      select: { id: true },
    });
    if (nameTaken) throw errors.conflict('组合名称已存在');

    const portfolio = await app.prisma.portfolio.create({
      data: {
        userId,
        accountId: account.id,
        name: body.name,
        currency: account.currency,
        note: body.note ?? null,
      },
      select: {
        id: true,
        name: true,
        currency: true,
        accountId: true,
        costBasisMethod: true,
        status: true,
        note: true,
        version: true,
      },
    });

    await app.prisma.auditLog.create({
      data: {
        userId,
        action: 'portfolio.created',
        targetType: 'portfolio',
        targetId: portfolio.id,
        metadata: { accountId: account.id, costBasisMethod: portfolio.costBasisMethod },
      },
    });

    return reply.status(201).send(ok(portfolio, request.id));
  });

  app.get('/portfolios/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);

    const summary = await summarizePortfolio(app.prisma, { userId, portfolioId: id });

    const account = await app.prisma.account.findFirst({
      where: { id: summary.portfolio.accountId, userId },
      select: { name: true },
    });

    return ok(
      {
        portfolio: {
          ...summary.portfolio,
          accountName: account?.name ?? '',
        },
        cash: moneyToString(summary.cash),
        marketValue: moneyToString(summary.marketValue),
        portfolioValue: moneyToString(summary.portfolioValue),
        totalCost: moneyToString(summary.totalCost),
        unrealizedPnl: summary.unrealizedPnl === null ? null : moneyToString(summary.unrealizedPnl),
        realizedPnl: moneyToString(summary.realizedPnl),
        dividends: moneyToString(summary.dividends),
        interest: moneyToString(summary.interest),
        totalPnl: moneyToString(summary.totalPnl),
        priceDate: summary.priceDate,
        stale: summary.stale,
        isComplete: summary.isComplete,
        missingPrices: summary.missingPrices,
        positionCount: summary.positionCount,
      },
      request.id,
    );
  });

  app.patch('/portfolios/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);
    const body = updatePortfolioSchema.parse(request.body);

    const portfolio = await getPortfolioContext(app.prisma, { userId, portfolioId: id });

    if (portfolio.version !== body.version) {
      throw errors.conflict('组合已被其他操作修改，请刷新后重试');
    }

    const updated = await app.prisma.portfolio.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
        version: { increment: 1 },
      },
      select: {
        id: true,
        name: true,
        currency: true,
        accountId: true,
        costBasisMethod: true,
        status: true,
        note: true,
        version: true,
      },
    });

    await app.prisma.auditLog.create({
      data: {
        userId,
        action: 'portfolio.updated',
        targetType: 'portfolio',
        targetId: id,
        metadata: { fields: Object.keys(body).filter((key) => key !== 'version') },
      },
    });

    return ok(updated, request.id);
  });

  app.post('/portfolios/:id/archive', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);

    const portfolio = await getPortfolioContext(app.prisma, { userId, portfolioId: id });
    if (portfolio.status === 'archived') return ok({ archived: true }, request.id);

    await app.prisma.portfolio.update({
      where: { id },
      data: { status: 'archived', archivedAt: new Date(), version: { increment: 1 } },
    });

    await app.prisma.auditLog.create({
      data: {
        userId,
        action: 'portfolio.archived',
        targetType: 'portfolio',
        targetId: id,
        metadata: {},
      },
    });

    return ok({ archived: true }, request.id);
  });

  app.get('/portfolios/:id/holdings', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);

    const summary = await summarizePortfolio(app.prisma, { userId, portfolioId: id });

    return ok(
      {
        portfolio: summary.portfolio,
        holdings: summary.holdings.map((holding) => ({
          instrumentId: holding.instrumentId,
          symbol: holding.symbol,
          name: holding.name,
          assetClass: holding.assetClass,
          quantity: holding.quantity.toFixed(8),
          averageCost: holding.averageCost === null ? null : moneyToString(holding.averageCost),
          totalCost: moneyToString(holding.totalCost),
          price: holding.price === null ? null : holding.price.toFixed(8),
          priceDate: holding.priceDate,
          stale: holding.stale,
          marketValue: moneyToString(holding.marketValue),
          unrealizedPnl: holding.unrealizedPnl === null ? null : moneyToString(holding.unrealizedPnl),
          unrealizedRatio:
            holding.unrealizedRatio === null ? null : holding.unrealizedRatio.toFixed(6),
          weight: holding.weight === null ? null : holding.weight.toFixed(6),
          realizedPnl: moneyToString(holding.realizedPnl),
        })),
        totals: {
          marketValue: moneyToString(summary.marketValue),
          cash: moneyToString(summary.cash),
          portfolioValue: moneyToString(summary.portfolioValue),
          totalCost: moneyToString(summary.totalCost),
          totalPnl: moneyToString(summary.totalPnl),
        },
        isComplete: summary.isComplete,
        missingPrices: summary.missingPrices,
        valuationDate: summary.priceDate,
        stale: summary.stale,
      },
      request.id,
    );
  });

  app.get('/portfolios/:id/summary', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);

    const summary = await summarizePortfolio(app.prisma, { userId, portfolioId: id });

    return ok(
      {
        marketValue: moneyToString(summary.marketValue),
        cash: moneyToString(summary.cash),
        portfolioValue: moneyToString(summary.portfolioValue),
        totalCost: moneyToString(summary.totalCost),
        unrealizedPnl: summary.unrealizedPnl === null ? null : moneyToString(summary.unrealizedPnl),
        realizedPnl: moneyToString(summary.realizedPnl),
        dividends: moneyToString(summary.dividends),
        interest: moneyToString(summary.interest),
        totalPnl: moneyToString(summary.totalPnl),
        positionCount: summary.positionCount,
        priceDate: summary.priceDate,
        stale: summary.stale,
        isComplete: summary.isComplete,
        missingPrices: summary.missingPrices,
      },
      request.id,
    );
  });

  app.get('/portfolios/:id/unrealized-gains', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);

    const summary = await summarizePortfolio(app.prisma, { userId, portfolioId: id });

    return ok(
      {
        items: summary.holdings
          .filter((holding) => holding.quantity.gt(0))
          .map((holding) => ({
            instrumentId: holding.instrumentId,
            symbol: holding.symbol,
            name: holding.name,
            quantity: holding.quantity.toFixed(8),
            averageCost: holding.averageCost === null ? null : moneyToString(holding.averageCost),
            price: holding.price === null ? null : holding.price.toFixed(8),
            marketValue: moneyToString(holding.marketValue),
            totalCost: moneyToString(holding.totalCost),
            unrealizedPnl: holding.unrealizedPnl === null ? null : moneyToString(holding.unrealizedPnl),
            unrealizedRatio:
              holding.unrealizedRatio === null ? null : holding.unrealizedRatio.toFixed(6),
          })),
        totals: {
          totalCost: moneyToString(summary.totalCost),
          marketValue: moneyToString(summary.marketValue),
          unrealizedPnl: summary.unrealizedPnl === null ? null : moneyToString(summary.unrealizedPnl),
        },
        isComplete: summary.isComplete,
        missingPrices: summary.missingPrices,
      },
      request.id,
    );
  });

  app.get('/portfolios/:id/income', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);

    // 股息利息来自交易重放，与账本的 income 交易口径一致
    const summary = await summarizePortfolio(app.prisma, { userId, portfolioId: id });

    return ok(
      {
        dividends: moneyToString(summary.dividends),
        interest: moneyToString(summary.interest),
        total: moneyToString(roundMoney(summary.dividends.plus(summary.interest))),
      },
      request.id,
    );
  });

  app.get('/portfolios/:id/realized-gains', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);
    const context = await getUserAnalyticsContext(app.prisma, userId);
    const query = returnsSchema.parse(request.query);

    const result = await computeRealizedGains(app.prisma, {
      userId,
      portfolioId: id,
      timezone: context.timezone,
      fromText: query.from,
      toText: query.to,
    });

    return ok(
      {
        items: result.items.map((item) => ({
          tradeId: item.tradeId,
          instrumentId: item.instrumentId,
          symbol: item.symbol,
          name: item.name,
          tradeDate: item.tradeDate,
          quantity: item.quantity.toFixed(8),
          sellPrice: item.sellPrice === null ? null : item.sellPrice.toFixed(8),
          averageCost: item.averageCost === null ? null : moneyToString(item.averageCost),
          proceeds: moneyToString(item.proceeds),
          cost: moneyToString(item.cost),
          fee: moneyToString(item.fee),
          tax: moneyToString(item.tax),
          realizedPnl: moneyToString(item.realizedPnl),
          realizedRatio: item.realizedRatio === null ? null : item.realizedRatio.toFixed(6),
        })),
        totals: {
          proceeds: moneyToString(result.totals.proceeds),
          cost: moneyToString(result.totals.cost),
          realizedPnl: moneyToString(result.totals.realizedPnl),
          fee: moneyToString(result.totals.fee),
          tax: moneyToString(result.totals.tax),
        },
        period: result.period,
      },
      request.id,
    );
  });

  // ===== 现金流 =====

  app.get('/portfolios/:id/cashflows', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    await getPortfolioContext(app.prisma, { userId, portfolioId: id });
    const flows = await listCashflows(app.prisma, {
      userId,
      portfolioId: id,
      timezone: context.timezone,
    });

    return ok(
      {
        items: flows.map((flow) => ({
          id: flow.id,
          kind: flow.kind,
          flowDate: flow.flowDate,
          amount: moneyToString(flow.amount),
          transactionId: flow.transactionId,
          note: flow.note,
        })),
      },
      request.id,
    );
  });

  app.post('/portfolios/:id/cashflows', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);
    const body = createCashflowSchema.parse(request.body);

    const context = await assertPortfolioActive(app.prisma, { userId, portfolioId: id });

    const amount = toDecimal(body.amount);
    if (amount.lte(0)) throw errors.cashflowAmountInvalid();

    const flowDate = new Date(body.flowDate);

    const cashflow = await app.prisma.$transaction(async (tx) => {
      // 入金/出金必须同时进账本，否则组合现金恒为 0，收益与净资产都会算错
      const ledger = await writeCashflowLedger(tx, {
        userId,
        accountId: context.accountId,
        currency: context.currency,
        kind: body.kind,
        flowDate,
        amount,
      });

      const created = await tx.portfolioCashflow.create({
        data: {
          userId,
          portfolioId: context.id,
          kind: body.kind,
          flowDate,
          amount,
          transactionId: ledger?.transactionId ?? null,
          note: body.note ?? null,
        },
        select: { id: true, kind: true, flowDate: true, amount: true, note: true },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'cashflow.created',
          targetType: 'portfolio',
          targetId: context.id,
          metadata: { cashflowId: created.id, kind: body.kind },
        },
      });

      return created;
    });

    return reply.status(201).send(ok(cashflow, request.id));
  });

  app.delete('/portfolios/:id/cashflows/:cashflowId', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id, cashflowId } = cashflowIdSchema.parse(request.params);

    const cashflow = await app.prisma.portfolioCashflow.findFirst({
      where: { id: cashflowId, portfolioId: id, userId },
      select: { id: true, transactionId: true },
    });
    if (!cashflow) throw errors.cashflowNotFound();

    await app.prisma.$transaction(async (tx) => {
      // 删除现金流必须同步冲正账本，否则账户余额与现金流记录会永久不一致
      if (cashflow.transactionId) {
        await voidLedgerTransaction(tx, { userId, transactionId: cashflow.transactionId });
      }
      await tx.portfolioCashflow.delete({ where: { id: cashflowId } });
    });

    return ok({ deleted: true }, request.id);
  });

  // ===== 收益 =====

  app.get('/portfolios/:id/returns', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);
    const context = await getUserAnalyticsContext(app.prisma, userId);
    const query = returnsSchema.parse(request.query);

    const result = await computeReturns(app.prisma, {
      userId,
      portfolioId: id,
      timezone: context.timezone,
      fromText: query.from,
      toText: query.to,
    });

    return ok(
      {
        twr: {
          value: result.twr.value === null ? null : result.twr.value.toFixed(8),
          reason: result.twr.reason,
          segments: result.twr.segments,
        },
        xirr: {
          value: result.xirr.value === null ? null : result.xirr.value.toFixed(6),
          reason: result.xirr.reason,
          cashflows: result.xirr.cashflows,
        },
        period: result.period,
        isComplete: result.isComplete,
        missingValuations: result.missingValuations,
      },
      request.id,
    );
  });

  app.get('/portfolios/:id/performance', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);
    const context = await getUserAnalyticsContext(app.prisma, userId);
    const query = returnsSchema.parse(request.query);

    const result = await computePerformance(app.prisma, {
      userId,
      portfolioId: id,
      timezone: context.timezone,
      fromText: query.from,
      toText: query.to,
    });

    return ok(
      {
        points: result.points.map((point) => ({
          date: point.date,
          value: moneyToString(point.value),
          index: point.index === null ? null : point.index.toFixed(6),
          complete: point.complete,
        })),
        granularity: result.granularity,
        downgraded: result.downgraded,
        period: result.period,
        isComplete: result.isComplete,
        missingValuations: result.missingValuations,
      },
      request.id,
    );
  });

  // ===== 配置与再平衡 =====

  app.get('/portfolios/:id/allocation', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);

    const [assetClass, instrument, currency] = await Promise.all([
      computeAllocation(app.prisma, { userId, portfolioId: id, dimension: 'asset_class' }),
      computeAllocation(app.prisma, { userId, portfolioId: id, dimension: 'instrument' }),
      computeAllocation(app.prisma, { userId, portfolioId: id, dimension: 'currency' }),
    ]);

    const serialize = (result: typeof assetClass) => ({
      dimension: result.dimension,
      items: result.items.map((item) => ({
        key: item.key,
        label: item.label,
        value: moneyToString(item.value),
        weight: item.weight === null ? null : item.weight.toFixed(6),
      })),
      total: moneyToString(result.total),
    });

    return ok(
      {
        assetClass: serialize(assetClass),
        instrument: serialize(instrument),
        currency: serialize(currency),
      },
      request.id,
    );
  });

  app.get('/portfolios/:id/targets', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);

    await getPortfolioContext(app.prisma, { userId, portfolioId: id });
    const targets = await getTargets(app.prisma, { userId, portfolioId: id });

    return ok(
      {
        items: targets.map((target) => ({
          dimension: target.dimension,
          targets: target.targets.map((item) => ({
            key: item.key,
            targetWeight: item.targetWeight.toFixed(6),
          })),
        })),
      },
      request.id,
    );
  });

  app.put('/portfolios/:id/targets', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);
    const body = targetsSchema.parse(request.body);

    await assertPortfolioActive(app.prisma, { userId, portfolioId: id });

    const parsed = body.targets.map((item) => ({
      key: item.key,
      targetWeight: toDecimal(item.targetWeight),
    }));

    for (const item of parsed) {
      if (item.targetWeight.lt(0) || item.targetWeight.gt(1)) {
        throw errors.allocationTargetsInvalid('目标权重必须在 0 到 1 之间');
      }
    }

    // 资产类别目标必须落在已知类别内，避免拼错后永远匹配不上
    if (body.dimension === 'asset_class') {
      const allowed = new Set(['stock', 'etf', 'fund', 'bond', 'cash', 'other']);
      for (const item of parsed) {
        if (!allowed.has(item.key)) {
          throw errors.allocationTargetsInvalid(`未知资产类别：${item.key}`);
        }
      }
    }

    assertTargetsSum(parsed);

    await app.prisma.$transaction(async (tx) => {
      await tx.portfolioTarget.deleteMany({
        where: { userId, portfolioId: id, dimension: body.dimension },
      });

      if (parsed.length > 0) {
        await tx.portfolioTarget.createMany({
          data: parsed.map((item) => ({
            userId,
            portfolioId: id,
            dimension: body.dimension,
            key: item.key,
            targetWeight: item.targetWeight,
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          userId,
          action: 'targets.updated',
          targetType: 'portfolio',
          targetId: id,
          metadata: { dimension: body.dimension, itemCount: parsed.length },
        },
      });
    });

    const targets = await getTargets(app.prisma, { userId, portfolioId: id });

    return ok(
      {
        items: targets.map((target) => ({
          dimension: target.dimension,
          targets: target.targets.map((item) => ({
            key: item.key,
            targetWeight: item.targetWeight.toFixed(6),
          })),
        })),
      },
      request.id,
    );
  });

  app.get('/portfolios/:id/drift', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);
    const dimension = (request.query as { dimension?: string }).dimension ?? 'asset_class';

    if (!['asset_class', 'instrument', 'currency'].includes(dimension)) {
      throw errors.validation('不支持的配置维度');
    }

    const result = await computeDrift(app.prisma, {
      userId,
      portfolioId: id,
      dimension: dimension as 'asset_class' | 'instrument' | 'currency',
    });

    return ok(
      {
        dimension: result.dimension,
        items: result.items.map((item) => ({
          key: item.key,
          label: item.label,
          targetWeight: item.targetWeight.toFixed(6),
          currentWeight: item.currentWeight.toFixed(6),
          drift: item.drift.toFixed(6),
          action: item.action,
        })),
        threshold: result.threshold.toFixed(6),
      },
      request.id,
    );
  });

  app.post('/portfolios/:id/rebalance-preview', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);
    const body = rebalancePreviewSchema.parse(request.body ?? {});

    const result = await previewRebalance(app.prisma, {
      userId,
      portfolioId: id,
      dimension: body.dimension ?? 'asset_class',
      amount: body.amount ? toDecimal(body.amount) : null,
    });

    // 只返回建议，不产生任何 portfolio_trades 记录
    return ok(
      {
        dimension: result.dimension,
        totalValue: moneyToString(result.totalValue),
        suggestions: result.suggestions.map((item) => ({
          key: item.key,
          label: item.label,
          action: item.action,
          amount: moneyToString(item.amount),
          quantity: item.quantity === null ? null : item.quantity.toFixed(4),
          price: item.price === null ? null : item.price.toFixed(8),
        })),
        note: result.note ?? null,
      },
      request.id,
    );
  });

  app.get('/portfolios/:id/risk-summary', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);

    const summary = await computeRiskSummary(app.prisma, { userId, portfolioId: id });

    return ok(
      {
        positionCount: summary.positionCount,
        maxWeight: summary.maxWeight === null ? null : summary.maxWeight.toFixed(6),
        maxWeightLabel: summary.maxWeightLabel,
        topThreeWeight: summary.topThreeWeight === null ? null : summary.topThreeWeight.toFixed(6),
        concentrationWarning: summary.concentrationWarning,
        concentrationKeys: summary.concentrationKeys,
        byAssetClass: summary.byAssetClass.map((item) => ({
          key: item.key,
          weight: item.weight === null ? null : item.weight.toFixed(6),
        })),
      },
      request.id,
    );
  });

  // ===== 估值快照 =====

  app.get('/portfolios/:id/valuations', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);

    await getPortfolioContext(app.prisma, { userId, portfolioId: id });

    const valuations = await app.prisma.portfolioValuation.findMany({
      where: { userId, portfolioId: id },
      orderBy: { valuationDate: 'desc' },
      select: {
        id: true,
        valuationDate: true,
        marketValue: true,
        source: true,
        note: true,
      },
    });

    return ok(
      {
        items: valuations.map((item) => ({
          id: item.id,
          valuationDate: item.valuationDate.toISOString().slice(0, 10),
          marketValue: moneyToString(toDecimal(item.marketValue.toString())),
          source: item.source,
          note: item.note,
        })),
      },
      request.id,
    );
  });

  app.post('/portfolios/:id/valuations', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = portfolioIdSchema.parse(request.params);
    const body = createValuationSchema.parse(request.body);

    await getPortfolioContext(app.prisma, { userId, portfolioId: id });

    const valuationDate = new Date(`${body.valuationDate}T00:00:00.000Z`);
    const existing = await app.prisma.portfolioValuation.findFirst({
      where: { userId, portfolioId: id, valuationDate },
      select: { id: true },
    });

    if (existing && !body.overwrite) throw errors.valuationDateExists(existing.id);

    const valuation = await app.prisma.portfolioValuation.upsert({
      where: { portfolioId_valuationDate: { portfolioId: id, valuationDate } },
      create: {
        userId,
        portfolioId: id,
        valuationDate,
        marketValue: toDecimal(body.marketValue),
        source: 'manual',
        note: body.note ?? null,
      },
      update: {
        marketValue: toDecimal(body.marketValue),
        source: 'manual',
        note: body.note ?? null,
      },
      select: { id: true, valuationDate: true, marketValue: true, source: true, note: true },
    });

    return reply.status(201).send(
      ok(
        {
          id: valuation.id,
          valuationDate: valuation.valuationDate.toISOString().slice(0, 10),
          marketValue: moneyToString(toDecimal(valuation.marketValue.toString())),
          source: valuation.source,
          note: valuation.note,
        },
        request.id,
      ),
    );
  });

  app.delete('/portfolios/:id/valuations/:valuationId', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id, valuationId } = valuationIdSchema.parse(request.params);

    const valuation = await app.prisma.portfolioValuation.findFirst({
      where: { id: valuationId, portfolioId: id, userId },
      select: { id: true },
    });
    if (!valuation) throw errors.portfolioValuationNotFound();

    await app.prisma.portfolioValuation.delete({ where: { id: valuationId } });
    return ok({ deleted: true }, request.id);
  });
}
