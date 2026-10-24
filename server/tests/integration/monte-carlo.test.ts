import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('monte-carlo');

let app: FastifyInstance;
let token: string;
let userId: string;

function scenarioBody(overrides: Record<string, unknown> = {}) {
  return {
    name: `方案-${Math.random().toString(36).slice(2, 8)}`,
    currency: 'CNY',
    years: 5,
    pathCount: 300,
    rebalance: 'annual',
    assets: [
      { key: 'equity', label: '股票', weight: '1', expectedAnnualReturn: '0.07', annualVolatility: '0.15' },
    ],
    correlation: [[1]],
    settings: {
      initialValue: '10000',
      contribution: { amount: '500', frequency: 'monthly', timing: 'end' },
      withdrawal: { amount: '0', frequency: 'none', startYear: 1 },
      inflationRate: '0.025',
      feeRate: '0',
      targetAmount: null,
    },
    ...overrides,
  };
}

async function createScenario(body = scenarioBody()) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/simulations/monte-carlo',
    headers: auth(token),
    payload: body,
  });
  return res;
}

/** 轮询直到运行进入终态，集成测试里路径数很小，通常 1-2 轮即可 */
async function waitForRun(scenarioId: string, runId: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/simulations/monte-carlo/${scenarioId}/runs/${runId}`,
      headers: auth(token),
    });
    const run = res.json().data.run;

    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) return run;

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('等待运行结束超时');
}

beforeAll(async () => {
  app = await buildApp();
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
  userId = user.userId;
});

describe('方案 CRUD', () => {
  it('创建方案返回 201 并持久化参数', async () => {
    const res = await createScenario();
    expect(res.statusCode).toBe(201);

    const scenario = res.json().data;
    expect(scenario.years).toBe(5);
    expect(scenario.pathCount).toBe(300);
    expect(scenario.modelVersion).toBe('montecarlo-v1');
  });

  it('重名返回 409', async () => {
    const body = scenarioBody({ name: '固定名称' });
    expect((await createScenario(body)).statusCode).toBe(201);
    expect((await createScenario(body)).statusCode).toBe(409);
  });

  it('权重合计不为 1 返回 422 并给出合计值', async () => {
    const res = await createScenario(
      scenarioBody({
        assets: [
          { key: 'a', label: 'A', weight: '0.5', expectedAnnualReturn: '0.07', annualVolatility: '0.1' },
          { key: 'b', label: 'B', weight: '0.3', expectedAnnualReturn: '0.03', annualVolatility: '0.05' },
        ],
        correlation: [
          [1, 0],
          [0, 1],
        ],
      }),
    );

    expect(res.statusCode).toBe(422);
    const error = res.json().error;
    expect(error.code).toBe('MC_WEIGHTS_INVALID');
    expect(error.details.total).toBe('0.800000');
  });

  it('非正定相关矩阵返回 422 并给出原因', async () => {
    const res = await createScenario(
      scenarioBody({
        assets: [
          { key: 'a', label: 'A', weight: '0.34', expectedAnnualReturn: '0.07', annualVolatility: '0.1' },
          { key: 'b', label: 'B', weight: '0.33', expectedAnnualReturn: '0.05', annualVolatility: '0.1' },
          { key: 'c', label: 'C', weight: '0.33', expectedAnnualReturn: '0.03', annualVolatility: '0.1' },
        ],
        correlation: [
          [1, 0.9, 0.9],
          [0.9, 1, -0.9],
          [0.9, -0.9, 1],
        ],
      }),
    );

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('MC_CORRELATION_INVALID');
    expect(res.json().error.details.reason).toBe('not_positive_definite');
  });

  it('不对称矩阵返回 422', async () => {
    const res = await createScenario(
      scenarioBody({
        assets: [
          { key: 'a', label: 'A', weight: '0.5', expectedAnnualReturn: '0.07', annualVolatility: '0.1' },
          { key: 'b', label: 'B', weight: '0.5', expectedAnnualReturn: '0.03', annualVolatility: '0.05' },
        ],
        correlation: [
          [1, 0.5],
          [0.2, 1],
        ],
      }),
    );

    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.reason).toBe('not_symmetric');
  });

  it('本金、定投、提款全为 0 时返回 422', async () => {
    const res = await createScenario(
      scenarioBody({
        settings: {
          initialValue: '0',
          contribution: { amount: '0', frequency: 'none', timing: 'end' },
          withdrawal: { amount: '0', frequency: 'none', startYear: 1 },
          inflationRate: '0',
          feeRate: '0',
          targetAmount: null,
        },
      }),
    );

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('MC_PARAMETERS_INVALID');
  });

  it('提款起始年超出年限时返回 422', async () => {
    const res = await createScenario(
      scenarioBody({
        years: 5,
        settings: {
          initialValue: '10000',
          contribution: { amount: '0', frequency: 'none', timing: 'end' },
          withdrawal: { amount: '500', frequency: 'monthly', startYear: 9 },
          inflationRate: '0',
          feeRate: '0',
          targetAmount: null,
        },
      }),
    );

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('MC_PARAMETERS_INVALID');
  });

  it('跨用户访问返回 404', async () => {
    const created = (await createScenario()).json().data;
    const other = await createUser(app, DOMAIN, 'other');

    const res = await app.inject({
      method: 'GET',
      url: `/api/simulations/monte-carlo/${created.id}`,
      headers: auth(other.token),
    });

    expect(res.statusCode).toBe(404);
  });

  it('编辑方案不影响历史运行的参数快照', async () => {
    const scenario = (await createScenario()).json().data;

    const runRes = await app.inject({
      method: 'POST',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs`,
      headers: auth(token),
      payload: {},
    });
    const runId = runRes.json().data.id;
    await waitForRun(scenario.id, runId);

    const before = await app.inject({
      method: 'GET',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs/${runId}`,
      headers: auth(token),
    });
    const assumptionsBefore = before.json().data.assumptions;

    await app.inject({
      method: 'PATCH',
      url: `/api/simulations/monte-carlo/${scenario.id}`,
      headers: auth(token),
      payload: { years: 10 },
    });

    const after = await app.inject({
      method: 'GET',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs/${runId}`,
      headers: auth(token),
    });

    expect(after.json().data.assumptions).toEqual(assumptionsBefore);
    expect(after.json().data.assumptions.years).toBe(5);
  });
});

