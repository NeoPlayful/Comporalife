import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, clearExchangeRates, createUser, promoteToAdmin, testDomain } from '../helpers';

const DOMAIN = testDomain('admin-rate-views');

// 币种刻意避开其他套件清理的集合（dashboard 用 USD/CNY/EUR/JPY，
// rate-sync 用 GBP/AUD/CNY，rate-watchlist 用 GBP/AUD/CHF/SGD）。
// 汇率表是全局的，并行执行时同币种会被别人的 clearExchangeRates 连坐删掉。
const A = 'HKD';
const B = 'CAD';
const C = 'KRW';

let app: FastifyInstance;
let adminToken: string;
let userToken: string;

async function createRate(
  baseCurrency: string,
  quoteCurrency: string,
  rate: string,
  rateDate: string,
) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/exchange-rates',
    headers: auth(adminToken),
    payload: { baseCurrency, quoteCurrency, rate, rateDate },
  });
  if (res.statusCode !== 201) {
    throw new Error(`录入汇率失败：${res.statusCode} ${res.body}`);
  }
  return res.json().data.exchangeRate.id as string;
}

/**
 * 统计是全局的：汇率表不按用户或套件隔离，并行执行的其他测试随时可能增删
 * 自己的币种对，因此「上一次请求的值 + 2」这种跨请求断言并不可靠。
 * 正确做法是断言同一响应内部成立的等式：统计不受筛选与分页影响。
 */
type Stats = { pairs: number; manual: number; provider: number; baseCurrencies: number };

async function statsFor(query = ''): Promise<{ stats: Stats; rowCount: number; total: number }> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/admin/exchange-rates/latest${query}`,
    headers: auth(adminToken),
  });
  const body = res.json().data;
  return { stats: body.stats, rowCount: body.exchangeRates.length, total: body.pagination.total };
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
  await clearExchangeRates(app, [A, B, C]);
  // 审计日志不随用户级联删除，上一轮运行留下的行会让「只写一条审计」的断言失效
  await app.prisma.auditLog.deleteMany({ where: { targetType: 'exchange_rate' } });

  const admin = await createUser(app, DOMAIN, 'admin');
  adminToken = await promoteToAdmin(app, admin.userId);

  const user = await createUser(app, DOMAIN);
  userToken = user.token;
});

describe('当前汇率视图', () => {
  it('每个币种对只返回最新一条', async () => {
    await createRate(A, B, '150.5', '2026-01-01');
    await createRate(A, B, '151.25', '2026-02-01');
    await createRate(A, C, '890', '2026-01-15');

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/exchange-rates/latest',
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const rows = res.json().data.exchangeRates as Array<{
      baseCurrency: string;
      quoteCurrency: string;
      rate: string;
      rateDate: string;
      daysLag: number;
    }>;
    const ab = rows.find((row) => row.baseCurrency === A && row.quoteCurrency === B);

    expect(ab?.rate).toBe('151.2500000000');
    expect(ab?.rateDate.slice(0, 10)).toBe('2026-02-01');
    expect(ab?.daysLag).toBeGreaterThan(0);
    // 旧记录不能出现在当前视图里
    expect(rows.filter((row) => row.baseCurrency === A && row.quoteCurrency === B)).toHaveLength(1);
  });

  it('统计在筛选之前计算，不受筛选影响', async () => {
    await createRate(A, B, '150', '2026-01-01');
    await createRate(A, C, '890', '2026-01-01');

    // 只断言单个响应内部成立的等式：并行套件随时会增删自己的行，
    // 跨两次请求比较统计值会随别人的写入漂移。
    const all = await statsFor();
    expect(all.stats.manual + all.stats.provider).toBe(all.stats.pairs);

    // 加了筛选：列表被裁剪到 1 行，但统计仍是全局口径（远大于 1）
    const filtered = await statsFor(`?base=${A}&quote=${B}`);
    expect(filtered.rowCount).toBe(1);
    expect(filtered.stats.pairs).toBeGreaterThanOrEqual(2);
    expect(filtered.stats.manual + filtered.stats.provider).toBe(filtered.stats.pairs);
  });

  it('支持按币种代码搜索与来源筛选', async () => {
    await createRate(A, B, '150', '2026-01-01');
    await createRate(A, C, '890', '2026-01-01');

    const search = await app.inject({
      method: 'GET',
      url: `/api/admin/exchange-rates/latest?q=${C.toLowerCase()}`,
      headers: auth(adminToken),
    });
    expect(search.json().data.exchangeRates).toHaveLength(1);
    expect(search.json().data.exchangeRates[0].quoteCurrency).toBe(C);

    const bySource = await app.inject({
      method: 'GET',
      url: '/api/admin/exchange-rates/latest?source=provider',
      headers: auth(adminToken),
    });
    // 人工录入的两条都归 manual，按 provider 筛不应出现它们
    const returned = bySource.json().data.exchangeRates as Array<{ baseCurrency: string }>;
    expect(returned.some((row) => row.baseCurrency === A)).toBe(false);
    // 统计仍是全局的，包含这两条人工记录
    expect(bySource.json().data.stats.manual).toBeGreaterThanOrEqual(2);
  });

  it('分页只切列表，不切统计', async () => {
    await createRate(A, B, '150', '2026-01-01');
    await createRate(A, C, '890', '2026-01-01');

    // 同一次响应内比较：每页 1 行，但统计与分页总数都是全局口径
    const paged = await statsFor('?page=1&pageSize=1');

    expect(paged.rowCount).toBe(1);
    expect(paged.total).toBe(paged.stats.pairs);
    expect(paged.total).toBeGreaterThanOrEqual(2);
  });

  it('普通用户访问当前汇率视图被拒绝', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/exchange-rates/latest',
      headers: auth(userToken),
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('搜索', () => {
  it('按币种中文名与英文名都能命中', async () => {
    await createRate(A, B, '150', '2026-01-01');

    // A = HKD（港币 / Hong Kong Dollar），B = CAD（加元 / Canadian Dollar）
    for (const query of ['港币', 'hong kong']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/exchange-rates/latest?q=${encodeURIComponent(query)}`,
        headers: auth(adminToken),
      });
      expect(res.statusCode).toBe(200);
      const rows = res.json().data.exchangeRates as Array<{ baseCurrency: string }>;
      expect(rows.some((row) => row.baseCurrency === A)).toBe(true);
    }
  });

  it('搜不到的词返回空列表，统计不受影响', async () => {
    await createRate(A, B, '150', '2026-01-01');

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/exchange-rates/latest?q=zzzznotacurrency',
      headers: auth(adminToken),
    });

    const body = res.json().data;
    expect(body.exchangeRates).toHaveLength(0);
    expect(body.stats.pairs).toBeGreaterThanOrEqual(1);
  });
});

