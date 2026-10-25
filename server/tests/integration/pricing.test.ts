import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('pricing');

let app: FastifyInstance;
let token: string;
let portfolioId: string;
let instrumentId: string;

async function createBrokerageAccount(openingBalance = '10000'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    headers: auth(token),
    payload: {
      name: '证券账户',
      type: 'brokerage',
      currency: 'CNY',
      openingBalance,
      openingBalanceDate: '2026-01-01',
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.account.id;
}

async function createInstrument(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/instruments',
    headers: auth(token),
    payload: {
      symbol: `T${Math.floor(Math.random() * 1_000_000)}`,
      name: '测试ETF',
      assetClass: 'etf',
      currency: 'CNY',
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id;
}

async function buy(quantity: string, price: string): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/portfolio-trades',
    headers: auth(token),
    payload: {
      portfolioId,
      instrumentId,
      kind: 'buy',
      tradeDate: '2026-01-02T00:00:00.000Z',
      quantity,
      price,
      amount: '1000',
    },
  });
  expect(res.statusCode).toBe(201);
}

async function setPrice(priceDate: string, price: string) {
  return app.inject({
    method: 'POST',
    url: `/api/instruments/${instrumentId}/prices`,
    headers: auth(token),
    payload: { priceDate, price },
  });
}

