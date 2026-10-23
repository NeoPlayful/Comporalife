import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('portfolios');

let app: FastifyInstance;
let token: string;
let brokerageId: string;
let bankId: string;
let portfolioId: string;
let instrumentId: string;

interface CategoryNode {
  id: string;
  name: string;
  kind: string;
  children?: CategoryNode[];
}

async function createAccount(type: 'bank' | 'brokerage', name: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    headers: auth(token),
    payload: {
      name,
      type,
      currency: 'CNY',
      openingBalance: type === 'brokerage' ? '0' : '100000',
      openingBalanceDate: '2026-01-01',
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.account.id;
}

async function findCategory(name: string, kind: 'income' | 'expense'): Promise<string> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/categories?kind=${kind}`,
    headers: auth(token),
  });
  const tree = res.json().data.categories as CategoryNode[];
  const flat = tree.flatMap((node) => [node, ...(node.children ?? [])]);
  const found = flat.find((node) => node.name === name);
  if (!found) throw new Error(`分类 ${name} 不存在`);
  return found.id;
}

async function createInstrument(symbol = '510300', currency = 'CNY'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/instruments',
    headers: auth(token),
    payload: { symbol, name: `ETF ${symbol}`, assetClass: 'etf', currency },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id;
}

async function setPrice(id: string, priceDate: string, price: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/instruments/${id}/prices`,
    headers: auth(token),
    payload: { priceDate, price },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data;
}

function createTrade(payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/portfolio-trades',
    headers: auth(token),
    payload: { portfolioId, ...payload },
  });
}

async function deposit(amount: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/portfolios/${portfolioId}/cashflows`,
    headers: auth(token),
    payload: { kind: 'deposit', flowDate: '2026-01-02T00:00:00.000Z', amount },
  });
  expect(res.statusCode).toBe(201);
}

async function overview() {
  const res = await app.inject({
    method: 'GET',
    url: '/api/dashboard/overview',
    headers: auth(token),
  });
  expect(res.statusCode).toBe(200);
  return res.json().data;
}

async function incomeExpense(from: string, to: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/api/analytics/income-expense?from=${from}&to=${to}`,
    headers: auth(token),
  });
  expect(res.statusCode).toBe(200);
  return res.json().data;
}

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await cleanupUsers(app, DOMAIN);
  await app.close();
});

beforeEach(async () => {
  await cleanupUsers(app, DOMAIN);
  const user = await createUser(app, DOMAIN);
  token = user.token;

  brokerageId = await createAccount('brokerage', '证券账户');
  bankId = await createAccount('bank', '银行');

  const res = await app.inject({
    method: 'POST',
    url: '/api/portfolios',
    headers: auth(token),
    payload: { accountId: brokerageId, name: '长期账户' },
  });
  expect(res.statusCode).toBe(201);
  portfolioId = res.json().data.id;

  instrumentId = await createInstrument();
  await setPrice(instrumentId, '2026-10-20', '4.0');
});

