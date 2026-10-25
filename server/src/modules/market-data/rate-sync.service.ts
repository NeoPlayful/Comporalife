import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';
import { toDecimal } from '../../lib/money.js';
import { createGenericJsonProvider, todayKey, RateProviderError, type RateProvider } from './rate-provider.js';
import { convertToBasePairs, pairKey, validateQuotes, type RateRejectCode } from './rate-validation.js';
import type { Redis } from 'ioredis';

export interface SyncFailure {
  pair: string;
  code: RateRejectCode | string;
}

export interface SyncSummary {
  provider: string;
  anchorCurrency: string;
  status: 'succeeded' | 'partial' | 'failed' | 'skipped';
  fetchedPairs: number;
  writtenRows: number;
  skippedManual: number;
  failures: SyncFailure[];
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string;
}

const LOCK_KEY = 'rate:sync:lock';

/** 供应商是否已配置：只暴露布尔，绝不返回 URL 或密钥 */
export function isRateProviderConfigured(): boolean {
  return Boolean(env.RATE_PROVIDER_URL);
}

export function buildProvider(): RateProvider {
  if (!env.RATE_PROVIDER_URL) {
    throw new RateProviderError('PROVIDER_ERROR', '未配置外部汇率源');
  }
  return createGenericJsonProvider({
    urlTemplate: env.RATE_PROVIDER_URL,
    anchorCurrency: env.RATE_PROVIDER_ANCHOR,
    apiKey: env.RATE_PROVIDER_KEY,
    keyParam: env.RATE_PROVIDER_KEY_PARAM,
    ratesPath: env.RATE_PROVIDER_RATES_PATH,
    datePath: env.RATE_PROVIDER_DATE_PATH,
    timeoutMs: env.RATE_PROVIDER_TIMEOUT_MS,
  });
}

/**
 * 需要抓取与写入的币种需求。
 *
 * 折算只需要「外币 → 该用户的基准币」。由于分录币种恒等于账户币种、跨币种
 * 转账已被禁，四类实体的币种集合就是完备的。
 */
export async function collectRateDemand(
  prisma: PrismaClient,
): Promise<{ targets: string[]; baseCurrencies: string[] }> {
  const [accounts, portfolios, assets, liabilities, settings, approved] = await Promise.all([
    prisma.account.findMany({ where: { status: 'active' }, select: { currency: true } }),
    prisma.portfolio.findMany({ where: { status: 'active' }, select: { currency: true } }),
    prisma.asset.findMany({ where: { status: 'active' }, select: { currency: true } }),
    prisma.liability.findMany({ where: { status: 'active' }, select: { currency: true } }),
    prisma.userSettings.findMany({ select: { baseCurrency: true } }),
    prisma.ratePairRequest.findMany({ where: { status: 'approved' }, select: { baseCurrency: true, quoteCurrency: true } }),
  ]);

  const baseCurrencies = [...new Set(settings.map((item) => item.baseCurrency))];
  const targets = new Set<string>();
  for (const row of [...accounts, ...portfolios, ...assets, ...liabilities]) {
    targets.add(row.currency);
  }
  // 已批准的申请也纳入：供应商标不支持时，用户仍可看到状态提示
  for (const row of approved) {
    targets.add(row.baseCurrency);
    targets.add(row.quoteCurrency);
  }

  return { targets: [...targets].sort(), baseCurrencies: baseCurrencies.sort() };
}

/** 上一次同步后连续失败次数，用于自动停用判定 */
async function consecutiveFailures(prisma: PrismaClient, limit: number): Promise<boolean> {
  const rows = await prisma.rateSyncRun.findMany({
    where: { trigger: 'scheduled', status: { in: ['failed', 'succeeded', 'partial'] } },
    orderBy: { startedAt: 'desc' },
    take: limit,
    select: { status: true },
  });
  return rows.length >= limit && rows.every((row) => row.status === 'failed');
}

