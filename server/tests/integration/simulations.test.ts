import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('simulations');

let app: FastifyInstance;
let token: string;

const VALID = {
  principal: '10000',
  contributionAmount: '500',
  contributionFrequency: 'monthly',
  contributionTiming: 'end',
  annualReturnRate: '0.07',
  years: 20,
  inflationRate: '0.025',
  feeRate: '0',
};

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
});

describe('即时计算', () => {
  it('返回黄金用例 C 的终值', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations/compound/calculate',
      headers: auth(token),
      payload: VALID,
    });

    expect(res.statusCode).toBe(200);
    const result = res.json().data.result;
    expect(Number(result.finalNominalValue)).toBeCloseTo(292465.03, 1);
  });

  it('返回年度明细与假设说明', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations/compound/calculate',
      headers: auth(token),
      payload: VALID,
    });

    const result = res.json().data.result;
    expect(result.yearlySchedule).toHaveLength(20);
    expect(result.modelVersion).toBe('compound-v2');
    expect(result.assumptions.disclaimer).toContain('不代表实际投资收益');
  });

  it('相同参数两次计算完全一致', async () => {
    const call = () =>
      app.inject({
        method: 'POST',
        url: '/api/simulations/compound/calculate',
        headers: auth(token),
        payload: VALID,
      });

    const [a, b] = await Promise.all([call(), call()]);
    expect(a.json().data.result.finalNominalValue).toBe(b.json().data.result.finalNominalValue);
  });

  it('参数越界被拒绝', async () => {
    const cases = [
      { ...VALID, years: 0 },
      { ...VALID, years: 101 },
      { ...VALID, annualReturnRate: '-1.5' },
      { ...VALID, annualReturnRate: '1.5' },
      { ...VALID, feeRate: '0.2' },
      { ...VALID, inflationRate: '2' },
      { ...VALID, principal: '0', contributionAmount: '0' },
    ];

    for (const payload of cases) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/simulations/compound/calculate',
        headers: auth(token),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('计算不写入任何交易或账户余额', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/simulations/compound/calculate',
      headers: auth(token),
      payload: VALID,
    });

    const user = await app.prisma.user.findFirstOrThrow({ where: { email: { endsWith: DOMAIN } } });
    const [txCount, accountCount] = await Promise.all([
      app.prisma.transaction.count({ where: { userId: user.id } }),
      app.prisma.account.count({ where: { userId: user.id } }),
    ]);

    expect(txCount).toBe(0);
    expect(accountCount).toBe(0);
  });
});

