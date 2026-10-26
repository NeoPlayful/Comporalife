import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('accounts');

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

async function createAccount(overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    headers: auth(token),
    payload: {
      name: '储蓄账户',
      type: 'bank',
      currency: 'CNY',
      openingBalance: '10000.00',
      openingBalanceDate: '2026-01-01',
      ...overrides,
    },
  });
  return res.json().data.account;
}

describe('账户', () => {
  it('创建账户并返回期初余额', async () => {
    const account = await createAccount();

    expect(account.name).toBe('储蓄账户');
    expect(account.openingBalance).toBe('10000.000000');
    expect(account.status).toBe('active');
    expect(account.currency).toBe('CNY');
  });

  it('余额等于期初余额（无流水）', async () => {
    const account = await createAccount();

    const res = await app.inject({
      method: 'GET',
      url: `/api/accounts/${account.id}/balance`,
      headers: auth(token),
    });

    const body = res.json().data;
    expect(body.balance).toBe('10000.000000');
    expect(body.entryCount).toBe(0);
    expect(body.basis).toContain('期初余额');
  });

  it('列表返回余额且不查他人账户', async () => {
    await createAccount();
    const other = await createUser(app, DOMAIN, 'other');

    const res = await app.inject({
      method: 'GET',
      url: '/api/accounts',
      headers: auth(other.token),
    });

    expect(res.json().data.accounts).toHaveLength(0);
  });

  it('删除无流水账户时归档', async () => {
    const account = await createAccount();

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/accounts/${account.id}`,
      headers: auth(token),
    });
    expect(del.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/api/accounts', headers: auth(token) });
    expect(list.json().data.accounts).toHaveLength(0);

    const all = await app.inject({
      method: 'GET',
      url: '/api/accounts?status=all',
      headers: auth(token),
    });
    expect(all.json().data.accounts[0].status).toBe('archived');
  });

  it('期初余额修改走乐观锁并写审计', async () => {
    const account = await createAccount();

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/accounts/${account.id}`,
      headers: auth(token),
      payload: { openingBalance: '20000.00', version: account.version },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.account.openingBalance).toBe('20000.000000');
    expect(updated.json().data.account.version).toBe(account.version + 1);

    // 用旧版本号再次提交必须冲突
    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/accounts/${account.id}`,
      headers: auth(token),
      payload: { openingBalance: '30000.00', version: account.version },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('CONFLICT');

    const audit = await app.prisma.auditLog.findFirst({
      where: { userId, action: 'account.opening_balance_changed' },
    });
    expect(audit).not.toBeNull();
  });

  it('跨用户访问账户返回 404', async () => {
    const account = await createAccount();
    const other = await createUser(app, DOMAIN, 'other');

    const res = await app.inject({
      method: 'GET',
      url: `/api/accounts/${account.id}/balance`,
      headers: auth(other.token),
    });

    expect(res.statusCode).toBe(404);
  });

  it('对账只记录差异不改余额', async () => {
    const account = await createAccount();

    const res = await app.inject({
      method: 'POST',
      url: `/api/accounts/${account.id}/reconcile`,
      headers: auth(token),
      payload: { statementBalance: '9800.00', reconciledAt: '2026-02-01' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json().data;
    expect(body.reconciliation.difference).toBe('-200.000000');
    expect(body.suggestion).toContain('余额调整');

    const balance = await app.inject({
      method: 'GET',
      url: `/api/accounts/${account.id}/balance`,
      headers: auth(token),
    });
    // 对账不产生分录，余额仍是期初值
    expect(balance.json().data.balance).toBe('10000.000000');
  });

  it('余额历史按日聚合', async () => {
    const account = await createAccount();

    const res = await app.inject({
      method: 'GET',
      url: `/api/accounts/${account.id}/balance-history?from=2026-01-01&to=2026-01-05`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.granularity).toBe('day');
    expect(body.series).toHaveLength(5);
    expect(body.series[0].balance).toBe('10000.000000');
  });

  it('余额历史超过两年被拒绝', async () => {
    const account = await createAccount();

    const res = await app.inject({
      method: 'GET',
      url: `/api/accounts/${account.id}/balance-history?from=2020-01-01&to=2026-01-01`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('分类', () => {
  it('注册时复制两级分类模板', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/categories?kind=expense',
      headers: auth(token),
    });

    const roots = res.json().data.categories as Array<{ children: unknown[] }>;
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.some((root) => root.children.length > 0)).toBe(true);
  });

  it('可以创建二级分类', async () => {
    const roots = await app.inject({
      method: 'GET',
      url: '/api/categories?kind=expense',
      headers: auth(token),
    });
    const parent = (roots.json().data.categories as Array<{ id: string }>)[0]!;

    const res = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: auth(token),
      payload: { kind: 'expense', name: '新子类', parentId: parent.id },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.category.parentId).toBe(parent.id);
  });

  it('分类最多两级', async () => {
    const roots = await app.inject({
      method: 'GET',
      url: '/api/categories?kind=expense',
      headers: auth(token),
    });
    const parent = (roots.json().data.categories as Array<{ id: string; children: Array<{ id: string }> }>)[0]!;

    const child = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: auth(token),
      payload: { kind: 'expense', name: '二级', parentId: parent.id },
    });
    const childId = child.json().data.category.id as string;

    const grandchild = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: auth(token),
      payload: { kind: 'expense', name: '三级', parentId: childId },
    });

    expect(grandchild.statusCode).toBe(400);
  });

  it('子分类类型必须与父级一致', async () => {
    const roots = await app.inject({
      method: 'GET',
      url: '/api/categories?kind=expense',
      headers: auth(token),
    });
    const parent = (roots.json().data.categories as Array<{ id: string }>)[0]!;

    const res = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: auth(token),
      payload: { kind: 'income', name: '错误类型', parentId: parent.id },
    });

    expect(res.statusCode).toBe(400);
  });

  it('同级重名被拒绝', async () => {
    const payload = { kind: 'expense', name: '唯一分类名' };

    const first = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: auth(token),
      payload,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: auth(token),
      payload,
    });
    expect(second.statusCode).toBe(409);
  });

  it('删除分类为归档而非物理删除', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: auth(token),
      payload: { kind: 'expense', name: '待删分类' },
    });
    const id = created.json().data.category.id as string;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/categories/${id}`,
      headers: auth(token),
    });
    expect(del.statusCode).toBe(200);

    const record = await app.prisma.category.findUniqueOrThrow({ where: { id } });
    expect(record.archived).toBe(true);
  });
});

