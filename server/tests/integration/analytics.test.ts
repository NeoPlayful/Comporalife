import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('analytics');

let app: FastifyInstance;
let token: string;
let bankId: string;
let cashId: string;
let housingId: string;
let foodId: string;
let salaryId: string;

async function createAccount(payload: Record<string, unknown>): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    headers: auth(token),
    payload: { currency: 'CNY', openingBalance: '0', openingBalanceDate: '2026-01-01', ...payload },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.account.id;
}

interface CategoryNode {
  id: string;
  name: string;
  kind: string;
  children?: CategoryNode[];
}

async function findOrCreateCategory(
  name: string,
  kind: 'income' | 'expense',
  parentId?: string,
): Promise<string> {
  const list = await app.inject({
    method: 'GET',
    url: `/api/categories?kind=${kind}`,
    headers: auth(token),
  });
  const tree = list.json().data.categories as CategoryNode[];
  const flat = tree.flatMap((node) => [node, ...(node.children ?? [])]);
  const existing = flat.find((node) => node.name === name && node.kind === kind);
  if (existing) return existing.id;

  const res = await app.inject({
    method: 'POST',
    url: '/api/categories',
    headers: auth(token),
    payload: { name, kind, ...(parentId ? { parentId } : {}) },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.category.id;
}

async function addTransaction(payload: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/transactions',
    headers: auth(token),
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.transaction.id as string;
}

async function addTransfer(from: string, to: string, amount: string, occurredAt: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/transfers',
    headers: auth(token),
    payload: { fromAccountId: from, toAccountId: to, amount, occurredAt },
  });
  expect(res.statusCode).toBe(201);
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

  bankId = await createAccount({ name: '银行', type: 'bank', openingBalance: '20000' });
  cashId = await createAccount({ name: '现金', type: 'cash' });
  housingId = await findOrCreateCategory('住房', 'expense');
  foodId = await findOrCreateCategory('餐饮', 'expense');
  salaryId = await findOrCreateCategory('工资', 'income');
});

describe('收支汇总', () => {
  it('转账与调整不计入收入支出', async () => {
    await addTransaction({
      type: 'income', accountId: bankId, categoryId: salaryId,
      amount: '10000', occurredAt: '2026-10-05T02:00:00.000Z', description: '工资',
    });
    await addTransaction({
      type: 'expense', accountId: bankId, categoryId: housingId,
      amount: '3000', occurredAt: '2026-10-06T02:00:00.000Z', description: '房租',
    });
    await addTransfer(bankId, cashId, '2000', '2026-10-07T02:00:00.000Z');

    const res = await app.inject({
      method: 'GET',
      url: '/api/analytics/income-expense?from=2026-10-01&to=2026-10-31',
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.income).toBe('10000.000000');
    expect(data.expense).toBe('3000.000000');
    expect(data.net).toBe('7000.000000');
    expect(data.savingsRate).toBe('0.7000');
    expect(data.transactionCounts).toEqual({ income: 1, expense: 1 });
  });

  it('收入为 0 时储蓄率为 null', async () => {
    await addTransaction({
      type: 'expense', accountId: cashId, categoryId: foodId,
      amount: '100', occurredAt: '2026-10-03T02:00:00.000Z', description: '午餐',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/analytics/income-expense?from=2026-10-01&to=2026-10-31',
      headers: auth(token),
    });

    expect(res.json().data.savingsRate).toBeNull();
  });

  it('冲正交易被排除', async () => {
    const txId = await addTransaction({
      type: 'expense', accountId: cashId, categoryId: foodId,
      amount: '500', occurredAt: '2026-10-03T02:00:00.000Z', description: '误记',
    });

    await app.inject({
      method: 'DELETE',
      url: `/api/transactions/${txId}`,
      headers: auth(token),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/analytics/income-expense?from=2026-10-01&to=2026-10-31',
      headers: auth(token),
    });

    expect(res.json().data.expense).toBe('0.000000');
  });

  it('与 Dashboard 现金流的支出口径一致', async () => {
    await addTransaction({
      type: 'expense', accountId: bankId, categoryId: housingId,
      amount: '1200', occurredAt: '2026-10-06T02:00:00.000Z', description: '房租',
    });
    await addTransaction({
      type: 'expense', accountId: cashId, categoryId: null,
      amount: '80', occurredAt: '2026-10-08T02:00:00.000Z', description: '杂项',
    });

    const [analytics, dashboard] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/api/analytics/income-expense?from=2026-10-01&to=2026-10-31',
        headers: auth(token),
      }),
      app.inject({
        method: 'GET',
        url: '/api/dashboard/cashflow?from=2026-10-01T00:00:00.000Z&to=2026-10-31T23:59:59.999Z',
        headers: auth(token),
      }),
    ]);

    expect(Number(analytics.json().data.expense)).toBeCloseTo(
      Number(dashboard.json().data.totalExpense),
      6,
    );
  });

  it('区间超过 5 年返回 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/analytics/income-expense?from=2015-01-01&to=2026-10-31',
      headers: auth(token),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ANALYTICS_RANGE_TOO_LARGE');
  });
});

