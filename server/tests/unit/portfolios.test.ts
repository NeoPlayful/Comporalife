import Decimal from 'decimal.js';
import { describe, it, expect } from 'vitest';
import {
  replayTrades,
  sortTrades,
  type ReplayTrade,
  type TradeKind,
} from '../../src/modules/portfolios/holdings.engine.js';
import {
  computeTwr,
  computeXirr,
  downgradeGranularity,
  type ExternalCashflow,
  type ValuePoint,
} from '../../src/modules/portfolios/performance.engine.js';
import { assertTargetsSum } from '../../src/modules/portfolios/analytics.service.js';

const d = (value: string | number) => new Decimal(value);

let sequence = 0;

function trade(
  kind: TradeKind,
  day: string,
  params: { quantity?: string; price?: string; amount?: string; fee?: string; tax?: string; instrumentId?: string } = {},
): ReplayTrade {
  const quantity = params.quantity ? d(params.quantity) : null;
  const price = params.price ? d(params.price) : null;
  const amount = params.amount
    ? d(params.amount)
    : quantity && price
      ? quantity.mul(price)
      : d(0);

  sequence += 1;

  return {
    id: `t${sequence}`,
    kind,
    tradeDate: new Date(`${day}T00:00:00.000Z`),
    sequence,
    instrumentId: params.instrumentId ?? 'inst-a',
    quantity,
    price,
    amount,
    fee: d(params.fee ?? 0),
    tax: d(params.tax ?? 0),
  };
}