describe('标签', () => {
  it('创建、重命名、删除标签', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/tags',
      headers: auth(token),
      payload: { name: '旅行' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.tag.id as string;

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/tags/${id}`,
      headers: auth(token),
      payload: { name: '出差' },
    });
    expect(renamed.json().data.tag.name).toBe('出差');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/tags/${id}`,
      headers: auth(token),
    });
    expect(del.statusCode).toBe(200);
  });

  it('标签重名被拒绝', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/tags',
      headers: auth(token),
      payload: { name: '重复标签' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/tags',
      headers: auth(token),
      payload: { name: '重复标签' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('标签按用户隔离', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/tags',
      headers: auth(token),
      payload: { name: '私有标签' },
    });

    const other = await createUser(app, DOMAIN, 'other');
    const res = await app.inject({ method: 'GET', url: '/api/tags', headers: auth(other.token) });

    expect(res.json().data.tags).toHaveLength(0);
  });
});

describe('币种', () => {
  it('返回支持的币种与精度', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/currencies' });

    expect(res.statusCode).toBe(200);
    const currencies = res.json().data.currencies as Array<{ code: string; decimals: number }>;
    expect(currencies.find((c) => c.code === 'JPY')?.decimals).toBe(0);
    expect(currencies.find((c) => c.code === 'CNY')?.decimals).toBe(2);
  });

  it('每个币种都带代码、精度与符号，且精度不是全部默认 2 位', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/currencies' });
    const currencies = res.json().data.currencies as Array<{
      code: string;
      decimals: number;
      symbol: string;
    }>;

    expect(currencies.length).toBe(32);
    for (const item of currencies) {
      expect(item.code).toMatch(/^[A-Z]{3}$/);
      expect(item.symbol.trim()).not.toBe('');
      expect([0, 2, 3]).toContain(item.decimals);
    }

    // 0 位币种必须如实反映，缺条目会退化成 2 位并在展示时凭空多出辅币
    expect(currencies.find((c) => c.code === 'VND')?.decimals).toBe(0);
    expect(currencies.find((c) => c.code === 'IDR')?.decimals).toBe(0);
    expect(currencies.find((c) => c.code === 'HUF')?.decimals).toBe(0);
  });

  it('新增的主流币种可用于建账户', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: auth(token),
      payload: {
        name: 'INR 账户',
        type: 'bank',
        currency: 'INR',
        openingBalance: '1000',
        openingBalanceDate: '2026-01-01',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.account.currency).toBe('INR');
  });
});
