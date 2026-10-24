import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('reports');

let app: FastifyInstance;
let token: string;
let bankId: string;
let salaryId: string;
let foodId: string;

interface CategoryNode {
  id: string;
  name: string;
  kind: string;
  children?: CategoryNode[];
}

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

async function firstCategory(kind: 'income' | 'expense'): Promise<string> {
  const res = await app.inject({ method: 'GET', url: '/api/categories', headers: auth(token) });
  const roots = res.json().data.categories as CategoryNode[];
  const match = roots.find((node) => node.kind === kind && node.children && node.children.length > 0);
  return (match?.children?.[0]?.id ?? match?.id)!;
}

async function addTransaction(payload: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/transactions',
    headers: auth(token),
    payload,
  });
  expect(res.statusCode).toBe(201);
}

async function createReport(type: string, from = '2026-01-01', to = '2026-12-31') {
  return app.inject({
    method: 'POST',
    url: '/api/reports',
    headers: auth(token),
    payload: { type, from, to },
  });
}

beforeAll(async () => {
  app = await buildApp();
  // 模拟运行需要执行器消费队列；与 monte-carlo 测试保持一致
  await app.jobs.start();
});

afterAll(async () => {
  await cleanupUsers(app, DOMAIN);
  await app.close();
});

beforeEach(async () => {
  await cleanupUsers(app, DOMAIN);
  const user = await createUser(app, DOMAIN);
  token = user.token;

  bankId = await createAccount({ name: '银行', type: 'bank', openingBalance: '50000' });
  salaryId = await firstCategory('income');
  foodId = await firstCategory('expense');

  for (let month = 1; month <= 6; month += 1) {
    const mm = String(month).padStart(2, '0');
    await addTransaction({
      type: 'income',
      accountId: bankId,
      categoryId: salaryId,
      amount: '10000',
      occurredAt: `2026-${mm}-05T02:00:00.000Z`,
      description: '工资',
    });
    await addTransaction({
      type: 'expense',
      accountId: bankId,
      categoryId: foodId,
      amount: '3000',
      occurredAt: `2026-${mm}-10T02:00:00.000Z`,
      description: '餐饮',
    });
  }
});

describe('报表生成', () => {
  it('六类报表均可生成并返回完整口径', async () => {
    for (const type of ['net_worth', 'cashflow', 'analytics', 'investment', 'goals', 'simulation']) {
      const res = await createReport(type);
      expect(res.statusCode, `type=${type}`).toBe(201);

      const summary = res.json().data.report;
      expect(summary.type).toBe(type);
      expect(summary.rangeFrom).toBe('2026-01-01');
      expect(summary.currency).toBe('CNY');
    }
  });

  it('详情返回 basis 与模型版本', async () => {
    const created = await createReport('cashflow');
    const id = created.json().data.report.id;

    const res = await app.inject({ method: 'GET', url: `/api/reports/${id}`, headers: auth(token) });
    expect(res.statusCode).toBe(200);

    const report = res.json().data.report;
    expect(report.basis.range).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(report.basis.completeness).toBeTruthy();
    expect(report.modelVersions.compound).toBe('compound-v1');
    expect(report.modelVersions.monteCarlo).toBe('montecarlo-v1');
  });

  it('现金流报表合计与交易一致', async () => {
    const created = await createReport('cashflow');
    const id = created.json().data.report.id;

    const res = await app.inject({ method: 'GET', url: `/api/reports/${id}/data`, headers: auth(token) });
    const data = res.json().data.data;

    expect(Number(data.totals.income)).toBeCloseTo(60000, 2);
    expect(Number(data.totals.expense)).toBeCloseTo(18000, 2);
    expect(Number(data.totals.net)).toBeCloseTo(42000, 2);
  });

  it('净资产报表包含账户与汇总', async () => {
    const created = await createReport('net_worth');
    const id = created.json().data.report.id;

    const res = await app.inject({ method: 'GET', url: `/api/reports/${id}/data`, headers: auth(token) });
    const data = res.json().data.data;

    expect(data.accounts).toHaveLength(1);
    expect(data.totals).toBeTruthy();
    // 50000 期初 + 6×(10000-3000) = 92000
    expect(Number(data.totals.netWorth)).toBeCloseTo(92000, 2);
  });

  it('区间颠倒返回 422', async () => {
    const res = await createReport('cashflow', '2026-12-31', '2026-01-01');
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('REPORT_PARAMETERS_INVALID');
  });

  it('区间超限返回 400', async () => {
    const res = await createReport('cashflow', '2010-01-01', '2026-12-31');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('REPORT_RANGE_INVALID');
  });

  it('未知类型返回 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: auth(token),
      payload: { type: 'unknown', from: '2026-01-01', to: '2026-12-31' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('分类生成接口与通用接口产出同结构', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/reports/goals',
      headers: auth(token),
      payload: { from: '2026-01-01', to: '2026-12-31' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.report.type).toBe('goals');
  });
});

describe('快照冻结', () => {
  it('生成后修改账本，报表数据不变', async () => {
    const created = await createReport('cashflow');
    const id = created.json().data.report.id;

    const before = await app.inject({ method: 'GET', url: `/api/reports/${id}/data`, headers: auth(token) });
    const beforeExpense = before.json().data.data.totals.expense;

    await addTransaction({
      type: 'expense',
      accountId: bankId,
      categoryId: foodId,
      amount: '9999',
      occurredAt: '2026-07-10T02:00:00.000Z',
      description: '大额支出',
    });

    const after = await app.inject({ method: 'GET', url: `/api/reports/${id}/data`, headers: auth(token) });
    expect(after.json().data.data.totals.expense).toBe(beforeExpense);
  });

  it('重新生成后数据反映最新账本', async () => {
    const created = await createReport('cashflow');
    const id = created.json().data.report.id;

    const before = await app.inject({ method: 'GET', url: `/api/reports/${id}/data`, headers: auth(token) });
    const beforeGeneratedAt = before.json().data.generatedAt;

    await addTransaction({
      type: 'expense',
      accountId: bankId,
      categoryId: foodId,
      amount: '1000',
      occurredAt: '2026-07-10T02:00:00.000Z',
      description: '新增支出',
    });

    const regenerated = await app.inject({
      method: 'POST',
      url: `/api/reports/${id}/regenerate`,
      headers: auth(token),
    });
    expect(regenerated.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: `/api/reports/${id}/data`, headers: auth(token) });
    expect(Number(after.json().data.data.totals.expense)).toBeCloseTo(19000, 2);
    expect(after.json().data.generatedAt).not.toBe(beforeGeneratedAt);
  });

  it('报表生成不改变账本与账户余额', async () => {
    const before = await app.prisma.transaction.count({ where: { user: { email: { endsWith: DOMAIN } } } });
    const beforeEntries = await app.prisma.transactionEntry.count({
      where: { user: { email: { endsWith: DOMAIN } } },
    });

    await createReport('net_worth');
    await createReport('investment');
    await createReport('goals');

    const after = await app.prisma.transaction.count({ where: { user: { email: { endsWith: DOMAIN } } } });
    const afterEntries = await app.prisma.transactionEntry.count({
      where: { user: { email: { endsWith: DOMAIN } } },
    });

    expect(after).toBe(before);
    expect(afterEntries).toBe(beforeEntries);
  });
});

