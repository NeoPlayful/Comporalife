import Decimal from 'decimal.js';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  DEFAULT_RATE_PREVIEW_CURRENCIES,
  RATE_STALE_DAYS,
  STORAGE_ANCHOR,
  SUPPORTED_CURRENCIES,
} from '../../config/constants.js';
import { rateToString, toDecimal } from '../../lib/money.js';

const DAY_MS = 86_400_000;

export const WATCHLIST_LIMIT = 50;

export type WatchlistState = 'fresh' | 'stale' | 'missing';

export interface RateNeed {
  baseCurrency: string;
  /** 自己持有的外币，不含基准币种 */
  held: string[];
}

export interface WatchlistEntry {
  from: string;
  to: string;
  rate: string | null;
  rateDate: string | null;
  source: 'manual' | 'provider' | null;
  state: WatchlistState;
  daysLag: number | null;
  /** 是否来自自己账户/资产/负债的币种需求 */
  required: boolean;
}

export interface WatchlistCandidate {
  from: string;
  to: string;
  required: boolean;
}

export interface WatchlistView {
  baseCurrency: string;
  /** false 表示当前跟随默认集合；true 表示用户自定义过 */
  custom: boolean;
  limit: number;
  entries: WatchlistEntry[];
  candidates: WatchlistCandidate[];
}

export function pairKey(from: string, to: string): string {
  return `${from}->${to}`;
}

export function splitPair(key: string): { from: string; to: string } | null {
  const [from, to] = key.split('->');
  if (!from || !to) return null;
  return { from, to };
}

/**
 * 没有外币持仓时展示的预览币种对（各自兑基准币）。
 *
 * 只用于展示与抓取范围，不参与任何折算：折算仍按实际持仓推导。
 */
export function defaultPreviewPairs(baseCurrency: string): Array<{ from: string; to: string }> {
  return DEFAULT_RATE_PREVIEW_CURRENCIES.filter(
    (code) => code !== baseCurrency && SUPPORTED_CURRENCIES.includes(code),
  ).map((code) => ({ from: code, to: baseCurrency }));
}

/** 默认自选集合：有外币持仓就看持仓，没有就看预览币种 */
export function defaultWatchlistKeys(need: RateNeed): string[] {
  const heldKeys = need.held.map((currency) => pairKey(currency, need.baseCurrency));
  if (heldKeys.length > 0) return heldKeys;
  return defaultPreviewPairs(need.baseCurrency).map((pair) => pairKey(pair.from, pair.to));
}

/**
 * 用户的汇率需求：自己持有的币种 → 基准币种。
 *
 * 折算只需要「外币 → 该用户的基准币」，且分录币种恒等于账户币种、
 * 跨币种转账已被禁，因此四类实体的币种集合就是完备的。
 */
export async function collectUserRateNeeds(
  prisma: PrismaClient,
  userId: string,
): Promise<RateNeed> {
  const [settings, accounts, portfolios, assets, liabilities] = await Promise.all([
    prisma.userSettings.findUniqueOrThrow({ where: { userId }, select: { baseCurrency: true } }),
    prisma.account.findMany({ where: { userId, status: 'active' }, select: { currency: true } }),
    prisma.portfolio.findMany({ where: { userId, status: 'active' }, select: { currency: true } }),
    prisma.asset.findMany({ where: { userId, status: 'active' }, select: { currency: true } }),
    prisma.liability.findMany({ where: { userId, status: 'active' }, select: { currency: true } }),
  ]);

  const held = new Set<string>();
  for (const row of [...accounts, ...portfolios, ...assets, ...liabilities]) {
    held.add(row.currency);
  }
  held.delete(settings.baseCurrency);

  return { baseCurrency: settings.baseCurrency, held: [...held].sort() };
}

export function readStoredPairs(value: Prisma.JsonValue | null): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * 某个用户的自选币种对（含默认预览）。
 *
 * 汇率指标页展示的是自选行情，每日抓取必须覆盖用户实际会看的列表，
 * 否则没有外币持仓的用户既看不到默认行，图表日线也永远不会增长。
 */
