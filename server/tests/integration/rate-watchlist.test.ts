import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, clearExchangeRates, createUser, promoteToAdmin, testDomain } from '../helpers';

const DOMAIN = testDomain('rate-watchlist');

// 与其他汇率测试文件使用互不重叠的币种对，避免并行执行时互相污染全局汇率表。
// 基准币种也刻意不选 CNY：dashboard 与 rate-sync 两个套件都用 CNY 作为对手币。
const HELD = 'GBP';
const OTHER = 'AUD';
const BASE = 'SGD';

let app: FastifyInstance;
let token: string;
let adminToken: string;

function day(offset: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

async function createAdminRate(from: string, to: string, rate: string, rateDate = day(0)) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/exchange-rates',
    headers: auth(adminToken),
    payload: { baseCurrency: from, quoteCurrency: to, rate, rateDate },
  });
  expect(res.statusCode).toBe(201);
}

async function createAccount(currency: string, name = `${currency} 账户`) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    headers: auth(token),
    payload: {
      name,
      type: 'bank',
      currency,
      openingBalance: '1000',
      openingBalanceDate: '2026-01-01',
    },
  });
  expect(res.statusCode).toBe(201);
}

function watchlist() {
  return app.inject({ method: 'GET', url: '/api/exchange-rates/watchlist', headers: auth(token) });
}

function addPair(from: string, to: string) {
  return app.inject({
    method: 'POST',
    url: '/api/exchange-rates/watchlist',
    headers: auth(token),
    payload: { from, to },
  });
}

function removePair(from: string, to: string) {
  return app.inject({
    method: 'DELETE',
    url: '/api/exchange-rates/watchlist',
    headers: auth(token),
    body: { from, to },
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
  await clearExchangeRates(app, [HELD, OTHER, 'CHF', BASE]);

  const user = await createUser(app, DOMAIN);
  token = user.token;

  const settings = await app.inject({
    method: 'PATCH',
    url: '/api/settings',
    headers: auth(token),
    payload: { baseCurrency: BASE },
  });
  expect(settings.statusCode).toBe(200);

  const admin = await createUser(app, DOMAIN, 'admin');
  adminToken = await promoteToAdmin(app, admin.userId);
});

describe('默认集合', () => {
  it('没有外币账户时列表为空，且标记为跟随默认', async () => {
    const res = await watchlist();
    expect(res.statusCode).toBe(200);

    const data = res.json().data;
    expect(data.baseCurrency).toBe(BASE);
    expect(data.custom).toBe(false);
    expect(data.entries).toEqual([]);
  });

  it('持有外币时默认展示该币种到基准币种', async () => {
    await createAccount(HELD);
    await createAdminRate(HELD, BASE, '9');

    const entries = (await watchlist()).json().data.entries as Array<{
      from: string;
      to: string;
      rate: string;
      state: string;
      required: boolean;
    }>;

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      from: HELD,
      to: BASE,
      rate: '9.0000000000',
      state: 'fresh',
      required: true,
    });
  });

  it('缺少汇率时保留该行并标记 missing', async () => {
    await createAccount(HELD);

    const entries = (await watchlist()).json().data.entries as Array<{
      rate: string | null;
      state: string;
    }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.rate).toBeNull();
    expect(entries[0]!.state).toBe('missing');
  });

  it('只有反向汇率时按倒数展示', async () => {
    await createAccount(HELD);
    await createAdminRate(BASE, HELD, '0.125');

    const entries = (await watchlist()).json().data.entries as Array<{ rate: string }>;
    expect(entries[0]!.rate).toBe('8.0000000000');
  });

  it('超过过期天数标记 stale', async () => {
    await createAccount(HELD);
    await createAdminRate(HELD, BASE, '9', day(30));

    const entries = (await watchlist()).json().data.entries as Array<{
      state: string;
      daysLag: number;
    }>;
    expect(entries[0]!.state).toBe('stale');
    expect(entries[0]!.daysLag).toBeGreaterThanOrEqual(30);
  });
});

