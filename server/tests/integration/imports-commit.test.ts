import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('importcommit');

let app: FastifyInstance;
let token: string;
let accountId: string;

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

  const res = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    headers: auth(token),
    payload: {
      name: '导入提交账户',
      type: 'bank',
      currency: 'CNY',
      openingBalance: '10000.00',
      openingBalanceDate: '2026-01-01',
    },
  });
  accountId = res.json().data.account.id;
});

const MAPPING = {
  occurredAt: 0,
  amountMode: 'signed',
  amount: 1,
  description: 2,
  externalId: 3,
  dateFormat: 'YYYY-MM-DD',
};

function multipartBody(filename: string, content: string) {
  const boundary = '----commitTest' + Math.random().toString(36).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      'Content-Type: text/csv\r\n\r\n',
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    headers: { ...auth(token), 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, Buffer.from(content, 'utf8'), tail]),
  };
}

const CSV = [
  '日期,金额,摘要,流水号',
  '2026-03-01,-123.45,午餐支出,R0001',
  '2026-03-02,1200.00,工资收入,R0002',
  '',
].join('\n');

async function prepareBatch(content = CSV) {
  const body = multipartBody('statement.csv', content);
  const uploaded = await app.inject({
    method: 'POST',
    url: `/api/imports/upload?accountId=${accountId}`,
    headers: body.headers,
    payload: body.payload,
  });

  if (uploaded.statusCode !== 201) throw new Error(`上传失败 ${uploaded.statusCode} ${uploaded.body}`);
  const batchId = uploaded.json().data.batch.id;

  await app.inject({
    method: 'PATCH',
    url: `/api/imports/${batchId}/mapping`,
    headers: auth(token),
    payload: { mapping: MAPPING },
  });

  const validated = await app.inject({
    method: 'POST',
    url: `/api/imports/${batchId}/validate`,
    headers: auth(token),
  });

  if (validated.statusCode !== 200) throw new Error(`校验失败 ${validated.statusCode} ${validated.body}`);
  return { batchId, validated: validated.json().data };
}

function commit(batchId: string, key = 'idem-key-1') {
  return app.inject({
    method: 'POST',
    url: `/api/imports/${batchId}/commit`,
    headers: { ...auth(token), 'idempotency-key': key },
  });
}

