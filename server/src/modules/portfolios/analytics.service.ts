import Decimal from 'decimal.js';
import { formatInTimeZone } from 'date-fns-tz';
import { addDays, subDays } from 'date-fns';
import type { PrismaClient } from '@prisma/client';
import {
  INVESTMENT_CONCENTRATION_WARNING_RATIO,
  INVESTMENT_MAX_CASHFLOWS,
  INVESTMENT_MAX_SERIES_POINTS,
  INVESTMENT_REBALANCE_DRIFT_THRESHOLD,
  INVESTMENT_REBALANCE_QUANTITY_DECIMALS,
} from '../../config/constants.js';
import { errors } from '../../lib/errors.js';
import { roundMoney, toDecimal } from '../../lib/money.js';
import {
  computeTwr,
  computeXirr,
  downgradeGranularity,
  type ExternalCashflow,
  type ValuePoint,
} from './performance.engine.js';
import { summarizePortfolio, getPortfolioContext } from './portfolio.service.js';
import { portfolioPositions, valueHoldings } from './valuation.service.js';

function dayKeyOf(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'yyyy-MM-dd');
}

/**
 * 默认区间：从组合的第一笔交易或入金开始。
 *
 * 不能用「今天往前 365 天」——组合成立于那天之后时，起点价值为 0，
 * TWR 会直接不可算，用户一打开收益页看到的就是破折号。
 */
async function defaultRange(
  prisma: PrismaClient,
  params: { userId: string; portfolioId: string; timezone: string },
): Promise<{ fromText: string; toText: string }> {
  const [firstTrade, firstFlow] = await Promise.all([
    prisma.portfolioTrade.findFirst({
      where: { userId: params.userId, portfolioId: params.portfolioId, voidedAt: null },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true },
    }),
    prisma.portfolioCashflow.findFirst({
      where: { userId: params.userId, portfolioId: params.portfolioId },
      orderBy: { flowDate: 'asc' },
      select: { flowDate: true },
    }),
  ]);

  const candidates = [firstTrade?.tradeDate, firstFlow?.flowDate].filter(
    (date): date is Date => date !== undefined,
  );

  const today = new Date();
  const fallback = dayKeyOf(subDays(today, 365), params.timezone);

  // 起点取最早一笔，且不晚于今天
  const start =
    candidates.length > 0
      ? dayKeyOf(new Date(Math.min(...candidates.map((date) => date.getTime()))), params.timezone)
      : fallback;

  return {
    fromText: start > dayKeyOf(today, params.timezone) ? dayKeyOf(today, params.timezone) : start,
    toText: dayKeyOf(today, params.timezone),
  };
}

export interface CashflowView {
  id: string;
  kind: 'deposit' | 'withdraw';
  flowDate: string;
  amount: Decimal;
  transactionId: string | null;
  note: string | null;
}

export async function listCashflows(
  prisma: PrismaClient,
  params: { userId: string; portfolioId: string; timezone: string },
): Promise<CashflowView[]> {
  const rows = await prisma.portfolioCashflow.findMany({
    where: { userId: params.userId, portfolioId: params.portfolioId },
    orderBy: { flowDate: 'asc' },
    select: { id: true, kind: true, flowDate: true, amount: true, transactionId: true, note: true },
  });

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    flowDate: dayKeyOf(row.flowDate, params.timezone),
    amount: toDecimal(row.amount.toString()),
    transactionId: row.transactionId,
    note: row.note,
  }));
}

/**
 * 组合价值曲线。
 *
 * 每个采样点都要重放持仓并按当日价格估值，因此采样点越密越慢。
 * 缺价的点标记 complete = false，曲线断开，绝不用相邻点插值。
 */
async function buildValueSeries(
  prisma: PrismaClient,
  params: {
    userId: string;
    portfolioId: string;
    currency: string;
    accountId: string;
    timezone: string;
    fromText: string;
    toText: string;
    dates: string[];
  },
): Promise<ValuePoint[]> {
  const points: ValuePoint[] = [];

  for (const date of params.dates) {
    // 采样点按用户时区当日零点，与账本口径一致
    const asOf = new Date(`${date}T23:59:59.999Z`);

    const positions = await portfolioPositions(prisma, {
      userId: params.userId,
      portfolioId: params.portfolioId,
      asOf,
    });

    if (!positions.ok) {
      points.push({ date, value: new Decimal(0), complete: false });
      continue;
    }

    const valuation = await valueHoldings(prisma, {
      userId: params.userId,
      currency: params.currency,
      holdings: positions.holdings.map((holding) => ({
        instrumentId: holding.instrumentId,
        quantity: holding.quantity,
      })),
      asOf,
    });

    // 组合价值需要现金，但历史现金无法直接取，
    // 因此用「初始入金 + 累计外部现金流 + 已实现损益 + 股息」反推现金
    const balance = await prisma.transactionEntry.aggregate({
      where: {
        userId: params.userId,
        accountId: params.accountId,
        transaction: { status: 'posted', occurredAt: { lte: asOf } },
      },
      _sum: { amount: true },
    });

    const cash = toDecimal(balance._sum.amount?.toString() ?? '0');

    points.push({
      date,
      value: roundMoney(cash.plus(valuation.marketValue)),
      complete: valuation.isComplete,
    });
  }

  return points;
}

