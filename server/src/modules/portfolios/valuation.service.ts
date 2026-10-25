import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { INVESTMENT_PRICE_STALE_DAYS } from '../../config/constants.js';
import { roundMoney } from '../../lib/money.js';
import { replayTrades, type ReplayTrade } from './holdings.engine.js';

export interface MissingPrice {
  instrumentId: string;
  symbol: string;
  name: string;
}

export interface ValuationResult {
  /** 仅证券市值，不含现金 */
  marketValue: Decimal;
  currency: string;
  /** 最新有效价格所属日期，全无价格时为 null */
  priceDate: string | null;
  stale: boolean;
  isComplete: boolean;
  missingPrices: MissingPrice[];
  holdingValues: Array<{
    instrumentId: string;
    symbol: string;
    name: string;
    quantity: Decimal;
    price: Decimal | null;
    priceDate: string | null;
    marketValue: Decimal;
    stale: boolean;
  }>;
  positionCount: number;
}

function dayKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * 最新价格：优先取 asOf 当日及之前最近一条。
 * 没有价格的标的不会用成本价冒充市值，而是计入 missingPrices 且市值为 0。
 */
export async function latestPrices(
  prisma: PrismaClient,
  params: { userId: string; instrumentIds: string[]; asOf?: Date | null },
): Promise<Map<string, { price: Decimal; priceDate: string }>> {
  const result = new Map<string, { price: Decimal; priceDate: string }>();
  if (params.instrumentIds.length === 0) return result;

  const rows = await prisma.instrumentPrice.findMany({
    where: {
      userId: params.userId,
      instrumentId: { in: params.instrumentIds },
      ...(params.asOf ? { priceDate: { lte: params.asOf } } : {}),
    },
    orderBy: [{ instrumentId: 'asc' }, { priceDate: 'desc' }],
    select: { instrumentId: true, price: true, priceDate: true },
  });

  for (const row of rows) {
    // 结果已按日期倒序，首次出现即为最新
    if (result.has(row.instrumentId)) continue;
    result.set(row.instrumentId, {
      price: new Decimal(row.price.toString()),
      priceDate: dayKeyOf(row.priceDate),
    });
  }

  return result;
}