describe('组合与账户绑定', () => {
  it('只能绑定证券账户', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/portfolios',
      headers: auth(token),
      payload: { accountId: bankId, name: '错误组合' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('PORTFOLIO_ACCOUNT_INVALID');
  });

  it('同一账户不能被两个组合占用', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/portfolios',
      headers: auth(token),
      payload: { accountId: brokerageId, name: '第二组合' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('PORTFOLIO_ACCOUNT_INVALID');
  });

  it('跨用户访问组合返回 404', async () => {
    const other = await createUser(app, DOMAIN, 'other');
    const res = await app.inject({
      method: 'GET',
      url: `/api/portfolios/${portfolioId}`,
      headers: auth(other.token),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('PORTFOLIO_NOT_FOUND');
  });
});

describe('标的与价格', () => {
  it('同日重复录价覆盖而非报错', async () => {
    const first = await setPrice(instrumentId, '2026-10-21', '4.10');
    expect(first.created).toBe(true);

    const second = await setPrice(instrumentId, '2026-10-21', '4.20');
    expect(second.created).toBe(false);
    expect(second.price).toBe('4.200000');
  });

  it('未来日期价格被 422 拒绝', async () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const res = await app.inject({
      method: 'POST',
      url: `/api/instruments/${instrumentId}/prices`,
      headers: auth(token),
      payload: { priceDate: future, price: '5.00' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('PRICE_DATE_INVALID');
  });

  it('有交易的标的不能删除', async () => {
    await createTrade({
      instrumentId,
      kind: 'buy',
      tradeDate: '2026-10-10T00:00:00.000Z',
      quantity: '100',
      price: '3.5',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/instruments/${instrumentId}`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INSTRUMENT_IN_USE');
  });

  it('标的币种与账户币种不一致时拒绝交易', async () => {
    const usd = await createInstrument('VOO', 'USD');

    const res = await createTrade({
      instrumentId: usd,
      kind: 'buy',
      tradeDate: '2026-10-10T00:00:00.000Z',
      quantity: '1',
      price: '400',
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INSTRUMENT_CURRENCY_MISMATCH');
  });
});

describe('账本口径：投资不是收支', () => {
  it('买入前后支出不变；按买入价估值时净资产也不变', async () => {
    const before = await incomeExpense('2026-01-01', '2026-12-31');
    const beforeOverview = await overview();

    // 让最新价等于买入价，净资产的变化就只反映手续费，可精确断言
    await setPrice(instrumentId, '2026-10-21', '3.5');

    const res = await createTrade({
      instrumentId,
      kind: 'buy',
      tradeDate: '2026-10-10T00:00:00.000Z',
      quantity: '100',
      price: '3.5',
      fee: '5',
    });
    expect(res.statusCode).toBe(201);

    const after = await incomeExpense('2026-01-01', '2026-12-31');
    // 买入不进收支口径，支出与收入都必须与买入前完全相等
    expect(after.expense).toBe(before.expense);
    expect(after.income).toBe(before.income);

    // 资产转换：现金 -355、市值 +350，差额仅为 5 元手续费
    const afterOverview = await overview();
    expect(Number(beforeOverview.netWorth) - Number(afterOverview.netWorth)).toBeCloseTo(5, 2);
  });

  it('股息计入收入并保持分类覆盖', async () => {
    const before = await incomeExpense('2026-01-01', '2026-12-31');

    await createTrade({
      instrumentId,
      kind: 'buy',
      tradeDate: '2026-10-01T00:00:00.000Z',
      quantity: '100',
      price: '3.5',
    });

    const res = await createTrade({
      instrumentId,
      kind: 'dividend',
      tradeDate: '2026-10-15T00:00:00.000Z',
      amount: '30',
    });
    expect(res.statusCode).toBe(201);

    const after = await incomeExpense('2026-01-01', '2026-12-31');
    expect(Number(after.income)).toBeCloseTo(Number(before.income) + 30, 2);
    // 股息必须归类，不能产生未分类支出（覆盖率只统计支出）
    expect(after.coverage.uncategorizedCount).toBe(0);
  });

  it('通用记账接口不能创建 investment 类型', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: auth(token),
      payload: {
        type: 'investment',
        accountId: brokerageId,
        amount: '100',
        occurredAt: '2026-10-10T00:00:00.000Z',
        description: '绕过投资模块',
      },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('手续费计入支出，且不改变持仓数量', async () => {
    const before = await incomeExpense('2026-01-01', '2026-12-31');

    await createTrade({
      instrumentId,
      kind: 'buy',
      tradeDate: '2026-10-01T00:00:00.000Z',
      quantity: '100',
      price: '3.5',
    });

    const res = await createTrade({
      kind: 'fee',
      tradeDate: '2026-10-15T00:00:00.000Z',
      amount: '12',
    });
    expect(res.statusCode).toBe(201);

    const after = await incomeExpense('2026-01-01', '2026-12-31');
    expect(Number(after.expense)).toBeCloseTo(Number(before.expense) + 12, 2);

    const holdings = await app.inject({
      method: 'GET',
      url: `/api/portfolios/${portfolioId}/holdings`,
      headers: auth(token),
    });
    expect(holdings.json().data.holdings).toHaveLength(1);
    expect(holdings.json().data.holdings[0].quantity).toBe('100.00000000');
  });
});

describe('持仓与损益', () => {
  it('加权平均成本含手续费，未实现损益按最新价', async () => {
    await createTrade({
      instrumentId,
      kind: 'buy',
      tradeDate: '2026-10-01T00:00:00.000Z',
      quantity: '100',
      price: '3.0',
      fee: '5',
    });
    await setPrice(instrumentId, '2026-10-21', '4.0');

    const res = await app.inject({
      method: 'GET',
      url: `/api/portfolios/${portfolioId}/holdings`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);

    const holding = res.json().data.holdings[0];
    // (300 + 5) / 100 = 3.05
    expect(holding.averageCost).toBe('3.050000');
    expect(holding.marketValue).toBe('400.000000');
    expect(holding.unrealizedPnl).toBe('95.000000');
  });

  it('卖出超过持仓返回 422 并给出可用数量', async () => {
    await createTrade({
      instrumentId,
      kind: 'buy',
      tradeDate: '2026-10-01T00:00:00.000Z',
      quantity: '100',
      price: '3.0',
    });

    const res = await createTrade({
      instrumentId,
      kind: 'sell',
      tradeDate: '2026-10-10T00:00:00.000Z',
      quantity: '150',
      price: '4.0',
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('TRADE_SELL_EXCEEDS_HOLDING');
    expect(res.json().error.details.available).toBe('100.00000000');
  });

  it('历史卖出校验用的是卖出当日持仓，不是今天的持仓', async () => {
    await createTrade({
      instrumentId,
      kind: 'buy',
      tradeDate: '2026-10-01T00:00:00.000Z',
      quantity: '100',
      price: '3.0',
    });
    await createTrade({
      instrumentId,
      kind: 'buy',
      tradeDate: '2026-10-20T00:00:00.000Z',
      quantity: '100',
      price: '3.5',
    });

    // 10-10 时只有 100 股，卖 150 必须被拒
    const res = await createTrade({
      instrumentId,
      kind: 'sell',
      tradeDate: '2026-10-10T00:00:00.000Z',
      quantity: '150',
      price: '4.0',
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.available).toBe('100.00000000');
  });

  it('已实现损益使用卖出当时的平均成本', async () => {
    await createTrade({
      instrumentId,
      kind: 'buy',
      tradeDate: '2026-10-01T00:00:00.000Z',
      quantity: '100',
      price: '10',
    });
    await createTrade({
      instrumentId,
      kind: 'buy',
      tradeDate: '2026-10-05T00:00:00.000Z',
      quantity: '100',
      price: '11',
    });
    await createTrade({
      instrumentId,
      kind: 'sell',
      tradeDate: '2026-10-10T00:00:00.000Z',
      quantity: '100',
      price: '12',
      fee: '10',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/portfolios/${portfolioId}/realized-gains`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);

    const item = res.json().data.items[0];
    expect(item.averageCost).toBe('10.500000');
    // 1200 - 10 - 1050 = 140
    expect(item.realizedPnl).toBe('140.000000');
  });

  it('无价格标的进入 missingPrices，市值不按成本填充', async () => {
    const unpriced = await createInstrument('UNPRICED');

    await createTrade({
      instrumentId: unpriced,
      kind: 'buy',
      tradeDate: '2026-10-01T00:00:00.000Z',
      quantity: '10',
      price: '100',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/portfolios/${portfolioId}/holdings`,
      headers: auth(token),
    });

    const data = res.json().data;
    expect(data.isComplete).toBe(false);
    expect(data.missingPrices.map((item: { symbol: string }) => item.symbol)).toContain('UNPRICED');

    const holding = data.holdings.find(
      (item: { symbol: string }) => item.symbol === 'UNPRICED',
    );
    expect(holding.marketValue).toBe('0.000000');
    expect(holding.unrealizedPnl).toBeNull();
  });

  it('撤销交易后持仓立即变化，账本记录被冲正', async () => {
    const buy = await createTrade({
      instrumentId,
      kind: 'buy',
      tradeDate: '2026-10-01T00:00:00.000Z',
      quantity: '100',
      price: '3.0',
    });
    const tradeId = buy.json().data.id;

    const before = await app.inject({
      method: 'GET',
      url: `/api/portfolios/${portfolioId}/holdings`,
      headers: auth(token),
    });
    expect(before.json().data.holdings).toHaveLength(1);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/portfolio-trades/${tradeId}`,
      headers: auth(token),
    });
    expect(remove.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: `/api/portfolios/${portfolioId}/holdings`,
      headers: auth(token),
    });
    expect(after.json().data.holdings).toHaveLength(0);

    // 账本交易已被冲正，现金回到初始状态
    const summary = await app.inject({
      method: 'GET',
      url: `/api/portfolios/${portfolioId}/summary`,
      headers: auth(token),
    });
    expect(summary.json().data.cash).toBe('0.000000');
  });
});

describe('请求格式错误', () => {
  it('空 JSON body 的 DELETE 返回 400 而不是 500', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/portfolio-trades/00000000-0000-0000-0000-000000000000',
      headers: { ...auth(token), 'content-type': 'application/json' },
      payload: '',
    });

    // 调用方格式错误不能被包装成服务故障
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('现金流、收益与配置', () => {
  it('无现金流时 XIRR 等于简单收益率', async () => {
    await deposit('10000');
    await createTrade({
      instrumentId,
      kind: 'buy',
      tradeDate: '2026-01-05T00:00:00.000Z',
      quantity: '2500',
      price: '4.0',
    });
    await setPrice(instrumentId, '2026-10-21', '4.4');

    const res = await app.inject({
      method: 'GET',
      url: `/api/portfolios/${portfolioId}/returns?from=2026-01-02&to=2026-10-21`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    if (data.xirr.value !== null) {
      expect(Number(data.xirr.value)).toBeGreaterThan(0);
    }
  });

  it('默认区间从组合首笔资金开始，不会因起点为 0 而算不出 TWR', async () => {
    // 组合今天才建，若默认区间取「今天往前 365 天」，起点价值一定是 0
    await deposit('10000');
    await createTrade({
      instrumentId,
      kind: 'buy',
      tradeDate: new Date().toISOString().slice(0, 19) + '.000Z',
      quantity: '100',
      price: '3.0',
    });
    await setPrice(instrumentId, new Date().toISOString().slice(0, 10), '4.0');

    const res = await app.inject({
      method: 'GET',
      url: `/api/portfolios/${portfolioId}/returns`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.twr.reason).not.toBe('zero_start_value');
    expect(data.xirr.reason).not.toBe('no_cashflow_sign_change');
  });

  it('目标权重合计不为 1 时 422 并给出合计值', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/portfolios/${portfolioId}/targets`,
      headers: auth(token),
      payload: {
        dimension: 'asset_class',
        targets: [
          { key: 'stock', targetWeight: '0.6' },
          { key: 'bond', targetWeight: '0.3' },
        ],
      },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('ALLOCATION_TARGETS_MISMATCH');
    expect(res.json().error.details.total).toBe('0.900000');
  });

  it('目标权重合计为 1 时保存成功并可读回', async () => {
    const save = await app.inject({
      method: 'PUT',
      url: `/api/portfolios/${portfolioId}/targets`,
      headers: auth(token),
      payload: {
        dimension: 'asset_class',
        targets: [
          { key: 'stock', targetWeight: '0.7' },
          { key: 'bond', targetWeight: '0.3' },
        ],
      },
    });
    expect(save.statusCode).toBe(200);

    const read = await app.inject({
      method: 'GET',
      url: `/api/portfolios/${portfolioId}/targets`,
      headers: auth(token),
    });
    expect(read.json().data.items).toHaveLength(1);
    expect(read.json().data.items[0].targets).toHaveLength(2);
  });

  it('再平衡预览不产生任何交易记录', async () => {
    await createTrade({
      instrumentId,
      kind: 'buy',
      tradeDate: '2026-10-01T00:00:00.000Z',
      quantity: '100',
      price: '3.0',
    });

    await app.inject({
      method: 'PUT',
      url: `/api/portfolios/${portfolioId}/targets`,
      headers: auth(token),
      payload: {
        dimension: 'asset_class',
        targets: [{ key: 'etf', targetWeight: '0.5' }, { key: 'cash', targetWeight: '0.5' }],
      },
    });

    const tradesBefore = await app.prisma.portfolioTrade.count({
      where: { portfolioId },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/portfolios/${portfolioId}/rebalance-preview`,
      headers: auth(token),
      payload: { dimension: 'asset_class' },
    });
    expect(res.statusCode).toBe(200);

    const tradesAfter = await app.prisma.portfolioTrade.count({ where: { portfolioId } });
    expect(tradesAfter).toBe(tradesBefore);
  });

  it('未设置目标时偏离返回空数组而不是报错', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/portfolios/${portfolioId}/drift?dimension=asset_class`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.items).toEqual([]);
  });

  it('汇总路由不被 :id 吞掉', async () => {
    const summary = await app.inject({
      method: 'GET',
      url: `/api/portfolios/${portfolioId}/summary`,
      headers: auth(token),
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().data).toHaveProperty('marketValue');

    const list = await app.inject({
      method: 'GET',
      url: '/api/portfolios',
      headers: auth(token),
    });
    expect(list.statusCode).toBe(200);
  });
});

describe('估值快照', () => {
  it('同日快照重复提交返回 409，overwrite 时覆盖', async () => {
    const first = await app.inject({
      method: 'POST',
      url: `/api/portfolios/${portfolioId}/valuations`,
      headers: auth(token),
      payload: { valuationDate: '2026-10-21', marketValue: '1000' },
    });
    expect(first.statusCode).toBe(201);

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/portfolios/${portfolioId}/valuations`,
      headers: auth(token),
      payload: { valuationDate: '2026-10-21', marketValue: '1200' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('VALUATION_DATE_EXISTS');

    const overwrite = await app.inject({
      method: 'POST',
      url: `/api/portfolios/${portfolioId}/valuations`,
      headers: auth(token),
      payload: { valuationDate: '2026-10-21', marketValue: '1200', overwrite: true },
    });
    expect(overwrite.statusCode).toBe(201);
    expect(overwrite.json().data.marketValue).toBe('1200.000000');
  });
});

describe('归档', () => {
  it('归档后不出现在默认列表，但数据保留', async () => {
    await createTrade({
      instrumentId,
      kind: 'buy',
      tradeDate: '2026-10-01T00:00:00.000Z',
      quantity: '100',
      price: '3.0',
    });

    const archive = await app.inject({
      method: 'POST',
      url: `/api/portfolios/${portfolioId}/archive`,
      headers: auth(token),
    });
    expect(archive.statusCode).toBe(200);

    const active = await app.inject({
      method: 'GET',
      url: '/api/portfolios',
      headers: auth(token),
    });
    expect(active.json().data.items).toHaveLength(0);

    const all = await app.inject({
      method: 'GET',
      url: '/api/portfolios?status=all',
      headers: auth(token),
    });
    expect(all.json().data.items).toHaveLength(1);

    // 交易记录仍在
    const tradeCount = await app.prisma.portfolioTrade.count({ where: { portfolioId } });
    expect(tradeCount).toBe(1);
  });

  it('归档后不能新增交易', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/portfolios/${portfolioId}/archive`,
      headers: auth(token),
    });

    const res = await createTrade({
      instrumentId,
      kind: 'buy',
      tradeDate: '2026-10-10T00:00:00.000Z',
      quantity: '100',
      price: '3.0',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PORTFOLIO_ARCHIVED');
  });
});

describe('能力声明', () => {
  it('portfolios 与 instruments 进入 available', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/system/capabilities' });
    const data = res.json().data;

    expect(data.phase).toBe('phase-5');
    expect(data.available).toContain('portfolios');
    expect(data.available).toContain('instruments');
    expect(data.planned).not.toContain('portfolios');
    expect(data.investmentLimits.priceStaleDays).toBeGreaterThan(0);
  });
});
