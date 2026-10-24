import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('assets');

let app: FastifyInstance;
let token: string;
let userId: string;

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

async function createAsset(overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/assets',
    headers: auth(token),
    payload: { name: '自住房', kind: 'property', currency: 'CNY', ...overrides },
  });
  return res.json().data.asset;
}

async function addValuation(assetId: string, date: string, value: string, overwrite = false) {
  return app.inject({
    method: 'POST',
    url: `/api/assets/${assetId}/valuations`,
    headers: auth(token),
    payload: { valuationDate: date, value, basis: 'manual', overwrite },
  });
}

describe('资产', () => {
  it('创建资产并拒绝同名', async () => {
    const asset = await createAsset();
    expect(asset.name).toBe('自住房');
    expect(asset.status).toBe('active');

    const dup = await app.inject({
      method: 'POST',
      url: '/api/assets',
      headers: auth(token),
      payload: { name: '自住房', kind: 'property', currency: 'CNY' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('ASSET_NAME_EXISTS');
  });

  it('同日估值需要显式覆盖', async () => {
    const asset = await createAsset();

    const first = await addValuation(asset.id, '2026-01-01', '1000000');
    expect(first.statusCode).toBe(201);

    const conflict = await addValuation(asset.id, '2026-01-01', '1100000');
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('ASSET_VALUATION_EXISTS');

    const overwrite = await addValuation(asset.id, '2026-01-01', '1100000', true);
    expect(overwrite.statusCode).toBe(200);
    expect(overwrite.json().data.valuation.value).toBe('1100000.000000');
  });

  it('有估值记录时只能归档不能硬删', async () => {
    const asset = await createAsset();
    await addValuation(asset.id, '2026-01-01', '1000000');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/assets/${asset.id}`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ASSET_HAS_VALUATIONS');
    expect(await app.prisma.asset.count({ where: { id: asset.id } })).toBe(1);
  });

  it('无估值时归档且不再出现在默认列表', async () => {
    const asset = await createAsset();

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/assets/${asset.id}`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/api/assets', headers: auth(token) });
    expect(list.json().data.assets).toHaveLength(0);
  });

  it('汇总只计入有估值的资产，未估值单独列出', async () => {
    const priced = await createAsset({ name: '自住房' });
    const unpriced = await createAsset({ name: '汽车', kind: 'vehicle' });
    await addValuation(priced.id, '2026-01-01', '1000000');

    const res = await app.inject({ method: 'GET', url: '/api/assets/summary', headers: auth(token) });
    expect(res.statusCode).toBe(200);

    const data = res.json().data;
    expect(data.total).toBe('1000000.000000');
    expect(data.unpriced).toEqual([{ id: unpriced.id, name: '汽车', reason: 'no_valuation' }]);
  });

  it('未来日期的估值不计入', async () => {
    const asset = await createAsset();
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await addValuation(asset.id, future, '2000000');

    const res = await app.inject({ method: 'GET', url: '/api/assets/summary', headers: auth(token) });
    expect(res.json().data.total).toBe('0.000000');
    expect(res.json().data.unpriced[0].reason).toBe('no_valuation');
  });

  it('取最新一条估值而非最早一条', async () => {
    const asset = await createAsset();
    await addValuation(asset.id, '2026-01-01', '1000000');
    await addValuation(asset.id, '2026-06-01', '1200000');

    const res = await app.inject({ method: 'GET', url: '/api/assets/summary', headers: auth(token) });
    expect(res.json().data.total).toBe('1200000.000000');
  });

  it('外币资产缺汇率时不计入并声明', async () => {
    const asset = await createAsset({ currency: 'USD' });
    await addValuation(asset.id, '2026-01-01', '100000');

    const res = await app.inject({ method: 'GET', url: '/api/assets/summary', headers: auth(token) });
    const data = res.json().data;
    expect(data.total).toBe('0.000000');
    expect(data.missingRate).toEqual([{ id: asset.id, name: '自住房', currency: 'USD' }]);
  });

  it('跨用户访问返回 404', async () => {
    const asset = await createAsset();
    const other = await createUser(app, DOMAIN, 'other');

    const res = await app.inject({
      method: 'GET',
      url: `/api/assets/${asset.id}`,
      headers: auth(other.token),
    });
    expect(res.statusCode).toBe(404);
  });

  it('乐观锁拒绝过期版本', async () => {
    const asset = await createAsset();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/assets/${asset.id}`,
      headers: auth(token),
      payload: { name: '新名字', version: asset.version + 5 },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('负债', () => {
  async function createLiability(overrides: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/liabilities',
      headers: auth(token),
      payload: { name: '房贷', kind: 'mortgage', currency: 'CNY', ...overrides },
    });
    return res.json().data.liability;
  }

  it('创建负债并记录余额快照', async () => {
    const liability = await createLiability();

    const res = await app.inject({
      method: 'POST',
      url: `/api/liabilities/${liability.id}/balance-snapshots`,
      headers: auth(token),
      payload: { snapshotDate: '2026-01-01', balance: '800000' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.snapshot.balance).toBe('800000.000000');
  });

  it('汇总取最新余额快照', async () => {
    const liability = await createLiability();

    for (const [date, balance] of [
      ['2026-01-01', '800000'],
      ['2026-06-01', '700000'],
    ] as const) {
      await app.inject({
        method: 'POST',
        url: `/api/liabilities/${liability.id}/balance-snapshots`,
        headers: auth(token),
        payload: { snapshotDate: date, balance },
      });
    }

    const res = await app.inject({ method: 'GET', url: '/api/liabilities/summary', headers: auth(token) });
    expect(res.json().data.total).toBe('700000.000000');
  });

  it('有快照时只能归档', async () => {
    const liability = await createLiability();
    await app.inject({
      method: 'POST',
      url: `/api/liabilities/${liability.id}/balance-snapshots`,
      headers: auth(token),
      payload: { snapshotDate: '2026-01-01', balance: '800000' },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/liabilities/${liability.id}`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('LIABILITY_HAS_SNAPSHOTS');
  });

  it('同日快照需要显式覆盖', async () => {
    const liability = await createLiability();
    const payload = { snapshotDate: '2026-01-01', balance: '800000' };

    await app.inject({
      method: 'POST',
      url: `/api/liabilities/${liability.id}/balance-snapshots`,
      headers: auth(token),
      payload,
    });

    const conflict = await app.inject({
      method: 'POST',
      url: `/api/liabilities/${liability.id}/balance-snapshots`,
      headers: auth(token),
      payload: { ...payload, balance: '750000' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('LIABILITY_SNAPSHOT_EXISTS');
  });

  it('跨用户访问返回 404', async () => {
    const liability = await createLiability();
    const other = await createUser(app, DOMAIN, 'other');

    const res = await app.inject({
      method: 'GET',
      url: `/api/liabilities/${liability.id}`,
      headers: auth(other.token),
    });
    expect(res.statusCode).toBe(404);
  });
});