describe('分类分析', () => {
  it('一级分类金额等于其二级分类之和', async () => {
    const child = await findOrCreateCategory('测试外食', 'expense', foodId);

    await addTransaction({
      type: 'expense', accountId: cashId, categoryId: foodId,
      amount: '100', occurredAt: '2026-10-03T02:00:00.000Z', description: '午餐',
    });
    await addTransaction({
      type: 'expense', accountId: cashId, categoryId: child,
      amount: '200', occurredAt: '2026-10-04T02:00:00.000Z', description: '聚餐',
    });

    const level1 = await app.inject({
      method: 'GET',
      url: '/api/analytics/categories?from=2026-10-01&to=2026-10-31&kind=expense&level=1',
      headers: auth(token),
    });

    const food = level1.json().data.items.find((item: { name: string }) => item.name === '餐饮');
    expect(food.amount).toBe('300.000000');

    const level2 = await app.inject({
      method: 'GET',
      url: '/api/analytics/categories?from=2026-10-01&to=2026-10-31&kind=expense&level=2',
      headers: auth(token),
    });
    expect(level2.json().data.items).toHaveLength(2);
  });

  it('未分类金额进入覆盖率但不进入分类条目', async () => {
    await addTransaction({
      type: 'expense', accountId: cashId, categoryId: foodId,
      amount: '900', occurredAt: '2026-10-03T02:00:00.000Z', description: '餐费',
    });
    await addTransaction({
      type: 'expense', accountId: cashId, categoryId: null,
      amount: '100', occurredAt: '2026-10-04T02:00:00.000Z', description: '未知',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/analytics/categories?from=2026-10-01&to=2026-10-31',
      headers: auth(token),
    });

    const data = res.json().data;
    expect(data.items).toHaveLength(1);
    expect(data.coverage.uncategorizedAmount).toBe('100.000000');
    expect(data.coverage.uncategorizedCount).toBe(1);
    expect(data.coverage.coverageRatio).toBe('0.9000');
  });

  it('环比附带上一等长周期的分类金额', async () => {
    await addTransaction({
      type: 'expense', accountId: cashId, categoryId: foodId,
      amount: '100', occurredAt: '2026-09-10T02:00:00.000Z', description: '九月',
    });
    await addTransaction({
      type: 'expense', accountId: cashId, categoryId: foodId,
      amount: '150', occurredAt: '2026-10-10T02:00:00.000Z', description: '十月',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/analytics/categories?from=2026-10-01&to=2026-10-31&previous=true',
      headers: auth(token),
    });

    const item = res.json().data.items[0];
    // 上一等长周期为 8/31–9/29，包含 9 月 10 日那笔
    expect(item.previousAmount).toBe('100.000000');
    expect(item.changeRatio).toBe('0.5000');
  });
});

describe('账户、未分类与商户', () => {
  it('账户维度单独列出转账，不并入收支', async () => {
    await addTransfer(bankId, cashId, '500', '2026-10-07T02:00:00.000Z');

    const res = await app.inject({
      method: 'GET',
      url: '/api/analytics/accounts?from=2026-10-01&to=2026-10-31',
      headers: auth(token),
    });

    const items = res.json().data.items as Array<Record<string, string>>;
    const bank = items.find((item) => item.name === '银行')!;
    const cash = items.find((item) => item.name === '现金')!;

    expect(bank.transferOut).toBe('500.000000');
    expect(bank.expense).toBe('0.000000');
    expect(cash.transferIn).toBe('500.000000');
    expect(res.json().data.totals.expenseBase).toBe('0.000000');
  });

  it('未分类接口返回笔数与最早时间', async () => {
    await addTransaction({
      type: 'expense', accountId: cashId, categoryId: null,
      amount: '60', occurredAt: '2026-10-02T02:00:00.000Z', description: 'A',
    });
    await addTransaction({
      type: 'expense', accountId: cashId, categoryId: null,
      amount: '40', occurredAt: '2026-10-09T02:00:00.000Z', description: 'B',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/analytics/uncategorized?from=2026-10-01&to=2026-10-31',
      headers: auth(token),
    });

    const data = res.json().data;
    expect(data.count).toBe(2);
    expect(data.amount).toBe('100.000000');
    expect(data.oldestOccurredAt).toContain('2026-10-02');
  });

  it('商户为空的流水进入 unattributed，不进入排行', async () => {
    await addTransaction({
      type: 'expense', accountId: cashId, categoryId: foodId, merchant: '示例餐厅',
      amount: '300', occurredAt: '2026-10-05T02:00:00.000Z', description: '晚餐',
    });
    await addTransaction({
      type: 'expense', accountId: cashId, categoryId: null, merchant: null,
      amount: '200', occurredAt: '2026-10-06T02:00:00.000Z', description: '无商户',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/analytics/merchants?from=2026-10-01&to=2026-10-31',
      headers: auth(token),
    });

    const data = res.json().data;
    expect(data.items).toHaveLength(1);
    expect(data.items[0].merchant).toBe('示例餐厅');
    expect(data.items[0].topCategoryName).toBe('餐饮');
    expect(data.unattributed.amount).toBe('200.000000');
  });

  it('交易列表支持未分类与来源筛选', async () => {
    await addTransaction({
      type: 'expense', accountId: cashId, categoryId: null,
      amount: '10', occurredAt: '2026-10-05T02:00:00.000Z', description: '未分类',
    });
    await addTransaction({
      type: 'expense', accountId: cashId, categoryId: foodId,
      amount: '20', occurredAt: '2026-10-06T02:00:00.000Z', description: '已分类',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/transactions?uncategorized=true&source=manual',
      headers: auth(token),
    });

    const transactions = res.json().data.transactions as Array<{ description: string }>;
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.description).toBe('未分类');
  });
});

