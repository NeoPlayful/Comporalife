import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('jobs');

let app: FastifyInstance;
let token: string;
let userId: string;

async function createTask(kind: 'export' | 'backup' | 'restore' | 'recheck', status = 'queued') {
  return app.prisma.jobTask.create({
    data: { userId, kind, status: status as 'queued', targetType: 'data_exports', targetId: null },
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
  userId = user.userId;
});

describe('统一任务列表', () => {
  it('通用任务与蒙特卡罗运行合并并按时间倒序', async () => {
    const scenario = await app.prisma.monteCarloScenario.create({
      data: {
        userId,
        name: '测试方案',
        currency: 'CNY',
        years: 10,
        pathCount: 100,
        assets: [],
        correlation: [],
        settings: {},
      },
    });

    await app.prisma.monteCarloRun.create({
      data: {
        userId,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        assumptions: {},
        seed: 1,
        modelVersion: 'montecarlo-v1',
        pathCount: 100,
        years: 10,
      },
    });

    await createTask('export');

    const res = await app.inject({ method: 'GET', url: '/api/jobs', headers: auth(token) });
    expect(res.statusCode).toBe(200);

    const kinds = res.json().data.items.map((item: { kind: string }) => item.kind);
    expect(kinds).toContain('export');
    expect(kinds).toContain('monte-carlo');

    const times = res.json().data.items.map((item: { createdAt: string }) => item.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('按 kind 筛选只返回对应类型', async () => {
    await createTask('export');
    await createTask('backup');

    const res = await app.inject({ method: 'GET', url: '/api/jobs?kind=export', headers: auth(token) });
    const items = res.json().data.items as Array<{ kind: string }>;

    expect(items.length).toBe(1);
    expect(items[0]!.kind).toBe('export');
  });

  it('返回按状态聚合的计数', async () => {
    await createTask('export', 'queued');
    await createTask('export', 'failed');

    const res = await app.inject({ method: 'GET', url: '/api/jobs', headers: auth(token) });
    const counts = res.json().data.counts;

    expect(counts.queued).toBeGreaterThanOrEqual(1);
    expect(counts.failed).toBeGreaterThanOrEqual(1);
  });

  it('跨用户看不到他人任务', async () => {
    await createTask('export');
    const other = await createUser(app, DOMAIN, 'other');

    const res = await app.inject({ method: 'GET', url: '/api/jobs', headers: auth(other.token) });
    expect(res.json().data.items).toHaveLength(0);
  });
});

describe('任务详情', () => {
  it('通用任务详情返回失败说明与尝试次数', async () => {
    const task = await createTask('backup', 'failed');
    await app.prisma.jobTask.update({
      where: { id: task.id },
      data: { failureCode: 'TASK_INTERNAL', failureMessage: '磁盘写入失败', attempts: 2 },
    });

    const res = await app.inject({ method: 'GET', url: `/api/jobs/${task.id}`, headers: auth(token) });
    expect(res.statusCode).toBe(200);

    const job = res.json().data.job;
    expect(job.source).toBe('task');
    expect(job.failureMessage).toBe('磁盘写入失败');
    expect(job.attempts).toBe(2);
  });

  it('跨用户读取任务详情返回 404', async () => {
    const task = await createTask('export');
    const other = await createUser(app, DOMAIN, 'other');

    const res = await app.inject({
      method: 'GET',
      url: `/api/jobs/${task.id}`,
      headers: auth(other.token),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('TASK_NOT_FOUND');
  });
});

describe('取消与重试', () => {
  it('取消排队中的通用任务会写入取消标记', async () => {
    const task = await createTask('export');

    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${task.id}/cancel`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    const updated = await app.prisma.jobTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(updated.cancelRequestedAt).not.toBeNull();
  });

  it('已完成的任务不可取消', async () => {
    const task = await createTask('export', 'succeeded');

    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${task.id}/cancel`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TASK_NOT_CANCELLABLE');
  });

  it('失败任务可重试并复用同一行', async () => {
    const task = await createTask('backup', 'failed');

    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${task.id}/retry`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('queued');
    expect(res.json().data.attempts).toBe(1);

    const rows = await app.prisma.jobTask.count({ where: { id: task.id } });
    expect(rows).toBe(1);
  });

  it('成功任务不可重试', async () => {
    const task = await createTask('export', 'succeeded');

    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${task.id}/retry`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TASK_NOT_RETRYABLE');
  });

  it('达到重试上限后不可再重试', async () => {
    const task = await createTask('export', 'failed');
    await app.prisma.jobTask.update({ where: { id: task.id }, data: { attempts: 3 } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${task.id}/retry`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(409);
  });

  it('蒙特卡罗运行走 Phase 5 的取消实现，语义不变', async () => {
    const scenario = await app.prisma.monteCarloScenario.create({
      data: {
        userId,
        name: '取消测试',
        currency: 'CNY',
        years: 5,
        pathCount: 100,
        assets: [],
        correlation: [],
        settings: {},
      },
    });
    const run = await app.prisma.monteCarloRun.create({
      data: {
        userId,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        status: 'succeeded',
        assumptions: {},
        seed: 7,
        modelVersion: 'montecarlo-v1',
        pathCount: 100,
        years: 5,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${run.id}/cancel`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.cancelled).toBe(false);
    expect(res.json().data.status).toBe('finished');
  });

  it('蒙特卡罗运行重试保留原种子', async () => {
    const scenario = await app.prisma.monteCarloScenario.create({
      data: {
        userId,
        name: '重试测试',
        currency: 'CNY',
        years: 5,
        pathCount: 100,
        assets: [],
        correlation: [],
        settings: {},
      },
    });
    const run = await app.prisma.monteCarloRun.create({
      data: {
        userId,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        status: 'failed',
        assumptions: {},
        seed: 424242,
        modelVersion: 'montecarlo-v1',
        pathCount: 100,
        years: 5,
        failureCode: 'MC_INTERNAL',
        attempts: 1,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${run.id}/retry`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    const updated = await app.prisma.monteCarloRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(updated.seed).toBe(424242);
    expect(updated.status).toBe('queued');
    expect(updated.failureCode).toBeNull();
  });
});

describe('任务执行器泛化不影响蒙特卡罗', () => {
  it('既有蒙特卡罗运行表不被任务表污染', async () => {
    const scenario = await app.prisma.monteCarloScenario.create({
      data: {
        userId,
        name: '隔离测试',
        currency: 'CNY',
        years: 5,
        pathCount: 100,
        assets: [],
        correlation: [],
        settings: {},
      },
    });
    await app.prisma.monteCarloRun.create({
      data: {
        userId,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        assumptions: {},
        seed: 2,
        modelVersion: 'montecarlo-v1',
        pathCount: 100,
        years: 5,
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/jobs?kind=monte-carlo', headers: auth(token) });
    expect(res.json().data.items).toHaveLength(1);

    expect(await app.prisma.jobTask.count({ where: { userId } })).toBe(0);
  });
});