export function resolveWatchlistPairs(
  baseCurrency: string,
  held: string[],
  storedPairs: string[] | null,
): Array<{ from: string; to: string }> {
  const keys = storedPairs ?? defaultWatchlistKeys({ baseCurrency, held });
  return keys
    .map((key) => splitPair(key))
    .filter(
      (pair): pair is { from: string; to: string } =>
        pair !== null && isSupportedPair(pair.from, pair.to),
    );
}

function isSupportedPair(from: string, to: string): boolean {
  return (
    from !== to && SUPPORTED_CURRENCIES.includes(from) && SUPPORTED_CURRENCIES.includes(to)
  );
}

interface LatestRate {
  rate: Decimal;
  rateDate: Date;
  source: 'manual' | 'provider';
}

/**
 * 一次查询取回多个币种对的最新一条汇率，避免逐行查询在 50 行时放大成 50 次往返。
 *
 * codes 里必须包含存储锚定币（USD），否则套算交叉对时缺少分母/分子腿。
 */
async function loadLatestRates(
  prisma: PrismaClient,
  codes: string[],
  asOf: Date,
): Promise<Map<string, LatestRate>> {
  const result = new Map<string, LatestRate>();
  if (codes.length === 0) return result;

  const maxRows = await prisma.exchangeRate.groupBy({
    by: ['baseCurrency', 'quoteCurrency'],
    where: {
      baseCurrency: { in: codes },
      quoteCurrency: { in: codes },
      rateDate: { lte: asOf },
    },
    _max: { rateDate: true },
  });

  const compound = maxRows
    .filter((row) => row._max.rateDate !== null)
    .map((row) => ({
      baseCurrency: row.baseCurrency,
      quoteCurrency: row.quoteCurrency,
      rateDate: row._max.rateDate as Date,
    }));
  if (compound.length === 0) return result;

  const rows = await prisma.exchangeRate.findMany({
    where: { OR: compound },
    select: {
      baseCurrency: true,
      quoteCurrency: true,
      rate: true,
      rateDate: true,
      source: true,
    },
  });

  for (const row of rows) {
    result.set(pairKey(row.baseCurrency, row.quoteCurrency), {
      rate: toDecimal(row.rate.toString()),
      rateDate: row.rateDate,
      source: row.source,
    });
  }

  return result;
}

/** 汇率表里出现过的币种对方向，用于判断某个币种对当前是否真的能折算 */
async function loadExistingPairs(prisma: PrismaClient): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<Array<{ base_currency: string; quote_currency: string }>>`
    SELECT DISTINCT base_currency, quote_currency FROM "exchange_rates"
  `;
  return new Set(rows.map((row) => pairKey(row.base_currency, row.quote_currency)));
}

/**
 * 某币种对能否折算。
 *
 * 直接行 / 反向行任一存在即可；两边都不是 USD 时，只要两条 USD 腿齐全
 * 也能套算出来——迁移后这正是交叉对的常规情形。
 */
function isComputable(existing: Set<string>, from: string, to: string): boolean {
  if (existing.has(pairKey(from, to)) || existing.has(pairKey(to, from))) return true;
  if (from === STORAGE_ANCHOR || to === STORAGE_ANCHOR) return false;
  return (
    existing.has(pairKey(STORAGE_ANCHOR, from)) && existing.has(pairKey(STORAGE_ANCHOR, to))
  );
}

/** 按 UTC 自然日计算日期差，避免时分秒让「今天」被判成 1 天前 */
function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

interface ResolvedRate {
  rate: Decimal;
  rateDate: Date;
  source: 'manual' | 'provider';
}

/**
 * 按「直接 → 反向 → USD 套算」解析一个币种对的最新值。
 *
 * 人工直接行（迁移后唯一会出现的非 USD 直接行）优先于任何推算值：管理员
 * 录入交叉对就是为了覆盖套算结果。没有直接行时，反向行比套算值更贴近
 * 原始数据，优先取反向。
 */