describe('趋势与对比', () => {
  it('时间序列补齐无流水周期并标记不完整', async () => {
    await addTransaction({
      type: 'expense', accountId: cashId, categoryId: foodId,
      amount: '100', occurredAt: '2026-10-05T02:00:00.000Z', description: '十月',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/analytics/cashflow-trend?from=2026-08-01&to=2026-10-31&granularity=month',
      headers: auth(token),
    });

    const points = res.json().data.points as Array<{ period: string; isComplete: boolean }>;
    expect(points.map((point) => point.period)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(points[0]!.isComplete).toBe(false);
    expect(points[2]!.isComplete).toBe(true);
  });

  it('历史不足 12 个月时同比为 null', async () => {
    await addTransaction({
      type: 'expense', accountId: cashId, categoryId: foodId,
      amount: '100', occurredAt: '2026-10-05T02:00:00.000Z', description: '十月',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/analytics/period-comparison?from=2026-10-01&to=2026-10-31&mode=month',
      headers: auth(token),
    });

    const data = res.json().data;
    expect(data.yoy).toBeNull();
    expect(data.basis.yoyAvailable).toBe(false);
    expect(data.changes.expense).toBeNull();
  });

  it('大额支出在样本不足时使用中位数倍数', async () => {
    // 笔数少于 20 时 P95 不稳定，阈值为中位数 × 3
    for (const day of ['01', '02', '03', '04', '05', '06', '07', '08', '09']) {
      await addTransaction({
        type: 'expense', accountId: cashId, categoryId: foodId,
        amount: '50', occurredAt: `2026-10-${day}T02:00:00.000Z`, description: `日常 ${day}`,
      });
    }
    await addTransaction({
      type: 'expense', accountId: cashId, categoryId: housingId,
      amount: '900', occurredAt: '2026-10-10T02:00:00.000Z', description: '房租',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/analytics/large-expenses?from=2026-10-01&to=2026-10-31',
      headers: auth(token),
    });

    const data = res.json().data;
    expect(data.thresholdSource).toBe('median_multiple');
    expect(data.items).toHaveLength(1);
    expect(data.items[0].description).toBe('房租');
  });

  it('显式阈值覆盖自动判定', async () => {
    await addTransaction({
      type: 'expense', accountId: cashId, categoryId: foodId,
      amount: '200', occurredAt: '2026-10-05T02:00:00.000Z', description: '餐费',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/analytics/large-expenses?from=2026-10-01&to=2026-10-31&threshold=100',
      headers: auth(token),
    });

    const data = res.json().data;
    expect(data.thresholdSource).toBe('parameter');
    expect(data.items).toHaveLength(1);
  });

  it('区间参数格式错误返回 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/analytics/income-expense?from=2026/10/01&to=2026-10-31',
      headers: auth(token),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('跨用户隔离', () => {
  it('分析接口只返回自己的数据', async () => {
    const other = await createUser(app, DOMAIN, 'other');

    await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: auth(other.token),
      payload: {
        name: '他人账户', type: 'bank', currency: 'CNY',
        openingBalance: '1000', openingBalanceDate: '2026-01-01',
      },
    }).then(async (accountRes) => {
      const accountId = accountRes.json().data.account.id;
      const categoryRes = await app.inject({
        method: 'POST',
        url: '/api/categories',
        headers: auth(other.token),
        payload: { name: '他人分类', kind: 'expense' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/transactions',
        headers: auth(other.token),
        payload: {
          type: 'expense', accountId, categoryId: categoryRes.json().data.category.id,
          amount: '999', occurredAt: '2026-10-05T02:00:00.000Z', description: '他人支出',
        },
      });
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/analytics/income-expense?from=2026-10-01&to=2026-10-31',
      headers: auth(token),
    });

    expect(res.json().data.expense).toBe('0.000000');
  });
});