function enumerateDates(fromText: string, toText: string, granularity: 'day' | 'week' | 'month'): string[] {
  const dates: string[] = [];
  let cursor = new Date(`${fromText}T00:00:00Z`);
  const end = new Date(`${toText}T00:00:00Z`);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    if (granularity === 'day') cursor = addDays(cursor, 1);
    else if (granularity === 'week') cursor = addDays(cursor, 7);
    else {
      const next = new Date(cursor);
      next.setUTCMonth(next.getUTCMonth() + 1);
      cursor = next;
    }
  }

  // 终点必须落在区间末端，否则最后一段收益会丢失
  const last = dates[dates.length - 1];
  if (last !== toText) dates.push(toText);

  return dates;
}

export interface ReturnsResult {
  twr: { value: Decimal | null; reason: string | null; segments: unknown[] };
  xirr: { value: Decimal | null; reason: string | null; cashflows: unknown[] };
  period: { from: string; to: string };
  isComplete: boolean;
  missingValuations: string[];
}

export async function computeReturns(
  prisma: PrismaClient,
  params: {
    userId: string;
    portfolioId: string;
    timezone: string;
    fromText?: string;
    toText?: string;
  },
): Promise<ReturnsResult> {
  const context = await getPortfolioContext(prisma, {
    userId: params.userId,
    portfolioId: params.portfolioId,
  });

  const fallback = await defaultRange(prisma, {
    userId: params.userId,
    portfolioId: context.id,
    timezone: params.timezone,
  });
  const fromText = params.fromText ?? fallback.fromText;
  const toText = params.toText ?? fallback.toText;

  if (fromText > toText) {
    throw errors.portfolioRangeInvalid('起始日期不能晚于结束日期');
  }

  const flows = await listCashflows(prisma, {
    userId: params.userId,
    portfolioId: context.id,
    timezone: params.timezone,
  });

  if (flows.length > INVESTMENT_MAX_CASHFLOWS) {
    throw errors.portfolioTooManyCashflows(INVESTMENT_MAX_CASHFLOWS);
  }

  const externalFlows: ExternalCashflow[] = flows.map((flow) => ({
    date: flow.flowDate,
    amount: flow.amount,
    kind: flow.kind,
  }));

  // TWR 的分段点 = 首尾 + 区间内每个现金流日
  const boundaries = [
    fromText,
    ...externalFlows.filter((flow) => flow.date > fromText && flow.date <= toText).map((flow) => flow.date),
    toText,
  ].filter((date, index, list) => list.indexOf(date) === index);

  const points = await buildValueSeries(prisma, {
    userId: params.userId,
    portfolioId: context.id,
    currency: context.currency,
    accountId: context.accountId,
    timezone: params.timezone,
    fromText,
    toText,
    dates: boundaries.sort(),
  });

  const twr = computeTwr({ startDate: fromText, endDate: toText, points, cashflows: externalFlows });

  const terminal = points.find((point) => point.date === toText);
  const xirr = computeXirr({
    startDate: fromText,
    endDate: toText,
    cashflows: externalFlows,
    terminalValue: terminal?.value ?? new Decimal(0),
  });

  // 缺价的采样点必须显式列出，用户才知道收益为何不可计算
  const missingValuations = points.filter((point) => !point.complete).map((point) => point.date);

  return {
    twr: { value: twr.value, reason: twr.reason, segments: twr.segments },
    xirr: { value: xirr.value, reason: xirr.reason, cashflows: xirr.cashflows },
    period: { from: fromText, to: toText },
    isComplete: missingValuations.length === 0,
    missingValuations,
  };
}

