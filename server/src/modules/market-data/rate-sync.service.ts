import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { SETTING_RATE_SYNC_ENABLED } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { toDecimal } from '../../lib/money.js';
import {
  createGenericJsonProvider,
  createPresetProvider,
  todayKey,
  RateProviderError,
  type RateProvider,
} from './rate-provider.js';
import {
  getRateProviderConfig,
  isProviderUsable,
  isRateProviderAvailable,
} from './rate-provider-config.service.js';
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

/**
 * 供应商是否已配置：只暴露布尔，绝不返回地址或密钥。
 *
 * 配置可能来自数据库（后台可改）或环境变量（回退兼容），因此必须异步读。
 */
export async function isRateProviderConfigured(prisma: PrismaClient): Promise<boolean> {
  return isRateProviderAvailable(prisma);
}

export async function buildProvider(prisma: PrismaClient): Promise<RateProvider> {
  const resolved = await getRateProviderConfig(prisma);
  if (!resolved || !isProviderUsable(resolved.config)) {
    throw new RateProviderError('PROVIDER_ERROR', '未配置外部汇率源');
  }

  const { config, source } = resolved;
  if (source === 'environment') {
    // 回退路径保持原样：老部署的 RATE_PROVIDER_URL 是带 {date}/{quotes}/{key}
    // 占位符的模板，按预设的「自定义端点」构造会丢掉这些占位符与 keyParam，
    // 静默把一个能用的配置变成请求失败。
    return createGenericJsonProvider({
      urlTemplate: env.RATE_PROVIDER_URL!,
      anchorCurrency: config.anchorCurrency,
      apiKey: config.apiKey,
      keyParam: env.RATE_PROVIDER_KEY_PARAM,
      ratesPath: config.ratesPath,
      datePath: config.datePath,
      timeoutMs: env.RATE_PROVIDER_TIMEOUT_MS,
    });
  }

  return createPresetProvider(config.provider, {
    anchorCurrency: config.anchorCurrency,
    apiKey: config.apiKey,
    customUrl: config.customUrl,
    ratesPath: config.ratesPath,
    datePath: config.datePath,
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
  const [accounts, portfolios, assets, liabilities, settings] = await Promise.all([
    prisma.account.findMany({ where: { status: 'active' }, select: { currency: true } }),
    prisma.portfolio.findMany({ where: { status: 'active' }, select: { currency: true } }),
    prisma.asset.findMany({ where: { status: 'active' }, select: { currency: true } }),
    prisma.liability.findMany({ where: { status: 'active' }, select: { currency: true } }),
    prisma.userSettings.findMany({ select: { baseCurrency: true } }),
  ]);

  const baseCurrencies = [...new Set(settings.map((item) => item.baseCurrency))];
  const targets = new Set<string>();
  for (const row of [...accounts, ...portfolios, ...assets, ...liabilities]) {
    targets.add(row.currency);
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

export async function isRateSyncEnabled(prisma: PrismaClient): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: SETTING_RATE_SYNC_ENABLED },
    select: { value: true },
  });
  if (!row) return false;
  return row.value === true || row.value === 'true';
}

export async function setRateSyncEnabled(
  prisma: PrismaClient,
  enabled: boolean,
  updatedBy: string | null,
): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_RATE_SYNC_ENABLED },
    create: { key: SETTING_RATE_SYNC_ENABLED, value: enabled, updatedBy },
    update: { value: enabled, updatedBy },
  });
}

export interface RunSyncOptions {
  trigger: 'scheduled' | 'manual';
  triggeredBy?: string | null;
  /** 测试注入；默认按环境变量构造 */
  provider?: RateProvider;
  now?: () => Date;
  /**
   * 测试注入：覆盖抓取范围。
   *
   * 生产环境的范围是全站并集，但集成测试共享同一个数据库，其他套件的币种
   * 会让「写入了几行」无法稳定断言。注入后只按给定集合执行。
   */
  demand?: { targets: string[]; baseCurrencies: string[] };
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
  let errorAnchor = 'USD';
  try {
    const resolved = options.provider ? null : await getRateProviderConfig(prisma);
    if (resolved) errorAnchor = resolved.config.anchorCurrency;
    provider = options.provider ?? (await buildProvider(prisma));
  } catch (err) {
    return {
      provider: 'unknown',
      anchorCurrency: errorAnchor,
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

  const { targets, baseCurrencies } = options.demand ?? (await collectRateDemand(prisma));

  // 没有任何外币实体时不需要外部调用，也不该产生一次「失败」
  const baseSet = new Set(
    baseCurrencies.length > 0 ? baseCurrencies : [provider.anchorCurrency],
  );
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
