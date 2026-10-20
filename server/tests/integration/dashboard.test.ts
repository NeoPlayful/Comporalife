import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('dashboard');

let app: FastifyInstance;
let token: string;
let bankId: string;
let cashId: string;
let expenseCategoryId: string;
let incomeCategoryId: string;

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

  const bank = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    headers: auth(token),
    payload: {
      name: '银行',
      type: 'bank',
      currency: 'CNY',
      openingBalance: '10000',
      openingBalanceDate: '2026-01-01',
    },
  });
  bankId = bank.json().data.account.id;

  // 信用卡用于验证负债口径（勿删）
  await app.inject({
    method: 'POST',
    url: '/api/accounts',
    headers: auth(token),
    payload: {
      name: '信用卡',
      type: 'credit_card',
      currency: 'CNY',
      openingBalance: '2000',
      openingBalanceDate: '2026-01-01',
    },
  });


  const cash = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    headers: auth(token),
    payload: {
      name: '现金',
      type: 'cash',
      currency: 'CNY',
      openingBalance: '1000',
      openingBalanceDate: '2026-01-01',
    },
  });
  cashId = cash.json().data.account.id;

  const tree = await app.inject({ method: 'GET', url: '/api/categories', headers: auth(token) });
  const flat = tree.json().data.flat as Array<{ id: string; kind: string; name: string }>;
  expenseCategoryId = flat.find((c) => c.kind === 'expense' && c.name === '食品')!.id;
  incomeCategoryId = flat.find((c) => c.kind === 'income' && c.name === '工资')!.id;
});

async function addTransaction(type: 'income' | 'expense', amount: string, occurredAt: string) {
  return app.inject({
    method: 'POST',
    url: '/api/transactions',
    headers: auth(token),
    payload: {
      type,
      accountId: type === 'income' ? bankId : cashId,
      categoryId: type === 'income' ? incomeCategoryId : expenseCategoryId,
      amount,
      occurredAt,
      description: type === 'income' ? '工资' : '支出',
    },
  });
}

describe('净资产', () => {
  it('信用卡余额计入负债而非资产', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/overview',
      headers: auth(token),
    });

    const data = res.json().data;
    // 资产 = 银行 10000 + 现金 1000 = 11000，负债 = 2000
    expect(data.totalAssets).toBe('11000.000000');
    expect(data.totalLiabilities).toBe('2000.000000');
    expect(data.netWorth).toBe('9000.000000');
  });

  it('响应带完整统计口径', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/overview',
      headers: auth(token),
    });

    const basis = res.json().data.basis;
    expect(basis.baseCurrency).toBe('CNY');
    expect(basis.timezone).toBe('Asia/Shanghai');
    expect(basis.asOf).toBeTruthy();
    expect(basis.period.from).toBeTruthy();
    expect(Array.isArray(basis.missingRates)).toBe(true);
  });

  it('净资产趋势返回序列', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/net-worth-trend?from=2026-01-01&to=2026-01-31',
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.granularity).toBe('day');
    expect(data.series.length).toBe(31);
    // 期初之后无流水，净值恒定期初资产减负债
    expect(data.series[0].netWorth).toBe('9000.000000');
  });
});

describe('现金流', () => {
  it('转账不计入收入与支出', async () => {
    await addTransaction('income', '8000', '2026-02-01T10:00:00Z');
    await addTransaction('expense', '3000', '2026-02-02T10:00:00Z');

    await app.inject({
      method: 'POST',
      url: '/api/transfers',
      headers: auth(token),
      payload: {
        fromAccountId: bankId,
        toAccountId: cashId,
        amount: '2000',
        occurredAt: '2026-02-03T10:00:00Z',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/cashflow?from=2026-02-01T00:00:00Z&to=2026-02-28T23:59:59Z',
      headers: auth(token),
    });

    const data = res.json().data;
    expect(data.totalIncome).toBe('8000.000000');
    expect(data.totalExpense).toBe('3000.000000');
    expect(data.totalNet).toBe('5000.000000');
    // 转账单独统计，不混入收支
    expect(data.transferTotal).toBe('2000.000000');
  });

  it('储蓄率 = 净结余 / 收入', async () => {
    await addTransaction('income', '10000', '2026-03-01T10:00:00Z');
    await addTransaction('expense', '4000', '2026-03-02T10:00:00Z');

    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/cashflow?from=2026-03-01T00:00:00Z&to=2026-03-31T23:59:59Z',
      headers: auth(token),
    });

    expect(res.json().data.savingsRate).toBe('0.6000');
  });

  it('收入为 0 时储蓄率为 null', async () => {
    await addTransaction('expense', '500', '2026-04-01T10:00:00Z');

    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/cashflow?from=2026-04-01T00:00:00Z&to=2026-04-30T23:59:59Z',
      headers: auth(token),
    });

    expect(res.json().data.savingsRate).toBeNull();
  });

  it('无流水月份标记为不完整', async () => {
    await addTransaction('expense', '100', '2026-05-10T10:00:00Z');

    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/cashflow?from=2026-05-01T00:00:00Z&to=2026-06-30T23:59:59Z',
      headers: auth(token),
    });

    const points = res.json().data.points as Array<{ period: string; isComplete: boolean }>;
    expect(points.find((p) => p.period === '2026-05')?.isComplete).toBe(true);
    // 6 月没有流水，必须标记不完整而不是当作 0 支出
    expect(points.find((p) => p.period === '2026-06')?.isComplete).toBe(false);
  });

  it('区间内月份完整填充', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/cashflow?from=2026-01-01T00:00:00Z&to=2026-03-31T23:59:59Z',
      headers: auth(token),
    });

    const periods = (res.json().data.points as Array<{ period: string }>).map((p) => p.period);
    expect(periods).toEqual(['2026-01', '2026-02', '2026-03']);
  });
});