describe('场景管理', () => {
  it('保存后详情返回实时计算结果', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/simulations/compound',
      headers: auth(token),
      payload: { ...VALID, name: '基准方案' },
    });

    expect(created.statusCode).toBe(201);
    const id = created.json().data.scenario.id as string;

    const detail = await app.inject({
      method: 'GET',
      url: `/api/simulations/compound/${id}`,
      headers: auth(token),
    });

    expect(detail.statusCode).toBe(200);
    expect(Number(detail.json().data.result.finalNominalValue)).toBeCloseTo(292465.03, 1);
  });

  it('同名场景被拒绝', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/simulations/compound',
      headers: auth(token),
      payload: { ...VALID, name: '重复名' },
    });

    const again = await app.inject({
      method: 'POST',
      url: '/api/simulations/compound',
      headers: auth(token),
      payload: { ...VALID, name: '重复名' },
    });

    expect(again.statusCode).toBe(409);
  });

  it('保存时先试算，非法参数不入库', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations/compound',
      headers: auth(token),
      payload: { ...VALID, name: '非法方案', years: 500 },
    });

    expect(res.statusCode).toBe(400);

    const list = await app.inject({
      method: 'GET',
      url: '/api/simulations/compound',
      headers: auth(token),
    });
    expect(list.json().data.scenarios).toHaveLength(0);
  });

  it('更新参数后结果随之变化', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/simulations/compound',
      headers: auth(token),
      payload: { ...VALID, name: '待修改' },
    });
    const scenario = created.json().data.scenario;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/simulations/compound/${scenario.id}`,
      headers: auth(token),
      payload: { years: 10 },
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.scenario.years).toBe(10);
    expect(Number(updated.json().data.result.finalNominalValue)).toBeLessThan(292465.03);
  });

  it('复制场景自动处理重名', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/simulations/compound',
      headers: auth(token),
      payload: { ...VALID, name: '原始' },
    });
    const id = created.json().data.scenario.id as string;

    const first = await app.inject({
      method: 'POST',
      url: `/api/simulations/compound/${id}/duplicate`,
      headers: auth(token),
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().data.scenario.name).toBe('原始 副本');

    const second = await app.inject({
      method: 'POST',
      url: `/api/simulations/compound/${id}/duplicate`,
      headers: auth(token),
    });
    expect(second.json().data.scenario.name).toBe('原始 副本 2');
  });

  it('删除场景', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/simulations/compound',
      headers: auth(token),
      payload: { ...VALID, name: '待删除' },
    });
    const id = created.json().data.scenario.id as string;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/simulations/compound/${id}`,
      headers: auth(token),
    });
    expect(del.statusCode).toBe(200);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/simulations/compound/${id}`,
      headers: auth(token),
    });
    expect(detail.statusCode).toBe(404);
  });
});

describe('场景对比', () => {
  it('按参数对比最多 4 个方案', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations/compound/compare',
      headers: auth(token),
      payload: {
        params: [
          VALID,
          { ...VALID, annualReturnRate: '0.03' },
          { ...VALID, annualReturnRate: '0.1' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const comparisons = res.json().data.comparisons as Array<{ finalNominalValue: string }>;
    expect(comparisons).toHaveLength(3);
    // 收益率越高终值越大
    expect(Number(comparisons[0]!.finalNominalValue)).toBeGreaterThan(
      Number(comparisons[1]!.finalNominalValue),
    );
    expect(Number(comparisons[2]!.finalNominalValue)).toBeGreaterThan(
      Number(comparisons[0]!.finalNominalValue),
    );
  });

  it('超过 4 个方案被拒绝', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations/compound/compare',
      headers: auth(token),
      payload: { params: [VALID, VALID, VALID, VALID, VALID] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('按场景 ID 对比', async () => {
    const ids: string[] = [];
    for (const [name, rate] of [
      ['保守', '0.03'],
      ['基准', '0.07'],
    ] as const) {
      const created = await app.inject({
        method: 'POST',
        url: '/api/simulations/compound',
        headers: auth(token),
        payload: { ...VALID, name, annualReturnRate: rate },
      });
      ids.push(created.json().data.scenario.id as string);
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations/compound/compare',
      headers: auth(token),
      payload: { scenarioIds: ids },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.comparisons[0].label).toBe('保守');
  });

  it('包含他人场景时整体失败', async () => {
    const other = await createUser(app, DOMAIN, 'other');

    const mine = await app.inject({
      method: 'POST',
      url: '/api/simulations/compound',
      headers: auth(token),
      payload: { ...VALID, name: '我的' },
    });
    const mineId = mine.json().data.scenario.id as string;

    const otherScenario = await app.inject({
      method: 'POST',
      url: '/api/simulations/compound',
      headers: auth(other.token),
      payload: { ...VALID, name: '他人' },
    });
    const otherId = otherScenario.json().data.scenario.id as string;

    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations/compound/compare',
      headers: auth(token),
      payload: { scenarioIds: [mineId, otherId] },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('数据隔离', () => {
  it('他人无法读取场景', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/simulations/compound',
      headers: auth(token),
      payload: { ...VALID, name: '私密方案' },
    });
    const id = created.json().data.scenario.id as string;

    const other = await createUser(app, DOMAIN, 'other');
    const res = await app.inject({
      method: 'GET',
      url: `/api/simulations/compound/${id}`,
      headers: auth(other.token),
    });

    expect(res.statusCode).toBe(404);
  });

  it('他人列表看不到我的场景', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/simulations/compound',
      headers: auth(token),
      payload: { ...VALID, name: '我的方案' },
    });

    const other = await createUser(app, DOMAIN, 'other');
    const res = await app.inject({
      method: 'GET',
      url: '/api/simulations/compound',
      headers: auth(other.token),
    });

    expect(res.json().data.scenarios).toHaveLength(0);
  });
});