const SETTING_KEY = 'rate_sync_enabled';

export async function isRateSyncEnabled(prisma: PrismaClient): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEY }, select: { value: true } });
  if (!row) return false;
  return row.value === true || row.value === 'true';
}

export async function setRateSyncEnabled(
  prisma: PrismaClient,
  enabled: boolean,
  updatedBy: string | null,
): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: enabled, updatedBy },
    update: { value: enabled, updatedBy },
  });
}

export interface RunSyncOptions {
  trigger: 'scheduled' | 'manual';
  triggeredBy?: string | null;
  /** 测试注入；默认按环境变量构造 */
  provider?: RateProvider;
  now?: () => Date;
}

/**
 * 执行一次同步。
 *
 * 读请求路径上永远不会调用它：只由定时任务与后台手动刷新触发。
 * 抓取失败不写任何汇率行，只在运行记录里留下原因——占位行会让「缺失」变成谎言。
 */
export async function runRateSync(
  prisma: PrismaClient,
  options: RunSyncOptions,
): Promise<SyncSummary> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const asOf = todayKey(startedAt);

  let provider: RateProvider;
  try {
    provider = options.provider ?? buildProvider();
  } catch (err) {
    return {
      provider: 'unknown',
      anchorCurrency: env.RATE_PROVIDER_ANCHOR,
      status: 'failed',
      fetchedPairs: 0,
      writtenRows: 0,
      skippedManual: 0,
      failures: [],
      errorCode: err instanceof RateProviderError ? err.code : 'PROVIDER_ERROR',
      errorMessage: err instanceof Error ? err.message : '汇率源不可用',
      startedAt: startedAt.toISOString(),
      finishedAt: now().toISOString(),
    };
  }

  const run = await prisma.rateSyncRun.create({
    data: {
      triggeredBy: options.triggeredBy ?? null,
      trigger: options.trigger,
      provider: provider.name,
      anchorCurrency: provider.anchorCurrency,
      status: 'running',
      startedAt,
    },
    select: { id: true },
  });

  const { targets, baseCurrencies } = await collectRateDemand(prisma);

  // 没有任何外币实体时不需要外部调用，也不该产生一次「失败」
  const baseSet = new Set(baseCurrencies.length > 0 ? baseCurrencies : [env.RATE_PROVIDER_ANCHOR]);
  const quotesToFetch = targets.filter((target) =>
    [...baseSet].some((base) => base !== target),
  );

  if (quotesToFetch.length === 0) {
    const summary: SyncSummary = {
      provider: provider.name,
      anchorCurrency: provider.anchorCurrency,
      status: 'succeeded',
      fetchedPairs: 0,
      writtenRows: 0,
      skippedManual: 0,
      failures: [],
      errorCode: null,
      errorMessage: null,
      startedAt: startedAt.toISOString(),
      finishedAt: now().toISOString(),
    };
    await prisma.rateSyncRun.update({
      where: { id: run.id },
      data: {
        status: 'succeeded',
        finishedAt: now(),
        fetchedPairs: 0,
        writtenRows: 0,
        skippedManual: 0,
      },
    });
    return summary;
  }

  let rawQuotes;
  try {
    rawQuotes = await provider.fetch(asOf, quotesToFetch);
  } catch (err) {
    const code = err instanceof RateProviderError ? err.code : 'PROVIDER_ERROR';
    const message = err instanceof Error ? err.message.slice(0, 200) : '汇率源请求失败';
    await prisma.rateSyncRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        finishedAt: now(),
        errorCode: code,
        errorMessage: message,
      },
    });
    return {
      provider: provider.name,
      anchorCurrency: provider.anchorCurrency,
      status: 'failed',
      fetchedPairs: 0,
      writtenRows: 0,
      skippedManual: 0,
      failures: [],
      errorCode: code,
      errorMessage: message,
      startedAt: startedAt.toISOString(),
      finishedAt: now().toISOString(),
    };
  }

  // 偏离护栏要比较的对象是「供应商口径的锚定币对」，即 anchor->x，
  // 因为校验发生在换算之前。已有数据里可能只有 x->base，因此两种方向都收进来。
  const previousRows = await prisma.exchangeRate.findMany({
    select: { baseCurrency: true, quoteCurrency: true, rate: true },
    orderBy: [{ baseCurrency: 'asc' }, { quoteCurrency: 'asc' }, { rateDate: 'desc' }],
  });
  const previous = new Map<string, Decimal>();
  for (const row of previousRows) {
    const key = pairKey(row.baseCurrency, row.quoteCurrency);
    if (!previous.has(key)) previous.set(key, toDecimal(row.rate.toString()));
  }

  const validated = validateQuotes({
    quotes: rawQuotes,
    asOf,
    previous,
    maxDeviationPct: env.RATE_MAX_DEVIATION_PCT,
  });

  const failures: SyncFailure[] = validated.rejected.map((item) => ({ pair: item.pair, code: item.code }));

  let writtenRows = 0;
  let skippedManual = 0;

  for (const baseCurrency of baseSet) {
    const converted = convertToBasePairs({
      quotes: validated.accepted,
      anchor: provider.anchorCurrency,
      baseCurrency,
      targets: quotesToFetch,
    });
    failures.push(...converted.rejected.map((item) => ({ pair: item.pair, code: item.code })));

    for (const pair of converted.pairs) {
      const rateDate = new Date(`${pair.date}T00:00:00.000Z`);
      const existing = await prisma.exchangeRate.findUnique({
        where: {
          baseCurrency_quoteCurrency_rateDate: {
            baseCurrency: pair.base,
            quoteCurrency: pair.quote,
            rateDate,
          },
        },
        select: { id: true, source: true },
      });

      // 人工录入是权威值：同一天同一个键绝不覆盖
      if (existing?.source === 'manual') {
        skippedManual += 1;
        continue;
      }

      await prisma.exchangeRate.upsert({
        where: {
          baseCurrency_quoteCurrency_rateDate: {
            baseCurrency: pair.base,
            quoteCurrency: pair.quote,
            rateDate,
          },
        },
        create: {
          baseCurrency: pair.base,
          quoteCurrency: pair.quote,
          rate: pair.rate,
          rateDate,
          source: 'provider',
        },
        // 同源重抓允许刷新自己写入的行
        update: { rate: pair.rate },
      });
      writtenRows += 1;
    }
  }

  const status: SyncSummary['status'] =
    failures.length === 0
      ? 'succeeded'
      : writtenRows > 0
        ? 'partial'
        : 'failed';

  const finishedAt = now();

  await prisma.rateSyncRun.update({
    where: { id: run.id },
    data: {
      status,
      finishedAt,
      fetchedPairs: validated.accepted.length,
      writtenRows,
      skippedManual,
      failures: failures.length > 0 ? (failures as never) : undefined,
    },
  });

  return {
    provider: provider.name,
    anchorCurrency: provider.anchorCurrency,
    status,
    fetchedPairs: validated.accepted.length,
    writtenRows,
    skippedManual,
    failures,
    errorCode: null,
    errorMessage: null,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };
}

/** 单飞锁：多实例部署时只允许一个进程真正抓取 */
export async function acquireSyncLock(redis: Redis, token: string): Promise<boolean> {
  const result = await redis.set(LOCK_KEY, token, 'PX', env.RATE_SYNC_LOCK_MS, 'NX');
  return result === 'OK';
}

export async function releaseSyncLock(redis: Redis, token: string): Promise<void> {
  // 只删自己持有的锁：Lua 保证「比对 + 删除」原子
  await redis.eval(
    `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
    1,
    LOCK_KEY,
    token,
  );
}

export async function shouldAutoDisable(prisma: PrismaClient): Promise<boolean> {
  return consecutiveFailures(prisma, 3);
}