describe('滞后统计', () => {
  it('统计里给出滞后对数与阈值', async () => {
    // 一条今天的、一条很旧的：只有后者算滞后
    await createRate(A, B, '150', new Date().toISOString().slice(0, 10));
    await createRate(A, C, '890', '2020-01-01');

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/exchange-rates/latest',
      headers: auth(adminToken),
    });

    const stats = res.json().data.stats as { stale: number; staleDays: number };
    expect(stats.staleDays).toBeGreaterThan(0);
    // 只断言本套件写入的这对旧数据一定被计入，不假设库里总数
    expect(stats.stale).toBeGreaterThanOrEqual(1);
  });
});

describe('显式来源', () => {
  it('不传 source 时人工改动仍转人工', async () => {
    const id = await createRate(A, B, '150', '2026-01-01');
    // 先伪造成自动同步写入的行
    await app.prisma.exchangeRate.update({ where: { id }, data: { source: 'provider' } });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/exchange-rates/${id}`,
      headers: auth(adminToken),
      payload: { rate: '151' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.exchangeRate.source).toBe('manual');
  });

  it('显式传 provider 可以把一行交还自动同步', async () => {
    const id = await createRate(A, B, '150', '2026-01-01');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/exchange-rates/${id}`,
      headers: auth(adminToken),
      payload: { rate: '150', source: 'provider' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.exchangeRate.source).toBe('provider');

    const row = await app.prisma.exchangeRate.findUnique({ where: { id } });
    expect(row?.source).toBe('provider');
  });

  it('拒绝无法识别的来源', async () => {
    const id = await createRate(A, B, '150', '2026-01-01');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/exchange-rates/${id}`,
      headers: auth(adminToken),
      payload: { rate: '150', source: 'automatic' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('普通用户不能改来源', async () => {
    const id = await createRate(A, B, '150', '2026-01-01');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/exchange-rates/${id}`,
      headers: auth(userToken),
      payload: { rate: '150', source: 'provider' },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('新增与覆盖', () => {
  it('同一币种对同一天再次新增时标记 replaced', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/admin/exchange-rates',
      headers: auth(adminToken),
      payload: { baseCurrency: A, quoteCurrency: B, rate: '150', rateDate: '2026-01-01' },
    });
    expect(first.json().data.replaced).toBe(false);

    const second = await app.inject({
      method: 'POST',
      url: '/api/admin/exchange-rates',
      headers: auth(adminToken),
      payload: { baseCurrency: A, quoteCurrency: B, rate: '151', rateDate: '2026-01-01' },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().data.replaced).toBe(true);
    expect(second.json().data.exchangeRate.rate).toBe('151.0000000000');
  });
});

describe('批量录入', () => {
  it('一次写入多组并返回行数', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/exchange-rates/bulk',
      headers: auth(adminToken),
      payload: {
        rateDate: '2026-02-01',
        rates: [
          { baseCurrency: A, quoteCurrency: B, rate: '150' },
          { baseCurrency: A, quoteCurrency: C, rate: '890' },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.writtenRows).toBe(2);
    expect(res.json().data.rateDate).toBe('2026-02-01');

    const count = await app.prisma.exchangeRate.count({
      where: {
        baseCurrency: A,
        quoteCurrency: { in: [B, C] },
        rateDate: new Date('2026-02-01T00:00:00.000Z'),
      },
    });
    expect(count).toBe(2);
  });

  it('批量写入的来源是人工', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/admin/exchange-rates/bulk',
      headers: auth(adminToken),
      payload: {
        rateDate: '2026-02-01',
        rates: [{ baseCurrency: A, quoteCurrency: B, rate: '150' }],
      },
    });

    const row = await app.prisma.exchangeRate.findFirst({
      where: { baseCurrency: A, quoteCurrency: B },
    });
    expect(row?.source).toBe('manual');
  });

  it('任一条非法则整批不写入', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/exchange-rates/bulk',
      headers: auth(adminToken),
      payload: {
        rateDate: '2026-03-01',
        rates: [
          { baseCurrency: A, quoteCurrency: B, rate: '150' },
          { baseCurrency: A, quoteCurrency: C, rate: '0' },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    const count = await app.prisma.exchangeRate.count({
      where: {
        baseCurrency: A,
        quoteCurrency: { in: [B, C] },
        rateDate: new Date('2026-03-01T00:00:00.000Z'),
      },
    });
    expect(count).toBe(0);
  });

  it('拒绝同一批里的重复币种对', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/exchange-rates/bulk',
      headers: auth(adminToken),
      payload: {
        rateDate: '2026-04-01',
        rates: [
          { baseCurrency: A, quoteCurrency: B, rate: '150' },
          { baseCurrency: A, quoteCurrency: B, rate: '151' },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('拒绝同币种对自身', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/exchange-rates/bulk',
      headers: auth(adminToken),
      payload: {
        rateDate: '2026-04-01',
        rates: [{ baseCurrency: A, quoteCurrency: A, rate: '1' }],
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('拒绝空批次与未来日期', async () => {
    const empty = await app.inject({
      method: 'POST',
      url: '/api/admin/exchange-rates/bulk',
      headers: auth(adminToken),
      payload: { rateDate: '2026-04-01', rates: [] },
    });
    expect(empty.statusCode).toBe(400);

    const future = await app.inject({
      method: 'POST',
      url: '/api/admin/exchange-rates/bulk',
      headers: auth(adminToken),
      payload: {
        rateDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
        rates: [{ baseCurrency: A, quoteCurrency: B, rate: '150' }],
      },
    });
    expect(future.statusCode).toBe(400);
  });

  it('批量录入写一条审计且不含数值', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/admin/exchange-rates/bulk',
      headers: auth(adminToken),
      payload: {
        rateDate: '2026-05-01',
        rates: [
          { baseCurrency: A, quoteCurrency: B, rate: '150.123456' },
          { baseCurrency: A, quoteCurrency: C, rate: '890.654321' },
        ],
      },
    });

    const logs = await app.prisma.auditLog.findMany({
      where: {
        action: 'admin.currency_rate.bulk_updated',
        metadata: { path: ['rateDate'], equals: '2026-05-01' },
      },
    });
    expect(logs).toHaveLength(1);
    const text = JSON.stringify(logs[0]?.metadata);
    expect(text).not.toContain('150.123456');
    expect(text).not.toContain('890.654321');
    expect(text).toContain(`${A}->${B}`);
  });

  it('普通用户不能批量录入', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/exchange-rates/bulk',
      headers: auth(userToken),
      payload: {
        rateDate: '2026-02-01',
        rates: [{ baseCurrency: A, quoteCurrency: B, rate: '150' }],
      },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('汇率历史', () => {
  it('按区间返回正序时间序列', async () => {
    await createRate(A, B, '148', '2026-01-01');
    await createRate(A, B, '150', '2026-02-01');
    await createRate(A, B, '152', '2026-03-01');

    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/exchange-rates/history?from=${A}&to=${B}&days=3650`,
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.inverted).toBe(false);
    const dates = (body.points as Array<{ rateDate: string }>).map((point) => point.rateDate);
    expect(dates).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  });

  it('窗口外的点被排除', async () => {
    await createRate(A, B, '148', '2020-01-01');
    await createRate(A, B, '152', new Date().toISOString().slice(0, 10));

    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/exchange-rates/history?from=${A}&to=${B}&days=7`,
      headers: auth(adminToken),
    });

    const points = res.json().data.points as Array<{ rateDate: string }>;
    expect(points).toHaveLength(1);
    expect(points[0]?.rateDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it('没有正向记录时用反向汇率的倒数', async () => {
    await createRate(B, A, '2', '2026-01-01');

    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/exchange-rates/history?from=${A}&to=${B}&days=3650`,
      headers: auth(adminToken),
    });

    const body = res.json().data;
    expect(body.inverted).toBe(true);
    expect(body.points).toHaveLength(1);
    expect(body.points[0].rate).toBe('0.5000000000');
  });

  it('缺参数时返回校验错误', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/exchange-rates/history?from=${A}`,
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(400);
  });

  it('普通用户访问汇率历史被拒绝', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/exchange-rates/history?from=${A}&to=${B}`,
      headers: auth(userToken),
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('自动同步开关', () => {
  it('管理员可读写开关，普通用户被拒绝', async () => {
    const initial = await app.inject({
      method: 'GET',
      url: '/api/admin/rate-sync/settings',
      headers: auth(adminToken),
    });
    expect(initial.statusCode).toBe(200);

    const enabled = await app.inject({
      method: 'PATCH',
      url: '/api/admin/rate-sync/settings',
      headers: auth(adminToken),
      payload: { enabled: true },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().data.enabled).toBe(true);

    const readBack = await app.inject({
      method: 'GET',
      url: '/api/admin/rate-sync/settings',
      headers: auth(adminToken),
    });
    expect(readBack.json().data.enabled).toBe(true);

    const denied = await app.inject({
      method: 'PATCH',
      url: '/api/admin/rate-sync/settings',
      headers: auth(userToken),
      payload: { enabled: false },
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe('同步频率', () => {
  it('返回当前频率与可选值', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/rate-sync/settings',
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(['hourly', 'daily', 'weekly']).toContain(body.frequency);
    expect(body.frequencies).toEqual(['hourly', 'daily', 'weekly']);
  });

  it('可以单独修改频率而不影响开关', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/admin/rate-sync/settings',
      headers: auth(adminToken),
      payload: { enabled: true },
    });

    const changed = await app.inject({
      method: 'PATCH',
      url: '/api/admin/rate-sync/settings',
      headers: auth(adminToken),
      payload: { frequency: 'hourly' },
    });

    expect(changed.statusCode).toBe(200);
    expect(changed.json().data.frequency).toBe('hourly');
    // 只改频率不应该把开关一起改掉
    expect(changed.json().data.enabled).toBe(true);

    const readBack = await app.inject({
      method: 'GET',
      url: '/api/admin/rate-sync/settings',
      headers: auth(adminToken),
    });
    expect(readBack.json().data.frequency).toBe('hourly');

    // 还原，避免影响同库上的其他用例
    await app.inject({
      method: 'PATCH',
      url: '/api/admin/rate-sync/settings',
      headers: auth(adminToken),
      payload: { frequency: 'daily' },
    });
  });

  it('拒绝无法识别的频率', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/rate-sync/settings',
      headers: auth(adminToken),
      payload: { frequency: 'every-minute' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('拒绝空对象：至少改一项', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/rate-sync/settings',
      headers: auth(adminToken),
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('普通用户不能修改频率', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/rate-sync/settings',
      headers: auth(userToken),
      payload: { frequency: 'weekly' },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('供应商状态包含调度信息', () => {
  it('返回频率与下次运行时间字段', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/market-data/providers',
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(['hourly', 'daily', 'weekly']).toContain(body.frequency);
    // 测试环境没有启动调度器，因此下次运行时间应为 null 而不是编造的时间
    expect(body.nextRunAt).toBeNull();
  });
});