export interface PerformanceResult {
  points: Array<{ date: string; value: Decimal; index: Decimal | null; complete: boolean }>;
  granularity: 'day' | 'week' | 'month';
  downgraded: boolean;
  period: { from: string; to: string };
  isComplete: boolean;
  missingValuations: string[];
}

export async function computePerformance(
  prisma: PrismaClient,
  params: {
    userId: string;
    portfolioId: string;
    timezone: string;
    fromText?: string;
    toText?: string;
  },
): Promise<PerformanceResult> {
  const context = await getPortfolioContext(prisma, {
    userId: params.userId,
    portfolioId: params.portfolioId,
  });

  const fallback = await defaultRange(prisma, {
    userId: params.userId,
    portfolioId: context.id,
    timezone: params.timezone,
  });
  const fromText = params.fromText ?? fallback.fromText;
  const toText = params.toText ?? fallback.toText;

  if (fromText > toText) {
    throw errors.portfolioRangeInvalid('起始日期不能晚于结束日期');
  }

  const days = Math.floor(
    (Date.parse(`${toText}T00:00:00Z`) - Date.parse(`${fromText}T00:00:00Z`)) / 86_400_000,
  ) + 1;
  const granularity = downgradeGranularity(days, INVESTMENT_MAX_SERIES_POINTS);
  const dates = enumerateDates(fromText, toText, granularity);

  const values = await buildValueSeries(prisma, {
    userId: params.userId,
    portfolioId: context.id,
    currency: context.currency,
    accountId: context.accountId,
    timezone: params.timezone,
    fromText,
    toText,
    dates,
  });

  const base = values.find((point) => point.complete && point.value.gt(0));

  const missingValuations = values.filter((point) => !point.complete).map((point) => point.date);

  return {
    points: values.map((point) => ({
      date: point.date,
      value: point.value,
      // 以区间内首个有效点为基准 1；基准点之前或缺失时为 null
      index: base && point.complete ? point.value.div(base.value).toDecimalPlaces(6) : null,
      complete: point.complete,
    })),
    granularity,
    downgraded: granularity !== 'day',
    period: { from: fromText, to: toText },
    isComplete: missingValuations.length === 0,
    missingValuations,
  };
}

export interface AllocationItem {
  key: string;
  label: string;
  value: Decimal;
  weight: Decimal | null;
}

export interface AllocationResult {
  dimension: 'asset_class' | 'instrument' | 'currency';
  items: AllocationItem[];
  total: Decimal;
}

export async function computeAllocation(
  prisma: PrismaClient,
  params: {
    userId: string;
    portfolioId: string;
    dimension: 'asset_class' | 'instrument' | 'currency';
  },
): Promise<AllocationResult> {
  const summary = await summarizePortfolio(prisma, {
    userId: params.userId,
    portfolioId: params.portfolioId,
  });

  const buckets = new Map<string, { value: Decimal; label: string }>();

  for (const holding of summary.holdings) {
    if (holding.marketValue.lte(0)) continue;

    const key =
      params.dimension === 'asset_class'
        ? holding.assetClass
        : params.dimension === 'instrument'
          ? holding.instrumentId
          : summary.portfolio.currency;

    const label =
      params.dimension === 'asset_class'
        ? holding.assetClass
        : params.dimension === 'instrument'
          ? `${holding.symbol} ${holding.name}`.trim()
          : summary.portfolio.currency;

    const existing = buckets.get(key);
    buckets.set(key, {
      value: (existing?.value ?? new Decimal(0)).plus(holding.marketValue),
      label,
    });
  }

  const total = [...buckets.values()].reduce((sum, item) => sum.plus(item.value), new Decimal(0));

  return {
    dimension: params.dimension,
    items: [...buckets.entries()]
      .map(([key, item]) => ({
        key,
        label: item.label,
        value: roundMoney(item.value),
        weight: total.gt(0) ? item.value.div(total).toDecimalPlaces(6) : null,
      }))
      .sort((a, b) => b.value.comparedTo(a.value)),
    total: roundMoney(total),
  };
}

export interface TargetView {
  dimension: 'asset_class' | 'instrument' | 'currency';
  targets: Array<{ key: string; targetWeight: Decimal }>;
}

