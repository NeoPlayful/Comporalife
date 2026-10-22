import Decimal from 'decimal.js';
import type { Prisma, PrismaClient } from '@prisma/client';
import { computeBalance } from '../accounts/balance.service.js';
import { errors } from '../../lib/errors.js';
import { roundMoney } from '../../lib/money.js';
import { buildEntries, assertBalanced } from '../ledger/entry.service.js';
import { replayTrades } from './holdings.engine.js';
import {
  loadReplayTrades,
  portfolioPositions,
  valueHoldings,
  type MissingPrice,
} from './valuation.service.js';

export interface PortfolioContext {
  id: string;
  name: string;
  currency: string;
  accountId: string;
  costBasisMethod: 'average';
  status: 'active' | 'archived';
  version: number;
  note: string | null;
}

/** 组合与账户一对一，且账户必须是同币种的证券账户 */
export async function assertPortfolioAccount(
  prisma: PrismaClient,
  params: { userId: string; accountId: string; portfolioId?: string },
): Promise<{ id: string; currency: string; name: string }> {
  const account = await prisma.account.findFirst({
    where: { id: params.accountId, userId: params.userId },
    select: { id: true, type: true, status: true, currency: true, name: true },
  });

  if (!account || account.status !== 'active') {
    throw errors.portfolioAccountInvalid('资金账户不存在或已归档');
  }
  if (account.type !== 'brokerage') {
    throw errors.portfolioAccountInvalid('投资组合只能绑定证券账户');
  }

  const occupied = await prisma.portfolio.findFirst({
    where: {
      userId: params.userId,
      accountId: params.accountId,
      ...(params.portfolioId ? { id: { not: params.portfolioId } } : {}),
    },
    select: { id: true },
  });

  if (occupied) {
    throw errors.portfolioAccountInvalid('该资金账户已被其他组合占用');
  }

  return { id: account.id, currency: account.currency, name: account.name };
}

export async function getPortfolioContext(
  prisma: PrismaClient,
  params: { userId: string; portfolioId: string },
): Promise<PortfolioContext> {
  const portfolio = await prisma.portfolio.findFirst({
    where: { id: params.portfolioId, userId: params.userId },
    select: {
      id: true,
      name: true,
      currency: true,
      accountId: true,
      costBasisMethod: true,
      status: true,
      version: true,
      note: true,
    },
  });

  // 不存在与不属于当前用户返回同一错误，避免 ID 枚举
  if (!portfolio) throw errors.portfolioNotFound();

  return {
    id: portfolio.id,
    name: portfolio.name,
    currency: portfolio.currency,
    accountId: portfolio.accountId,
    costBasisMethod: portfolio.costBasisMethod,
    status: portfolio.status,
    version: portfolio.version,
    note: portfolio.note,
  };
}

export async function assertPortfolioActive(
  prisma: PrismaClient,
  params: { userId: string; portfolioId: string },
): Promise<PortfolioContext> {
  const context = await getPortfolioContext(prisma, params);
  if (context.status === 'archived') throw errors.portfolioArchived();
  return context;
}

export interface HoldingView {
  instrumentId: string;
  symbol: string;
  name: string;
  assetClass: string;
  quantity: Decimal;
  averageCost: Decimal | null;
  totalCost: Decimal;
  price: Decimal | null;
  priceDate: string | null;
  stale: boolean;
  marketValue: Decimal;
  unrealizedPnl: Decimal | null;
  unrealizedRatio: Decimal | null;
  weight: Decimal | null;
  realizedPnl: Decimal;
}

export interface PortfolioSummaryView {
  portfolio: PortfolioContext;
  cash: Decimal;
  marketValue: Decimal;
  portfolioValue: Decimal;
  totalCost: Decimal;
  unrealizedPnl: Decimal | null;
  realizedPnl: Decimal;
  dividends: Decimal;
  interest: Decimal;
  totalPnl: Decimal;
  holdings: HoldingView[];
  priceDate: string | null;
  stale: boolean;
  isComplete: boolean;
  missingPrices: MissingPrice[];
  positionCount: number;
}

/**
 * 组合总览 = 账户现金 + 证券市值。
 * 现金来自账本余额，市值来自价格表，两者来源不同但相加不重复：
 * 买入时现金减少、市值增加，总价值不变。
 */
