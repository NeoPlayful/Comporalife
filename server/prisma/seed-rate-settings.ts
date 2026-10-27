import type { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import {
  SETTING_RATE_PROVIDER,
  SETTING_RATE_SYNC_ENABLED,
  SETTING_RATE_SYNC_FREQUENCY,
  SUPPORTED_CURRENCIES,
} from '../src/config/constants.js';
import type { RateQuote } from '../src/modules/market-data/rate-provider.js';
import { validateQuotes } from '../src/modules/market-data/rate-validation.js';

/**
 * 汇率初始数据。
 *
 * 只写「还没有」的那几项，已存在的值一律不覆盖：管理员把同步关掉之后，
 * 再跑一次 seed 不应该把它悄悄打开。
 *
 * 币种目录本身不是数据库表（见 config/constants.ts），因此这里种下的是
 * 「让新装实例能自己跑起来」的配置与一份起步汇率。
 *
 * 抽成独立模块是为了能被集成测试直接调用：seed.ts 在导入时就会执行 main()，
 * 不能作为库导入，而复制一份逻辑到测试里等于测了个假的。
 */

/**
 * USD 锚定中间价快照（1 USD = rate 目标币）。
 *
 * 为什么是快照而不是「seed 时请求一次外部接口」：db:seed 可能在没有出网权限
 * 的机器上执行，把外部依赖塞进建库流程会让安装变成时好时坏。数值取自
 * 2026-10-27 的 USD 锚定牌价，只作为「出生时有个合理起点」，之后由自动同步覆盖。
 */
const USD_SNAPSHOT: Record<string, string> = {
  CNY: '6.683751',
  EUR: '0.893935',
  GBP: '0.749228',
  JPY: '157.437384',
  HKD: '7.844911',
  AUD: '1.42457',
  CAD: '1.401591',
  SGD: '1.280726',
  KRW: '1325.18618',
  CHF: '0.827067',
  TWD: '32.592411',
  NZD: '1.758677',
  SEK: '9.95282',
  NOK: '9.322995',
  DKK: '6.680612',
  INR: '95.269051',
  THB: '33.78705',
  MYR: '4.087317',
  PHP: '63.960174',
  IDR: '18148.805129',
  VND: '25831.545742',
  BRL: '5.431867',
  MXN: '18.591266',
  ZAR: '16.635521',
  TRY: '49.789815',
  AED: '3.6725',
  SAR: '3.75',
  PLN: '3.937979',
  CZK: '21.780517',
  HUF: '328.427501',
  ILS: '3.079309',
};

/** 种子汇率的锚定币：与默认数据源、默认设置一致 */
const SEED_ANCHOR = 'USD';

export interface RateSeedResult {
  written: number;
  skipped: number;
  date: string;
}

export interface SeedRateDataResult extends RateSeedResult {
  /** 本次实际写入的配置键 */
  settingsApplied: string[];
}

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

/**
 * 写入起步汇率，方向为「USD → 其他币种」。
 *
 * 快照本身就是这个方向（1 USD = rate 目标币），因此直接落库，不再换算。
 * 读侧 resolveRate 支持反向取倒数，所以基准币不是美元的用户照样能折算。
 *
 * 幂等：同一天同一币种对已存在就跳过，重复执行 db:seed 不会堆积重复行，
 * 也不会把管理员当天手工改过的值改回去。
 *
 * 标记 source=provider 而不是 manual：manual 是权威值，自动同步永远不会覆盖，
 * 把这些初始值标成 manual 会让首次同步整体跳过，汇率永远停在快照那一天。
 *
 * 日期取 UTC 当天，与 todayKey() 及录入接口口径一致——三处用不同基准会让
 * 「今天的汇率」在界面和数据里指向两个不同的日子。
 */
export async function seedExchangeRates(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<RateSeedResult> {
  const date = now.toISOString().slice(0, 10);
  const rateDate = new Date(`${date}T00:00:00.000Z`);

  // 快照里只保留当前支持的币种：目录收缩后残留的键用户根本选不到，纯属噪音
  const quotes: RateQuote[] = Object.entries(USD_SNAPSHOT)
    .filter(([code]) => SUPPORTED_CURRENCIES.includes(code))
    .map(([code, rate]) => ({
      base: SEED_ANCHOR,
      quote: code,
      rate: new Decimal(rate),
      date,
    }));

  // 走一遍生产校验：一个笔误（负数、零、超长整数位）应当在建库时就暴露，
  // 而不是等到第一次折算才让净值变成 NaN。previous 为空，不触发偏离护栏。
  const { accepted } = validateQuotes({
    quotes,
    asOf: date,
    previous: new Map(),
    maxDeviationPct: Number.POSITIVE_INFINITY,
  });

  const existing = await prisma.exchangeRate.findMany({
    where: {
      rateDate,
      baseCurrency: SEED_ANCHOR,
      quoteCurrency: { in: accepted.map((quote) => quote.quote) },
    },
    select: { quoteCurrency: true },
  });
  const seen = new Set(existing.map((row) => row.quoteCurrency));

  const pending = accepted.filter((quote) => !seen.has(quote.quote));
  if (pending.length > 0) {
    await prisma.exchangeRate.createMany({
      data: pending.map((quote) => ({
        baseCurrency: SEED_ANCHOR,
        quoteCurrency: quote.quote,
        rate: quote.rate.toFixed(10),
        rateDate,
        source: 'provider',
      })),
      // 并发执行 seed 时后到的一次不应因唯一约束整批失败
      skipDuplicates: true,
    });
  }

  return { written: pending.length, skipped: accepted.length - pending.length, date };
}

/** db:seed 的入口：先补配置，再补起步汇率 */
export async function seedRateData(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<SeedRateDataResult> {
  const settingsApplied = await seedRateSettings(prisma);
  const rates = await seedExchangeRates(prisma, now);
  return { ...rates, settingsApplied };
}
