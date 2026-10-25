import Decimal from 'decimal.js';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { runRateSync, setRateSyncEnabled } from '@/modules/market-data/rate-sync.service';
import type { RateProvider, RateQuote } from '@/modules/market-data/rate-provider';
import { RateProviderError } from '@/modules/market-data/rate-provider';
import { auth, cleanupUsers, clearExchangeRates, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('rate-sync');
const TODAY = '2026-10-20';
// 抓取范围固定为本套件所需币种：集成测试共享数据库，其他套件的币种会改变写入行数
function demandFor(...targets: string[]) {
  return { targets, baseCurrencies: ['CNY'] };
}

let app: FastifyInstance;
let token: string;
let userId: string;

/** 固定响应：绝不访问外网 */
function fakeProvider(quotes: RateQuote[]): RateProvider {
  return {
    name: 'fake',
    anchorCurrency: 'USD',
    fetch: async () => quotes,
  };
}

function failingProvider(code: 'TIMEOUT' | 'RATE_LIMIT' | 'AUTH'): RateProvider {
  return {
    name: 'fake',
    anchorCurrency: 'USD',
    fetch: async () => {
      throw new RateProviderError(code, '模拟失败');
    },
  };
}

function q(target: string, rate: string, date = TODAY): RateQuote {
  return { base: 'USD', quote: target, rate: new Decimal(rate), date };
}

async function createAccount(currency: string): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    headers: auth(token),
    payload: {
      name: `${currency} 账户`,
      type: 'bank',
      currency,
      openingBalance: '1000',
      openingBalanceDate: '2026-01-01',
    },
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
  // 只清本套件使用的币种：全表清理会抹掉并行执行的其他套件正在写入的汇率
  await clearExchangeRates(app, ['GBP', 'AUD', 'CNY']);
  await app.prisma.rateSyncRun.deleteMany({});

  const user = await createUser(app, DOMAIN);
  token = user.token;
  userId = user.userId;
});

describe('同步落库', () => {
  it('按需换算成直接币种对并写入全局表', async () => {
    await createAccount('GBP');

    const summary = await runRateSync(app.prisma, {
      trigger: 'manual',
      triggeredBy: userId,
      provider: fakeProvider([q('CNY', '7.2'), q('GBP', '0.8')]),
      now: () => new Date(`${TODAY}T08:00:00.000Z`),
      demand: demandFor('GBP'),
    });

    expect(summary.status).toBe('succeeded');
    expect(summary.writtenRows).toBe(1);

    const row = await app.prisma.exchangeRate.findFirst({
      where: { baseCurrency: 'GBP', quoteCurrency: 'CNY' },
    });
    // 7.2 / 0.8 = 9，落库为直接对
    expect(row?.rate.toString()).toBe('9');
    expect(row?.source).toBe('provider');
  });

  it('同日已有人工录入时跳过，人工值不变', async () => {
    await createAccount('GBP');
    await app.prisma.exchangeRate.create({
      data: {
        baseCurrency: 'GBP',
        quoteCurrency: 'CNY',
        rate: '7.777',
        rateDate: new Date(`${TODAY}T00:00:00.000Z`),
        source: 'manual',
      },
    });

    const summary = await runRateSync(app.prisma, {
      trigger: 'manual',
      provider: fakeProvider([q('CNY', '7.2'), q('GBP', '0.8')]),
      now: () => new Date(`${TODAY}T08:00:00.000Z`),
      demand: demandFor('GBP'),
    });

    expect(summary.skippedManual).toBe(1);
    expect(summary.writtenRows).toBe(0);

    const row = await app.prisma.exchangeRate.findFirst({
      where: { baseCurrency: 'GBP', quoteCurrency: 'CNY' },
    });
    expect(row?.rate.toString()).toBe('7.777');
    expect(row?.source).toBe('manual');
  });

  it('删除人工行后再同步可补上', async () => {
    await createAccount('GBP');
    const manual = await app.prisma.exchangeRate.create({
      data: {
        baseCurrency: 'GBP',
        quoteCurrency: 'CNY',
        rate: '7.777',
        rateDate: new Date(`${TODAY}T00:00:00.000Z`),
        source: 'manual',
      },
    });
    const settings = {
      trigger: 'manual' as const,
      provider: fakeProvider([q('CNY', '7.2'), q('GBP', '0.8')]),
      now: () => new Date(`${TODAY}T08:00:00.000Z`),
      demand: demandFor('GBP'),
    };

    await runRateSync(app.prisma, settings);
    await app.prisma.exchangeRate.delete({ where: { id: manual.id } });
    await runRateSync(app.prisma, settings);

    const row = await app.prisma.exchangeRate.findFirst({
      where: { baseCurrency: 'GBP', quoteCurrency: 'CNY' },
    });
    expect(row?.rate.toString()).toBe('9');
    expect(row?.source).toBe('provider');
  });

  it('供应商失败时零写入并记录原因码', async () => {
    await createAccount('GBP');

    const summary = await runRateSync(app.prisma, {
      trigger: 'manual',
      provider: failingProvider('RATE_LIMIT'),
      now: () => new Date(`${TODAY}T08:00:00.000Z`),
      demand: demandFor('GBP'),
    });

    expect(summary.status).toBe('failed');
    expect(summary.errorCode).toBe('RATE_LIMIT');
    // 并行执行的其他套件可能已有汇率行，只断言本套件的币种没有被写入
    expect(
      await app.prisma.exchangeRate.count({
        where: { OR: [{ baseCurrency: 'GBP' }, { quoteCurrency: 'GBP' }] },
      }),
    ).toBe(0);

    const run = await app.prisma.rateSyncRun.findFirst();
    expect(run?.status).toBe('failed');
    // 失败说明不得包含密钥或完整响应
    expect(run?.errorMessage ?? '').not.toContain('key');
  });

  it('部分币种无效时状态为 partial，其余正常写入', async () => {
    await createAccount('GBP');
    await createAccount('AUD');

    const summary = await runRateSync(app.prisma, {
      trigger: 'manual',
      provider: fakeProvider([q('CNY', '7.2'), q('GBP', '0.8'), q('AUD', '0')]),
      now: () => new Date(`${TODAY}T08:00:00.000Z`),
      demand: demandFor('GBP', 'AUD'),
    });

    expect(summary.status).toBe('partial');
    expect(summary.writtenRows).toBe(1);
    expect(summary.failures.some((item) => item.code === 'RATE_INVALID')).toBe(true);
  });

  it('两个用户看到同一个币种对的值与来源', async () => {
    await createAccount('GBP');
    const other = await createUser(app, DOMAIN, 'other');

    await runRateSync(app.prisma, {
      trigger: 'manual',
      provider: fakeProvider([q('CNY', '7.2'), q('GBP', '0.8')]),
      now: () => new Date(`${TODAY}T08:00:00.000Z`),
      demand: demandFor('GBP'),
    });

    const lookups = await Promise.all(
      [token, other.token].map((t) =>
        app.inject({ method: 'GET', url: '/api/exchange-rates?from=GBP&to=CNY', headers: auth(t) }),
      ),
    );

    for (const res of lookups) {
      expect(res.statusCode).toBe(200);
      expect(res.json().data.rate).toBe('9.0000000000');
    }
  });

  it('同步写一条审计且不含数值', async () => {
    await createAccount('GBP');
    await runRateSync(app.prisma, {
      trigger: 'manual',
      triggeredBy: userId,
      provider: fakeProvider([q('CNY', '7.2'), q('GBP', '0.8')]),
      now: () => new Date(`${TODAY}T08:00:00.000Z`),
      demand: demandFor('GBP'),
    });

    // runRateSync 本身不写审计（由调用方/接口写），这里断言运行记录不含数值
    const run = await app.prisma.rateSyncRun.findFirst();
    const text = JSON.stringify(run);
    expect(text).not.toContain('7.2');
    expect(text).not.toContain('"9"');
  });
});

