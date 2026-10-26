import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import {
  SETTING_RATE_PROVIDER,
  SETTING_RATE_SYNC_ENABLED,
  SETTING_RATE_SYNC_FREQUENCY,
} from '@/config/constants';
import { seedRateSettings } from '../../prisma/seed-rate-settings';

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

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await clearRateSettings();
  await app.close();
});

beforeEach(async () => {
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

  it('种子不写入任何汇率数值', async () => {
    await seedRateSettings(app.prisma);
    // 写死的历史汇率会因「同日人工录入优先」挡住首次自动同步，
    // 也会立刻触发偏离护栏，因此种子只种配置
    const manualRows = await app.prisma.exchangeRate.count({ where: { source: 'manual' } });
    expect(manualRows).toBe(0);
  });
});
