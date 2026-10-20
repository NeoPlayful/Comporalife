import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('ledger');

let app: FastifyInstance;
let token: string;
let userId: string;
let cashAccountId: string;
let bankAccountId: string;
let expenseCategoryId: string;
let incomeCategoryId: string;
let otherExpenseId: string;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await cleanupUsers(app, DOMAIN);
  await app.close();
});

beforeEach(async () => {
  await cleanupUsers(app, DOMAIN);
  const user = await createUser(app, DOMAIN, 'ledger');
  token = user.token;
  userId = user.userId;

  const cash = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    headers: auth(token),
    payload: {
      name: '现金',
      type: 'cash',
      currency: 'CNY',
      openingBalance: '1000.00',
      openingBalanceDate: '2026-01-01',
    },
  });
  cashAccountId = cash.json().data.account.id;

  const bank = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    headers: auth(token),
    payload: {
      name: '工资卡',
      type: 'bank',
      currency: 'CNY',
      openingBalance: '5000.00',
      openingBalanceDate: '2026-01-01',
    },
  });
  bankAccountId = bank.json().data.account.id;

  const tree = await app.inject({
    method: 'GET',
    url: '/api/categories',
    headers: auth(token),
  });
  const flat = tree.json().data.flat as Array<{ id: string; kind: string; name: string }>;

  expenseCategoryId = flat.find((c) => c.kind === 'expense' && c.name === '食品')!.id;
  incomeCategoryId = flat.find((c) => c.kind === 'income' && c.name === '工资')!.id;
  otherExpenseId = flat.find((c) => c.kind === 'expense' && c.name === '其他支出')!.id;
});

