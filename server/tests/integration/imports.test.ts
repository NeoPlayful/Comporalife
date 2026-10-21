import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('imports');

let app: FastifyInstance;
let token: string;
let userId: string;
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
  userId = user.userId;

  const res = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    headers: auth(token),
    payload: {
      name: '导入测试账户',
      type: 'bank',
      currency: 'CNY',
      openingBalance: '10000.00',
      openingBalanceDate: '2026-01-01',
    },
  });
  accountId = res.json().data.account.id;
});

/** 构造 multipart 请求体，避免依赖表单库 */
function multipartBody(filename: string, content: Buffer | string) {
  const boundary = '----compTestBoundary' + Math.random().toString(36).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n',
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const fileBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');

  return {
    headers: {
      ...auth(token),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([head, fileBuffer, tail]),
  };
}

const BASIC_CSV = [
  '日期,金额,币种,摘要,对方户名,流水号,余额',
  '2026-03-01,-123.45,CNY,午餐支出,示例餐厅,REF0001,9876.55',
  '2026-03-02,1200.00,CNY,工资收入,示例公司,REF0002,11076.55',
  '',
].join('\n');

async function upload(content: string | Buffer = BASIC_CSV, filename = 'statement.csv') {
  const body = multipartBody(filename, content);
  return app.inject({
    method: 'POST',
    url: `/api/imports/upload?accountId=${accountId}`,
    headers: body.headers,
    payload: body.payload,
  });
}

const MAPPING = {
  occurredAt: 0,
  amountMode: 'signed',
  amount: 1,
  currency: 2,
  description: 3,
  merchant: 4,
  externalId: 5,
  balanceAfter: 6,
  dateFormat: 'YYYY-MM-DD',
};

describe('上传', () => {
  it('上传 CSV 后批次为 parsed 并写入行记录', async () => {
    const res = await upload();
    expect(res.statusCode).toBe(201);

    const data = res.json().data;
    expect(data.batch.status).toBe('parsed');
    expect(data.parsed.headers).toEqual(['日期', '金额', '币种', '摘要', '对方户名', '流水号', '余额']);
    expect(data.parsed.totalRows).toBe(2);

    const rows = await app.prisma.importRow.findMany({ where: { batchId: data.batch.id } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.raw).toMatchObject({ 摘要: '午餐支出' });
  });

  it('扩展名与内容不符时拒绝', async () => {
    const res = await upload(BASIC_CSV, 'statement.xlsx');
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('IMPORT_FORMAT_UNSUPPORTED');
  });

  it('不支持的扩展名被拒绝', async () => {
    const res = await upload(BASIC_CSV, 'statement.pdf');
    expect(res.statusCode).toBe(415);
  });

  it('归档账户不能上传', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/accounts/${accountId}/archive`,
      headers: auth(token),
    });

    const res = await upload();
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ACCOUNT_ARCHIVED');
  });

  it('他人账户上传返回 404', async () => {
    const other = await createUser(app, DOMAIN, 'other');
    const otherAccount = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: auth(other.token),
      payload: {
        name: '他人账户',
        type: 'bank',
        currency: 'CNY',
        openingBalance: '0',
        openingBalanceDate: '2026-01-01',
      },
    });

    const body = multipartBody('statement.csv', BASIC_CSV);
    const res = await app.inject({
      method: 'POST',
      url: `/api/imports/upload?accountId=${otherAccount.json().data.account.id}`,
      headers: body.headers,
      payload: body.payload,
    });

    expect(res.statusCode).toBe(404);
  });

  it('超出大小上限被拒绝', async () => {
    const huge = 'x'.repeat(11 * 1024 * 1024);
    const res = await upload(huge, 'big.csv');
    expect([413, 415]).toContain(res.statusCode);
  });

  it('空文件被拒绝', async () => {
    const res = await upload('日期,金额\n', 'empty.csv');
    expect(res.statusCode).toBe(422);
  });
});

describe('映射与校验', () => {
  it('保存映射后批次为 mapped，行被规范化', async () => {
    const created = (await upload()).json().data;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/imports/${created.batch.id}/mapping`,
      headers: auth(token),
      payload: { mapping: MAPPING },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.batch.status).toBe('mapped');

    const rows = await app.prisma.importRow.findMany({
      where: { batchId: created.batch.id },
      orderBy: { rowNumber: 'asc' },
    });

    expect(rows[0]!.amount?.toString()).toBe('-123.45');
    expect(rows[0]!.direction).toBe('expense');
    expect(rows[1]!.direction).toBe('income');
    expect(rows[0]!.fingerprint).toHaveLength(64);
  });

  it('缺少必填映射时返回 422', async () => {
    const created = (await upload()).json().data;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/imports/${created.batch.id}/mapping`,
      headers: auth(token),
      payload: { mapping: { occurredAt: 0, amountMode: 'signed', dateFormat: 'YYYY-MM-DD' } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('列索引越界时返回 422', async () => {
    const created = (await upload()).json().data;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/imports/${created.batch.id}/mapping`,
      headers: auth(token),
      payload: { mapping: { ...MAPPING, description: 99 } },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('IMPORT_MAPPING_INVALID');
  });

  it('校验后进入 validated 并统计有效行', async () => {
    const created = (await upload()).json().data;

    await app.inject({
      method: 'PATCH',
      url: `/api/imports/${created.batch.id}/mapping`,
      headers: auth(token),
      payload: { mapping: MAPPING },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/imports/${created.batch.id}/validate`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.batch.status).toBe('validated');
    expect(data.batch.counts.valid).toBe(2);
    expect(data.batch.counts.invalid).toBe(0);
  });

  it('全部行无效时批次进入 failed', async () => {
    const csv = '日期,金额,摘要\n2026-02-30,-10.00,非法日期\nbogus,abc,全错\n';
    const created = (await upload(csv)).json().data;

    await app.inject({
      method: 'PATCH',
      url: `/api/imports/${created.batch.id}/mapping`,
      headers: auth(token),
      payload: {
        mapping: { occurredAt: 0, amountMode: 'signed', amount: 1, description: 2, dateFormat: 'YYYY-MM-DD' },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/imports/${created.batch.id}/validate`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.batch.status).toBe('failed');
    expect(res.json().data.batch.counts.invalid).toBe(2);
  });

  it('未映射即校验返回 409', async () => {
    const created = (await upload()).json().data;

    const res = await app.inject({
      method: 'POST',
      url: `/api/imports/${created.batch.id}/validate`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('IMPORT_NOT_READY');
  });
});

describe('状态机与访问控制', () => {
  it('取消批次后可查看到 cancelled 状态', async () => {
    const created = (await upload()).json().data;

    const res = await app.inject({
      method: 'POST',
      url: `/api/imports/${created.batch.id}/cancel`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/imports/${created.batch.id}`,
      headers: auth(token),
    });
    expect(detail.json().data.batch.status).toBe('cancelled');
    expect(detail.json().data.actions).toEqual([]);
  });

  it('已取消批次不能再次取消', async () => {
    const created = (await upload()).json().data;

    await app.inject({
      method: 'POST',
      url: `/api/imports/${created.batch.id}/cancel`,
      headers: auth(token),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/imports/${created.batch.id}/cancel`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('IMPORT_STATE_CONFLICT');
  });

  it('他人批次一律 404', async () => {
    const created = (await upload()).json().data;
    const other = await createUser(app, DOMAIN, 'other2');

    for (const [method, url] of [
      ['GET', `/api/imports/${created.batch.id}`],
      ['GET', `/api/imports/${created.batch.id}/preview`],
      ['GET', `/api/imports/${created.batch.id}/rows`],
      ['POST', `/api/imports/${created.batch.id}/cancel`],
    ] as const) {
      const res = await app.inject({ method, url, headers: auth(other.token) });
      expect(res.statusCode).toBe(404);
    }
  });

  it('列表只返回自己的批次', async () => {
    await upload();
    const other = await createUser(app, DOMAIN, 'other3');

    const res = await app.inject({ method: 'GET', url: '/api/imports', headers: auth(other.token) });
    expect(res.json().data.batches).toHaveLength(0);
  });
});

describe('预览与错误汇总', () => {
  it('预览返回分页行与规范化金额', async () => {
    const created = (await upload()).json().data;

    await app.inject({
      method: 'PATCH',
      url: `/api/imports/${created.batch.id}/mapping`,
      headers: auth(token),
      payload: { mapping: MAPPING },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/imports/${created.batch.id}/preview`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.rows).toHaveLength(2);
    expect(res.json().data.rows[0].amount).toBe('-123.450000');
  });

  it('错误汇总按错误码分组', async () => {
    const csv = '日期,金额,摘要\n2026-02-30,-10.00,非法日期\n2026-03-01,abc,金额错\n';
    const created = (await upload(csv)).json().data;

    await app.inject({
      method: 'PATCH',
      url: `/api/imports/${created.batch.id}/mapping`,
      headers: auth(token),
      payload: {
        mapping: { occurredAt: 0, amountMode: 'signed', amount: 1, description: 2, dateFormat: 'YYYY-MM-DD' },
      },
    });

    await app.inject({
      method: 'POST',
      url: `/api/imports/${created.batch.id}/validate`,
      headers: auth(token),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/imports/${created.batch.id}/errors`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    const codes = res.json().data.byCode.map((item: { code: string }) => item.code);
    expect(codes).toContain('DATE_INVALID');
    expect(codes).toContain('AMOUNT_INVALID');
  });
});
