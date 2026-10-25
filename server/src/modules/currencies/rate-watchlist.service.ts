import Decimal from 'decimal.js';
import { Prisma, type PrismaClient } from '@prisma/client';
import { RATE_STALE_DAYS, SUPPORTED_CURRENCIES } from '../../config/constants.js';
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

function readStoredPairs(value: Prisma.JsonValue | null): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === 'string');
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

/** 一次查询取回多个币种对的最新一条汇率，避免逐行查询在 50 行时放大成 50 次往返 */
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

function isComputable(existing: Set<string>, from: string, to: string): boolean {
  return existing.has(pairKey(from, to)) || existing.has(pairKey(to, from));
}

/** 按 UTC 自然日计算日期差，避免时分秒让「今天」被判成 1 天前 */
function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function buildEntry(
  from: string,
  to: string,
  required: Set<string>,
  latest: Map<string, LatestRate>,
  asOf: Date,
): WatchlistEntry {
  const direct = latest.get(pairKey(from, to));
  const inverse = direct ? undefined : latest.get(pairKey(to, from));
  const resolved = direct
    ? { rate: direct.rate, rateDate: direct.rateDate, source: direct.source }
    : inverse
      ? {
          rate: new Decimal(1).div(inverse.rate),
          rateDate: inverse.rateDate,
          source: inverse.source,
        }
      : null;

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

  const defaultKeys = need.held.map((currency) => pairKey(currency, need.baseCurrency));
  const selectedKeys = (stored ?? defaultKeys).filter((key) => {
    const pair = splitPair(key);
    return pair !== null && isSupportedPair(pair.from, pair.to);
  });

  const [existing, latest] = await Promise.all([
    loadExistingPairs(prisma),
    loadLatestRates(
      prisma,
      [...new Set(selectedKeys.flatMap((key) => key.split('->')))],
      asOf,
    ),
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
  const current = stored ?? need.held.map((currency) => pairKey(currency, need.baseCurrency));
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
  const current = stored ?? need.held.map((currency) => pairKey(currency, need.baseCurrency));
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