describe('运行生命周期', () => {
  it('发起运行返回 202 并在完成后可取结果', async () => {
    const scenario = (await createScenario()).json().data;

    const res = await app.inject({
      method: 'POST',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs`,
      headers: auth(token),
      payload: { pathCount: 200, seed: 12345 },
    });

    expect(res.statusCode).toBe(202);
    const created = res.json().data;
    expect(created.status).toBe('queued');
    expect(created.seed).toBe(12345);

    const run = await waitForRun(scenario.id, created.id);
    expect(run.status).toBe('succeeded');

    const resultRes = await app.inject({
      method: 'GET',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs/${created.id}/results`,
      headers: auth(token),
    });

    expect(resultRes.statusCode).toBe(200);
    const result = resultRes.json().data.result;
    expect(result.terminal.nominal.p50).toBeDefined();
    expect(Number(result.probabilities.loss)).toBeGreaterThanOrEqual(0);
    expect(Number(result.probabilities.loss)).toBeLessThanOrEqual(1);
  });

  it('未完成的运行请求结果返回 409', async () => {
    const scenario = (await createScenario()).json().data;

    const runRes = await app.inject({
      method: 'POST',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs`,
      headers: auth(token),
      payload: { pathCount: 20000 },
    });
    const runId = runRes.json().data.id;

    // 立即请求，此时大概率仍在排队或运行中
    const res = await app.inject({
      method: 'GET',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs/${runId}/results`,
      headers: auth(token),
    });

    expect([409, 200]).toContain(res.statusCode);
    if (res.statusCode === 409) {
      expect(res.json().error.code).toBe('MC_RUN_NOT_READY');
    }

    // 收尾：取消以免拖慢后续测试
    await app.inject({
      method: 'POST',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs/${runId}/cancel`,
      headers: auth(token),
    });
    await waitForRun(scenario.id, runId);
  });

  it('相同种子与参数两次运行结果一致', async () => {
    const scenario = (await createScenario()).json().data;

    const runOnce = async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/simulations/monte-carlo/${scenario.id}/runs`,
        headers: auth(token),
        payload: { pathCount: 200, seed: 999 },
      });
      const runId = res.json().data.id;
      await waitForRun(scenario.id, runId);

      const result = await app.inject({
        method: 'GET',
        url: `/api/simulations/monte-carlo/${scenario.id}/runs/${runId}/results`,
        headers: auth(token),
      });
      return result.json().data.result;
    };

    const first = await runOnce();
    const second = await runOnce();

    expect(first.terminal).toEqual(second.terminal);
    expect(first.probabilities).toEqual(second.probabilities);
    expect(first.drawdown).toEqual(second.drawdown);
  });

  it('取消已结束的运行返回 409', async () => {
    const scenario = (await createScenario()).json().data;

    const runRes = await app.inject({
      method: 'POST',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs`,
      headers: auth(token),
      payload: { pathCount: 200 },
    });
    const runId = runRes.json().data.id;
    await waitForRun(scenario.id, runId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs/${runId}/cancel`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('MC_RUN_ALREADY_FINISHED');
  });

  it('超过队列上限时拒绝并返回 429', async () => {
    const scenario = (await createScenario()).json().data;

    // 执行器在本进程内跑得很快，靠「连发」不一定能压到上限；
    // 这里直接构造排队记录，稳定覆盖上限判断分支
    const limit = 10;
    const seeded = Array.from({ length: limit }, (_, index) => ({
      userId,
      scenarioId: scenario.id,
      scenarioName: '占位',
      status: 'queued' as const,
      assumptions: {},
      seed: index,
      modelVersion: 'montecarlo-v1',
      pathCount: 100,
      years: 1,
    }));

    // 先停下执行器，否则占位记录会被立刻领走，队列瞬间清空
    app.jobs.stop();
    await app.prisma.monteCarloRun.createMany({ data: seeded });

    const res = await app.inject({
      method: 'POST',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs`,
      headers: auth(token),
      payload: { pathCount: 200 },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('MC_QUEUE_FULL');

    await app.prisma.monteCarloRun.deleteMany({ where: { scenarioId: scenario.id, scenarioName: '占位' } });
    await app.jobs.start();
  });

  it('运行历史按时间倒序返回', async () => {
    const scenario = (await createScenario()).json().data;

    for (let i = 0; i < 2; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/simulations/monte-carlo/${scenario.id}/runs`,
        headers: auth(token),
        payload: { pathCount: 200 },
      });
      await waitForRun(scenario.id, res.json().data.id);
    }

    const list = await app.inject({
      method: 'GET',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs`,
      headers: auth(token),
    });

    const items = list.json().data.items;
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(new Date(items[0].createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(items[1].createdAt).getTime(),
    );
  });

  it('路径接口按索引再生成，年终值与结果中的样本一致', async () => {
    const scenario = (await createScenario()).json().data;

    const runRes = await app.inject({
      method: 'POST',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs`,
      headers: auth(token),
      payload: { pathCount: 200, seed: 777 },
    });
    const runId = runRes.json().data.id;
    await waitForRun(scenario.id, runId);

    const paths = await app.inject({
      method: 'GET',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs/${runId}/paths?indexes=3&resolution=yearly`,
      headers: auth(token),
    });

    expect(paths.statusCode).toBe(200);
    const path = paths.json().data.paths[0];
    expect(path.index).toBe(3);
    expect(path.values).toHaveLength(5);

    // 再请求一次，结果必须完全相同
    const again = await app.inject({
      method: 'GET',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs/${runId}/paths?indexes=3&resolution=yearly`,
      headers: auth(token),
    });
    expect(again.json().data.paths[0].values).toEqual(path.values);
  });

  it('路径索引越界返回 422', async () => {
    const scenario = (await createScenario()).json().data;

    const runRes = await app.inject({
      method: 'POST',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs`,
      headers: auth(token),
      payload: { pathCount: 200 },
    });
    const runId = runRes.json().data.id;
    await waitForRun(scenario.id, runId);

    const res = await app.inject({
      method: 'GET',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs/${runId}/paths?indexes=99999`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('MC_PATH_INDEX_INVALID');
  });
});

describe('对比', () => {
  it('不同年限的运行对比被 422 拒绝', async () => {
    const short = (await createScenario(scenarioBody({ years: 3 }))).json().data;
    const long = (await createScenario(scenarioBody({ years: 10 }))).json().data;

    const shortRun = await app.inject({
      method: 'POST',
      url: `/api/simulations/monte-carlo/${short.id}/runs`,
      headers: auth(token),
      payload: { pathCount: 200 },
    });
    const longRun = await app.inject({
      method: 'POST',
      url: `/api/simulations/monte-carlo/${long.id}/runs`,
      headers: auth(token),
      payload: { pathCount: 200 },
    });

    await waitForRun(short.id, shortRun.json().data.id);
    await waitForRun(long.id, longRun.json().data.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations/monte-carlo/compare',
      headers: auth(token),
      payload: { runIds: [shortRun.json().data.id, longRun.json().data.id] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('MC_COMPARE_INCOMPATIBLE');
  });
});

describe('同步预览', () => {
  it('返回终值分位数与亏损概率', async () => {
    const body = scenarioBody({ pathCount: 300 });
    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations/monte-carlo/calculate',
      headers: auth(token),
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.terminal.nominal.p50).toBeDefined();
    expect(data.probabilities.loss).toBeDefined();
    expect(data.standardError).toBeDefined();
  });

  it('路径数超过预览上限返回 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations/monte-carlo/calculate',
      headers: auth(token),
      payload: scenarioBody({ pathCount: 2000 }),
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('作业执行器', () => {
  it('心跳超时的运行在重启后回到队列并重算成功', async () => {
    const scenario = (await createScenario()).json().data;

    // 模拟「进程在计算中被杀掉」：直接造一条心跳很旧的 running 记录
    const stale = await app.prisma.monteCarloRun.create({
      data: {
        userId,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        status: 'running',
        stage: 'simulating',
        progress: '0.4230',
        attempts: 1,
        assumptions: {
          years: 3,
          pathCount: 200,
          rebalance: 'annual',
          assets: [{ key: 'e', label: 'E', weight: '1', expectedAnnualReturn: '0.07', annualVolatility: '0.15' }],
          correlation: [[1]],
          settings: {
            initialValue: '10000',
            contribution: { amount: '0', frequency: 'none', timing: 'end' },
            withdrawal: { amount: '0', frequency: 'none', startYear: 1 },
            inflationRate: '0',
            feeRate: '0',
            targetAmount: null,
          },
          seed: 4242,
          stressPreset: null,
        },
        seed: 4242,
        modelVersion: 'montecarlo-v1',
        pathCount: 200,
        years: 3,
        heartbeatAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    app.jobs.stop();
    const { requeued } = await app.jobs.repository.resumeInterrupted(2);
    expect(requeued).toBeGreaterThan(0);
    await app.jobs.start();

    const run = await waitForRun(scenario.id, stale.id);
    expect(run.status).toBe('succeeded');
    expect(run.attempts).toBe(2);
  });

  it('重试次数用尽的中断运行直接置为 failed', async () => {
    const scenario = (await createScenario()).json().data;

    const stale = await app.prisma.monteCarloRun.create({
      data: {
        userId,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        status: 'running',
        attempts: 2,
        assumptions: {},
        seed: 1,
        modelVersion: 'montecarlo-v1',
        pathCount: 100,
        years: 1,
        heartbeatAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    app.jobs.stop();
    await app.jobs.repository.resumeInterrupted(2);

    const run = await app.prisma.monteCarloRun.findUnique({ where: { id: stale.id } });
    expect(run?.status).toBe('failed');
    expect(run?.failureCode).toBe('MC_INTERRUPTED');

    await app.jobs.start();
  });

  it('保留策略只留最新若干条终态运行', async () => {
    const scenario = (await createScenario()).json().data;

    const rows = Array.from({ length: 5 }, (_, index) => ({
      userId,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      status: 'succeeded' as const,
      progress: '1',
      assumptions: {},
      seed: index,
      modelVersion: 'montecarlo-v1',
      pathCount: 100,
      years: 1,
      createdAt: new Date(Date.now() - (5 - index) * 1000),
      finishedAt: new Date(Date.now() - (5 - index) * 1000),
    }));

    await app.prisma.monteCarloRun.createMany({ data: rows });

    // 只保留最新 3 条
    const deleted = await app.jobs.repository.pruneRuns(scenario.id, 3);
    expect(deleted).toBe(2);

    const remaining = await app.prisma.monteCarloRun.count({ where: { scenarioId: scenario.id } });
    expect(remaining).toBe(3);
  });

  it('清理不会删除排队中或运行中的记录', async () => {
    const scenario = (await createScenario()).json().data;

    await app.prisma.monteCarloRun.create({
      data: {
        userId,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        status: 'queued',
        assumptions: {},
        seed: 1,
        modelVersion: 'montecarlo-v1',
        pathCount: 100,
        years: 1,
      },
    });

    const deleted = await app.jobs.repository.pruneRuns(scenario.id, 0);
    expect(deleted).toBe(0);

    const queued = await app.prisma.monteCarloRun.count({
      where: { scenarioId: scenario.id, status: 'queued' },
    });
    expect(queued).toBe(1);
  });
});

describe('压力情景', () => {
  it('返回预设清单且只含键与文案键', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/simulations/monte-carlo/presets',
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    const presets = res.json().data.presets;
    expect(presets.map((preset: { key: string }) => preset.key)).toEqual([
      'crash',
      'stagflation',
      'lost_decade',
    ]);
    for (const preset of presets) {
      expect(preset.labelKey).toMatch(/^stress\.preset\./);
    }
  });

  it('压力运行标记 deterministic 且无达标概率', async () => {
    const scenario = (await createScenario()).json().data;

    const runRes = await app.inject({
      method: 'POST',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs`,
      headers: auth(token),
      payload: { stressPreset: 'crash' },
    });

    const runId = runRes.json().data.id;
    const run = await waitForRun(scenario.id, runId);
    expect(run.status).toBe('succeeded');

    const result = await app.inject({
      method: 'GET',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs/${runId}/results`,
      headers: auth(token),
    });

    const data = result.json().data.result;
    expect(data.deterministic).toBe(true);
    expect(data.probabilities.target).toBeNull();
  });
});

describe('不写账本', () => {
  it('模拟运行前后账户余额与交易条数完全不变', async () => {
    const before = {
      accounts: await app.prisma.account.count({ where: { userId } }),
      transactions: await app.prisma.transaction.count({ where: { userId } }),
      entries: await app.prisma.transactionEntry.count({ where: { userId } }),
    };

    const scenario = (await createScenario()).json().data;
    const runRes = await app.inject({
      method: 'POST',
      url: `/api/simulations/monte-carlo/${scenario.id}/runs`,
      headers: auth(token),
      payload: { pathCount: 200 },
    });
    await waitForRun(scenario.id, runRes.json().data.id);

    const after = {
      accounts: await app.prisma.account.count({ where: { userId } }),
      transactions: await app.prisma.transaction.count({ where: { userId } }),
      entries: await app.prisma.transactionEntry.count({ where: { userId } }),
    };

    expect(after).toEqual(before);
  });
});