async function getBalance(accountId: string): Promise<string> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/accounts/${accountId}/balance`,
    headers: auth(token),
  });
  return res.json().data.balance as string;
}

async function createExpense(amount = '100.00') {
  return app.inject({
    method: 'POST',
    url: '/api/transactions',
    headers: auth(token),
    payload: {
      type: 'expense',
      accountId: cashAccountId,
      categoryId: expenseCategoryId,
      amount,
      occurredAt: '2026-02-01T10:00:00Z',
      description: '午餐',
    },
  });
}

describe('交易分录', () => {
  it('支出生成两条平衡分录并扣减余额', async () => {
    const res = await createExpense('100.00');
    expect(res.statusCode).toBe(201);

    const transaction = res.json().data.transaction;
    expect(transaction.entries).toHaveLength(2);

    const entries = transaction.entries as Array<{ accountId: string | null; amount: string }>;
    const realLeg = entries.find((e) => e.accountId === cashAccountId)!;
    const externalLeg = entries.find((e) => e.accountId === null)!;

    expect(realLeg.amount).toBe('-100.000000');
    expect(externalLeg.amount).toBe('100.000000');

    expect(await getBalance(cashAccountId)).toBe('900.000000');
  });

  it('收入增加账户余额且展示金额为正', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: auth(token),
      payload: {
        type: 'income',
        accountId: bankAccountId,
        categoryId: incomeCategoryId,
        amount: '8000.00',
        occurredAt: '2026-02-05T10:00:00Z',
        description: '二月工资',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.transaction.amount).toBe('8000.000000');
    expect(await getBalance(bankAccountId)).toBe('13000.000000');
  });

  it('分录明细接口报告平衡状态', async () => {
    const created = await createExpense('250.50');
    const id = created.json().data.transaction.id as string;

    const res = await app.inject({
      method: 'GET',
      url: `/api/transactions/${id}/entries`,
      headers: auth(token),
    });

    const body = res.json().data;
    expect(body.balanced).toBe(true);
    expect(body.entries).toHaveLength(2);
  });

  it('收入使用支出分类被拒绝', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: auth(token),
      payload: {
        type: 'income',
        accountId: bankAccountId,
        categoryId: expenseCategoryId,
        amount: '100.00',
        occurredAt: '2026-02-05T10:00:00Z',
        description: '错误分类',
      },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('CATEGORY_KIND_MISMATCH');
  });

  it('金额为 0 或负数被拒绝', async () => {
    for (const amount of ['0', '-50.00']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/transactions',
        headers: auth(token),
        payload: {
          type: 'expense',
          accountId: cashAccountId,
          amount,
          occurredAt: '2026-02-01T10:00:00Z',
          description: '非法金额',
        },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('归档账户不可记账', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/accounts/${cashAccountId}/archive`,
      headers: auth(token),
    });

    const res = await createExpense();
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ACCOUNT_ARCHIVED');
  });

  it('事务中记账后账户不允许删除', async () => {
    await createExpense();

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/accounts/${cashAccountId}`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ACCOUNT_HAS_TRANSACTIONS');
  });
});

describe('转账', () => {
  it('转账生成两条真实分录且不计入收支', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/transfers',
      headers: auth(token),
      payload: {
        fromAccountId: bankAccountId,
        toAccountId: cashAccountId,
        amount: '500.00',
        occurredAt: '2026-02-10T10:00:00Z',
      },
    });

    expect(res.statusCode).toBe(201);
    const entries = res.json().data.transaction.entries as Array<{ accountId: string | null }>;
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.accountId !== null)).toBe(true);
    expect(res.json().data.transaction.category).toBeNull();

    expect(await getBalance(bankAccountId)).toBe('4500.000000');
    expect(await getBalance(cashAccountId)).toBe('1500.000000');
  });

  it('转账两侧账户相同被拒绝', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/transfers',
      headers: auth(token),
      payload: {
        fromAccountId: cashAccountId,
        toAccountId: cashAccountId,
        amount: '100.00',
        occurredAt: '2026-02-10T10:00:00Z',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('跨币种转账被明确拒绝', async () => {
    const usd = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: auth(token),
      payload: {
        name: '美元账户',
        type: 'bank',
        currency: 'USD',
        openingBalance: '100',
        openingBalanceDate: '2026-01-01',
      },
    });
    const usdId = usd.json().data.account.id as string;

    const res = await app.inject({
      method: 'POST',
      url: '/api/transfers',
      headers: auth(token),
      payload: {
        fromAccountId: cashAccountId,
        toAccountId: usdId,
        amount: '100.00',
        occurredAt: '2026-02-10T10:00:00Z',
      },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('CROSS_CURRENCY_TRANSFER_UNSUPPORTED');
  });

  it('冲正转账后两侧余额同时回退', async () => {
    const transfer = await app.inject({
      method: 'POST',
      url: '/api/transfers',
      headers: auth(token),
      payload: {
        fromAccountId: bankAccountId,
        toAccountId: cashAccountId,
        amount: '300.00',
        occurredAt: '2026-02-10T10:00:00Z',
      },
    });
    const id = transfer.json().data.transaction.id as string;

    expect(await getBalance(cashAccountId)).toBe('1300.000000');

    const voided = await app.inject({
      method: 'DELETE',
      url: `/api/transfers/${id}`,
      headers: auth(token),
    });
    expect(voided.statusCode).toBe(200);

    expect(await getBalance(cashAccountId)).toBe('1000.000000');
    expect(await getBalance(bankAccountId)).toBe('5000.000000');
  });
});

describe('修改与冲正', () => {
  it('修改金额会重建分录并重新校验平衡', async () => {
    const created = await createExpense('100.00');
    const transaction = created.json().data.transaction;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/transactions/${transaction.id}`,
      headers: auth(token),
      payload: { amount: '250.00', version: transaction.version },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.transaction.amount).toBe('-250.000000');
    expect(await getBalance(cashAccountId)).toBe('750.000000');

    const entries = await app.inject({
      method: 'GET',
      url: `/api/transactions/${transaction.id}/entries`,
      headers: auth(token),
    });
    expect(entries.json().data.balanced).toBe(true);
  });

  it('版本号过期返回 409', async () => {
    const created = await createExpense();
    const transaction = created.json().data.transaction;

    await app.inject({
      method: 'PATCH',
      url: `/api/transactions/${transaction.id}`,
      headers: auth(token),
      payload: { description: '第一次修改', version: transaction.version },
    });

    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/transactions/${transaction.id}`,
      headers: auth(token),
      payload: { description: '并发修改', version: transaction.version },
    });

    expect(stale.statusCode).toBe(409);
  });

  it('冲正后余额回退且记录保留为已冲正', async () => {
    const created = await createExpense('400.00');
    const id = created.json().data.transaction.id as string;

    expect(await getBalance(cashAccountId)).toBe('600.000000');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/transactions/${id}`,
      headers: auth(token),
    });
    expect(del.statusCode).toBe(200);

    expect(await getBalance(cashAccountId)).toBe('1000.000000');

    // 默认列表不含已冲正，status=all 时可见
    const posted = await app.inject({
      method: 'GET',
      url: '/api/transactions',
      headers: auth(token),
    });
    expect(posted.json().data.transactions).toHaveLength(0);

    const all = await app.inject({
      method: 'GET',
      url: '/api/transactions?status=all',
      headers: auth(token),
    });
    expect(all.json().data.transactions[0].status).toBe('voided');
  });

  it('已冲正交易不可再次冲正或修改', async () => {
    const created = await createExpense();
    const transaction = created.json().data.transaction;

    await app.inject({
      method: 'DELETE',
      url: `/api/transactions/${transaction.id}`,
      headers: auth(token),
    });

    const again = await app.inject({
      method: 'DELETE',
      url: `/api/transactions/${transaction.id}`,
      headers: auth(token),
    });
    expect(again.statusCode).toBe(409);
  });

  it('冲正交易后写审计记录', async () => {
    const created = await createExpense();
    const id = created.json().data.transaction.id as string;

    await app.inject({
      method: 'DELETE',
      url: `/api/transactions/${id}`,
      headers: auth(token),
    });

    const audit = await app.prisma.auditLog.findFirst({
      where: { userId, action: 'transaction.void', targetId: id },
    });
    expect(audit).not.toBeNull();
    // 审计不得记录金额
    expect(JSON.stringify(audit?.metadata ?? {})).not.toContain('100');
  });
});