export async function getTargets(
  prisma: PrismaClient,
  params: { userId: string; portfolioId: string },
): Promise<TargetView[]> {
  const rows = await prisma.portfolioTarget.findMany({
    where: { userId: params.userId, portfolioId: params.portfolioId },
    orderBy: [{ dimension: 'asc' }, { key: 'asc' }],
    select: { dimension: true, key: true, targetWeight: true },
  });

  const grouped = new Map<string, TargetView>();

  for (const row of rows) {
    const existing = grouped.get(row.dimension) ?? { dimension: row.dimension, targets: [] };
    existing.targets.push({ key: row.key, targetWeight: toDecimal(row.targetWeight.toString()) });
    grouped.set(row.dimension, existing);
  }

  return [...grouped.values()];
}

/**
 * 目标权重按维度独立校验：合计必须为 1。
 * 偏差大于 1e-6 就拒绝，避免 99.99% 这类「看起来对」的输入通过。
 */
export function assertTargetsSum(targets: Array<{ targetWeight: Decimal }>): void {
  const total = targets.reduce((sum, item) => sum.plus(item.targetWeight), new Decimal(0));
  if (total.minus(1).abs().gt('0.000001')) {
    throw errors.allocationTargetsMismatch(total.toFixed(6));
  }
}

export interface DriftItem {
  key: string;
  label: string;
  targetWeight: Decimal;
  currentWeight: Decimal;
  drift: Decimal;
  action: 'buy' | 'sell' | 'none';
}

export async function computeDrift(
  prisma: PrismaClient,
  params: {
    userId: string;
    portfolioId: string;
    dimension: 'asset_class' | 'instrument' | 'currency';
  },
): Promise<{ dimension: string; items: DriftItem[]; threshold: Decimal }> {
  const [allocation, targets] = await Promise.all([
    computeAllocation(prisma, {
      userId: params.userId,
      portfolioId: params.portfolioId,
      dimension: params.dimension,
    }),
    getTargets(prisma, { userId: params.userId, portfolioId: params.portfolioId }),
  ]);

  const target = targets.find((item) => item.dimension === params.dimension);
  // 未设置目标时返回空数组，而不是报错：用户可能只是还没配置
  if (!target) {
    return { dimension: params.dimension, items: [], threshold: new Decimal(INVESTMENT_REBALANCE_DRIFT_THRESHOLD) };
  }

  const currentByKey = new Map(allocation.items.map((item) => [item.key, item]));
  const threshold = new Decimal(INVESTMENT_REBALANCE_DRIFT_THRESHOLD);

  const items: DriftItem[] = target.targets.map((item) => {
    const current = currentByKey.get(item.key);
    const currentWeight = current?.weight ?? new Decimal(0);
    const drift = currentWeight.minus(item.targetWeight);

    return {
      key: item.key,
      label: current?.label ?? item.key,
      targetWeight: item.targetWeight,
      currentWeight,
      drift,
      action: drift.abs().lte(threshold) ? 'none' : drift.isPositive() ? 'sell' : 'buy',
    };
  });

  return { dimension: params.dimension, items, threshold };
}

export interface RebalanceSuggestion {
  key: string;
  label: string;
  action: 'buy' | 'sell' | 'none';
  amount: Decimal;
  quantity: Decimal | null;
  price: Decimal | null;
}

/**
 * 再平衡预览：只计算建议，绝不写入交易。
 * 数量向下取整到 4 位，避免建议买入量因四舍五入超过可用资金。
 */
export async function previewRebalance(
  prisma: PrismaClient,
  params: {
    userId: string;
    portfolioId: string;
    dimension: 'asset_class' | 'instrument' | 'currency';
    amount?: Decimal | null;
  },
): Promise<{ dimension: string; totalValue: Decimal; suggestions: RebalanceSuggestion[]; note?: string }> {
  const summary = await summarizePortfolio(prisma, {
    userId: params.userId,
    portfolioId: params.portfolioId,
  });

  const drift = await computeDrift(prisma, {
    userId: params.userId,
    portfolioId: params.portfolioId,
    dimension: params.dimension,
  });

  if (drift.items.length === 0) {
    return {
      dimension: params.dimension,
      totalValue: summary.marketValue,
      suggestions: [],
      note: 'no_targets',
    };
  }

  // 本次可投入金额：用户指定则用指定值，否则按现有市值内调仓
  const investable = params.amount ?? summary.marketValue;
  const priceById = new Map(summary.holdings.map((holding) => [holding.instrumentId, holding.price]));

  const suggestions: RebalanceSuggestion[] = drift.items
    .filter((item) => item.action !== 'none')
    .map((item) => {
      const amount = roundMoney(investable.mul(item.drift.abs()));
      const price = priceById.get(item.key) ?? null;
      const quantity = price && price.gt(0)
        ? amount.div(price).toDecimalPlaces(INVESTMENT_REBALANCE_QUANTITY_DECIMALS, Decimal.ROUND_DOWN)
        : null;

      return {
        key: item.key,
        label: item.label,
        action: item.action,
        amount,
        quantity,
        price,
      };
    });

  return {
    dimension: params.dimension,
    totalValue: summary.marketValue,
    suggestions,
    // 资产类别的建议无法映射到具体标的，必须说清楚
    note: params.dimension === 'instrument' ? undefined : 'category_level',
  };
}