function resolveEntry(
  from: string,
  to: string,
  latest: Map<string, LatestRate>,
): ResolvedRate | null {
  const direct = latest.get(pairKey(from, to));
  if (direct) {
    return { rate: direct.rate, rateDate: direct.rateDate, source: direct.source };
  }

  const inverse = latest.get(pairKey(to, from));
  if (inverse && inverse.rate.gt(0)) {
    return {
      rate: new Decimal(1).div(inverse.rate),
      rateDate: inverse.rateDate,
      source: inverse.source,
    };
  }

  if (from !== STORAGE_ANCHOR && to !== STORAGE_ANCHOR) {
    const numerator = latest.get(pairKey(STORAGE_ANCHOR, to));
    const denominator = latest.get(pairKey(STORAGE_ANCHOR, from));
    if (numerator && denominator && denominator.rate.gt(0)) {
      return {
        rate: new Decimal(numerator.rate.toString())
          .div(new Decimal(denominator.rate.toString()))
          .toDecimalPlaces(30, Decimal.ROUND_HALF_UP),
        // 套算值取两腿里较旧的日期：任一条腿过期就说明这个值不够新
        rateDate:
          numerator.rateDate.getTime() <= denominator.rateDate.getTime()
            ? numerator.rateDate
            : denominator.rateDate,
        source:
          numerator.source === 'manual' || denominator.source === 'manual'
            ? 'manual'
            : 'provider',
      };
    }
  }

  return null;
}

function buildEntry(
  from: string,
  to: string,
  required: Set<string>,
  latest: Map<string, LatestRate>,
  asOf: Date,
): WatchlistEntry {
  const resolved = resolveEntry(from, to, latest);

  if (!resolved) {
    return {
      from,
      to,
      rate: null,
      rateDate: null,
      source: null,
      state: 'missing',
      daysLag: null,
      required: required.has(from),
    };
  }

  const daysLag = Math.max(0, Math.floor((utcDay(asOf) - utcDay(resolved.rateDate)) / DAY_MS));

  return {
    from,
    to,
    rate: rateToString(resolved.rate),
    rateDate: resolved.rateDate.toISOString().slice(0, 10),
    source: resolved.source,
    state: daysLag > RATE_STALE_DAYS ? 'stale' : 'fresh',
    daysLag,
    required: required.has(from),
  };
}

/**
 * 自选汇率列表。
 *
 * 未自定义时跟随默认集合：自己持有的外币 → 基准币种。一旦用户增删过，
 * 就转为显式列表，缺失的币种对保留在列表里显示「暂无数据」，而不是悄悄消失。
 * 这只是展示偏好，任何折算逻辑都不读它。
 */
export async function getWatchlist(
  prisma: PrismaClient,
  userId: string,
  asOf: Date = new Date(),
): Promise<WatchlistView> {
  const [settings, need] = await Promise.all([
    prisma.userSettings.findUniqueOrThrow({
      where: { userId },
      select: { rateDisplayPairs: true },
    }),
    collectUserRateNeeds(prisma, userId),
  ]);

  const required = new Set(need.held);
  const stored = readStoredPairs(settings.rateDisplayPairs);
  const selectedKeys = resolveWatchlistPairs(need.baseCurrency, need.held, stored).map((pair) =>
    pairKey(pair.from, pair.to),
  );

  // 载入最新值时把存储锚定币一并带上：套算交叉对需要 USD 两条腿
  const latestCodes = new Set<string>(selectedKeys.flatMap((key) => key.split('->')));
  latestCodes.add(STORAGE_ANCHOR);

  const [existing, latest] = await Promise.all([
    loadExistingPairs(prisma),
    loadLatestRates(prisma, [...latestCodes], asOf),
  ]);

  const entries = selectedKeys.map((key) => {
    const { from, to } = splitPair(key)!;
    return buildEntry(from, to, required, latest, asOf);
  });

  const selected = new Set(selectedKeys);
  const candidateKeys = new Set<string>();

  // 可添加集合 = 当前真能折算的币种对 + 自己确实需要的币种对。
  // 前者保证「加了就能看到值」，后者保证缺失汇率的需求不会因为没有数据而无法加入。
  for (const key of existing) {
    const pair = splitPair(key);
    if (!pair || !isSupportedPair(pair.from, pair.to)) continue;
    candidateKeys.add(pairKey(pair.from, pair.to));
    candidateKeys.add(pairKey(pair.to, pair.from));
  }
  for (const currency of need.held) {
    candidateKeys.add(pairKey(currency, need.baseCurrency));
  }

  // 用户同时持有的多个外币之间的交叉对也作候选：迁移后它们靠两条 USD 腿套算，
  // 只要 isComputable 认，加进来就能看到值。不枚举全站所有交叉对，否则候选
  // 会膨胀到近千条，用户根本无从选择。
  const heldList = need.held.filter((currency) => isComputable(existing, currency, need.baseCurrency));
  for (const a of heldList) {
    for (const b of heldList) {
      if (a !== b) candidateKeys.add(pairKey(a, b));
    }
  }

  const candidates = [...candidateKeys]
    .filter((key) => !selected.has(key))
    .map((key) => {
      const { from, to } = splitPair(key)!;
      return { from, to, required: required.has(from) };
    })
    .sort(
      (a, b) =>
        Number(b.required) - Number(a.required) ||
        Number(b.to === need.baseCurrency) - Number(a.to === need.baseCurrency) ||
        a.from.localeCompare(b.from) ||
        a.to.localeCompare(b.to),
    );

  return {
    baseCurrency: need.baseCurrency,
    custom: stored !== null,
    limit: WATCHLIST_LIMIT,
    entries,
    candidates,
  };
}

