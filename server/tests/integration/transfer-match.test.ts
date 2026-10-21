import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('match');

let app: FastifyInstance;
let token: string;
let bankId: string;
let cashId: string;

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

  const bank = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    headers: auth(token),
    payload: {
      name: '工资卡',
      type: 'bank',
      currency: 'CNY',
      openingBalance: '10000.00',
      openingBalanceDate: '2026-01-01',
    },
  });
  bankId = bank.json().data.account.id;

  const cash = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    headers: auth(token),
    payload: {
      name: '日常现金',
      type: 'cash',
      currency: 'CNY',
      openingBalance: '1000.00',
      openingBalanceDate: '2026-01-01',
    },
  });
  cashId = cash.json().data.account.id;
});

async function addTransaction(accountId: string, type: 'income' | 'expense', amount: string, date: string, description: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/transactions',
    headers: auth(token),
    payload: { type, occurredAt: date, description, amount, accountId },
  });
  if (res.statusCode !== 201) throw new Error(`创建交易失败 ${res.body}`);
  return res.json().data.transaction.id as string;
}

async function balanceOf(accountId: string) {
  const res = await app.inject({ method: 'GET', url: `/api/accounts/${accountId}/balance`, headers: auth(token) });
  return Number(res.json().data.balance);
}

describe('待匹配流水', () => {
  it('返回未匹配流水与候选配对', async () => {
    await addTransaction(bankId, 'expense', '500.00', '2026-03-01T02:00:00.000Z', '转出到现金');
    await addTransaction(cashId, 'income', '500.00', '2026-03-01T02:00:00.000Z', '从工资卡转入');

    const res = await app.inject({
      method: 'GET',
      url: '/api/transactions/unmatched',
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.transactions).toHaveLength(2);
    expect(res.json().data.candidates).toHaveLength(1);
    expect(res.json().data.candidates[0].score).toBeGreaterThan(0);
  });

  it('金额不同的流水不成为候选', async () => {
    await addTransaction(bankId, 'expense', '500.00', '2026-03-01T02:00:00.000Z', '转出');
    await addTransaction(cashId, 'income', '400.00', '2026-03-01T02:00:00.000Z', '转入');

    const res = await app.inject({ method: 'GET', url: '/api/transactions/unmatched', headers: auth(token) });
    expect(res.json().data.candidates).toHaveLength(0);
  });

  it('日期相差超过 3 天不成为候选', async () => {
    await addTransaction(bankId, 'expense', '500.00', '2026-03-01T02:00:00.000Z', '转出');
    await addTransaction(cashId, 'income', '500.00', '2026-03-10T02:00:00.000Z', '转入');

    const res = await app.inject({ method: 'GET', url: '/api/transactions/unmatched', headers: auth(token) });
    expect(res.json().data.candidates).toHaveLength(0);
  });
});

describe('匹配为转账', () => {
  it('匹配后余额不变且不计入收支', async () => {
    const outId = await addTransaction(bankId, 'expense', '500.00', '2026-03-01T02:00:00.000Z', '转出到现金');
    const inId = await addTransaction(cashId, 'income', '500.00', '2026-03-01T02:00:00.000Z', '从工资卡转入');

    const beforeBank = await balanceOf(bankId);
    const beforeCash = await balanceOf(cashId);

    const res = await app.inject({
      method: 'POST',
      url: '/api/transfers/match',
      headers: auth(token),
      payload: { transactionIdA: outId, transactionIdB: inId },
    });

    expect(res.statusCode).toBe(201);
    const transferId = res.json().data.transferId;

    expect(await balanceOf(bankId)).toBeCloseTo(beforeBank, 2);
    expect(await balanceOf(cashId)).toBeCloseTo(beforeCash, 2);

    const transfer = await app.prisma.transaction.findUniqueOrThrow({
      where: { id: transferId },
      include: { entries: true },
    });
    expect(transfer.type).toBe('transfer');
    expect(transfer.entries).toHaveLength(2);

    const sum = transfer.entries.reduce((acc, entry) => acc + Number(entry.amount.toString()), 0);
    expect(sum).toBeCloseTo(0, 6);

    // 原交易被冲正并标记
    const originals = await app.prisma.transaction.findMany({ where: { id: { in: [outId, inId] } } });
    for (const tx of originals) {
      expect(tx.status).toBe('voided');
      expect(tx.note).toContain('已匹配为转账');
    }

    // Dashboard 的现金流不应把转账算作支出或收入
    const cashflow = await app.inject({
      method: 'GET',
      url: '/api/dashboard/cashflow?from=2026-03-01&to=2026-03-31',
      headers: auth(token),
    });
    expect(Number(cashflow.json().data.totalExpense)).toBeCloseTo(0, 2);
    expect(Number(cashflow.json().data.totalIncome)).toBeCloseTo(0, 2);
  });

  it('金额不一致时拒绝', async () => {
    const outId = await addTransaction(bankId, 'expense', '500.00', '2026-03-01T02:00:00.000Z', '转出');
    const inId = await addTransaction(cashId, 'income', '450.00', '2026-03-01T02:00:00.000Z', '转入');

    const res = await app.inject({
      method: 'POST',
      url: '/api/transfers/match',
      headers: auth(token),
      payload: { transactionIdA: outId, transactionIdB: inId },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('TRANSFER_MATCH_INVALID');
  });

  it('同一账户的两条交易拒绝', async () => {
    const outId = await addTransaction(bankId, 'expense', '500.00', '2026-03-01T02:00:00.000Z', '转出');
    const inId = await addTransaction(bankId, 'income', '500.00', '2026-03-01T02:00:00.000Z', '转入');

    const res = await app.inject({
      method: 'POST',
      url: '/api/transfers/match',
      headers: auth(token),
      payload: { transactionIdA: outId, transactionIdB: inId },
    });

    expect(res.statusCode).toBe(422);
  });

  it('方向相同拒绝', async () => {
    const a = await addTransaction(bankId, 'expense', '500.00', '2026-03-01T02:00:00.000Z', '转出');
    const b = await addTransaction(cashId, 'expense', '500.00', '2026-03-01T02:00:00.000Z', '也转出');

    const res = await app.inject({
      method: 'POST',
      url: '/api/transfers/match',
      headers: auth(token),
      payload: { transactionIdA: a, transactionIdB: b },
    });

    expect(res.statusCode).toBe(422);
  });

  it('他人交易一律 404', async () => {
    const outId = await addTransaction(bankId, 'expense', '500.00', '2026-03-01T02:00:00.000Z', '转出');
    const inId = await addTransaction(cashId, 'income', '500.00', '2026-03-01T02:00:00.000Z', '转入');

    const other = await createUser(app, DOMAIN, 'matchother');
    const res = await app.inject({
      method: 'POST',
      url: '/api/transfers/match',
      headers: auth(other.token),
      payload: { transactionIdA: outId, transactionIdB: inId },
    });

    expect(res.statusCode).toBe(404);
  });

  it('已冲正交易不能匹配', async () => {
    const outId = await addTransaction(bankId, 'expense', '500.00', '2026-03-01T02:00:00.000Z', '转出');
    const inId = await addTransaction(cashId, 'income', '500.00', '2026-03-01T02:00:00.000Z', '转入');

    await app.inject({ method: 'DELETE', url: `/api/transactions/${outId}`, headers: auth(token) });

    const res = await app.inject({
      method: 'POST',
      url: '/api/transfers/match',
      headers: auth(token),
      payload: { transactionIdA: outId, transactionIdB: inId },
    });

    expect(res.statusCode).toBe(409);
  });
});

describe('解除匹配', () => {
  it('解除后生成两条新流水，转账被冲正', async () => {
    const outId = await addTransaction(bankId, 'expense', '500.00', '2026-03-01T02:00:00.000Z', '转出到现金');
    const inId = await addTransaction(cashId, 'income', '500.00', '2026-03-01T02:00:00.000Z', '从工资卡转入');

    const matched = await app.inject({
      method: 'POST',
      url: '/api/transfers/match',
      headers: auth(token),
      payload: { transactionIdA: outId, transactionIdB: inId },
    });
    const transferId = matched.json().data.transferId;

    const beforeBank = await balanceOf(bankId);
    const beforeCash = await balanceOf(cashId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/transfers/${transferId}/unmatch`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    const created = res.json().data.created as string[];
    expect(created).toHaveLength(2);

    // 余额维持不变
    expect(await balanceOf(bankId)).toBeCloseTo(beforeBank, 2);
    expect(await balanceOf(cashId)).toBeCloseTo(beforeCash, 2);

    const transfer = await app.prisma.transaction.findUniqueOrThrow({ where: { id: transferId } });
    expect(transfer.status).toBe('voided');

    const rebuilt = await app.prisma.transaction.findMany({ where: { id: { in: created } }, include: { entries: true } });
    expect(rebuilt).toHaveLength(2);
    for (const tx of rebuilt) {
      expect(tx.status).toBe('posted');
      expect(tx.description.startsWith('解除匹配：')).toBe(true);
      expect(tx.entries).toHaveLength(2);
    }

    // 新流水恢复计入收支
    const cashflow = await app.inject({
      method: 'GET',
      url: '/api/dashboard/cashflow?from=2026-03-01&to=2026-03-31',
      headers: auth(token),
    });
    expect(Number(cashflow.json().data.totalExpense)).toBeCloseTo(500, 2);
    expect(Number(cashflow.json().data.totalIncome)).toBeCloseTo(500, 2);
  });

  it('重复解除匹配返回 409', async () => {
    const outId = await addTransaction(bankId, 'expense', '500.00', '2026-03-01T02:00:00.000Z', '转出');
    const inId = await addTransaction(cashId, 'income', '500.00', '2026-03-01T02:00:00.000Z', '转入');

    const matched = await app.inject({
      method: 'POST',
      url: '/api/transfers/match',
      headers: auth(token),
      payload: { transactionIdA: outId, transactionIdB: inId },
    });
    const transferId = matched.json().data.transferId;

    await app.inject({ method: 'POST', url: `/api/transfers/${transferId}/unmatch`, headers: auth(token) });
    const res = await app.inject({ method: 'POST', url: `/api/transfers/${transferId}/unmatch`, headers: auth(token) });

    expect(res.statusCode).toBe(409);
  });
});