describe('报表导出', () => {
  it('CSV 带 BOM、CRLF 与口径区块', async () => {
    const created = await createReport('cashflow');
    const id = created.json().data.report.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/reports/${id}/download?format=csv`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body.startsWith('﻿')).toBe(true);
    expect(res.body).toContain('\r\n');
    expect(res.body).toContain('口径说明');
    expect(res.body).toContain('2026-01-01');
  });

  it('CSV 响应头含 filename* 用于中文文件名', async () => {
    const created = await createReport('cashflow');
    const id = created.json().data.report.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/reports/${id}/download?format=csv`,
      headers: auth(token),
    });

    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''");
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('XLSX 下载返回 ZIP 魔数', async () => {
    const created = await createReport('net_worth');
    const id = created.json().data.report.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/reports/${id}/download?format=xlsx`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.rawPayload.subarray(0, 2).toString('binary')).toBe('PK');
  });

  it('未知格式返回 400', async () => {
    const created = await createReport('cashflow');
    const id = created.json().data.report.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/reports/${id}/download?format=pdf`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(400);
  });

  it('跨用户下载返回 404', async () => {
    const created = await createReport('cashflow');
    const id = created.json().data.report.id;

    const other = await createUser(app, DOMAIN, 'other');
    const res = await app.inject({
      method: 'GET',
      url: `/api/reports/${id}/download?format=csv`,
      headers: auth(other.token),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('REPORT_NOT_FOUND');
  });

  it('导出写入审计事件但不改报表内容', async () => {
    const created = await createReport('cashflow');
    const id = created.json().data.report.id;

    const before = await app.prisma.report.findUniqueOrThrow({ where: { id } });
    const auditsBefore = await app.prisma.auditLog.count({ where: { action: 'report.exported' } });

    await app.inject({ method: 'GET', url: `/api/reports/${id}/download?format=csv`, headers: auth(token) });

    const after = await app.prisma.report.findUniqueOrThrow({ where: { id } });
    const auditsAfter = await app.prisma.auditLog.count({ where: { action: 'report.exported' } });

    expect(after.data).toEqual(before.data);
    expect(auditsAfter).toBe(auditsBefore + 1);
  });
});

describe('报表列表与删除', () => {
  it('列表按生成时间倒序，支持类型筛选', async () => {
    await createReport('cashflow');
    await createReport('net_worth');
    await createReport('cashflow');

    const all = await app.inject({ method: 'GET', url: '/api/reports', headers: auth(token) });
    expect(all.json().data.reports).toHaveLength(3);

    const filtered = await app.inject({ method: 'GET', url: '/api/reports?type=cashflow', headers: auth(token) });
    expect(filtered.json().data.reports).toHaveLength(2);
    expect(filtered.json().data.reports.every((item: { type: string }) => item.type === 'cashflow')).toBe(true);
  });

  it('删除后详情返回 404', async () => {
    const created = await createReport('cashflow');
    const id = created.json().data.report.id;

    const deleted = await app.inject({ method: 'DELETE', url: `/api/reports/${id}`, headers: auth(token) });
    expect(deleted.statusCode).toBe(204);

    const res = await app.inject({ method: 'GET', url: `/api/reports/${id}`, headers: auth(token) });
    expect(res.statusCode).toBe(404);
  });

  it('跨用户访问报表列表只返回自己的', async () => {
    await createReport('cashflow');

    const other = await createUser(app, DOMAIN, 'other');
    const res = await app.inject({ method: 'GET', url: '/api/reports', headers: auth(other.token) });

    expect(res.json().data.reports).toHaveLength(0);
  });
});

describe('模拟与复利导出', () => {
  it('复利方案导出 CSV 含模型版本与年度明细', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/simulations/compound',
      headers: auth(token),
      payload: {
        name: '导出测试',
        principal: '10000',
        contributionAmount: '500',
        contributionFrequency: 'monthly',
        contributionTiming: 'end',
        annualReturnRate: '0.07',
        years: 5,
        inflationRate: '0.025',
        feeRate: '0',
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.scenario.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/simulations/compound/${id}/export`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('compound-v1');
    expect(res.body).toContain('年度明细');
  });

  it('蒙特卡罗运行导出首区块含 modelVersion 与 seed', async () => {
    const scenario = await app.inject({
      method: 'POST',
      url: '/api/simulations/monte-carlo',
      headers: auth(token),
      payload: {
        name: '导出模拟',
        currency: 'CNY',
        years: 5,
        pathCount: 200,
        rebalance: 'annual',
        assets: [
          { key: 'stock', label: '股票', weight: '1', expectedAnnualReturn: '0.07', annualVolatility: '0.15' },
        ],
        correlation: [[1]],
        settings: {
          initialValue: '100000',
          contribution: { amount: '1000', frequency: 'monthly', timing: 'end' },
          withdrawal: { amount: '0', frequency: 'none', startYear: 1 },
          inflationRate: '0.025',
          feeRate: '0.003',
          targetAmount: null,
        },
      },
    });
    expect(scenario.statusCode).toBe(201);
    const scenarioId = scenario.json().data.id;

    const run = await app.inject({
      method: 'POST',
      url: `/api/simulations/monte-carlo/${scenarioId}/runs`,
      headers: auth(token),
      payload: { seed: 12345, pathCount: 200 },
    });
    expect(run.statusCode).toBe(202);
    const runId = run.json().data.id;

    await app.jobs.drain(30_000);

    const res = await app.inject({
      method: 'GET',
      url: `/api/simulations/monte-carlo/${scenarioId}/runs/${runId}/export`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('modelVersion,montecarlo-v1');
    expect(res.body).toContain('seed,12345');
    expect(res.body).toContain('simulation_not_forecast');
  });

  it('方案导出 JSON 含完整参数', async () => {
    const scenario = await app.inject({
      method: 'POST',
      url: '/api/simulations/monte-carlo',
      headers: auth(token),
      payload: {
        name: 'JSON 导出',
        currency: 'CNY',
        years: 3,
        pathCount: 100,
        rebalance: 'none',
        assets: [
          { key: 'a', label: 'A', weight: '1', expectedAnnualReturn: '0.05', annualVolatility: '0.1' },
        ],
        correlation: [[1]],
        settings: {
          initialValue: '1',
          contribution: { amount: '0', frequency: 'none', timing: 'end' },
          withdrawal: { amount: '0', frequency: 'none', startYear: 1 },
          inflationRate: '0',
          feeRate: '0',
          targetAmount: null,
        },
      },
    });
    const id = scenario.json().data.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/simulations/monte-carlo/${id}/export`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.version).toBe(1);
    expect(body.scenario.name).toBe('JSON 导出');
    expect(body.note).toBe('result_requires_model_version_and_seed');
  });

  it('跨用户导出模拟运行返回 404', async () => {
    const other = await createUser(app, DOMAIN, 'other');
    const res = await app.inject({
      method: 'GET',
      url: `/api/simulations/monte-carlo/00000000-0000-0000-0000-000000000000/export`,
      headers: auth(other.token),
    });

    expect(res.statusCode).toBe(404);
  });
});