export async function summarizePortfolio(
  prisma: PrismaClient,
  params: { userId: string; portfolioId: string; asOf?: Date | null },
): Promise<PortfolioSummaryView> {
  const context = await getPortfolioContext(prisma, params);
  const asOf = params.asOf ?? new Date();

  const positions = await portfolioPositions(prisma, {
    userId: params.userId,
    portfolioId: context.id,
    asOf,
  });

  const holdings = positions.ok ? positions.holdings : [];

  const [valuation, balance, instruments] = await Promise.all([
    valueHoldings(prisma, {
      userId: params.userId,
      currency: context.currency,
      holdings: holdings.map((holding) => ({
        instrumentId: holding.instrumentId,
        quantity: holding.quantity,
      })),
      asOf,
    }),
    computeBalance(prisma, { userId: params.userId, accountId: context.accountId, asOf }),
    holdings.length > 0
      ? prisma.instrument.findMany({
          where: { userId: params.userId, id: { in: holdings.map((h) => h.instrumentId) } },
          select: { id: true, symbol: true, name: true, assetClass: true },
        })
      : Promise.resolve([]),
  ]);

  const metaById = new Map(instruments.map((item) => [item.id, item]));
  const valueById = new Map(valuation.holdingValues.map((item) => [item.instrumentId, item]));

  // 只对仍有持仓的标的展示在手成本；已清仓的成本为零，收益全在已实现里
  const totalCost = holdings.reduce(
    (sum, holding) => sum.plus(holding.totalCost),
    new Decimal(0),
  );

  const holdingViews: HoldingView[] = holdings.map((holding) => {
    const meta = metaById.get(holding.instrumentId);
    const value = valueById.get(holding.instrumentId);

    const marketValue = value?.marketValue ?? new Decimal(0);
    // 无价格时不计算未实现损益，避免用成本价冒充市值
    const unrealizedPnl =
      value?.price && holding.quantity.gt(0) ? roundMoney(marketValue.minus(holding.totalCost)) : null;

    return {
      instrumentId: holding.instrumentId,
      symbol: meta?.symbol ?? '',
      name: meta?.name ?? '',
      assetClass: meta?.assetClass ?? 'other',
      quantity: holding.quantity,
      averageCost: holding.averageCost,
      totalCost: holding.totalCost,
      price: value?.price ?? null,
      priceDate: value?.priceDate ?? null,
      stale: value?.stale ?? true,
      marketValue,
      unrealizedPnl,
      unrealizedRatio:
        unrealizedPnl && holding.totalCost.gt(0)
          ? unrealizedPnl.div(holding.totalCost).toDecimalPlaces(6)
          : null,
      weight: null,
      realizedPnl: holding.realizedPnl,
    };
  });

  // 权重不含现金，合计为 1；无持仓时全部为 null
  const marketTotal = valuation.marketValue;
  for (const view of holdingViews) {
    if (marketTotal.gt(0) && view.marketValue.gt(0)) {
      view.weight = view.marketValue.div(marketTotal).toDecimalPlaces(6);
    }
  }

  const replay = positions.ok ? positions.outcome : null;
  const dividends = replay?.dividends ?? new Decimal(0);
  const interest = replay?.interest ?? new Decimal(0);
  const realizedPnl = replay?.realizedPnl ?? new Decimal(0);

  const unrealizedTotal = holdingViews.reduce<Decimal | null>(
    (sum, view) => (view.unrealizedPnl === null ? sum : (sum ?? new Decimal(0)).plus(view.unrealizedPnl)),
    null,
  );

  return {
    portfolio: context,
    cash: balance.balance,
    marketValue: valuation.marketValue,
    portfolioValue: roundMoney(balance.balance.plus(valuation.marketValue)),
    totalCost: roundMoney(totalCost),
    unrealizedPnl: unrealizedTotal === null ? null : roundMoney(unrealizedTotal),
    realizedPnl: roundMoney(realizedPnl),
    dividends: roundMoney(dividends),
    interest: roundMoney(interest),
    totalPnl: roundMoney(
      (unrealizedTotal ?? new Decimal(0)).plus(realizedPnl).plus(dividends).plus(interest),
    ),
    holdings: holdingViews,
    priceDate: valuation.priceDate,
    stale: valuation.stale,
    isComplete: valuation.isComplete,
    missingPrices: valuation.missingPrices,
    positionCount: valuation.positionCount,
  };
}

export interface TradeLedgerResult {
  transactionId: string;
}

/**
 * 入金/出金也写进账本，否则组合价值曲线里的现金恒为 0，
 * 收益与净资产都会失真。
 *
 * 语义上它们是「外部资金 ↔ 证券账户」的转移，不是收入也不是支出，
 * 因此同样使用 investment 类型，这样分析口径会自动排除它们。
 */