describe('多币种与汇率', () => {
  it('缺少汇率时返回 422 并列出币种对', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: auth(token),
      payload: {
        name: '美元账户',
        type: 'bank',
        currency: 'USD',
        openingBalance: '1000',
        openingBalanceDate: '2026-01-01',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/exchange-rates?from=USD&to=CNY',
      headers: auth(token),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('CURRENCY_RATE_MISSING');
    expect(res.json().error.details.missingPairs).toContain('USD->CNY');
  });

  it('录入汇率后可折算', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: auth(token),
      payload: {
        name: '美元账户',
        type: 'bank',
        currency: 'USD',
        openingBalance: '1000',
        openingBalanceDate: '2026-01-01',
      },
    });

    await app.inject({
      method: 'POST',
      url: '/api/exchange-rates/manual',
      headers: auth(token),
      payload: { baseCurrency: 'USD', quoteCurrency: 'CNY', rate: '7.2', rateDate: '2026-01-01' },
    });

    const overview = await app.inject({
      method: 'GET',
      url: '/api/dashboard/overview',
      headers: auth(token),
    });

    // 1000 USD * 7.2 = 7200 CNY，加上 11000 资产
    expect(overview.json().data.totalAssets).toBe('18200.000000');
    expect(overview.json().data.basis.missingRates).toEqual([]);
  });

  it('支持反向汇率取倒数', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/exchange-rates/manual',
      headers: auth(token),
      payload: { baseCurrency: 'CNY', quoteCurrency: 'USD', rate: '7', rateDate: '2026-01-01' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/exchange-rates?from=USD&to=CNY',
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.inverted).toBe(true);
    expect(Number(res.json().data.rate)).toBeCloseTo(1 / 7, 8);
  });

  it('汇率按汇率日期向前取值', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/exchange-rates/manual',
      headers: auth(token),
      payload: { baseCurrency: 'USD', quoteCurrency: 'CNY', rate: '7', rateDate: '2026-01-01' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/exchange-rates/manual',
      headers: auth(token),
      payload: { baseCurrency: 'USD', quoteCurrency: 'CNY', rate: '7.5', rateDate: '2026-06-01' },
    });

    const before = await app.inject({
      method: 'GET',
      url: '/api/exchange-rates?from=USD&to=CNY&asOf=2026-03-01',
      headers: auth(token),
    });
    expect(before.json().data.rate).toBe('7.0000000000');

    const after = await app.inject({
      method: 'GET',
      url: '/api/exchange-rates?from=USD&to=CNY&asOf=2026-07-01',
      headers: auth(token),
    });
    expect(after.json().data.rate).toBe('7.5000000000');
  });
});

describe('资产配置与数据质量', () => {
  it('资产配置按类型返回占比', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/asset-allocation',
      headers: auth(token),
    });

    const data = res.json().data;
    const bank = data.byType.find((item: { type: string }) => item.type === 'bank');
    const card = data.byType.find((item: { type: string }) => item.type === 'credit_card');

    expect(bank.amount).toBe('10000.000000');
    expect(card.amount).toBe('2000.000000');
    expect(data.total).toBe('13000.000000');
  });

  it('数据质量统计未分类流水', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: auth(token),
      payload: {
        type: 'expense',
        accountId: cashId,
        amount: '88',
        occurredAt: '2026-02-01T10:00:00Z',
        description: '未分类支出',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/data-quality',
      headers: auth(token),
    });

    expect(res.json().data.uncategorizedTransactions).toBe(1);
  });

  it('数据质量列出缺少汇率的币种', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: auth(token),
      payload: {
        name: '欧元账户',
        type: 'bank',
        currency: 'EUR',
        openingBalance: '500',
        openingBalanceDate: '2026-01-01',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/data-quality',
      headers: auth(token),
    });

    expect(res.json().data.missingRateCurrencies).toContain('EUR');
  });

  it('数据质量标记归档但仍有余额的账户', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/accounts/${cashId}/archive`,
      headers: auth(token),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/data-quality',
      headers: auth(token),
    });

    expect(res.json().data.archivedWithNonZeroBalance).toContain('现金');
  });

  it('最近流水按时间倒序', async () => {
    await addTransaction('expense', '100', '2026-02-01T10:00:00Z');
    await addTransaction('expense', '200', '2026-02-05T10:00:00Z');

    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/recent-transactions',
      headers: auth(token),
    });

    const list = res.json().data.transactions as Array<{ occurredAt: string }>;
    expect(list.length).toBe(2);
    expect(new Date(list[0]!.occurredAt) > new Date(list[1]!.occurredAt)).toBe(true);
  });

  it('数据隔离：他人 Dashboard 看不到本用户账户', async () => {
    const other = await createUser(app, DOMAIN, 'other');

    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/account-balances',
      headers: auth(other.token),
    });

    expect(res.json().data.accounts).toHaveLength(0);
  });
});