export interface RiskSummary {
  positionCount: number;
  maxWeight: Decimal | null;
  maxWeightLabel: string | null;
  topThreeWeight: Decimal | null;
  concentrationWarning: boolean;
  concentrationKeys: string[];
  byAssetClass: Array<{ key: string; weight: Decimal | null }>;
}

export async function computeRiskSummary(
  prisma: PrismaClient,
  params: { userId: string; portfolioId: string },
): Promise<RiskSummary> {
  const summary = await summarizePortfolio(prisma, {
    userId: params.userId,
    portfolioId: params.portfolioId,
  });

  const weighted = summary.holdings.filter((holding) => holding.weight !== null);
  const sorted = [...weighted].sort((a, b) => b.weight!.comparedTo(a.weight!));

  const topThree = sorted.slice(0, 3).reduce(
    (sum, holding) => sum.plus(holding.weight ?? 0),
    new Decimal(0),
  );

  const allocation = await computeAllocation(prisma, {
    userId: params.userId,
    portfolioId: params.portfolioId,
    dimension: 'asset_class',
  });

  const concentrationKeys = allocation.items
    .filter((item) => item.weight && item.weight.gt(INVESTMENT_CONCENTRATION_WARNING_RATIO))
    .map((item) => item.key);

  return {
    positionCount: summary.positionCount,
    maxWeight: sorted[0]?.weight ?? null,
    maxWeightLabel: sorted[0] ? `${sorted[0].symbol} ${sorted[0].name}`.trim() : null,
    topThreeWeight: weighted.length > 0 ? topThree.toDecimalPlaces(6) : null,
    concentrationWarning: concentrationKeys.length > 0,
    concentrationKeys,
    byAssetClass: allocation.items.map((item) => ({ key: item.key, weight: item.weight })),
  };
}

/** 卖出记录及其卖出时点的平均成本 */
interface SellRecord {
  tradeId: string;
  instrumentId: string | null;
  tradeDate: Date;
  quantity: Decimal;
  sellPrice: Decimal | null;
  averageCost: Decimal | null;
  proceeds: Decimal;
  fee: Decimal;
  tax: Decimal;
}

/**
 * 一次重放同时记录每笔卖出的成本。
 *
 * 不能"逐笔卖出各自重放一遍"：那是 O(n²)，而且清仓后持仓归零，
 * 事后重放拿不到当时的平均成本。这里在重放过程中就地捕获。
 */
export function collectSellRecords(
  trades: Array<{
    id: string;
    kind: string;
    tradeDate: Date;
    instrumentId: string | null;
    quantity: Decimal | null;
    price: Decimal | null;
    amount: Decimal;
    fee: Decimal;
    tax: Decimal;
  }>,
): Array<Omit<SellRecord, 'tradeId' | 'instrumentId' | 'tradeDate' | 'quantity' | 'sellPrice'> & { tradeId: string; instrumentId: string | null; tradeDate: Date; quantity: Decimal; sellPrice: Decimal | null }> {
  const state = new Map<string, { quantity: Decimal; totalCost: Decimal }>();
  const records: Array<{
    tradeId: string;
    instrumentId: string | null;
    tradeDate: Date;
    quantity: Decimal;
    sellPrice: Decimal | null;
    averageCost: Decimal | null;
    proceeds: Decimal;
    fee: Decimal;
    tax: Decimal;
  }> = [];

  const ordered = [...trades].sort((a, b) => {
    const delta = a.tradeDate.getTime() - b.tradeDate.getTime();
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });

  for (const trade of ordered) {
    if (!trade.instrumentId) continue;
    const current = state.get(trade.instrumentId) ?? { quantity: new Decimal(0), totalCost: new Decimal(0) };

    if (trade.kind === 'buy' && trade.quantity) {
      current.quantity = current.quantity.plus(trade.quantity);
      current.totalCost = current.totalCost.plus(trade.amount).plus(trade.fee);
      state.set(trade.instrumentId, current);
      continue;
    }

    if (trade.kind === 'sell' && trade.quantity) {
      if (current.quantity.lte(0)) continue;

      const averageCost = current.totalCost.div(current.quantity);
      const costRemoved = roundMoney(averageCost.mul(trade.quantity));

      records.push({
        tradeId: trade.id,
        instrumentId: trade.instrumentId,
        tradeDate: trade.tradeDate,
        quantity: trade.quantity,
        sellPrice: trade.price,
        averageCost: roundMoney(averageCost),
        proceeds: roundMoney(trade.amount.minus(trade.fee).minus(trade.tax)),
        fee: trade.fee,
        tax: trade.tax,
      });

      current.quantity = current.quantity.minus(trade.quantity);
      current.totalCost = current.totalCost.minus(costRemoved);
      if (current.quantity.lte(0)) {
        current.quantity = new Decimal(0);
        current.totalCost = new Decimal(0);
      }
      state.set(trade.instrumentId, current);
    }
  }

  return records;
}

