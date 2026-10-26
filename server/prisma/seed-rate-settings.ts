import type { PrismaClient } from '@prisma/client';
import {
  SETTING_RATE_PROVIDER,
  SETTING_RATE_SYNC_ENABLED,
  SETTING_RATE_SYNC_FREQUENCY,
} from '../src/config/constants.js';

/**
 * 汇率源的初始配置。
 *
 * 只写「还没有」的那几项，已存在的值一律不覆盖：管理员把同步关掉之后，
 * 再跑一次 seed 不应该把它悄悄打开。
 *
 * 币种目录本身不是数据库表（见 config/constants.ts），因此这里种下的是
 * 「让新装实例能自己跑起来」的配置，而不是汇率数值本身——写死的汇率一出生
 * 就过期，还会因为「同日人工录入优先」规则挡住首次自动同步。
 *
 * 抽成独立模块是为了能被集成测试直接调用：seed.ts 在导入时就会执行 main()，
 * 不能作为库导入，而复制一份逻辑到测试里等于测了个假的。
 */
export async function seedRateSettings(prisma: PrismaClient): Promise<string[]> {
  const applied: string[] = [];

  const provider = await prisma.systemSetting.findUnique({
    where: { key: SETTING_RATE_PROVIDER },
    select: { key: true },
  });
  if (!provider) {
    await prisma.systemSetting.create({
      data: {
        key: SETTING_RATE_PROVIDER,
        value: {
          // 免密钥的公开端点：新装实例不填任何凭据也能抓汇率
          provider: 'exchangerate-api',
          anchorCurrency: 'USD',
          apiKeySealed: '',
          customUrl: '',
          ratesPath: 'rates',
          datePath: '',
        },
      },
    });
    applied.push('provider');
  }

  const enabled = await prisma.systemSetting.findUnique({
    where: { key: SETTING_RATE_SYNC_ENABLED },
    select: { key: true },
  });
  if (!enabled) {
    await prisma.systemSetting.create({ data: { key: SETTING_RATE_SYNC_ENABLED, value: true } });
    applied.push('enabled');
  }

  const frequency = await prisma.systemSetting.findUnique({
    where: { key: SETTING_RATE_SYNC_FREQUENCY },
    select: { key: true },
  });
  if (!frequency) {
    await prisma.systemSetting.create({
      data: { key: SETTING_RATE_SYNC_FREQUENCY, value: 'daily' },
    });
    applied.push('frequency');
  }

  return applied;
}
