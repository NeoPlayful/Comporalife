import Decimal from 'decimal.js';
import { roundMoney } from '../../lib/money.js';

export type TradeKind = 'buy' | 'sell' | 'dividend' | 'interest' | 'fee' | 'tax';

export interface ReplayTrade {
  id: string;
  kind: TradeKind;
  tradeDate: Date;
  /** 同日交易的稳定次序，避免依赖数据库返回顺序 */
  sequence: number;
  instrumentId: string | null;
  quantity: Decimal | null;
  price: Decimal | null;
  amount: Decimal;
  fee: Decimal;
  tax: Decimal;
}

export interface HoldingComputed {
  instrumentId: string;
  quantity: Decimal;
  /** 剩余持仓总成本；数量为 0 时为 0 */
  totalCost: Decimal;
  /** 数量为 0 时返回 null，而不是 0 成本 */
  averageCost: Decimal | null;
  realizedPnl: Decimal;
  dividends: Decimal;
  interest: Decimal;
  fees: Decimal;
  taxes: Decimal;
  firstTradeDate: Date | null;
  lastTradeDate: Date | null;
}

export interface SellExceedsHolding {
  ok: false;
  tradeId: string;
  instrumentId: string;
  requested: Decimal;
  available: Decimal;
}

export interface ReplayResult {
  ok: true;
  holdings: HoldingComputed[];
  realizedPnl: Decimal;
  dividends: Decimal;
  interest: Decimal;
  fees: Decimal;
  taxes: Decimal;
}

export type ReplayOutcome = ReplayResult | SellExceedsHolding;

interface Accumulator {
  quantity: Decimal;
  totalCost: Decimal;
  realizedPnl: Decimal;
  dividends: Decimal;
  interest: Decimal;
  fees: Decimal;
  taxes: Decimal;
  firstTradeDate: Date | null;
  lastTradeDate: Date | null;
}

function emptyAccumulator(): Accumulator {
  return {
    quantity: new Decimal(0),
    totalCost: new Decimal(0),
    realizedPnl: new Decimal(0),
    dividends: new Decimal(0),
    interest: new Decimal(0),
    fees: new Decimal(0),
    taxes: new Decimal(0),
    firstTradeDate: null,
    lastTradeDate: null,
  };
}

/**
 * 交易必须按时间升序重放，同日按稳定次序，
 * 否则同一天的买入与卖出可能被算成超卖。
 */
export function sortTrades(trades: ReplayTrade[]): ReplayTrade[] {
  return [...trades].sort((a, b) => {
    const delta = a.tradeDate.getTime() - b.tradeDate.getTime();
    if (delta !== 0) return delta;
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    return a.id.localeCompare(b.id);
  });
}

/**
 * 加权平均成本重放。
 *
 * 成本口径：
 * - 买入：总成本 += 成交金额 + 手续费
 * - 卖出：总成本 -= 加权平均成本 × 卖出数量（单位成本不变）
 * - 已实现损益 = 卖出净额 − 平均成本 × 数量 − 卖出手续费 − 卖出税费
 *
 * 数量归零后总成本同步归零，避免舍入残值变成"幽灵成本"。
 */