export async function computeRealizedGains(
  prisma: PrismaClient,
  params: { userId: string; portfolioId: string; timezone: string; fromText?: string; toText?: string },
) {
  const context = await getPortfolioContext(prisma, {
    userId: params.userId,
    portfolioId: params.portfolioId,
  });

  const trades = await prisma.portfolioTrade.findMany({
    where: { userId: params.userId, portfolioId: context.id, voidedAt: null },
    orderBy: [{ tradeDate: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      kind: true,
      tradeDate: true,
      instrumentId: true,
      quantity: true,
      price: true,
      amount: true,
      fee: true,
      tax: true,
    },
  });

  const allRecords = collectSellRecords(
    trades.map((trade) => ({
      id: trade.id,
      kind: trade.kind,
      tradeDate: trade.tradeDate,
      instrumentId: trade.instrumentId,
      quantity: trade.quantity ? toDecimal(trade.quantity.toString()) : null,
      price: trade.price ? toDecimal(trade.price.toString()) : null,
      amount: toDecimal(trade.amount.toString()),
      fee: toDecimal(trade.fee.toString()),
      tax: toDecimal(trade.tax.toString()),
    })),
  );

  // 区间筛选在重放之后进行：成本依赖完整历史，不能只喂区间内的交易
  const records = allRecords.filter((record) => {
    const day = dayKeyOf(record.tradeDate, params.timezone);
    if (params.fromText && day < params.fromText) return false;
    if (params.toText && day > params.toText) return false;
    return true;
  });

  const instruments = await prisma.instrument.findMany({
    where: { userId: params.userId, id: { in: [...new Set(records.map((r) => r.instrumentId!))] } },
    select: { id: true, symbol: true, name: true },
  });
  const metaById = new Map(instruments.map((item) => [item.id, item]));

  const items = records.map((record) => {
    const meta = metaById.get(record.instrumentId!);
    const cost = record.averageCost ? roundMoney(record.averageCost.mul(record.quantity)) : new Decimal(0);
    const realized = roundMoney(record.proceeds.minus(cost));

    return {
      tradeId: record.tradeId,
      instrumentId: record.instrumentId,
      symbol: meta?.symbol ?? '',
      name: meta?.name ?? '',
      tradeDate: dayKeyOf(record.tradeDate, params.timezone),
      quantity: record.quantity,
      sellPrice: record.sellPrice,
      averageCost: record.averageCost,
      proceeds: record.proceeds,
      cost,
      fee: record.fee,
      tax: record.tax,
      realizedPnl: realized,
      realizedRatio: cost.gt(0) ? realized.div(cost).toDecimalPlaces(6) : null,
    };
  });

  const totals = items.reduce(
    (acc, item) => ({
      proceeds: acc.proceeds.plus(item.proceeds),
      cost: acc.cost.plus(item.cost),
      realizedPnl: acc.realizedPnl.plus(item.realizedPnl),
      fee: acc.fee.plus(item.fee),
      tax: acc.tax.plus(item.tax),
    }),
    {
      proceeds: new Decimal(0),
      cost: new Decimal(0),
      realizedPnl: new Decimal(0),
      fee: new Decimal(0),
      tax: new Decimal(0),
    },
  );

  return {
    items,
    totals: {
      proceeds: roundMoney(totals.proceeds),
      cost: roundMoney(totals.cost),
      realizedPnl: roundMoney(totals.realizedPnl),
      fee: roundMoney(totals.fee),
      tax: roundMoney(totals.tax),
    },
    period: { from: params.fromText ?? null, to: params.toText ?? null },
  };
}