export async function writeCashflowLedger(
  prisma: DbClient,
  params: {
    userId: string;
    accountId: string;
    currency: string;
    kind: 'deposit' | 'withdraw';
    flowDate: Date;
    amount: Decimal;
  },
): Promise<TradeLedgerResult | null> {
  const magnitude = roundMoney(params.amount);
  if (magnitude.lte(0)) return null;

  const entries = buildEntries({
    type: 'investment',
    magnitude,
    accountId: params.accountId,
    currency: params.currency,
    cashDirection: params.kind === 'deposit' ? 'in' : 'out',
  });
  assertBalanced(entries, 'investment');

  const transaction = await prisma.transaction.create({
    data: {
      userId: params.userId,
      type: 'investment',
      occurredAt: params.flowDate,
      description: params.kind === 'deposit' ? '投资入金' : '投资出金',
      categoryId: null,
      source: 'manual',
      entries: {
        create: entries.map((entry) => ({
          userId: params.userId,
          accountId: entry.accountId,
          amount: entry.amount.toString(),
          currency: entry.currency,
        })),
      },
    },
    select: { id: true },
  });

  return { transactionId: transaction.id };
}

/**
 * 投资交易的账本映射。
 *
 * 买卖是资产转换（investment），股息/利息是收入，手续费/税费是支出。
 * 买卖的手续费与税费并入同一条账本交易的现金变动，
 * 否则一次买入会产生两条交易、账单对不上。
 */
type DbClient = PrismaClient | Prisma.TransactionClient;

export async function writeTradeLedger(
  prisma: DbClient,
  params: {
    userId: string;
    accountId: string;
    currency: string;
    kind: 'buy' | 'sell' | 'dividend' | 'interest' | 'fee' | 'tax';
    tradeDate: Date;
    amount: Decimal;
    fee: Decimal;
    tax: Decimal;
    categoryId: string | null;
    description: string;
  },
): Promise<TradeLedgerResult | null> {
  const { kind } = params;

  let type: 'investment' | 'income' | 'expense';
  let magnitude: Decimal;
  let cashDirection: 'in' | 'out' | undefined;

  if (kind === 'buy') {
    type = 'investment';
    magnitude = roundMoney(params.amount.plus(params.fee).plus(params.tax));
    cashDirection = 'out';
  } else if (kind === 'sell') {
    type = 'investment';
    magnitude = roundMoney(params.amount.minus(params.fee).minus(params.tax));
    cashDirection = 'in';
  } else if (kind === 'dividend' || kind === 'interest') {
    type = 'income';
    magnitude = roundMoney(params.amount);
  } else {
    type = 'expense';
    magnitude = roundMoney(params.amount.plus(params.fee).plus(params.tax));
  }

  // 净额为 0 时不写账本，避免产生一条零金额交易
  if (magnitude.lte(0)) return null;

  const entries = buildEntries({
    type,
    magnitude,
    accountId: params.accountId,
    currency: params.currency,
    cashDirection,
  });
  assertBalanced(entries, type);

  const transaction = await prisma.transaction.create({
    data: {
      userId: params.userId,
      type,
      occurredAt: params.tradeDate,
      description: params.description,
      categoryId: type === 'investment' ? null : params.categoryId,
      source: 'manual',
      entries: {
        create: entries.map((entry) => ({
          userId: params.userId,
          accountId: entry.accountId,
          amount: entry.amount.toString(),
          currency: entry.currency,
        })),
      },
    },
    select: { id: true },
  });

  return { transactionId: transaction.id };
}

/** 交易修改与撤销都走冲正，不原地改分录，保留审计链 */
export async function voidLedgerTransaction(
  prisma: DbClient,
  params: { userId: string; transactionId: string },
): Promise<void> {
  const existing = await prisma.transaction.findFirst({
    where: { id: params.transactionId, userId: params.userId },
    select: { id: true, status: true },
  });

  if (!existing || existing.status === 'voided') return;

  await prisma.transaction.update({
    where: { id: existing.id },
    data: { status: 'voided', voidedAt: new Date() },
  });
}

/** 卖出前按成交日校验持仓，避免用今天的持仓放行历史超卖 */
export async function availableQuantityAt(
  prisma: PrismaClient,
  params: { userId: string; portfolioId: string; instrumentId: string; tradeDate: Date },
): Promise<Decimal> {
  const trades = await loadReplayTrades(prisma, {
    userId: params.userId,
    portfolioId: params.portfolioId,
    asOf: params.tradeDate,
  });

  const outcome = replayTrades(trades, { asOf: params.tradeDate });
  if (!outcome.ok) return new Decimal(0);

  const holding = outcome.holdings.find((item) => item.instrumentId === params.instrumentId);
  return holding?.quantity ?? new Decimal(0);
}