describe('批量操作', () => {
  async function createThree() {
    const ids: string[] = [];
    for (const amount of ['10.00', '20.00', '30.00']) {
      const res = await createExpense(amount);
      ids.push(res.json().data.transaction.id as string);
    }
    return ids;
  }

  it('批量分类生效', async () => {
    const ids = await createThree();

    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions/bulk-categorize',
      headers: auth(token),
      payload: { transactionIds: ids, categoryId: otherExpenseId },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.updated).toBe(3);

    const check = await app.prisma.transaction.findMany({
      where: { id: { in: ids } },
      select: { categoryId: true },
    });
    expect(check.every((tx) => tx.categoryId === otherExpenseId)).toBe(true);
  });

  it('批量操作含他人交易时整体失败', async () => {
    const ids = await createThree();
    const other = await createUser(app, DOMAIN, 'other');

    // 另一个用户的交易
    const otherAccount = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: auth(other.token),
      payload: {
        name: '他人账户',
        type: 'cash',
        currency: 'CNY',
        openingBalance: '0',
        openingBalanceDate: '2026-01-01',
      },
    });
    const otherAccountId = otherAccount.json().data.account.id as string;

    const otherTx = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: auth(other.token),
      payload: {
        type: 'expense',
        accountId: otherAccountId,
        amount: '5.00',
        occurredAt: '2026-02-01T10:00:00Z',
        description: '他人交易',
      },
    });
    const otherTxId = otherTx.json().data.transaction.id as string;

    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions/bulk-categorize',
      headers: auth(token),
      payload: { transactionIds: [...ids, otherTxId], categoryId: otherExpenseId },
    });

    expect(res.statusCode).toBe(404);

    // 自己的交易也不能被部分修改
    const check = await app.prisma.transaction.findMany({
      where: { id: { in: ids } },
      select: { categoryId: true },
    });
    expect(check.every((tx) => tx.categoryId === expenseCategoryId)).toBe(true);
  });

  it('幂等键阻止重复创建', async () => {
    const payload = {
      type: 'expense',
      accountId: cashAccountId,
      amount: '77.00',
      occurredAt: '2026-02-01T10:00:00Z',
      description: '幂等测试',
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { ...auth(token), 'idempotency-key': 'test-key-1' },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { ...auth(token), 'idempotency-key': 'test-key-1' },
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.transaction.id).toBe(first.json().data.transaction.id);

    // 只扣一次
    expect(await getBalance(cashAccountId)).toBe('923.000000');
  });
});

describe('数据隔离', () => {
  it('跨用户访问交易返回 404', async () => {
    const created = await createExpense();
    const id = created.json().data.transaction.id as string;
    const other = await createUser(app, DOMAIN, 'other');

    const res = await app.inject({
      method: 'GET',
      url: `/api/transactions/${id}`,
      headers: auth(other.token),
    });

    expect(res.statusCode).toBe(404);
  });

  it('跨用户冲正返回 404', async () => {
    const created = await createExpense();
    const id = created.json().data.transaction.id as string;
    const other = await createUser(app, DOMAIN, 'other');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/transactions/${id}`,
      headers: auth(other.token),
    });

    expect(res.statusCode).toBe(404);
  });
});
