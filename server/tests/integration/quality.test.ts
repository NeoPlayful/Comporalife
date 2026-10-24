import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('quality');

let app: FastifyInstance;
let token: string;
let userId: string;
let bankId: string;
let expenseCategoryId: string;

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
  kind: string;
  children?: CategoryNode[];
}

async function firstCategory(kind: 'income' | 'expense'): Promise<string> {
  const res = await app.inject({ method: 'GET', url: '/api/categories', headers: auth(token) });
  const roots = res.json().data.categories as CategoryNode[];
  const match = roots.find((node) => node.kind === kind && node.children && node.children.length > 0);
  return (match?.children?.[0]?.id ?? match?.id)!;
}

async function addExpense(payload: {
  amount: string;
  occurredAt: string;
  description?: string;
  categoryId?: string | null;
}): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/transactions',
    headers: auth(token),
    payload: {
      type: 'expense',
      accountId: bankId,
      amount: payload.amount,
      occurredAt: payload.occurredAt,
      description: payload.description ?? '测试支出',
      ...(payload.categoryId === null ? {} : { categoryId: payload.categoryId ?? expenseCategoryId }),
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.transaction.id;
}

async function snapshotCounts(): Promise<Record<string, number>> {
  return {
    transactions: await app.prisma.transaction.count({ where: { userId } }),
    entries: await app.prisma.transactionEntry.count({ where: { userId } }),
    accounts: await app.prisma.account.count({ where: { userId } }),
    reports: await app.prisma.report.count({ where: { userId } }),
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
  userId = user.userId;

  bankId = await createAccount({ name: '储蓄账户', type: 'bank', openingBalance: '100000' });
  expenseCategoryId = await firstCategory('expense');
});

describe('数据质量总览', () => {
  it('未分类条数只统计已过账的收入支出', async () => {
    await addExpense({ amount: '100', occurredAt: '2026-09-02', categoryId: null });
    await addExpense({ amount: '200', occurredAt: '2026-09-03', categoryId: null });
    await addExpense({ amount: '300', occurredAt: '2026-09-04' });

    const res = await app.inject({ method: 'GET', url: '/api/data-quality/summary', headers: auth(token) });
    expect(res.statusCode).toBe(200);

    const metric = res.json().data.metrics.find((item: { key: string }) => item.key === 'uncategorized');
    expect(metric.count).toBe(2);
    expect(metric.unavailableReason).toBeNull();
  });

  it('没有账户时缺失月份返回 null 而不是 0', async () => {
    await app.prisma.account.deleteMany({ where: { userId } });

    const res = await app.inject({ method: 'GET', url: '/api/data-quality/summary', headers: auth(token) });
    const metric = res.json().data.metrics.find((item: { key: string }) => item.key === 'missing_months');

    expect(metric.count).toBeNull();
    expect(metric.unavailableReason).toBe('no_accounts');
  });

  it('总览返回口径键，前端据此翻译', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/data-quality/summary', headers: auth(token) });
    const body = res.json().data;

    expect(typeof body.checkedAt).toBe('string');
    expect(body.metrics.every((item: { rule: string }) => item.rule.length > 0)).toBe(true);
  });

  it('查询质量指标不产生任何写入', async () => {
    await addExpense({ amount: '120', occurredAt: '2026-09-05' });
    const before = await snapshotCounts();

    await app.inject({ method: 'GET', url: '/api/data-quality/summary', headers: auth(token) });
    await app.inject({ method: 'GET', url: '/api/data-quality/uncategorized', headers: auth(token) });
    await app.inject({ method: 'GET', url: '/api/data-quality/duplicates', headers: auth(token) });
    await app.inject({ method: 'GET', url: '/api/data-quality/missing-months', headers: auth(token) });

    expect(await snapshotCounts()).toEqual(before);
  });
});

describe('未分类明细', () => {
  it('明细条数与总览一致', async () => {
    await addExpense({ amount: '50', occurredAt: '2026-09-01', categoryId: null });
    await addExpense({ amount: '60', occurredAt: '2026-09-02', categoryId: null });

    const summary = await app.inject({ method: 'GET', url: '/api/data-quality/summary', headers: auth(token) });
    const count = summary.json().data.metrics.find((item: { key: string }) => item.key === 'uncategorized').count;

    const detail = await app.inject({ method: 'GET', url: '/api/data-quality/uncategorized', headers: auth(token) });

    expect(detail.json().data.total).toBe(count);
    expect(detail.json().data.items).toHaveLength(count);
  });

  it('同额同日不会被算成未分类之外的问题', async () => {
    await addExpense({ amount: '88', occurredAt: '2026-09-10' });
    const detail = await app.inject({ method: 'GET', url: '/api/data-quality/uncategorized', headers: auth(token) });

    expect(detail.json().data.total).toBe(0);
  });
});