describe('持仓重放：加权平均成本', () => {
  it('买入 100 @10、手续费 5 → 平均成本 10.05', () => {
    const result = replayTrades([trade('buy', '2026-01-02', { quantity: '100', price: '10', fee: '5' })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const holding = result.holdings[0]!;
    expect(holding.quantity.toFixed(8)).toBe('100.00000000');
    expect(holding.totalCost.toFixed(6)).toBe('1005.000000');
    expect(holding.averageCost!.toFixed(6)).toBe('10.050000');
  });

  it('再买 100 @11、手续费 5 → 平均成本 10.55', () => {
    const result = replayTrades([
      trade('buy', '2026-01-02', { quantity: '100', price: '10', fee: '5' }),
      trade('buy', '2026-01-05', { quantity: '100', price: '11', fee: '5' }),
    ]);
    if (!result.ok) throw new Error('should replay');

    expect(result.holdings[0]!.averageCost!.toFixed(6)).toBe('10.550000');
    expect(result.holdings[0]!.totalCost.toFixed(6)).toBe('2110.000000');
  });

  it('卖出 100 @12、费用 10 → 已实现损益 135，剩余平均成本不变', () => {
    const result = replayTrades([
      trade('buy', '2026-01-02', { quantity: '100', price: '10', fee: '5' }),
      trade('buy', '2026-01-05', { quantity: '100', price: '11', fee: '5' }),
      trade('sell', '2026-02-01', { quantity: '100', price: '12', fee: '10' }),
    ]);
    if (!result.ok) throw new Error('should replay');

    const holding = result.holdings[0]!;
    // 1200 - 10 费用 = 1190 净额，成本 1055，收益 135
    expect(holding.realizedPnl.toFixed(6)).toBe('135.000000');
    expect(holding.quantity.toFixed(8)).toBe('100.00000000');
    expect(holding.averageCost!.toFixed(6)).toBe('10.550000');
  });

  it('全部卖出后平均成本为 null、数量为 0、总成本归零', () => {
    const result = replayTrades([
      trade('buy', '2026-01-02', { quantity: '100', price: '10', fee: '5' }),
      trade('sell', '2026-02-01', { quantity: '100', price: '12' }),
    ]);
    if (!result.ok) throw new Error('should replay');

    const holding = result.holdings[0]!;
    expect(holding.quantity.isZero()).toBe(true);
    expect(holding.averageCost).toBeNull();
    expect(holding.totalCost.toFixed(6)).toBe('0.000000');
  });

  it('清仓后重新买入，成本从零重新累计，历史已实现损益保留', () => {
    const result = replayTrades([
      trade('buy', '2026-01-02', { quantity: '100', price: '10' }),
      trade('sell', '2026-02-01', { quantity: '100', price: '12' }),
      trade('buy', '2026-03-01', { quantity: '50', price: '20' }),
    ]);
    if (!result.ok) throw new Error('should replay');

    const holding = result.holdings[0]!;
    expect(holding.realizedPnl.toFixed(6)).toBe('200.000000');
    expect(holding.averageCost!.toFixed(6)).toBe('20.000000');
    expect(holding.totalCost.toFixed(6)).toBe('1000.000000');
  });

  it('卖出超过持仓返回 ok=false 并给出可用数量', () => {
    const sells = trade('sell', '2026-02-01', { quantity: '150', price: '12' });
    const result = replayTrades([trade('buy', '2026-01-02', { quantity: '100', price: '10' }), sells]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.available.toFixed(8)).toBe('100.00000000');
    expect(result.requested.toFixed(8)).toBe('150.00000000');
  });

  it('asOf 只回放该日期之前的交易', () => {
    const trades = [
      trade('buy', '2026-01-02', { quantity: '100', price: '10' }),
      trade('buy', '2026-03-01', { quantity: '100', price: '20' }),
    ];

    const atJan = replayTrades(trades, { asOf: new Date('2026-02-01T00:00:00.000Z') });
    if (!atJan.ok) throw new Error('should replay');
    expect(atJan.holdings[0]!.quantity.toFixed(8)).toBe('100.00000000');
    expect(atJan.holdings[0]!.averageCost!.toFixed(6)).toBe('10.000000');
  });

  it('同日多笔按稳定次序处理，结果与输入顺序无关', () => {
    const a = trade('buy', '2026-01-02', { quantity: '100', price: '10' });
    const b = trade('sell', '2026-01-02', { quantity: '50', price: '12' });

    const forward = replayTrades([a, b]);
    const backward = replayTrades([b, a]);

    if (!forward.ok || !backward.ok) throw new Error('should replay');
    expect(forward.holdings[0]!.quantity.toFixed(8)).toBe(backward.holdings[0]!.quantity.toFixed(8));
    expect(forward.realizedPnl.toFixed(6)).toBe(backward.realizedPnl.toFixed(6));
  });

  it('股息与利息不改变持仓与成本', () => {
    const result = replayTrades([
      trade('buy', '2026-01-02', { quantity: '100', price: '10' }),
      trade('dividend', '2026-02-01', { amount: '30' }),
      trade('interest', '2026-02-02', { amount: '10' }),
    ]);
    if (!result.ok) throw new Error('should replay');

    expect(result.holdings[0]!.quantity.toFixed(8)).toBe('100.00000000');
    expect(result.holdings[0]!.totalCost.toFixed(6)).toBe('1000.000000');
    expect(result.dividends.toFixed(6)).toBe('30.000000');
    expect(result.interest.toFixed(6)).toBe('10.000000');
  });

  it('已撤销交易不参与重放（调用方过滤，验证过滤后结果）', () => {
    const result = replayTrades([trade('buy', '2026-01-02', { quantity: '100', price: '10' })]);
    if (!result.ok) throw new Error('should replay');
    expect(result.holdings).toHaveLength(1);
  });

  it('多标的各自独立核算，按数量降序输出', () => {
    const result = replayTrades([
      trade('buy', '2026-01-02', { quantity: '100', price: '10', instrumentId: 'inst-a' }),
      trade('buy', '2026-01-02', { quantity: '300', price: '5', instrumentId: 'inst-b' }),
    ]);
    if (!result.ok) throw new Error('should replay');

    expect(result.holdings[0]!.instrumentId).toBe('inst-b');
    expect(result.holdings[1]!.instrumentId).toBe('inst-a');
  });
});

describe('sortTrades', () => {
  it('按日期升序，同日按 sequence', () => {
    const later = trade('buy', '2026-02-01', { quantity: '1', price: '1' });
    const earlier = trade('buy', '2026-01-01', { quantity: '1', price: '1' });

    const sorted = sortTrades([later, earlier]);
    expect(sorted[0]!.tradeDate.getTime()).toBeLessThan(sorted[1]!.tradeDate.getTime());
  });
});

describe('TWR 时间加权收益率', () => {
  const point = (date: string, value: string, complete = true): ValuePoint => ({
    date,
    value: d(value),
    complete,
  });

  it('无现金流时等于简单收益率', () => {
    const result = computeTwr({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      points: [point('2026-01-01', '10000'), point('2026-12-31', '11000')],
      cashflows: [],
    });

    expect(result.reason).toBeNull();
    expect(result.value!.toFixed(8)).toBe('0.10000000');
  });

  it('期间入金不被计入收益', () => {
    // 期初 10000，中途 +5000，期末 16500：
    // 第一段 10000→15000(含入金5000，实际收益 0)，
    // 第二段 15000→16500 (10%)
    const result = computeTwr({
      startDate: '2026-01-01',
      endDate: '2026-06-30',
      points: [point('2026-01-01', '10000'), point('2026-03-15', '15000'), point('2026-06-30', '16500')],
      cashflows: [{ date: '2026-03-15', amount: d('5000'), kind: 'deposit' }],
    });

    expect(result.reason).toBeNull();
    expect(result.value!.toFixed(8)).toBe('0.10000000');
    expect(result.segments).toHaveLength(2);
  });

  it('分段收益率连乘等于总收益', () => {
    const result = computeTwr({
      startDate: '2026-01-01',
      endDate: '2026-06-30',
      points: [point('2026-01-01', '10000'), point('2026-03-15', '12000'), point('2026-06-30', '13200')],
      cashflows: [{ date: '2026-03-15', amount: d('2000'), kind: 'deposit' }],
    });

    const compounded = result.segments.reduce(
      (acc, segment) => acc.mul(segment.return!.plus(1)),
      new Decimal(1),
    );
    expect(compounded.minus(1).toFixed(6)).toBe(result.value!.toFixed(6));
  });

  it('缺价返回 null 且原因为 missing_valuation', () => {
    const result = computeTwr({
      startDate: '2026-01-01',
      endDate: '2026-06-30',
      points: [point('2026-01-01', '10000'), point('2026-06-30', '11000', false)],
      cashflows: [],
    });

    expect(result.value).toBeNull();
    expect(result.reason).toBe('missing_valuation');
  });

  it('起点价值为 0 返回 zero_start_value', () => {
    const result = computeTwr({
      startDate: '2026-01-01',
      endDate: '2026-06-30',
      points: [point('2026-01-01', '0'), point('2026-06-30', '11000')],
      cashflows: [],
    });

    expect(result.reason).toBe('zero_start_value');
  });
});

describe('XIRR 资金加权收益率', () => {
  const flows = (items: Array<[string, string, 'deposit' | 'withdraw']>): ExternalCashflow[] =>
    items.map(([date, amount, kind]) => ({ date, amount: d(amount), kind }));

  it('一年期 10% 收益可解出接近 0.1 的正收益率', () => {
    const result = computeXirr({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      cashflows: flows([['2026-01-01', '10000', 'deposit']]),
      terminalValue: d('11000'),
    });

    expect(result.reason).toBeNull();
    expect(Number(result.value!.toString())).toBeGreaterThan(0.09);
    expect(Number(result.value!.toString())).toBeLessThan(0.11);
  });

  it('全为正现金流返回 no_cashflow_sign_change', () => {
    const result = computeXirr({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      cashflows: flows([['2026-03-01', '1000', 'withdraw']]),
      terminalValue: d('0'),
    });

    expect(result.value).toBeNull();
    expect(result.reason).toBe('no_cashflow_sign_change');
  });

  it('无现金流且终值为 0 时返回 no_cashflow_sign_change', () => {
    const result = computeXirr({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      cashflows: [],
      terminalValue: d('0'),
    });

    expect(result.reason).toBe('no_cashflow_sign_change');
  });

  it('结果确定性：相同输入两次调用完全一致', () => {
    const params = {
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      cashflows: flows([
        ['2026-01-01', '10000', 'deposit' as const],
        ['2026-07-01', '5000', 'deposit' as const],
      ]),
      terminalValue: d('16500'),
    };

    const first = computeXirr(params);
    const second = computeXirr(params);
    expect(first.value!.toString()).toBe(second.value!.toString());
  });

  it('亏损场景返回负收益率而不是抛异常', () => {
    const result = computeXirr({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      cashflows: flows([['2026-01-01', '10000', 'deposit']]),
      terminalValue: d('8000'),
    });

    expect(result.reason).toBeNull();
    expect(Number(result.value!.toString())).toBeLessThan(0);
  });

  it('现金流列表包含终值且金额已舍入', () => {
    const result = computeXirr({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      cashflows: flows([['2026-01-01', '10000', 'deposit']]),
      terminalValue: d('11000'),
    });

    expect(result.cashflows).toHaveLength(2);
    expect(result.cashflows[1]!.kind).toBe('terminal');
  });
});

describe('downgradeGranularity', () => {
  it('点数未超限保持日粒度', () => {
    expect(downgradeGranularity(100, 400)).toBe('day');
  });

  it('超限降到周，再超降到月', () => {
    expect(downgradeGranularity(2800, 400)).toBe('week');
    expect(downgradeGranularity(20000, 400)).toBe('month');
  });
});

describe('目标权重校验', () => {
  it('合计为 1 时通过', () => {
    expect(() =>
      assertTargetsSum([{ targetWeight: d('0.6') }, { targetWeight: d('0.4') }]),
    ).not.toThrow();
  });

  it('合计不为 1 时抛出 422，并在 details 中给出实际合计', () => {
    try {
      assertTargetsSum([{ targetWeight: d('0.6') }, { targetWeight: d('0.3') }]);
      throw new Error('应当抛出错误');
    } catch (error) {
      const appError = error as { code?: string; details?: { total?: string } };
      expect(appError.code).toBe('ALLOCATION_TARGETS_MISMATCH');
      expect(appError.details?.total).toBe('0.900000');
    }
  });
});