async function writeWatchlist(
  prisma: PrismaClient,
  userId: string,
  pairs: string[] | null,
): Promise<void> {
  await prisma.userSettings.update({
    where: { userId },
    data: { rateDisplayPairs: pairs === null ? Prisma.JsonNull : pairs },
  });
}

export class WatchlistError extends Error {
  constructor(
    readonly code: 'RATE_PAIR_NOT_AVAILABLE' | 'RATE_WATCHLIST_FULL',
    message: string,
  ) {
    super(message);
  }
}

export async function addToWatchlist(
  prisma: PrismaClient,
  userId: string,
  from: string,
  to: string,
): Promise<WatchlistView> {
  const [settings, need] = await Promise.all([
    prisma.userSettings.findUniqueOrThrow({
      where: { userId },
      select: { rateDisplayPairs: true },
    }),
    collectUserRateNeeds(prisma, userId),
  ]);

  const stored = readStoredPairs(settings.rateDisplayPairs);
  const current = stored ?? defaultWatchlistKeys(need);
  const key = pairKey(from, to);

  // 重复添加是幂等的：按钮点两次不应该报错
  if (current.includes(key)) {
    return getWatchlist(prisma, userId);
  }

  if (current.length >= WATCHLIST_LIMIT) {
    throw new WatchlistError(
      'RATE_WATCHLIST_FULL',
      `自选汇率最多 ${WATCHLIST_LIMIT} 个币种对`,
    );
  }

  const required = need.held.includes(from);
  const existing = await loadExistingPairs(prisma);
  if (!required && !isComputable(existing, from, to)) {
    throw new WatchlistError('RATE_PAIR_NOT_AVAILABLE', '该币种对当前没有汇率数据');
  }

  await writeWatchlist(prisma, userId, [...current, key]);
  return getWatchlist(prisma, userId);
}

export async function removeFromWatchlist(
  prisma: PrismaClient,
  userId: string,
  from: string,
  to: string,
): Promise<WatchlistView> {
  const [settings, need] = await Promise.all([
    prisma.userSettings.findUniqueOrThrow({
      where: { userId },
      select: { rateDisplayPairs: true },
    }),
    collectUserRateNeeds(prisma, userId),
  ]);

  const stored = readStoredPairs(settings.rateDisplayPairs);
  const current = stored ?? defaultWatchlistKeys(need);
  const key = pairKey(from, to);

  // 删除后保存为空数组而不是 null：空列表是用户的明确选择，不能退回默认
  await writeWatchlist(
    prisma,
    userId,
    current.filter((item) => item !== key),
  );
  return getWatchlist(prisma, userId);
}

export async function resetWatchlist(
  prisma: PrismaClient,
  userId: string,
): Promise<WatchlistView> {
  await writeWatchlist(prisma, userId, null);
  return getWatchlist(prisma, userId);
}
