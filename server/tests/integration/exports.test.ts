import { inflateRawSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('exports');

let app: FastifyInstance;
let token: string;
let userId: string;
let bankId: string;
let expenseCategoryId: string;

interface CategoryNode {
  id: string;
  kind: string;
  children?: CategoryNode[];
}

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

async function firstCategory(kind: 'income' | 'expense'): Promise<string> {
  const res = await app.inject({ method: 'GET', url: '/api/categories', headers: auth(token) });
  const roots = res.json().data.categories as CategoryNode[];
  const match = roots.find((node) => node.kind === kind && node.children && node.children.length > 0);
  return (match?.children?.[0]?.id ?? match?.id)!;
}

async function addExpense(amount: string, occurredAt: string, description = '测试支出') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/transactions',
    headers: auth(token),
    payload: { type: 'expense', accountId: bankId, categoryId: expenseCategoryId, amount, occurredAt, description },
  });
  expect(res.statusCode).toBe(201);
}

/** 从 ZIP 缓冲中读出条目（只处理 store 与 deflate 两种模式） */
function unzip(buffer: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;

  while (offset < buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);

    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    const dataStart = nameStart + nameLength + extraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    files.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    offset = dataStart + compressedSize;
  }

  return files;
}

async function createExport(payload: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/exports',
    headers: auth(token),
    payload: { scope: 'full', ...payload },
  });
}

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.prisma.dataExport.deleteMany({ where: { user: { email: { endsWith: DOMAIN } } } });
  await cleanupUsers(app, DOMAIN);
  await app.close();
});

beforeEach(async () => {
  await app.prisma.dataExport.deleteMany({ where: { user: { email: { endsWith: DOMAIN } } } });
  await cleanupUsers(app, DOMAIN);

  const user = await createUser(app, DOMAIN);
  token = user.token;
  userId = user.userId;

  bankId = await createAccount({ name: '储蓄账户', type: 'bank', openingBalance: '50000' });
  expenseCategoryId = await firstCategory('expense');
  await addExpense('88.5', '2026-09-10', '餐饮,外卖');
});

describe('创建导出', () => {
  it('小数据量同步生成并返回 ready', async () => {
    const res = await createExport({ scope: 'ledger' });
    expect(res.statusCode).toBe(201);

    const body = res.json().data;
    expect(body.status).toBe('ready');
    expect(body.async).toBe(false);
    expect(body.rowCount).toBeGreaterThan(0);
    expect(body.expiresAt).toBeTruthy();
  });

  it('ZIP 内含清单与本域 CSV', async () => {
    const res = await createExport({ scope: 'ledger' });
    const exportId = res.json().data.exportId;

    const download = await app.inject({
      method: 'GET',
      url: `/api/exports/${exportId}/download`,
      headers: auth(token),
    });

    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toContain('application/zip');
    expect(download.headers['content-disposition']).toContain('filename*=UTF-8');

    const files = unzip(download.rawPayload);
    expect([...files.keys()]).toEqual(
      expect.arrayContaining(['manifest.json', 'accounts.csv', 'transactions.csv', 'entries.csv']),
    );

    const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8'));
    expect(manifest.schemaVersion).toBe('comporalife-export-v1');
    expect(manifest.scope).toBe('ledger');
    expect(manifest.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'original_statement_files' }),
        expect.objectContaining({ key: 'password_hash' }),
      ]),
    );
  });

  it('清单中的文件列表与实际条目一一对应', async () => {
    const res = await createExport({ scope: 'ledger' });
    const details = await app.inject({
      method: 'GET',
      url: `/api/exports/${res.json().data.exportId}`,
      headers: auth(token),
    });
    const manifest = details.json().data.export.manifest as { files: Array<{ name: string }> };

    const download = await app.inject({
      method: 'GET',
      url: `/api/exports/${res.json().data.exportId}/download`,
      headers: auth(token),
    });
    const files = [...unzip(download.rawPayload).keys()].filter((name) => name !== 'manifest.json');

    expect(files.sort()).toEqual(manifest.files.map((file) => file.name).sort());
  });

  it('导出的 CSV 带 BOM、CRLF 且公式被阻断', async () => {
    await addExpense('12', '2026-09-11', '=SUM(A1:A2)');

    const res = await createExport({ scope: 'ledger' });
    const download = await app.inject({
      method: 'GET',
      url: `/api/exports/${res.json().data.exportId}/download`,
      headers: auth(token),
    });

    const files = unzip(download.rawPayload);
    const csv = files.get('transactions.csv')!.toString('utf8');

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('\r\n');
    expect(csv).toContain("'=SUM(A1:A2)");
    expect(csv).not.toContain('\n\n');
  });

  it('区间颠倒返回 400', async () => {
    const res = await createExport({ scope: 'ledger', from: '2026-09-30', to: '2026-09-01' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('EXPORT_RANGE_INVALID');
  });

  it('区间超过上限返回 400', async () => {
    const res = await createExport({ scope: 'ledger', from: '2015-01-01', to: '2026-01-01' });
    expect(res.statusCode).toBe(400);
  });

  it('区间只裁剪账本域，清单中标注 scopeLimited', async () => {
    const res = await createExport({ scope: 'full', from: '2026-09-01', to: '2026-09-30' });
    const details = await app.inject({
      method: 'GET',
      url: `/api/exports/${res.json().data.exportId}`,
      headers: auth(token),
    });

    const manifest = details.json().data.export.manifest as {
      range: { scopeLimited: boolean; from: string; to: string };
    };

    expect(manifest.range.scopeLimited).toBe(true);
    expect(manifest.range.from).toBe('2026-09-01');
  });

  it('导出不包含原始账单文件、密码哈希与令牌', async () => {
    const res = await createExport({ scope: 'full' });
    const download = await app.inject({
      method: 'GET',
      url: `/api/exports/${res.json().data.exportId}/download`,
      headers: auth(token),
    });

    const files = unzip(download.rawPayload);
    // 清单里的 excluded 是声明「没导什么」，属于应当出现的文字；
    // 数据文件本身绝不能含凭据
    const dataFiles = [...files.entries()]
      .filter(([name]) => name !== 'manifest.json')
      .map(([name, data]) => `${name}:${data.toString('utf8')}`)
      .join('|');

    expect(dataFiles.toLowerCase()).not.toContain('password_hash');
    expect(dataFiles.toLowerCase()).not.toContain('refreshtoken');
    expect([...files.keys()].some((name) => name.endsWith('.bin'))).toBe(false);
  });

  it('导出全程只读账本与账户', async () => {
    const before = {
      transactions: await app.prisma.transaction.count({ where: { userId } }),
      entries: await app.prisma.transactionEntry.count({ where: { userId } }),
      accounts: await app.prisma.account.count({ where: { userId } }),
      balance: await app.prisma.account.findUniqueOrThrow({ where: { id: bankId }, select: { version: true } }),
    };

    await createExport({ scope: 'full' });

    expect(await app.prisma.transaction.count({ where: { userId } })).toBe(before.transactions);
    expect(await app.prisma.transactionEntry.count({ where: { userId } })).toBe(before.entries);
    expect(await app.prisma.account.count({ where: { userId } })).toBe(before.accounts);
    expect(
      (await app.prisma.account.findUniqueOrThrow({ where: { id: bankId }, select: { version: true } })).version,
    ).toBe(before.balance.version);
  });
});

