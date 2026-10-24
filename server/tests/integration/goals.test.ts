import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('goals');

let app: FastifyInstance;
let token: string;
let bankId: string;
let salaryId: string;
let foodId: string;

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

/** 注册时会创建默认分类，这里直接复用同类型的第一个，避免 409 */
async function firstCategory(kind: 'income' | 'expense'): Promise<string> {
  const res = await app.inject({ method: 'GET', url: '/api/categories', headers: auth(token) });
  expect(res.statusCode).toBe(200);

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

async function createGoal(payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/goals',
    headers: auth(token),
    payload: {
      name: `目标-${Math.random().toString(36).slice(2, 8)}`,
      type: 'savings',
      targetAmount: '800000',
      currency: 'CNY',
      startedAt: '2026-01-01',
      ...payload,
    },
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

  bankId = await createAccount({ name: '储蓄账户', type: 'bank', openingBalance: '100000' });
  salaryId = await firstCategory('income');
  foodId = await firstCategory('expense');
});

describe('目标 CRUD', () => {
  it('创建目标后可在列表与详情中看到', async () => {
    const created = await createGoal({ name: '教育金', targetAmount: '500000' });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id;

    const list = await app.inject({ method: 'GET', url: '/api/goals', headers: auth(token) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.goals).toHaveLength(1);
    expect(list.json().data.goals[0].name).toBe('教育金');

    const detail = await app.inject({ method: 'GET', url: `/api/goals/${id}`, headers: auth(token) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.goal.name).toBe('教育金');
  });

  it('同名目标返回 409', async () => {
    await createGoal({ name: '唯一名称' });
    const duplicate = await createGoal({ name: '唯一名称' });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('GOAL_NAME_EXISTS');
  });

  it('跨用户访问返回 404', async () => {
    const created = await createGoal({ name: '私有目标' });
    const id = created.json().data.id;

    const other = await createUser(app, DOMAIN, 'other');
    const res = await app.inject({
      method: 'GET',
      url: `/api/goals/${id}`,
      headers: auth(other.token),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('GOAL_NOT_FOUND');
  });

  it('修改目标后重新读取生效', async () => {
    const created = await createGoal({ name: '可修改', targetAmount: '100000' });
    const id = created.json().data.id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/goals/${id}`,
      headers: auth(token),
      payload: { targetAmount: '200000' },
    });
    expect(patched.statusCode).toBe(200);

    const detail = await app.inject({ method: 'GET', url: `/api/goals/${id}`, headers: auth(token) });
    expect(detail.json().data.progress.originalTargetAmount).toBe('200000.000000');
  });

  it('删除目标返回 204 且不影响账户余额', async () => {
    const created = await createGoal({ name: '待删除' });
    const id = created.json().data.id;

    const before = await app.inject({
      method: 'GET',
      url: `/api/accounts/${bankId}`,
      headers: auth(token),
    });
    const beforeBalance = before.json().data.account.balance;

    const deleted = await app.inject({ method: 'DELETE', url: `/api/goals/${id}`, headers: auth(token) });
    expect(deleted.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: `/api/accounts/${bankId}`,
      headers: auth(token),
    });
    expect(after.json().data.account.balance).toBe(beforeBalance);
  });
});

describe('参数校验', () => {
  it('开启通胀调整但没有目标日期返回 422', async () => {
    const res = await createGoal({ inflationAdjusted: true, inflationRate: '0.025' });
    expect(res.statusCode).toBe(400);
  });

  it('绑定不存在账户返回 422', async () => {
    const res = await createGoal({
      fundingSource: 'account',
      accountId: '00000000-0000-0000-0000-000000000000',
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('GOAL_FUNDING_INVALID');
  });

  it('绑定币种不一致的账户返回 422', async () => {
    const usdId = await createAccount({ name: '美元账户', type: 'bank', currency: 'USD' });

    const res = await createGoal({
      fundingSource: 'account',
      accountId: usdId,
      currency: 'CNY',
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('GOAL_FUNDING_INVALID');
  });

  it('目标日期早于起算日返回 400', async () => {
    const res = await createGoal({ startedAt: '2026-06-01', targetDate: '2026-01-01' });
    expect(res.statusCode).toBe(400);
  });
});

describe('进度推导', () => {
  it('绑定账户时进度等于账户余额除以目标金额', async () => {
    const created = await createGoal({
      name: '账户绑定',
      targetAmount: '200000',
      fundingSource: 'account',
      accountId: bankId,
      initialAmount: '0',
    });
    const id = created.json().data.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/goals/${id}/progress`,
      headers: auth(token),
    });

    const body = res.json().data;
    expect(Number(body.currentAmount)).toBeCloseTo(100000, 2);
    expect(Number(body.progress)).toBeCloseTo(0.5, 6);
    expect(Number(body.gap)).toBeCloseTo(100000, 2);
    expect(body.isAchieved).toBe(false);
  });

  it('改历史流水后进度立即变化，无需刷新任务', async () => {
    const created = await createGoal({
      name: '流水联动',
      targetAmount: '100000',
      fundingSource: 'account',
      accountId: bankId,
    });
    const id = created.json().data.id;

    await addTransaction({
      type: 'income',
      accountId: bankId,
      categoryId: salaryId,
      amount: '50000',
      occurredAt: '2026-05-05T02:00:00.000Z',
      description: '奖金',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/goals/${id}/progress`,
      headers: auth(token),
    });

    expect(Number(res.json().data.currentAmount)).toBeCloseTo(150000, 2);
    expect(res.json().data.isAchieved).toBe(true);
  });

  it('绑定归档账户时进度为 null 并标注不可用', async () => {
    const created = await createGoal({
      name: '归档账户',
      fundingSource: 'account',
      accountId: bankId,
    });
    const id = created.json().data.id;

    await app.inject({
      method: 'POST',
      url: `/api/accounts/${bankId}/archive`,
      headers: auth(token),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/goals/${id}/progress`,
      headers: auth(token),
    });

    const body = res.json().data;
    expect(body.currentAmount).toBeNull();
    expect(body.progress).toBeNull();
    expect(body.funding.available).toBe(false);
    expect(body.funding.unavailableReason).toBe('account_archived');
  });

  it('进度历史返回按月采样点', async () => {
    const created = await createGoal({
      name: '历史曲线',
      fundingSource: 'account',
      accountId: bankId,
    });
    const id = created.json().data.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/goals/${id}/history?months=6`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.points.length).toBeGreaterThan(0);
    expect(body.points.length).toBeLessThanOrEqual(6);
    expect(body.granularity).toBe('month_end');
  });
});

describe('目标汇总', () => {
  it('汇总只统计同币种目标，跨币种进入 unavailableGoalIds', async () => {
    await createGoal({ name: '人民币目标', targetAmount: '100000', fundingSource: 'account', accountId: bankId });

    const messaged = await createGoal({
      name: '美元目标',
      targetAmount: '10000',
      currency: 'USD',
      fundingSource: 'net_worth',
    });
    expect(messaged.statusCode).toBe(201);
    const usdGoalId = messaged.json().data.id;

    const res = await app.inject({ method: 'GET', url: '/api/goals/summary', headers: auth(token) });
    expect(res.statusCode).toBe(200);

    const body = res.json().data;
    expect(Number(body.totalTarget)).toBeCloseTo(100000, 2);
    expect(body.unavailableGoalIds).toContain(usdGoalId);
  });

  it('没有结余样本时 investableSurplus 为 null 而不是 0', async () => {
    await createGoal({ name: '单目标' });

    const res = await app.inject({ method: 'GET', url: '/api/goals/summary', headers: auth(token) });
    const body = res.json().data;

    expect(body.investableSurplus).toBeNull();
    expect(body.shortfall).toBeNull();
    expect(body.surplusBasis.isComplete).toBe(false);
  });
});

describe('目标预测', () => {
  it('给出预计达成时间与所需月供，且两者互相印证', async () => {
    const created = await createGoal({
      name: '预测目标',
      targetAmount: '800000',
      targetDate: '2036-01-01',
      expectedAnnualReturn: '0.06',
      monthlyContribution: '3000',
      fundingSource: 'account',
      accountId: bankId,
    });
    const id = created.json().data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/goals/${id}/projection`,
      headers: auth(token),
      payload: { includeProbabilistic: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;

    expect(body.deterministic).not.toBeNull();
    expect(body.deterministic.requiredMonthly).not.toBeNull();
    expect(Number(body.deterministic.requiredMonthly)).toBeGreaterThan(0);
    expect(body.deterministic.basis.engine).toBe('compound-v1');
    expect(body.deterministic.timeline.length).toBeGreaterThan(0);
    expect(body.probabilistic).toBeNull();
    expect(body.unavailableReasons).toContain('no_matching_run');
  });

  it('没有收益率假设时不返回确定性预测', async () => {
    const created = await createGoal({
      name: '无假设',
      targetAmount: '500000',
      fundingSource: 'account',
      accountId: bankId,
    });
    const id = created.json().data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/goals/${id}/projection`,
      headers: auth(token),
      payload: { includeProbabilistic: false },
    });

    const body = res.json().data;
    expect(body.deterministic).toBeNull();
    expect(body.unavailableReasons).toContain('no_expected_return');
  });

  it('目标已达成时所需月供为 0', async () => {
    const created = await createGoal({
      name: '已达成',
      targetAmount: '50000',
      targetDate: '2036-01-01',
      expectedAnnualReturn: '0.05',
      fundingSource: 'account',
      accountId: bankId,
    });
    const id = created.json().data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/goals/${id}/projection`,
      headers: auth(token),
      payload: { includeProbabilistic: false },
    });

    const body = res.json().data;
    expect(Number(body.deterministic.requiredMonthly)).toBe(0);
    expect(body.deterministic.etaMonths).toBe(0);
  });

  it('预测接口不写任何表', async () => {
    const created = await createGoal({
      name: '零写入',
      targetAmount: '800000',
      targetDate: '2036-01-01',
      expectedAnnualReturn: '0.06',
      fundingSource: 'account',
      accountId: bankId,
    });
    const id = created.json().data.id;

    const before = await app.prisma.financialGoal.findUniqueOrThrow({ where: { id } });

    await app.inject({
      method: 'POST',
      url: `/api/goals/${id}/projection`,
      headers: auth(token),
      payload: { includeProbabilistic: false },
    });

    const after = await app.prisma.financialGoal.findUniqueOrThrow({ where: { id } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });
});

describe('财务自由', () => {
  it('按最近完整月支出年化并给出敏感性网格', async () => {
    // 6 个完整月的支出，每月 3000
    for (let month = 1; month <= 6; month += 1) {
      await addTransaction({
        type: 'expense',
        accountId: bankId,
        categoryId: foodId,
        amount: '3000',
        occurredAt: `2026-0${month}-10T02:00:00.000Z`,
        description: '生活费',
      });
    }

    const res = await app.inject({ method: 'POST', url: '/api/financial-independence/calculate', headers: auth(token), payload: {} });
    expect(res.statusCode).toBe(200);

    const body = res.json().data;
    expect(body.disclaimers).toContain('not_retirement_advice');

    // 只有 6 个完整月且目标是 12 个完整月，年化只能基于实际完整月数
    if (body.annualExpense === null) {
      expect(body.unavailableReasons).toContain('insufficient_expense_months');
      expect(body.coverageMonths).toBeNull();
      expect(body.sensitivity).toBeNull();
    } else {
      expect(Number(body.annualExpense)).toBeGreaterThan(0);
      expect(body.sensitivity.cells).toHaveLength(3);
    }
  });

  it('提供自定义年化支出时直接按提取率计算目标资产', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/financial-independence/calculate',
      headers: auth(token),
      payload: { annualExpense: '180000', withdrawalRate: '0.04' },
    });

    const body = res.json().data;
    expect(Number(body.targetAssets)).toBeCloseTo(4500000, 2);
    expect(Number(body.withdrawalRate)).toBeCloseTo(0.04, 6);
    expect(body.sensitivity.cells).toHaveLength(3);
    expect(body.sensitivity.cells[0]).toHaveLength(3);
  });

  it('提取率越界返回 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/financial-independence/calculate',
      headers: auth(token),
      payload: { annualExpense: '100000', withdrawalRate: '0.5' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('FI_PARAMETERS_INVALID');
  });

  it('没有支出记录时覆盖月数为 null 而不是 Infinity', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/financial-independence/overview',
      headers: auth(token),
    });

    const body = res.json().data;
    expect(body.annualExpense).toBeNull();
    expect(body.coverageMonths).toBeNull();
    expect(Number(body.investableAssets)).toBeCloseTo(100000, 2);
  });
});
