import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, clearExchangeRates, createUser, promoteToAdmin, testDomain } from '../helpers';

const DOMAIN = testDomain('rate-history');

// 与其他汇率测试文件互不重叠的币种，避免并行执行时互相清掉全局汇率表里的数据。
// 已占用：dashboard 用 USD/CNY/EUR/JPY，rate-sync 用 GBP/AUD/CNY，
// admin-rate-views 用 HKD/CAD/KRW，rate-watchlist 用 SGD/CHF/TWD。
const A = 'NOK';
const B = 'SEK';
const C = 'DKK';

let app: FastifyInstance;
let adminToken: string;
let userToken: string;

/** 相对今天的日期串，offset 为「几天前」 */
function day(offset: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

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
}

async function history(query: string, token = userToken) {
  return app.inject({
    method: 'GET',
    url: `/api/exchange-rates/history?${query}`,
    headers: auth(token),
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
  await clearExchangeRates(app, [A, B, C]);

  const admin = await createUser(app, DOMAIN, 'admin');
  adminToken = await promoteToAdmin(app, admin.userId);

  const user = await createUser(app, DOMAIN);
  userToken = user.token;
});

describe('汇率历史：日线', () => {
  it('按日期正序返回日线序列，普通用户可读', async () => {
    await createRate(A, B, '1.11', day(2));
    await createRate(A, B, '1.12', day(1));
    await createRate(A, B, '1.13', day(0));

    const res = await history(`from=${A}&to=${B}&granularity=day&buckets=30`);
    expect(res.statusCode).toBe(200);

    const data = res.json().data;
    expect(data.granularity).toBe('day');
    expect(data.inverted).toBe(false);
    const points = data.points as Array<{ periodStart: string; rate: string; samples: number }>;
    expect(points.map((p) => p.periodStart)).toEqual([day(2), day(1), day(0)]);
    expect(points.map((p) => p.rate)).toEqual([
      '1.1100000000',
      '1.1200000000',
      '1.1300000000',
    ]);
    // 日线里每个桶只含一个日度点
    expect(points.every((p) => p.samples === 1)).toBe(true);
  });

  it('窗口外的点被排除，且按期数收窄（buckets=3 只保留最近 3 天）', async () => {
    await createRate(A, B, '1.10', day(10));
    await createRate(A, B, '1.11', day(2));
    await createRate(A, B, '1.12', day(1));
    await createRate(A, B, '1.13', day(0));

    const res = await history(`from=${A}&to=${B}&granularity=day&buckets=3`);
    const points = res.json().data.points as Array<{ periodStart: string }>;
    expect(points.map((p) => p.periodStart)).toEqual([day(2), day(1), day(0)]);
  });

  it('没有正向记录时用反向汇率的倒数，并标记 inverted', async () => {
    await createRate(B, A, '2', day(1));
    await createRate(B, A, '4', day(0));

    const res = await history(`from=${A}&to=${B}&granularity=day&buckets=30`);
    const data = res.json().data;
    expect(data.inverted).toBe(true);
    const points = data.points as Array<{ rate: string }>;
    expect(points.map((p) => p.rate)).toEqual(['0.5000000000', '0.2500000000']);
  });
});

describe('汇率历史：周期聚合（期末值）', () => {
  it('月线每桶取该月最后一个可用日的汇率，并给出样本数', async () => {
    // 2026-01 有两个点，取较晚的 01-20 作为期末值；2026-02 只有一个点
    await createRate(A, B, '10', '2026-01-05');
    await createRate(A, B, '20', '2026-01-20');
    await createRate(A, B, '30', '2026-02-10');

    // 用足够大的桶数覆盖 2026 年
    const res = await history(`from=${A}&to=${B}&granularity=month&buckets=240`);
    expect(res.statusCode).toBe(200);

    const points = res.json().data.points as Array<{
      periodStart: string;
      rate: string;
      samples: number;
    }>;
    const jan = points.find((p) => p.periodStart === '2026-01-01');
    const feb = points.find((p) => p.periodStart === '2026-02-01');

    expect(jan).toEqual({ periodStart: '2026-01-01', rate: '20.0000000000', samples: 2 });
    expect(feb).toEqual({ periodStart: '2026-02-01', rate: '30.0000000000', samples: 1 });
  });

  it('周线以周一为桶起点', async () => {
    // 2026-03-02 是周一；03-04 与 03-08(周日) 同属这一周
    await createRate(A, B, '7', '2026-03-02');
    await createRate(A, B, '8', '2026-03-08');
    await createRate(A, B, '9', '2026-03-09'); // 下一周的周一

    const res = await history(`from=${A}&to=${B}&granularity=week&buckets=520`);
    const points = res.json().data.points as Array<{ periodStart: string; rate: string }>;
    const firstWeek = points.find((p) => p.periodStart === '2026-03-02');
    const secondWeek = points.find((p) => p.periodStart === '2026-03-09');

    expect(firstWeek?.rate).toBe('8.0000000000');
    expect(secondWeek?.rate).toBe('9.0000000000');
  });

  it('季线按 1/4/7/10 月起桶', async () => {
    await createRate(A, B, '1', '2026-01-15');
    await createRate(A, B, '2', '2026-03-31');
    await createRate(A, B, '3', '2026-04-01');

    const res = await history(`from=${A}&to=${B}&granularity=quarter&buckets=80`);
    const points = res.json().data.points as Array<{ periodStart: string; rate: string }>;
    const q1 = points.find((p) => p.periodStart === '2026-01-01');
    const q2 = points.find((p) => p.periodStart === '2026-04-01');

    expect(q1?.rate).toBe('2.0000000000');
    expect(q2?.rate).toBe('3.0000000000');
  });

  it('年线按自然年聚合并取年末值', async () => {
    await createRate(A, B, '100', '2025-06-01');
    await createRate(A, B, '110', '2025-12-31');
    await createRate(A, B, '120', '2026-02-01');

    const res = await history(`from=${A}&to=${B}&granularity=year&buckets=50`);
    const points = res.json().data.points as Array<{ periodStart: string; rate: string }>;
    const y2025 = points.find((p) => p.periodStart === '2025-01-01');
    const y2026 = points.find((p) => p.periodStart === '2026-01-01');

    expect(y2025?.rate).toBe('110.0000000000');
    expect(y2026?.rate).toBe('120.0000000000');
  });

  it('空周期不补点：没有数据的月份直接缺失', async () => {
    await createRate(A, B, '1', '2026-01-10');
    await createRate(A, B, '3', '2026-03-10');

    const res = await history(`from=${A}&to=${B}&granularity=month&buckets=240`);
    const points = res.json().data.points as Array<{ periodStart: string }>;
    const starts = points.map((p) => p.periodStart);
    expect(starts).toContain('2026-01-01');
    expect(starts).toContain('2026-03-01');
    expect(starts).not.toContain('2026-02-01');
  });
});

describe('汇率历史：参数与权限', () => {
  it('没有任何数据时返回空序列', async () => {
    const res = await history(`from=${A}&to=${B}&granularity=day&buckets=30`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.points).toEqual([]);
  });

  it('缺参数返回校验错误', async () => {
    const res = await history(`from=${A}`);
    expect(res.statusCode).toBe(400);
  });

  it('非法粒度返回校验错误', async () => {
    const res = await history(`from=${A}&to=${B}&granularity=decade`);
    expect(res.statusCode).toBe(400);
  });

  it('同一币种对自身返回校验错误', async () => {
    const res = await history(`from=${A}&to=${A}`);
    expect(res.statusCode).toBe(400);
  });

  it('桶数超过上限时被钳制到该粒度的最大值', async () => {
    await createRate(A, B, '1', day(0));
    const res = await history(`from=${A}&to=${B}&granularity=day&buckets=99999`);
    expect(res.statusCode).toBe(200);
    // 日线上限 730
    expect(res.json().data.buckets).toBe(730);
  });

  it('未登录被拒绝', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/exchange-rates/history?from=${A}&to=${B}`,
    });
    expect(res.statusCode).toBe(401);
  });
});