/** 计算一组持仓在某一时点的证券市值与数据完整性 */
export async function valueHoldings(
  prisma: PrismaClient,
  params: {
    userId: string;
    currency: string;
    holdings: Array<{ instrumentId: string; quantity: Decimal }>;
    asOf?: Date | null;
  },
): Promise<ValuationResult> {
  const asOf = params.asOf ?? new Date();
  const active = params.holdings.filter((holding) => holding.quantity.gt(0));
  const instrumentIds = active.map((holding) => holding.instrumentId);

  const [prices, instruments] = await Promise.all([
    latestPrices(prisma, { userId: params.userId, instrumentIds, asOf }),
    instrumentIds.length > 0
      ? prisma.instrument.findMany({
          where: { userId: params.userId, id: { in: instrumentIds } },
          select: { id: true, symbol: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const instrumentMeta = new Map(instruments.map((item) => [item.id, item]));
  const staleThreshold = new Date(asOf.getTime() - INVESTMENT_PRICE_STALE_DAYS * 86_400_000);
  const staleThresholdKey = dayKeyOf(staleThreshold);

  let marketValue = new Decimal(0);
  let latestKey: string | null = null;
  let anyStale = false;
  const missingPrices: MissingPrice[] = [];

  const holdingValues = active.map((holding) => {
    const meta = instrumentMeta.get(holding.instrumentId);
    const price = prices.get(holding.instrumentId) ?? null;

    if (!price) {
      if (meta) {
        missingPrices.push({ instrumentId: meta.id, symbol: meta.symbol, name: meta.name });
      }
      return {
        instrumentId: holding.instrumentId,
        symbol: meta?.symbol ?? holding.instrumentId,
        name: meta?.name ?? '',
        quantity: holding.quantity,
        price: null,
        priceDate: null,
        marketValue: new Decimal(0),
        stale: true,
      };
    }

    const value = roundMoney(holding.quantity.mul(price.price));
    marketValue = marketValue.plus(value);

    if (!latestKey || price.priceDate > latestKey) latestKey = price.priceDate;
    const isStale = price.priceDate < staleThresholdKey;
    if (isStale) anyStale = true;

    return {
      instrumentId: holding.instrumentId,
      symbol: meta?.symbol ?? holding.instrumentId,
      name: meta?.name ?? '',
      quantity: holding.quantity,
      price: price.price,
      priceDate: price.priceDate,
      marketValue: value,
      stale: isStale,
    };
  });

  return {
    marketValue: roundMoney(marketValue),
    currency: params.currency,
    priceDate: latestKey,
    // 任一持仓价格过期即整体标记过期，避免部分旧价被整体当作新价
    stale: anyStale,
    isComplete: missingPrices.length === 0,
    missingPrices,
    holdingValues,
    positionCount: active.length,
  };
}

/** 读取组合的全部交易并重放，供估值与收益共用 */
export async function loadReplayTrades(
  prisma: PrismaClient,
  params: { userId: string; portfolioId: string; asOf?: Date | null },
): Promise<ReplayTrade[]> {
  const trades = await prisma.portfolioTrade.findMany({
    where: {
      userId: params.userId,
      portfolioId: params.portfolioId,
      voidedAt: null,
      ...(params.asOf ? { tradeDate: { lte: params.asOf } } : {}),
    },
    orderBy: [{ tradeDate: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      kind: true,
      tradeDate: true,
      createdAt: true,
      instrumentId: true,
      quantity: true,
      price: true,
      amount: true,
      fee: true,
      tax: true,
    },
  });

  return trades.map((trade, index) => ({
    id: trade.id,
    kind: trade.kind as ReplayTrade['kind'],
    tradeDate: trade.tradeDate,
    sequence: index,
    instrumentId: trade.instrumentId,
    quantity: trade.quantity ? new Decimal(trade.quantity.toString()) : null,
    price: trade.price ? new Decimal(trade.price.toString()) : null,
    amount: new Decimal(trade.amount.toString()),
    fee: new Decimal(trade.fee.toString()),
    tax: new Decimal(trade.tax.toString()),
  }));
}

/** 组合在某一时点的持仓与总成本 */
export async function portfolioPositions(
  prisma: PrismaClient,
  params: { userId: string; portfolioId: string; asOf?: Date | null },
) {
  const trades = await loadReplayTrades(prisma, params);
  const outcome = replayTrades(trades, { asOf: params.asOf });
  if (!outcome.ok) {
    return { ok: false as const, outcome };
  }
  return { ok: true as const, outcome, holdings: outcome.holdings };
}

export interface PortfolioValuationSummary {
  portfolioId: string;
  name: string;
  currency: string;
  marketValue: Decimal;
  priceDate: string | null;
  stale: boolean;
  isComplete: boolean;
  missingSymbols: string[];
  /** 逐标的的价格日期，供数据质量下钻；无价标的 priceDate 为 null */
  holdings: Array<{ instrumentId: string; symbol: string; name: string; priceDate: string | null }>;
}

/**
 * 所有活跃组合的证券市值。
 * 证券账户的现金已由账户余额计入净资产，这里只加证券市值，避免重复。
 */
export async function loadAllPortfolioValuations(
  prisma: PrismaClient,
  params: { userId: string; asOf: Date },
): Promise<PortfolioValuationSummary[]> {
  const portfolios = await prisma.portfolio.findMany({
    where: { userId: params.userId, status: 'active' },
    select: { id: true, name: true, currency: true },
  });

  const summaries: PortfolioValuationSummary[] = [];

  for (const portfolio of portfolios) {
    const positions = await portfolioPositions(prisma, {
      userId: params.userId,
      portfolioId: portfolio.id,
      asOf: params.asOf,
    });

    const holdings = positions.ok ? positions.holdings : [];
    const valuation = await valueHoldings(prisma, {
      userId: params.userId,
      currency: portfolio.currency,
      holdings: holdings.map((holding) => ({
        instrumentId: holding.instrumentId,
        quantity: holding.quantity,
      })),
      asOf: params.asOf,
    });

    summaries.push({
      portfolioId: portfolio.id,
      name: portfolio.name,
      currency: portfolio.currency,
      marketValue: valuation.marketValue,
      priceDate: valuation.priceDate,
      stale: valuation.stale,
      isComplete: valuation.isComplete,
      missingSymbols: valuation.missingPrices.map((item) => item.symbol),
      holdings: valuation.holdingValues.map((item) => ({
        instrumentId: item.instrumentId,
        symbol: item.symbol,
        name: item.name,
        priceDate: item.priceDate,
      })),
    });
  }

  return summaries;
}