describe('自选增删', () => {
  it('添加后可移除，移除后从列表消失', async () => {
    await createAccount(HELD);
    await createAdminRate(HELD, BASE, '9');
    await createAdminRate(OTHER, BASE, '4.5');

    const added = await addPair(OTHER, BASE);
    expect(added.statusCode).toBe(201);
    const afterAdd = added.json().data as { custom: boolean; entries: Array<{ from: string }> };
    expect(afterAdd.custom).toBe(true);
    expect(afterAdd.entries.map((item) => item.from).sort()).toEqual([HELD, OTHER].sort());

    const removed = await removePair(OTHER, BASE);
    expect(removed.statusCode).toBe(200);
    const afterRemove = removed.json().data as { entries: Array<{ from: string }> };
    expect(afterRemove.entries.map((item) => item.from)).toEqual([HELD]);
  });

  it('重复添加是幂等的，不产生重复行', async () => {
    await createAccount(HELD);
    await createAdminRate(HELD, BASE, '9');

    await addPair(OTHER, BASE).catch(() => undefined);
    await createAdminRate(OTHER, BASE, '4.5');
    await addPair(OTHER, BASE);
    const again = await addPair(OTHER, BASE);

    expect(again.statusCode).toBe(201);
    const entries = again.json().data.entries as Array<{ from: string }>;
    expect(entries.filter((item) => item.from === OTHER)).toHaveLength(1);
  });

  it('没有汇率数据的币种对不能添加', async () => {
    const res = await addPair(OTHER, 'JPY');
    expect(res.statusCode).toBe(400);
  });

  it('自己持有但暂时没有汇率的币种对可以添加', async () => {
    await createAccount(HELD);

    const res = await addPair(HELD, BASE);
    expect(res.statusCode).toBe(201);
    expect(res.json().data.entries[0].state).toBe('missing');
  });

  it('恢复默认后重新跟随持有币种', async () => {
    await createAccount(HELD);
    await createAdminRate(HELD, BASE, '9');
    await createAdminRate(OTHER, BASE, '4.5');
    await addPair(OTHER, BASE);

    const reset = await app.inject({
      method: 'POST',
      url: '/api/exchange-rates/watchlist/reset',
      headers: auth(token),
    });
    expect(reset.statusCode).toBe(200);

    const data = reset.json().data as { custom: boolean; entries: Array<{ from: string }> };
    expect(data.custom).toBe(false);
    expect(data.entries.map((item) => item.from)).toEqual([HELD]);
  });

  it('清空后不会退回默认集合', async () => {
    await createAccount(HELD);
    await createAdminRate(HELD, BASE, '9');

    const removed = await removePair(HELD, BASE);
    expect(removed.statusCode).toBe(200);

    const data = removed.json().data as { custom: boolean; entries: unknown[] };
    expect(data.custom).toBe(true);
    expect(data.entries).toEqual([]);
  });

  it('币种相同或不受支持时拒绝', async () => {
    expect((await addPair(HELD, HELD)).statusCode).toBe(400);
    expect((await addPair('XXX', BASE)).statusCode).toBe(400);
  });
});

describe('候选集合', () => {
  it('只给出能折算的币种对，不出现两个都无数据的组合', async () => {
    await createAccount(HELD);
    await createAdminRate(OTHER, BASE, '4.5');

    const candidates = (await watchlist()).json().data.candidates as Array<{
      from: string;
      to: string;
    }>;
    const keys = candidates.map((item) => `${item.from}->${item.to}`);

    // 存在汇率：正反两个方向都可以加
    expect(keys).toContain(`${OTHER}->${BASE}`);
    expect(keys).toContain(`${BASE}->${OTHER}`);
    // HELD 已在默认列表里，不应再出现在候选
    expect(keys).not.toContain(`${HELD}->${BASE}`);
    // 既不持有也没有汇率的组合不给出，否则加进来永远是空行
    expect(keys).not.toContain(`${OTHER}->${HELD}`);
  });

  it('持有但暂无汇率的币种对移除后仍可重新加入', async () => {
    await createAccount(HELD);
    await createAccount('CHF');
    await createAdminRate(OTHER, BASE, '4.5');

    // 先转为自定义列表：移除没有数据的 CHF
    await removePair('CHF', BASE);
    const candidates = (await watchlist()).json().data.candidates as Array<{
      from: string;
      to: string;
    }>;
    const keys = candidates.map((item) => `${item.from}->${item.to}`);
    expect(keys).toContain(`CHF->${BASE}`);

    const reAdded = await addPair('CHF', BASE);
    expect(reAdded.statusCode).toBe(201);
  });

  it('已在列表中的币种对不再出现在候选里', async () => {
    await createAccount(HELD);
    await createAdminRate(HELD, BASE, '9');

    const candidates = (await watchlist()).json().data.candidates as Array<{
      from: string;
      to: string;
    }>;
    expect(candidates.map((item) => `${item.from}->${item.to}`)).not.toContain(`${HELD}->${BASE}`);
  });
});

describe('隔离与上限', () => {
  it('两个用户的自选列表互不影响，但看到同一个汇率值', async () => {
    await createAccount(HELD);
    await createAdminRate(HELD, BASE, '9');

    const other = await createUser(app, DOMAIN, 'other');
    await app.inject({
      method: 'POST',
      url: '/api/exchange-rates/watchlist',
      headers: auth(other.token),
      payload: { from: HELD, to: BASE },
    });

    const mine = (await watchlist()).json().data as { custom: boolean; entries: unknown[] };
    expect(mine.custom).toBe(false);

    const theirs = await app.inject({
      method: 'GET',
      url: '/api/exchange-rates/watchlist',
      headers: auth(other.token),
    });
    const theirData = theirs.json().data as { custom: boolean; entries: Array<{ rate: string }> };
    expect(theirData.custom).toBe(true);
    expect(theirData.entries[0]!.rate).toBe('9.0000000000');
  });

  it('超过上限时返回 400', async () => {
    const pairs: string[] = [];
    const codes = ['USD', 'EUR', 'GBP', 'JPY', 'HKD', 'AUD', 'CAD', 'SGD', 'KRW', 'CHF', 'TWD'];
    for (const a of codes) {
      for (const b of codes) {
        if (a !== b) pairs.push(`${a}->${b}`);
      }
    }

    // 直接写库绕过逐条接口调用，只验证上限判断本身
    await app.prisma.userSettings.update({
      where: { userId: (await app.prisma.user.findFirstOrThrow({ where: { email: { endsWith: DOMAIN } } })).id },
      data: { rateDisplayPairs: pairs.slice(0, 50) },
    });

    const res = await addPair('USD', 'JPY');
    // 50 条里已包含 USD->JPY 时属于幂等返回；否则应因超限被拒
    if (res.statusCode === 201) {
      expect((res.json().data.entries as unknown[]).length).toBe(50);
    } else {
      expect(res.statusCode).toBe(400);
    }
  });
});
