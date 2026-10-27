import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import {
  SETTING_RATE_PROVIDER,
  SETTING_RATE_SYNC_ENABLED,
  SETTING_RATE_SYNC_FREQUENCY,
  SUPPORTED_CURRENCIES,
} from '@/config/constants';
import { seedExchangeRates, seedRateSettings } from '../../prisma/seed-rate-settings';

let app: FastifyInstance;

async function clearRateSettings(): Promise<void> {
  await app.prisma.systemSetting.deleteMany({
    where: {
      key: {
        in: [SETTING_RATE_PROVIDER, SETTING_RATE_SYNC_ENABLED, SETTING_RATE_SYNC_FREQUENCY],
      },
    },
  });
}

/** 种子汇率固定是「USD → 其他币种」，清理只按这个方向，避免误删其他套件的数据 */
const SEEDED_QUOTES = SUPPORTED_CURRENCIES.filter((code) => code !== 'USD');

async function clearSeededRates(): Promise<void> {
  await app.prisma.exchangeRate.deleteMany({
    where: { baseCurrency: 'USD', quoteCurrency: { in: SEEDED_QUOTES } },
  });
}

async function seededRows() {
  return app.prisma.exchangeRate.findMany({
    where: { baseCurrency: 'USD', quoteCurrency: { in: SEEDED_QUOTES } },
    select: { baseCurrency: true, quoteCurrency: true, rate: true, source: true, rateDate: true },
  });
}

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await clearSeededRates();
  await clearRateSettings();
  await app.close();
});

beforeEach(async () => {
  await clearSeededRates();
  await clearRateSettings();
});

/**
 * 种子只负责「让新装实例开箱能跑」。
 *
 * 真正的风险不在写入本身，而在重跑时把管理员已经做过的决定覆盖回去，
 * 因此这里重点断言「已存在就不碰」。
 */
describe('种子：汇率源配置', () => {
  it('空库时写入免密钥数据源并开启每日同步', async () => {
    const applied = await seedRateSettings(app.prisma);
    expect(applied).toEqual(['provider', 'enabled', 'frequency']);

    const provider = await app.prisma.systemSetting.findUniqueOrThrow({
      where: { key: SETTING_RATE_PROVIDER },
    });
    expect(provider.value).toMatchObject({
      provider: 'exchangerate-api',
      anchorCurrency: 'USD',
      apiKeySealed: '',
    });

    const enabled = await app.prisma.systemSetting.findUniqueOrThrow({
      where: { key: SETTING_RATE_SYNC_ENABLED },
    });
    expect(enabled.value).toBe(true);

    const frequency = await app.prisma.systemSetting.findUniqueOrThrow({
      where: { key: SETTING_RATE_SYNC_FREQUENCY },
    });
    expect(frequency.value).toBe('daily');
  });

  it('重复执行是幂等的：第二次不再写任何一行', async () => {
    await seedRateSettings(app.prisma);
    const second = await seedRateSettings(app.prisma);
    expect(second).toEqual([]);
  });

  it('不覆盖管理员已经改过的值', async () => {
    await seedRateSettings(app.prisma);

    // 管理员改成自定义源、关掉同步、调成每周
    await app.prisma.systemSetting.update({
      where: { key: SETTING_RATE_SYNC_ENABLED },
      data: { value: false },
    });
    await app.prisma.systemSetting.update({
      where: { key: SETTING_RATE_SYNC_FREQUENCY },
      data: { value: 'weekly' },
    });
    await app.prisma.systemSetting.update({
      where: { key: SETTING_RATE_PROVIDER },
      data: {
        value: {
          provider: 'custom',
          anchorCurrency: 'EUR',
          apiKeySealed: '',
          customUrl: 'https://example.test/rates',
          ratesPath: 'rates',
          datePath: '',
        },
      },
    });

    const applied = await seedRateSettings(app.prisma);
    expect(applied).toEqual([]);

    const enabled = await app.prisma.systemSetting.findUniqueOrThrow({
      where: { key: SETTING_RATE_SYNC_ENABLED },
    });
    expect(enabled.value).toBe(false);

    const frequency = await app.prisma.systemSetting.findUniqueOrThrow({
      where: { key: SETTING_RATE_SYNC_FREQUENCY },
    });
    expect(frequency.value).toBe('weekly');

    const provider = await app.prisma.systemSetting.findUniqueOrThrow({
      where: { key: SETTING_RATE_PROVIDER },
    });
    expect(provider.value).toMatchObject({ provider: 'custom', anchorCurrency: 'EUR' });
  });

  it('本模块只种配置，不碰汇率数值', async () => {
    await seedRateSettings(app.prisma);
    // 汇率由 seedExchangeRates 单独负责，且标记为 provider 而非 manual：
    // manual 是权威值，会把首次自动同步全部跳过，汇率就永远停在初始快照上
    const manualRows = await app.prisma.exchangeRate.count({ where: { source: 'manual' } });
    expect(manualRows).toBe(0);
  });
});