describe('提交', () => {
  it('提交后写入交易与分录，余额正确', async () => {
    const { batchId } = await prepareBatch();

    const res = await commit(batchId);
    expect(res.statusCode).toBe(201);
    expect(res.json().data.importedRows).toBe(2);

    const transactions = await app.prisma.transaction.findMany({
      where: { importBatchId: batchId },
      include: { entries: true },
    });
    expect(transactions).toHaveLength(2);

    for (const tx of transactions) {
      const sum = tx.entries.reduce((acc, entry) => acc + Number(entry.amount.toString()), 0);
      expect(sum).toBeCloseTo(0, 6);
      expect(tx.source).toBe('import');
    }

    const balance = await app.inject({ method: 'GET', url: `/api/accounts/${accountId}/balance`, headers: auth(token) });
    // 10000 - 123.45 + 1200
    expect(Number(balance.json().data.balance)).toBeCloseTo(11076.55, 2);
  });

  it('缺少 Idempotency-Key 时拒绝', async () => {
    const { batchId } = await prepareBatch();

    const res = await app.inject({
      method: 'POST',
      url: `/api/imports/${batchId}/commit`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(400);
  });

  it('同一幂等键重复提交只入账一次', async () => {
    const { batchId } = await prepareBatch();

    const first = await commit(batchId, 'same-key');
    expect(first.statusCode).toBe(201);

    const second = await commit(batchId, 'same-key');
    expect(second.statusCode).toBe(200);
    expect(second.json().data.importedRows).toBe(first.json().data.importedRows);

    const count = await app.prisma.transaction.count({ where: { importBatchId: batchId } });
    expect(count).toBe(2);
  });

  it('已完成批次再次提交换幂等键返回 409', async () => {
    const { batchId } = await prepareBatch();
    await commit(batchId, 'key-a');

    const res = await commit(batchId, 'key-b');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('IMPORT_STATE_CONFLICT');
  });

  it('重复导入同一文件被拒绝', async () => {
    const { batchId } = await prepareBatch();
    await commit(batchId);

    const body = multipartBody('statement.csv', CSV);
    const res = await app.inject({
      method: 'POST',
      url: `/api/imports/upload?accountId=${accountId}`,
      headers: body.headers,
      payload: body.payload,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('IMPORT_ALREADY_UPLOADED');
  });

  it('精确重复行被标记且不重复入账', async () => {
    const { batchId } = await prepareBatch();
    await commit(batchId);

    // 同一笔交易换个文件名重新导入，指纹相同
    const body = multipartBody('again.csv', CSV);
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/imports/upload?accountId=${accountId}&force=true`,
      headers: body.headers,
      payload: body.payload,
    });
    expect(uploaded.statusCode).toBe(201);
    const secondBatch = uploaded.json().data.batch.id;

    await app.inject({
      method: 'PATCH',
      url: `/api/imports/${secondBatch}/mapping`,
      headers: auth(token),
      payload: { mapping: MAPPING },
    });

    const validated = await app.inject({
      method: 'POST',
      url: `/api/imports/${secondBatch}/validate`,
      headers: auth(token),
    });

    expect(validated.json().data.batch.counts.duplicate).toBe(2);
    expect(validated.json().data.batch.counts.valid).toBe(0);
    expect(validated.json().data.batch.status).toBe('failed');
  });
});

describe('撤销', () => {
  it('撤销后余额回退且指纹被释放', async () => {
    const { batchId } = await prepareBatch();
    await commit(batchId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/imports/${batchId}/rollback`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.voided).toBe(2);

    const balance = await app.inject({ method: 'GET', url: `/api/accounts/${accountId}/balance`, headers: auth(token) });
    expect(Number(balance.json().data.balance)).toBeCloseTo(10000, 2);

    const released = await app.prisma.transaction.count({
      where: { importBatchId: batchId, importFingerprint: null },
    });
    expect(released).toBe(2);
  });

  it('撤销后可以重新导入同一文件', async () => {
    const { batchId } = await prepareBatch();
    await commit(batchId);

    await app.inject({ method: 'POST', url: `/api/imports/${batchId}/rollback`, headers: auth(token) });

    const body = multipartBody('statement.csv', CSV);
    const res = await app.inject({
      method: 'POST',
      url: `/api/imports/upload?accountId=${accountId}`,
      headers: body.headers,
      payload: body.payload,
    });

    expect(res.statusCode).toBe(201);
  });

  it('交易被手工修改后阻止撤销', async () => {
    const { batchId } = await prepareBatch();
    await commit(batchId);

    const tx = await app.prisma.transaction.findFirstOrThrow({ where: { importBatchId: batchId } });
    await app.prisma.transaction.update({
      where: { id: tx.id },
      data: { note: '手工补充备注', version: { increment: 1 } },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/imports/${batchId}/rollback`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('IMPORT_ROLLBACK_BLOCKED');
    expect(res.json().error.details.blockedTransactions.length).toBeGreaterThan(0);
  });

  it('未完成批次不能撤销', async () => {
    const { batchId } = await prepareBatch();

    const res = await app.inject({
      method: 'POST',
      url: `/api/imports/${batchId}/rollback`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(409);
  });
});

describe('重复确认', () => {
  it('疑似重复未确认时提交被拒绝', async () => {
    // 先手工记一笔支出
    await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: auth(token),
      payload: {
        type: 'expense',
        occurredAt: '2026-03-01T02:00:00.000Z',
        description: '手工记录的午餐',
        amount: '123.45',
        accountId,
      },
    });

    const csv = '日期,金额,摘要,流水号\n2026-03-01,-123.45,银行账单午餐,B0001\n';
    const { batchId, validated } = await prepareBatch(csv);

    expect(validated.batch.counts.suspected).toBe(1);
    expect(validated.batch.counts.valid).toBe(0);

    // 校验后没有有效行 → failed，提交应被拒
    const res = await commit(batchId, 'susp-key');
    expect(res.statusCode).toBe(409);
  });

  it('确认保留后可以提交', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: auth(token),
      payload: {
        type: 'expense',
        occurredAt: '2026-03-01T02:00:00.000Z',
        description: '手工记录的午餐',
        amount: '123.45',
        accountId,
      },
    });

    const { batchId } = await prepareBatch('日期,金额,摘要,流水号\n2026-03-01,-123.45,银行账单午餐,B0001\n');

    // 直接把疑似行设为 valid：模拟用户在确认弹窗中选择「保留」
    await app.prisma.importRow.updateMany({ where: { batchId, status: 'suspected' }, data: { status: 'valid' } });
    await app.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'validated' } });

    const res = await commit(batchId, 'keep-key');
    expect(res.statusCode).toBe(201);
    expect(res.json().data.importedRows).toBe(1);
  });
});

describe('错误导出', () => {
  it('导出 CSV 含 BOM 且公式前缀被转义', async () => {
    const csv = [
      '日期,金额,摘要,流水号',
      '2026-03-01,abc,=SUM(A1),R1',
      '2026-02-30,-10.00,@危险内容,R2',
      '',
    ].join('\n');

    const body = multipartBody('bad.csv', csv);
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/imports/upload?accountId=${accountId}`,
      headers: body.headers,
      payload: body.payload,
    });
    const batchId = uploaded.json().data.batch.id;

    await app.inject({
      method: 'PATCH',
      url: `/api/imports/${batchId}/mapping`,
      headers: auth(token),
      payload: { mapping: MAPPING },
    });
    await app.inject({ method: 'POST', url: `/api/imports/${batchId}/validate`, headers: auth(token) });

    const res = await app.inject({
      method: 'GET',
      url: `/api/imports/${batchId}/errors/export`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body.charCodeAt(0)).toBe(0xfeff);

    // 原始值中的 = 与 @ 前缀被加上单引号，防止 Excel 执行公式
    expect(res.body).toContain("'=SUM(A1)");
    expect(res.body).toContain("'@危险内容");
  });
});