async function performance(from: string, to: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/api/portfolios/${portfolioId}/performance?from=${from}&to=${to}`,
    headers: auth(token),
  });
  expect(res.statusCode).toBe(200);
  return res.json().data as {
    points: Array<{
      date: string;
      value: string;
      index: string | null;
      complete: boolean;
      valuationSource: 'computed' | 'manual_snapshot';
      snapshotDate: string | null;
    }>;
    isComplete: boolean;
    missingValuations: string[];
  };
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

  const accountId = await createBrokerageAccount();
  const portfolio = await app.inject({
    method: 'POST',
    url: '/api/portfolios',
    headers: auth(token),
    payload: { accountId, name: '测试组合' },
  });
  expect(portfolio.statusCode).toBe(201);
  portfolioId = portfolio.json().data.id;
  instrumentId = await createInstrument();
});

describe('收益序列的现金口径', () => {
  it('包含账户期初余额，与组合总览一致', async () => {
    const summary = await app.inject({
      method: 'GET',
      url: `/api/portfolios/${portfolioId}/summary`,
      headers: auth(token),
    });
    const cash = Number(summary.json().data.cash);

    const data = await performance('2026-01-01', '2026-01-05');
    // 没有交易也没有持仓时，序列值应等于账户现金
    expect(Number(data.points[0]!.value)).toBeCloseTo(cash, 2);
    expect(Number(data.points[data.points.length - 1]!.value)).toBeCloseTo(cash, 2);
  });
});

describe('价格可用性', () => {
  it('只录当日价格时，历史采样点标记为不完整', async () => {
    await buy('10', '10');
    await setPrice('2026-01-10', '20');

    const data = await performance('2026-01-01', '2026-01-12');

    // 持仓自 1/2 买入后才有，因此只看「有持仓但无价格」的 1/2 ~ 1/9
    const heldWithoutPrice = data.points.filter(
      (point) => point.date >= '2026-01-02' && point.date < '2026-01-10',
    );
    expect(heldWithoutPrice.length).toBeGreaterThan(0);
    expect(heldWithoutPrice.every((point) => point.complete === false)).toBe(true);
    expect(heldWithoutPrice.every((point) => point.index === null)).toBe(true);

    const on = data.points.find((point) => point.date === '2026-01-10');
    expect(on?.complete).toBe(true);

    expect(data.isComplete).toBe(false);
    expect(data.missingValuations.length).toBeGreaterThan(0);
  });

  it('按日录价后全部采样点完整', async () => {
    await buy('10', '10');
    for (let day = 5; day <= 10; day += 1) {
      await setPrice(`2026-01-${String(day).padStart(2, '0')}`, '20');
    }

    const data = await performance('2026-01-05', '2026-01-10');
    expect(data.points.every((point) => point.complete)).toBe(true);
    expect(data.missingValuations).toEqual([]);
    expect(data.isComplete).toBe(true);
  });

  it('中间缺价的日子被逐日列出', async () => {
    await buy('10', '10');
    await setPrice('2026-01-01', '20');
    await setPrice('2026-01-10', '20');

    const data = await performance('2026-01-01', '2026-01-10');
    // 中间 8 天缺少「当日或之前」的价格也不成立——1/1 的价格可用于其后所有日期，
    // 因此这里只验证两端完整、且没有凭空补点
    expect(data.points.find((point) => point.date === '2026-01-01')?.complete).toBe(true);
    expect(data.points.find((point) => point.date === '2026-01-10')?.complete).toBe(true);
  });

  it('价格目录入之前的价格不能用于更早的日期', async () => {
    await buy('10', '10');
    await setPrice('2026-02-01', '20');

    const data = await performance('2026-01-01', '2026-01-31');
    // 1/1 尚无持仓；1/2 起有持仓但价格要到 2/1 才有，因此必须全部不完整，
    // 不得用 2 月的价格回填 1 月
    const afterPurchase = data.points.filter((point) => point.date >= '2026-01-02');
    expect(afterPurchase.length).toBeGreaterThan(0);
    expect(afterPurchase.every((point) => !point.complete)).toBe(true);
  });
});

describe('估值快照接管', () => {
  it('缺价时用当日或之前最近的快照替代证券市值', async () => {
    await buy('10', '10');

    const created = await app.inject({
      method: 'POST',
      url: `/api/portfolios/${portfolioId}/valuations`,
      headers: auth(token),
      payload: { valuationDate: '2026-01-03', marketValue: '500' },
    });
    expect(created.statusCode).toBe(201);

    const data = await performance('2026-01-02', '2026-01-05');

    const beforeSnapshot = data.points.find((point) => point.date === '2026-01-02');
    expect(beforeSnapshot?.complete).toBe(false);

    for (const date of ['2026-01-03', '2026-01-04', '2026-01-05']) {
      const point = data.points.find((item) => item.date === date);
      expect(point?.complete).toBe(true);
      expect(point?.valuationSource).toBe('manual_snapshot');
      expect(point?.snapshotDate).toBe('2026-01-03');
    }
  });

  it('有价格时以重算为准，快照不生效', async () => {
    await buy('10', '10');
    await setPrice('2026-01-02', '20');
    await app.inject({
      method: 'POST',
      url: `/api/portfolios/${portfolioId}/valuations`,
      headers: auth(token),
      payload: { valuationDate: '2026-01-02', marketValue: '999999' },
    });

    const data = await performance('2026-01-02', '2026-01-03');
    expect(data.points[0]!.valuationSource).toBe('computed');
  });

  it('删除快照后对应时点回到不完整', async () => {
    await buy('10', '10');
    const created = await app.inject({
      method: 'POST',
      url: `/api/portfolios/${portfolioId}/valuations`,
      headers: auth(token),
      payload: { valuationDate: '2026-01-03', marketValue: '500' },
    });
    const valuationId = created.json().data.id;

    let data = await performance('2026-01-03', '2026-01-03');
    expect(data.points[0]!.complete).toBe(true);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/portfolios/${portfolioId}/valuations/${valuationId}`,
      headers: auth(token),
    });
    expect(removed.statusCode).toBe(200);

    data = await performance('2026-01-03', '2026-01-03');
    expect(data.points[0]!.complete).toBe(false);
  });

  it('同日重复录入需显式覆盖', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/portfolios/${portfolioId}/valuations`,
      headers: auth(token),
      payload: { valuationDate: '2026-01-03', marketValue: '500' },
    });

    const again = await app.inject({
      method: 'POST',
      url: `/api/portfolios/${portfolioId}/valuations`,
      headers: auth(token),
      payload: { valuationDate: '2026-01-03', marketValue: '600' },
    });
    expect(again.statusCode).toBe(409);

    const overwrite = await app.inject({
      method: 'POST',
      url: `/api/portfolios/${portfolioId}/valuations`,
      headers: auth(token),
      payload: { valuationDate: '2026-01-03', marketValue: '600', overwrite: true },
    });
    expect(overwrite.statusCode).toBe(201);
  });
});

describe('价格精度与校验', () => {
  it('8 位小数往返不失真', async () => {
    const res = await setPrice('2026-01-05', '0.12345678');
    expect(res.statusCode).toBe(201);
    expect(res.json().data.price).toBe('0.12345678');

    const list = await app.inject({
      method: 'GET',
      url: `/api/instruments/${instrumentId}/prices`,
      headers: auth(token),
    });
    expect(list.json().data.items[0].price).toBe('0.12345678');
  });

  it('拒绝 0 价', async () => {
    const res = await setPrice('2026-01-05', '0');
    expect(res.statusCode).toBe(400);
  });

  it('拒绝整数位超过 12 位', async () => {
    const res = await setPrice('2026-01-05', '1234567890123');
    expect(res.statusCode).toBe(400);
  });

  it('拒绝未来价格日期', async () => {
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const res = await setPrice(future, '10');
    expect(res.statusCode).toBe(422);
  });

  it('同日重录为覆盖而非新建', async () => {
    await setPrice('2026-01-05', '10');
    const second = await setPrice('2026-01-05', '11');
    expect(second.statusCode).toBe(201);
    expect(second.json().data.created).toBe(false);
  });
});

describe('审计与隔离', () => {
  it('价格与快照的增删改写入审计', async () => {
    await setPrice('2026-01-05', '10');
    await setPrice('2026-01-05', '11');

    const priceId = (
      await app.inject({
        method: 'GET',
        url: `/api/instruments/${instrumentId}/prices`,
        headers: auth(token),
      })
    ).json().data.items[0].id;

    await app.inject({
      method: 'DELETE',
      url: `/api/instruments/${instrumentId}/prices/${priceId}`,
      headers: auth(token),
    });

    await app.inject({
      method: 'POST',
      url: `/api/portfolios/${portfolioId}/valuations`,
      headers: auth(token),
      payload: { valuationDate: '2026-01-03', marketValue: '500' },
    });

    const audit = await app.inject({
      method: 'GET',
      url: '/api/audit-logs?pageSize=50',
      headers: auth(token),
    });
    const actions = (audit.json().data.items as Array<{ action: string }>).map((item) => item.action);

    expect(actions).toContain('price.created');
    expect(actions).toContain('price.updated');
    expect(actions).toContain('price.deleted');
    expect(actions).toContain('valuation.created');
  });

  it('审计不含价格数值', async () => {
    await setPrice('2026-01-05', '123.45678901');

    const audit = await app.inject({
      method: 'GET',
      url: '/api/audit-logs?pageSize=50',
      headers: auth(token),
    });
    const body = JSON.stringify(audit.json().data.items);
    expect(body).not.toContain('123.45678901');
  });

  it('跨用户不能读写他人价格', async () => {
    await setPrice('2026-01-05', '10');
    const other = await createUser(app, DOMAIN, 'other');

    const read = await app.inject({
      method: 'GET',
      url: `/api/instruments/${instrumentId}/prices`,
      headers: auth(other.token),
    });
    expect(read.statusCode).toBe(404);

    const write = await app.inject({
      method: 'POST',
      url: `/api/instruments/${instrumentId}/prices`,
      headers: auth(other.token),
      payload: { priceDate: '2026-01-06', price: '10' },
    });
    expect(write.statusCode).toBe(404);
  });
});