describe('种子：初始汇率', () => {
  const DAY = new Date('2026-10-27T08:00:00.000Z');

  it('空库时按「USD → 其他币种」写入全部支持币种', async () => {
    const result = await seedExchangeRates(app.prisma, DAY);
    expect(result.written).toBe(SEEDED_QUOTES.length);
    expect(result.skipped).toBe(0);
    expect(result.date).toBe('2026-10-27');

    const rows = await seededRows();
    expect(rows).toHaveLength(SEEDED_QUOTES.length);
    // 方向固定：基准币美元在前，目标币在后
    expect(rows.every((row) => row.baseCurrency === 'USD')).toBe(true);
    expect(new Set(rows.map((row) => row.quoteCurrency))).toEqual(new Set(SEEDED_QUOTES));
  });

  it('按快照原值写入，不取倒数', async () => {
    await seedExchangeRates(app.prisma, DAY);
    const cny = await app.prisma.exchangeRate.findFirstOrThrow({
      where: { baseCurrency: 'USD', quoteCurrency: 'CNY' },
      select: { rate: true },
    });
    // 快照是 1 USD = 6.683751 CNY；取倒数会写成 0.1496，方向就反了
    expect(Number(cny.rate.toString())).toBeCloseTo(6.683751, 6);
  });

  it('标记为 provider 而不是 manual，避免挡住首次自动同步', async () => {
    await seedExchangeRates(app.prisma, DAY);
    const rows = await seededRows();
    // manual 是权威值：标成 manual 会让同日同步全部被跳过，汇率永远停在快照
    expect(rows.every((row) => row.source === 'provider')).toBe(true);
  });

  it('重复执行是幂等的：第二次全部跳过', async () => {
    const first = await seedExchangeRates(app.prisma, DAY);
    const second = await seedExchangeRates(app.prisma, DAY);

    expect(second.written).toBe(0);
    expect(second.skipped).toBe(first.written);
    expect(await seededRows()).toHaveLength(SEEDED_QUOTES.length);
  });

  it('不覆盖同一天已存在的人工录入', async () => {
    const rateDate = new Date('2026-10-27T00:00:00.000Z');

    await app.prisma.exchangeRate.create({
      data: { baseCurrency: 'USD', quoteCurrency: 'CNY', rate: '99', rateDate, source: 'manual' },
    });

    const result = await seedExchangeRates(app.prisma, DAY);
    // 已存在的那一行不计入写入，其余照常
    expect(result.written).toBe(SEEDED_QUOTES.length - 1);
    expect(result.skipped).toBe(1);

    const cny = await app.prisma.exchangeRate.findFirstOrThrow({
      where: { baseCurrency: 'USD', quoteCurrency: 'CNY', rateDate },
      select: { rate: true, source: true },
    });
    // Decimal 会去掉尾随零，按数值比较
    expect(Number(cny.rate.toString())).toBe(99);
    expect(cny.source).toBe('manual');
  });

  it('日期取 UTC 当天，与录入接口和 todayKey 口径一致', async () => {
    // 北京时间 10-27 01:00 对应 UTC 10-26 17:00：三处若基准不同会指向两个日子
    const result = await seedExchangeRates(app.prisma, new Date('2026-10-26T17:00:00.000Z'));
    expect(result.date).toBe('2026-10-26');

    const rows = await seededRows();
    expect(rows.every((row) => row.rateDate.toISOString().slice(0, 10) === '2026-10-26')).toBe(
      true,
    );
  });
});