describe('疑似重复', () => {
  it('同账户同金额同日期的两笔被识别为疑似重复', async () => {
    await addExpense({ amount: '99', occurredAt: '2026-09-11', description: '午餐' });
    await addExpense({ amount: '99', occurredAt: '2026-09-11', description: '午餐' });

    const res = await app.inject({ method: 'GET', url: '/api/data-quality/duplicates', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.total).toBe(1);
    expect(res.json().data.items[0].dayGap).toBe(0);
  });

  it('超过日期窗口的相同金额不算重复', async () => {
    await addExpense({ amount: '77', occurredAt: '2026-09-01' });
    await addExpense({ amount: '77', occurredAt: '2026-09-20' });

    const res = await app.inject({ method: 'GET', url: '/api/data-quality/duplicates', headers: auth(token) });
    expect(res.json().data.total).toBe(0);
  });

  it('不同账户的相同金额不算重复', async () => {
    const secondId = await createAccount({ name: '第二账户', type: 'bank', openingBalance: '0' });

    await addExpense({ amount: '66', occurredAt: '2026-09-15' });
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: auth(token),
      payload: {
        type: 'expense',
        accountId: secondId,
        amount: '66',
        occurredAt: '2026-09-15',
        description: '测试支出',
        categoryId: expenseCategoryId,
      },
    });
    expect(res1.statusCode).toBe(201);

    const dup = await app.inject({ method: 'GET', url: '/api/data-quality/duplicates', headers: auth(token) });
    expect(dup.json().data.total).toBe(0);
  });

  it('疑似重复只提示，不修改任何交易', async () => {
    await addExpense({ amount: '55', occurredAt: '2026-09-12' });
    await addExpense({ amount: '55', occurredAt: '2026-09-12' });

    const before = await app.prisma.transaction.findMany({
      where: { userId },
      select: { id: true, status: true, updatedAt: true },
      orderBy: { id: 'asc' },
    });

    await app.inject({ method: 'GET', url: '/api/data-quality/duplicates', headers: auth(token) });

    const after = await app.prisma.transaction.findMany({
      where: { userId },
      select: { id: true, status: true, updatedAt: true },
      orderBy: { id: 'asc' },
    });

    expect(after).toEqual(before);
  });
});

describe('缺失月份与过期估值', () => {
  it('连续有流水的账户不产生缺失月份', async () => {
    const now = new Date();
    for (let offset = 1; offset <= 3; offset += 1) {
      const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 15));
      await addExpense({ amount: '10', occurredAt: anchor.toISOString(), categoryId: null });
    }

    const res = await app.inject({ method: 'GET', url: '/api/data-quality/missing-months', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.months).toEqual([]);
  });

  it('无组合时过期估值为空列表', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/data-quality/stale-valuations',
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.total).toBe(0);
    expect(res.json().data.items).toEqual([]);
  });

  it('基准币种之外没有账户时汇率滞后为空', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/data-quality/rate-lag', headers: auth(token) });
    expect(res.json().data.total).toBe(0);
  });
});

describe('重跑质量检查', () => {
  it('创建任务行但不写业务表', async () => {
    const before = await snapshotCounts();

    const res = await app.inject({
      method: 'POST',
      url: '/api/data-quality/recheck',
      headers: auth(token),
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.taskId).toMatch(/[0-9a-f-]{36}/);
    expect(await snapshotCounts()).toEqual(before);
    expect(await app.prisma.jobTask.count({ where: { kind: 'recheck' } })).toBeGreaterThan(0);
  });
});

describe('审计读模型', () => {
  it('只返回本人审计事件', async () => {
    const other = await createUser(app, DOMAIN, 'other');

    const mine = await app.inject({ method: 'GET', url: '/api/audit-logs', headers: auth(token) });
    const theirs = await app.inject({ method: 'GET', url: '/api/audit-logs', headers: auth(other.token) });

    expect(mine.statusCode).toBe(200);
    const mineIds = new Set(mine.json().data.items.map((item: { id: string }) => item.id));
    const theirsIds = theirs.json().data.items.map((item: { id: string }) => item.id);

    expect(theirsIds.some((id: string) => mineIds.has(id))).toBe(false);
  });

  it('IP 被脱敏到网段', async () => {
    await app.prisma.auditLog.create({
      data: {
        userId: (await app.prisma.user.findFirstOrThrow({ where: { email: { endsWith: DOMAIN } } })).id,
        action: 'test.event',
        ip: '203.0.113.42',
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/audit-logs', headers: auth(token) });
    const item = res.json().data.items.find((row: { action: string }) => row.action === 'test.event');

    expect(item.ip).toBe('203.0.113.x');
  });

  it('metadata 中未列入白名单的键被丢弃', async () => {
    const user = await app.prisma.user.findFirstOrThrow({ where: { email: { endsWith: DOMAIN } } });
    await app.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'test.metadata',
        metadata: { format: 'csv', amount: '9999.99', description: '私密商户' },
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/audit-logs', headers: auth(token) });
    const item = res.json().data.items.find((row: { action: string }) => row.action === 'test.metadata');

    expect(item.metadata).toEqual({ format: 'csv' });
  });

  it('跨用户读取审计详情返回 404', async () => {
    const user = await app.prisma.user.findFirstOrThrow({ where: { email: { endsWith: DOMAIN } } });
    const log = await app.prisma.auditLog.create({
      data: { userId: user.id, action: 'test.private' },
    });

    const other = await createUser(app, DOMAIN, 'other');
    const res = await app.inject({
      method: 'GET',
      url: `/api/audit-logs/${log.id}`,
      headers: auth(other.token),
    });

    expect(res.statusCode).toBe(404);
  });

  it('按动作筛选生效', async () => {
    const user = await app.prisma.user.findFirstOrThrow({ where: { email: { endsWith: DOMAIN } } });
    await app.prisma.auditLog.createMany({
      data: [
        { userId: user.id, action: 'filter.a' },
        { userId: user.id, action: 'filter.b' },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/audit-logs?action=filter.a',
      headers: auth(token),
    });

    const items = res.json().data.items as Array<{ action: string }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.action === 'filter.a')).toBe(true);
  });

  it('分页元信息包含总数', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/audit-logs?page=1&pageSize=1', headers: auth(token) });
    expect(res.json().meta.pagination.total).toBeGreaterThan(0);
  });
});