describe('导出列表与下载', () => {
  it('列表按创建时间倒序', async () => {
    await createExport({ scope: 'ledger' });
    await createExport({ scope: 'settings' });

    const res = await app.inject({ method: 'GET', url: '/api/exports', headers: auth(token) });
    const items = res.json().data.exports as Array<{ createdAt: string }>;

    expect(items).toHaveLength(2);
    expect([...items.map((item) => item.createdAt)].sort().reverse()).toEqual(items.map((item) => item.createdAt));
  });

  it('按 scope 筛选', async () => {
    await createExport({ scope: 'ledger' });
    await createExport({ scope: 'settings' });

    const res = await app.inject({ method: 'GET', url: '/api/exports?scope=settings', headers: auth(token) });
    const items = res.json().data.exports as Array<{ scope: string }>;

    expect(items).toHaveLength(1);
    expect(items[0]!.scope).toBe('settings');
  });

  it('跨用户下载返回 404', async () => {
    const res = await createExport({ scope: 'ledger' });
    const other = await createUser(app, DOMAIN, 'other');

    const download = await app.inject({
      method: 'GET',
      url: `/api/exports/${res.json().data.exportId}/download`,
      headers: auth(other.token),
    });

    expect(download.statusCode).toBe(404);
    expect(download.json().error.code).toBe('EXPORT_NOT_FOUND');
  });

  it('下载写审计但不改导出记录', async () => {
    const res = await createExport({ scope: 'ledger' });
    const exportId = res.json().data.exportId;

    await app.inject({
      method: 'GET',
      url: `/api/exports/${exportId}/download`,
      headers: auth(token),
    });

    expect(await app.prisma.auditLog.count({ where: { userId, action: 'export.downloaded' } })).toBe(1);

    const after = await app.prisma.dataExport.findUniqueOrThrow({ where: { id: exportId } });
    expect(after.status).toBe('ready');
  });

  it('删除导出同时移除文件并写审计', async () => {
    const res = await createExport({ scope: 'ledger' });
    const exportId = res.json().data.exportId;

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/exports/${exportId}`,
      headers: auth(token),
    });

    expect(removed.statusCode).toBe(200);
    expect(await app.prisma.dataExport.count({ where: { id: exportId } })).toBe(0);
    expect(await app.prisma.auditLog.count({ where: { userId, action: 'export.deleted' } })).toBe(1);

    const download = await app.inject({
      method: 'GET',
      url: `/api/exports/${exportId}/download`,
      headers: auth(token),
    });
    expect(download.statusCode).toBe(404);
  });
});

describe('完整性声明', () => {
  it('manifest.completeness 与数据质量口径一致', async () => {
    const res = await createExport({ scope: 'full' });
    const details = await app.inject({
      method: 'GET',
      url: `/api/exports/${res.json().data.exportId}`,
      headers: auth(token),
    });

    const manifest = details.json().data.export.manifest as {
      completeness: { isComplete: boolean; missingMonths: string[] };
    };
    const quality = await app.inject({ method: 'GET', url: '/api/data-quality/summary', headers: auth(token) });
    const metric = quality
      .json()
      .data.metrics.find((item: { key: string }) => item.key === 'missing_months');

    if (metric.unavailableReason === null) {
      expect(manifest.completeness.missingMonths.length).toBe(metric.count);
    }
  });
});
