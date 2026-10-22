import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('budgets');

let app: FastifyInstance;
let token: string;
let bankId: string;
let housingId: string;
let foodId: string;

interface CategoryNode {
  id: string;
  name: string;
  kind: string;
  children?: CategoryNode[];
}

async function createAccount(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    headers: auth(token),
    payload: {
      name: '银行', type: 'bank', currency: 'CNY',
      openingBalance: '50000', openingBalanceDate: '2026-01-01',
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

async function addExpense(params: {
  categoryId: string | null;
  amount: string;
  occurredAt: string;
}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/transactions',
    headers: auth(token),
    payload: {
      type: 'expense',
      accountId: bankId,
      categoryId: params.categoryId,
      amount: params.amount,
      occurredAt: params.occurredAt,
      description: '测试支出',
    },
  });
  expect(res.statusCode).toBe(201);
}

function createBudget(payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/budgets',
    headers: auth(token),
    payload,
  });
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

  bankId = await createAccount();
  housingId = await findCategory('住房', 'expense');
  foodId = await findCategory('食品', 'expense');
});

describe('预算 CRUD', () => {
  it('创建月度预算并返回进度', async () => {
    await addExpense({ categoryId: housingId, amount: '3000', occurredAt: '2026-10-06T02:00:00.000Z' });

    const res = await createBudget({
      periodType: 'monthly',
      year: 2026,
      month: 10,
      totalAmount: '10000',
      items: [{ categoryId: housingId, amount: '4000' }],
    });

    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.budget.totalAmount).toBe('10000.000000');
    expect(data.total.spent).toBe('3000.000000');
    expect(data.total.remaining).toBe('7000.000000');
    expect(data.items).toHaveLength(1);
    expect(data.items[0].spent).toBe('3000.000000');
    expect(data.total.level).toBe('ok');
  });

  it('同一周期重复创建返回 409 并附已有预算 ID', async () => {
    const first = await createBudget({ periodType: 'monthly', year: 2026, month: 10 });
    const budgetId = first.json().data.budget.id;

    const second = await createBudget({ periodType: 'monthly', year: 2026, month: 10 });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('BUDGET_PERIOD_EXISTS');
    expect(second.json().error.details.budgetId).toBe(budgetId);
  });

  it('年度预算 month 必须为 0，且可与其他年度预算区分', async () => {
    const invalid = await createBudget({ periodType: 'yearly', year: 2026, month: 10 });
    expect(invalid.statusCode).toBe(400);

    const first = await createBudget({ periodType: 'yearly', year: 2026, month: 0 });
    expect(first.statusCode).toBe(201);

    const duplicate = await createBudget({ periodType: 'yearly', year: 2026, month: 0 });
    expect(duplicate.statusCode).toBe(409);
  });

  it('年度预算开启结转返回 422', async () => {
    const res = await createBudget({
      periodType: 'yearly', year: 2026, month: 0, rollover: true,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('BUDGET_ROLLOVER_UNSUPPORTED');
  });

  it('分类额度全量替换语义', async () => {
    const created = await createBudget({
      periodType: 'monthly', year: 2026, month: 10,
      items: [
        { categoryId: housingId, amount: '4000' },
        { categoryId: foodId, amount: '1500' },
      ],
    });
    const budget = created.json().data.budget;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/budgets/${budget.id}`,
      headers: auth(token),
      payload: { version: budget.version, items: [{ categoryId: housingId, amount: '5000' }] },
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.items).toHaveLength(1);
    expect(updated.json().data.items[0].amount).toBe('5000.000000');
  });

  it('版本过期返回 409', async () => {
    const created = await createBudget({ periodType: 'monthly', year: 2026, month: 10 });
    const budget = created.json().data.budget;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/budgets/${budget.id}`,
      headers: auth(token),
      payload: { version: budget.version + 5, note: '过期版本' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('删除后不可再读取', async () => {
    const created = await createBudget({ periodType: 'monthly', year: 2026, month: 10 });
    const budgetId = created.json().data.budget.id;

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/budgets/${budgetId}`,
      headers: auth(token),
    });
    expect(removed.statusCode).toBe(200);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/budgets/${budgetId}`,
      headers: auth(token),
    });
    expect(detail.statusCode).toBe(404);
    expect(detail.json().error.code).toBe('BUDGET_NOT_FOUND');
  });
});

describe('分类额度校验', () => {
  it('收入分类不能设置预算', async () => {
    const salaryId = await findCategory('工资', 'income');

    const res = await createBudget({
      periodType: 'monthly', year: 2026, month: 10,
      items: [{ categoryId: salaryId, amount: '1000' }],
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('BUDGET_ITEM_INVALID');
  });

  it('父子分类同时预算返回 422 并指出冲突对', async () => {
    const child = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: auth(token),
      payload: { name: '预算子分类', kind: 'expense', parentId: foodId },
    });
    const childId = child.json().data.category.id;

    const res = await createBudget({
      periodType: 'monthly', year: 2026, month: 10,
      items: [
        { categoryId: foodId, amount: '1000' },
        { categoryId: childId, amount: '500' },
      ],
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('BUDGET_CATEGORY_CONFLICT');
    expect(res.json().error.details.categoryIds).toContain(foodId);
  });

  it('分类额度自动汇总子分类支出', async () => {
    const child = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: auth(token),
      payload: { name: '汇总子分类', kind: 'expense', parentId: foodId },
    });
    const childId = child.json().data.category.id;

    await addExpense({ categoryId: foodId, amount: '100', occurredAt: '2026-10-03T02:00:00.000Z' });
    await addExpense({ categoryId: childId, amount: '200', occurredAt: '2026-10-04T02:00:00.000Z' });

    const res = await createBudget({
      periodType: 'monthly', year: 2026, month: 10,
      items: [{ categoryId: foodId, amount: '1000' }],
    });

    const item = res.json().data.items[0];
    expect(item.spent).toBe('300.000000');
    expect(item.childCategoryIds).toContain(childId);
  });

  it('他人分类不能设置预算', async () => {
    const other = await createUser(app, DOMAIN, 'other');
    const otherCategories = await app.inject({
      method: 'GET',
      url: '/api/categories?kind=expense',
      headers: auth(other.token),
    });
    const tree = otherCategories.json().data.categories as CategoryNode[];
    const otherCategoryId = tree[0]!.id;

    const res = await createBudget({
      periodType: 'monthly', year: 2026, month: 10,
      items: [{ categoryId: otherCategoryId, amount: '1000' }],
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('BUDGET_ITEM_INVALID');
  });
});

describe('执行与预警', () => {
  it('未分类支出计入总预算但不计入分类额度', async () => {
    await addExpense({ categoryId: housingId, amount: '1000', occurredAt: '2026-10-03T02:00:00.000Z' });
    await addExpense({ categoryId: null, amount: '500', occurredAt: '2026-10-04T02:00:00.000Z' });

    const res = await createBudget({
      periodType: 'monthly', year: 2026, month: 10,
      totalAmount: '5000',
      items: [{ categoryId: housingId, amount: '3000' }],
    });

    const data = res.json().data;
    expect(data.total.spent).toBe('1500.000000');
    expect(data.items[0].spent).toBe('1000.000000');
    expect(data.uncategorizedSpent).toBe('500.000000');
  });

  it('超过额度为 exceeded，达到 80% 为 warning', async () => {
    await addExpense({ categoryId: housingId, amount: '4200', occurredAt: '2026-10-03T02:00:00.000Z' });
    await addExpense({ categoryId: foodId, amount: '900', occurredAt: '2026-10-04T02:00:00.000Z' });

    const res = await createBudget({
      periodType: 'monthly', year: 2026, month: 10,
      items: [
        { categoryId: housingId, amount: '4000' },
        { categoryId: foodId, amount: '1000' },
      ],
    });

    const items = res.json().data.items as Array<{ categoryName: string; level: string }>;
    expect(items.find((item) => item.categoryName === '住房')!.level).toBe('exceeded');
    expect(items.find((item) => item.categoryName === '食品')!.level).toBe('warning');
  });

  it('修改历史流水后预算进度立即变化', async () => {
    const created = await createBudget({
      periodType: 'monthly', year: 2026, month: 10, totalAmount: '5000',
    });
    const budgetId = created.json().data.budget.id;
    expect(created.json().data.total.spent).toBe('0.000000');

    await addExpense({ categoryId: foodId, amount: '1200', occurredAt: '2026-10-05T02:00:00.000Z' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/budgets/${budgetId}/progress`,
      headers: auth(token),
    });
    expect(res.json().data.total.spent).toBe('1200.000000');
  });

  it('预警接口只返回 warning 与 exceeded', async () => {
    await addExpense({ categoryId: housingId, amount: '4500', occurredAt: '2026-10-03T02:00:00.000Z' });
    await addExpense({ categoryId: foodId, amount: '100', occurredAt: '2026-10-04T02:00:00.000Z' });

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    await createBudget({
      periodType: 'monthly', year, month,
      items: [
        { categoryId: housingId, amount: '4000' },
        { categoryId: foodId, amount: '2000' },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/budgets/alerts',
      headers: auth(token),
    });

    const alerts = res.json().data.alerts as Array<{ scope: string; level: string }>;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.level).toBe('exceeded');
    expect(alerts[0]!.scope).toBe('category');
  });
});

describe('结转', () => {
  it('上月正结余结转到本月可用额度', async () => {
    // 九月：额度 1000，花费 600 → 结余 400
    await addExpense({ categoryId: foodId, amount: '600', occurredAt: '2026-09-10T02:00:00.000Z' });
    await createBudget({
      periodType: 'monthly', year: 2026, month: 9,
      totalAmount: '1000', rollover: true,
      items: [{ categoryId: foodId, amount: '1000' }],
    });

    // 十月：额度 1000，应可用 1400
    const october = await createBudget({
      periodType: 'monthly', year: 2026, month: 10,
      totalAmount: '1000', rollover: true,
      items: [{ categoryId: foodId, amount: '1000' }],
    });

    const data = october.json().data;
    expect(data.total.carryIn).toBe('400.000000');
    expect(data.total.available).toBe('1400.000000');
    expect(data.items[0].carryIn).toBe('400.000000');
    expect(data.basis.rolloverChain).toBe(1);
  });

  it('上月超支不产生负结转', async () => {
    await addExpense({ categoryId: foodId, amount: '1500', occurredAt: '2026-09-10T02:00:00.000Z' });
    await createBudget({
      periodType: 'monthly', year: 2026, month: 9,
      totalAmount: '1000', rollover: true,
    });

    const october = await createBudget({
      periodType: 'monthly', year: 2026, month: 10,
      totalAmount: '1000', rollover: true,
    });

    expect(october.json().data.total.carryIn).toBe('0.000000');
    expect(october.json().data.total.available).toBe('1000.000000');
  });

  it('前置预算未开启结转时链在此重置', async () => {
    await addExpense({ categoryId: foodId, amount: '100', occurredAt: '2026-09-10T02:00:00.000Z' });
    await createBudget({
      periodType: 'monthly', year: 2026, month: 9,
      totalAmount: '1000', rollover: false,
    });

    const october = await createBudget({
      periodType: 'monthly', year: 2026, month: 10,
      totalAmount: '1000', rollover: true,
    });

    expect(october.json().data.total.carryIn).toBe('0.000000');
  });

  it('未开启结转时可用额度等于额度', async () => {
    await addExpense({ categoryId: foodId, amount: '100', occurredAt: '2026-09-10T02:00:00.000Z' });
    await createBudget({
      periodType: 'monthly', year: 2026, month: 9, totalAmount: '1000', rollover: true,
    });

    const october = await createBudget({
      periodType: 'monthly', year: 2026, month: 10, totalAmount: '1000',
    });

    expect(october.json().data.total.carryIn).toBe('0.000000');
    expect(october.json().data.basis.rolloverChain).toBe(0);
  });
});

describe('列表、复制与隔离', () => {
  it('复制预算到下一周期', async () => {
    const created = await createBudget({
      periodType: 'monthly', year: 2026, month: 10,
      totalAmount: '8000',
      items: [{ categoryId: foodId, amount: '2000' }],
    });
    const budgetId = created.json().data.budget.id;

    const copied = await app.inject({
      method: 'POST',
      url: `/api/budgets/${budgetId}/copy`,
      headers: auth(token),
      payload: {},
    });

    expect(copied.statusCode).toBe(201);
    const data = copied.json().data;
    expect(data.budget.year).toBe(2026);
    expect(data.budget.month).toBe(11);
    expect(data.budget.totalAmount).toBe('8000.000000');
    expect(data.items).toHaveLength(1);
  });

  it('复制到已存在周期返回 409', async () => {
    const created = await createBudget({ periodType: 'monthly', year: 2026, month: 10 });
    const budgetId = created.json().data.budget.id;
    await createBudget({ periodType: 'monthly', year: 2026, month: 11 });

    const res = await app.inject({
      method: 'POST',
      url: `/api/budgets/${budgetId}/copy`,
      headers: auth(token),
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('BUDGET_PERIOD_EXISTS');
  });

  it('复制跨年自动进位', async () => {
    const created = await createBudget({ periodType: 'monthly', year: 2026, month: 12 });
    const budgetId = created.json().data.budget.id;

    const copied = await app.inject({
      method: 'POST',
      url: `/api/budgets/${budgetId}/copy`,
      headers: auth(token),
      payload: {},
    });

    expect(copied.json().data.budget.year).toBe(2027);
    expect(copied.json().data.budget.month).toBe(1);
  });

  it('列表按周期筛选', async () => {
    await createBudget({ periodType: 'monthly', year: 2026, month: 10 });
    await createBudget({ periodType: 'monthly', year: 2026, month: 11 });

    const res = await app.inject({
      method: 'GET',
      url: '/api/budgets?year=2026&month=10',
      headers: auth(token),
    });

    expect(res.json().data.budgets).toHaveLength(1);
    expect(res.json().data.budgets[0].month).toBe(10);
  });

  it('他人预算一律 404', async () => {
    const created = await createBudget({ periodType: 'monthly', year: 2026, month: 10 });
    const budgetId = created.json().data.budget.id;

    const other = await createUser(app, DOMAIN, 'other');

    for (const request of [
      { method: 'GET' as const, url: `/api/budgets/${budgetId}` },
      { method: 'DELETE' as const, url: `/api/budgets/${budgetId}` },
    ]) {
      const res = await app.inject({
        method: request.method,
        url: request.url,
        headers: auth(other.token),
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it('summary 与 alerts 不被 :id 路由吞掉', async () => {
    const summary = await app.inject({
      method: 'GET',
      url: '/api/budgets/summary?periodType=monthly&year=2026&month=10',
      headers: auth(token),
    });
    // 无预算时应为 404 BUDGET_NOT_FOUND，而不是参数校验错误
    expect(summary.json().error?.code).toBe('BUDGET_NOT_FOUND');

    const alerts = await app.inject({
      method: 'GET',
      url: '/api/budgets/alerts',
      headers: auth(token),
    });
    expect(alerts.statusCode).toBe(200);
    expect(alerts.json().data.alerts).toEqual([]);
  });
});