export function replayTrades(trades: ReplayTrade[], options: { asOf?: Date | null } = {}): ReplayOutcome {
  const accs = new Map<string, Accumulator>();
  const cutoff = options.asOf ? options.asOf.getTime() : null;

  let totalRealized = new Decimal(0);
  let totalDividends = new Decimal(0);
  let totalInterest = new Decimal(0);
  let totalFees = new Decimal(0);
  let totalTaxes = new Decimal(0);

  for (const trade of sortTrades(trades)) {
    if (cutoff !== null && trade.tradeDate.getTime() > cutoff) continue;

    const acc = trade.instrumentId ? (accs.get(trade.instrumentId) ?? emptyAccumulator()) : null;

    if (trade.kind === 'buy' || trade.kind === 'sell') {
      if (!trade.instrumentId || !acc || !trade.quantity || !trade.price) {
        throw new Error(`买卖交易缺少标的或数量价格：${trade.id}`);
      }
      if (trade.quantity.lte(0)) {
        throw new Error(`买卖数量必须为正：${trade.id}`);
      }

      if (trade.kind === 'buy') {
        acc.quantity = acc.quantity.plus(trade.quantity);
        acc.totalCost = acc.totalCost.plus(trade.amount).plus(trade.fee);
        acc.fees = acc.fees.plus(trade.fee);
        acc.taxes = acc.taxes.plus(trade.tax);
        totalFees = totalFees.plus(trade.fee);
        totalTaxes = totalTaxes.plus(trade.tax);
      } else {
        if (trade.quantity.gt(acc.quantity)) {
          return {
            ok: false,
            tradeId: trade.id,
            instrumentId: trade.instrumentId,
            requested: trade.quantity,
            available: acc.quantity,
          };
        }

        // 卖空不存在，因此平均成本必然可算
        const averageCost = acc.totalCost.div(acc.quantity);
        const costRemoved = roundMoney(averageCost.mul(trade.quantity));
        const proceeds = roundMoney(trade.amount.minus(trade.fee).minus(trade.tax));
        const realized = roundMoney(proceeds.minus(costRemoved));

        acc.quantity = acc.quantity.minus(trade.quantity);
        acc.totalCost = acc.totalCost.minus(costRemoved);
        acc.realizedPnl = acc.realizedPnl.plus(realized);
        acc.fees = acc.fees.plus(trade.fee);
        acc.taxes = acc.taxes.plus(trade.tax);
        totalRealized = totalRealized.plus(realized);
        totalFees = totalFees.plus(trade.fee);
        totalTaxes = totalTaxes.plus(trade.tax);

        if (acc.quantity.isZero()) {
          acc.quantity = new Decimal(0);
          acc.totalCost = new Decimal(0);
        }
      }

      acc.lastTradeDate = trade.tradeDate;
      if (!acc.firstTradeDate) acc.firstTradeDate = trade.tradeDate;
      accs.set(trade.instrumentId, acc);
      continue;
    }

    // 股息、利息、费用、税费不改变持仓数量与成本
    if (trade.kind === 'dividend') {
      totalDividends = totalDividends.plus(trade.amount);
      if (acc) acc.dividends = acc.dividends.plus(trade.amount);
    } else if (trade.kind === 'interest') {
      totalInterest = totalInterest.plus(trade.amount);
      if (acc) acc.interest = acc.interest.plus(trade.amount);
    } else if (trade.kind === 'fee') {
      totalFees = totalFees.plus(trade.amount).plus(trade.fee);
      if (acc) acc.fees = acc.fees.plus(trade.amount).plus(trade.fee);
    } else {
      totalTaxes = totalTaxes.plus(trade.amount).plus(trade.tax);
      if (acc) acc.taxes = acc.taxes.plus(trade.amount).plus(trade.tax);
    }

    if (acc) {
      acc.lastTradeDate = trade.tradeDate;
      if (!acc.firstTradeDate) acc.firstTradeDate = trade.tradeDate;
      accs.set(trade.instrumentId!, acc);
    }
  }

  const holdings: HoldingComputed[] = [...accs.entries()]
    .map(([instrumentId, acc]) => ({
      instrumentId,
      quantity: acc.quantity,
      totalCost: roundMoney(acc.totalCost),
      averageCost: acc.quantity.isZero() ? null : roundMoney(acc.totalCost.div(acc.quantity)),
      realizedPnl: roundMoney(acc.realizedPnl),
      dividends: roundMoney(acc.dividends),
      interest: roundMoney(acc.interest),
      fees: roundMoney(acc.fees),
      taxes: roundMoney(acc.taxes),
      firstTradeDate: acc.firstTradeDate,
      lastTradeDate: acc.lastTradeDate,
    }))
    // 已清仓的标的仍保留，已实现损益需要展示
    .sort((a, b) =>
      Number(b.quantity.toString()) !== Number(a.quantity.toString())
        ? Number(b.quantity.toString()) - Number(a.quantity.toString())
        : a.instrumentId.localeCompare(b.instrumentId),
    );

  return {
    ok: true,
    holdings,
    realizedPnl: roundMoney(totalRealized),
    dividends: roundMoney(totalDividends),
    interest: roundMoney(totalInterest),
    fees: roundMoney(totalFees),
    taxes: roundMoney(totalTaxes),
  };
}