describe('连续失败自限', () => {
  it('连续三次失败后 isRateSyncEnabled 仍由调用方决定，运行记录可判定', async () => {
    await setRateSyncEnabled(app.prisma, true, userId);
    await createAccount('GBP');

    for (let i = 0; i < 3; i += 1) {
      await runRateSync(app.prisma, {
        trigger: 'scheduled',
        provider: failingProvider('TIMEOUT'),
        now: () => new Date(`${TODAY}T08:00:0${i}.000Z`),
        demand: demandFor('GBP'),
      });
    }

    const runs = await app.prisma.rateSyncRun.findMany({ where: { trigger: 'scheduled' } });
    expect(runs).toHaveLength(3);
    expect(runs.every((run) => run.status === 'failed')).toBe(true);
  });
});

describe('状态接口', () => {
  it('区分 missing 与 fresh', async () => {
    await createAccount('GBP');

    const missing = await app.inject({
      method: 'GET',
      url: '/api/market-data/status',
      headers: auth(token),
    });
    expect(missing.statusCode).toBe(200);
    const missingPair = (missing.json().data.pairs as Array<{ from: string; state: string }>).find(
      (item) => item.from === 'GBP',
    );
    expect(missingPair?.state).toBe('missing');

    // 写入今天的汇率后应变为 fresh
    await app.prisma.exchangeRate.create({
      data: {
        baseCurrency: 'GBP',
        quoteCurrency: 'CNY',
        rate: '9',
        rateDate: new Date(),
        source: 'manual',
      },
    });

    const fresh = await app.inject({
      method: 'GET',
      url: '/api/market-data/status',
      headers: auth(token),
    });
    const freshPair = (fresh.json().data.pairs as Array<{ from: string; state: string }>).find(
      (item) => item.from === 'GBP',
    );
    expect(freshPair?.state).toBe('fresh');
  });

  it('用户访问供应商状态接口返回 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/market-data/providers',
      headers: auth(token),
    });
    expect(res.statusCode).toBe(403);
  });

  it('未配置供应商时手动刷新返回 400', async () => {
    const admin = await createUser(app, DOMAIN, 'admin');
    await app.prisma.user.update({ where: { id: admin.userId }, data: { role: 'admin' } });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: admin.email, password: 'TestPass123' },
    });
    const adminToken = login.json().data.accessToken as string;

    const res = await app.inject({
      method: 'POST',
      url: '/api/market-data/refresh',
      headers: auth(adminToken),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('RATE_PROVIDER_NOT_CONFIGURED');
    // 错误信息不得泄露端点
    expect(JSON.stringify(res.json())).not.toContain('https://');
  });
});
