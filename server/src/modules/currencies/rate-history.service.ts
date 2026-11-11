import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { STORAGE_ANCHOR } from '../../config/constants.js';
import { rateToString, toDecimal } from '../../lib/money.js';
import type { RateDerivation } from './rate-lookup.service.js';

export const RATE_GRANULARITIES = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type RateGranularity = (typeof RATE_GRANULARITIES)[number];

/**
 * 每档粒度的桶数上限与默认窗口。
 *
 * 上限不是拍脑袋：粒度越粗，同样的上限覆盖的时间越长，但可选的点也越稀。
 * 日线两年（730）足够看近况，周线十年（520）、月线二十年（240）、
 * 季线二十年（80）、年线五十年（50）则保证粗粒度也能拉到足够长的历史。
 */
export const RATE_GRANULARITY_LIMITS: Record<
  RateGranularity,
  { default: number; max: number }
> = {
  day: { default: 90, max: 730 },
  week: { default: 52, max: 520 },
  month: { default: 60, max: 240 },
  quarter: { default: 24, max: 80 },
  year: { default: 20, max: 50 },
};

/** 单次查询的日度原始行上限，远大于任何粒度下的桶数×每桶天数 */
const ROW_LIMIT = 20_000;

export interface RateHistoryPoint {
  /** 桶的起点日期（周期第一天），yyyy-MM-dd */
  periodStart: string;
  /** 桶内第一个可用日的汇率（开盘） */
  open: string;
  /** 桶内最高汇率 */
  high: string;
  /** 桶内最低汇率 */
  low: string;
  /** 桶内最后一个可用日的汇率（收盘），与折算口径一致 */
  rate: string;
  /** 该桶内实际有数据的日度点数 */
  samples: number;
}

export interface RateHistoryResult {
  from: string;
  to: string;
  granularity: RateGranularity;
  /** 实际生效的桶数（可能因超上限被收窄） */
  buckets: number;
  /** 整段序列是否由反向汇率的倒数求得（direct=false 的单腿倒数场景） */
  inverted: boolean;
  /** 整段序列的推导方式：直接 / 单腿倒数 / 两条 USD 腿套算 */
  derivation: RateDerivation;
  points: RateHistoryPoint[];
}

function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 给定日期落在哪个周期的第一天 */
function periodStart(date: Date, granularity: RateGranularity): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();

  switch (granularity) {
    case 'day':
      return utcDate(y, m, d);
    case 'week': {
      // 周一起算：UTC 里 0 是周日，先折成「距本周一的天数」
      const offset = (date.getUTCDay() + 6) % 7;
      return utcDate(y, m, d - offset);
    }
    case 'month':
      return utcDate(y, m, 1);
    case 'quarter':
      return utcDate(y, Math.floor(m / 3) * 3, 1);
    case 'year':
      return utcDate(y, 0, 1);
  }
}

/** 从某个周期起点前后移动 n 个周期，落在目标周期的第一天 */
function shiftPeriods(start: Date, granularity: RateGranularity, n: number): Date {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth();
  const d = start.getUTCDate();

  switch (granularity) {
    case 'day':
      return utcDate(y, m, d + n);
    case 'week':
      return utcDate(y, m, d + n * 7);
    case 'month':
      return utcDate(y, m + n, 1);
    case 'quarter':
      return utcDate(y, m + n * 3, 1);
    case 'year':
      return utcDate(y + n, 0, 1);
  }
}

/**
 * 单个币种对按粒度聚合后的走势。
 *
 * 汇率主表本来就是「每对每天一条」，本身就是日度时序数据，无需另建历史表。
 * 聚合口径是「期末值」：每个周期桶取桶内最后一个可用日的汇率——这与
 * 折算逻辑「取最近一条 rateDate <= asOf」语义一致，也让图上最后一个点
 * 能和列表卡片的当前值对上（同一天时）。
 *
 * 方向仍然整段统一，但不再「有正向就只认正向」：那样会让 seed 留下的一天正向行
 * 压过之后每天更新的反向行，图上只剩一个点。这里比较两个方向的最新数据日，
 * 取更新的一侧（同一天时优先正向），并用 inverted 标出来。
 * 逐日混用正反向虽然数值上等价，却会让「本图来自反向汇率」这类提示失真，
 * 因此不做逐日回退。
 *
 * 空周期不返回、不补零：没有数据的周期在图上直接缺失，而不是画成跌到 0。
 */
export async function getRateHistory(
  prisma: PrismaClient,
  params: {
    from: string;
    to: string;
    granularity: RateGranularity;
    buckets: number;
    asOf?: Date;
  },
): Promise<RateHistoryResult> {
  const asOf = params.asOf ?? new Date();
  const limit = RATE_GRANULARITY_LIMITS[params.granularity];
  const buckets = Math.min(Math.max(1, params.buckets), limit.max);

  const currentStart = periodStart(asOf, params.granularity);
  const windowStart = shiftPeriods(currentStart, params.granularity, -(buckets - 1));

  const range = { gte: windowStart, lte: asOf };

  const series = await loadPairSeries(prisma, params.from, params.to, range);
  const { rows, inverted, derivation } = series;

  // 按周期桶归并：行已按日期升序，后写覆盖 close；首条写 open；逐行维护 high/low
  const bucketsByKey = new Map<string, { open: Decimal; high: Decimal; low: Decimal; close: Decimal; samples: number }>();
  for (const row of rows) {
    const value = row.rate;
    const key = dayKey(periodStart(row.rateDate, params.granularity));
    const bucket = bucketsByKey.get(key);
    if (bucket) {
      bucket.close = value;
      if (value.gt(bucket.high)) bucket.high = value;
      if (value.lt(bucket.low)) bucket.low = value;
      bucket.samples += 1;
    } else {
      bucketsByKey.set(key, { open: value, high: value, low: value, close: value, samples: 1 });
    }
  }

  const points = [...bucketsByKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodStartKey, bucket]) => ({
      periodStart: periodStartKey,
      open: rateToString(bucket.open),
      high: rateToString(bucket.high),
      low: rateToString(bucket.low),
      rate: rateToString(bucket.close),
      samples: bucket.samples,
    }));

  return {
    from: params.from,
    to: params.to,
    granularity: params.granularity,
    buckets,
    inverted,
    derivation,
    points,
  };
}

export interface SeriesRow {
  rateDate: Date;
  rate: Decimal;
}

interface PairSeries {
  rows: SeriesRow[];
  inverted: boolean;
  derivation: RateDerivation;
}

/** 把一段区间内某方向的行按日期归并成「每天一个值」，同日取最后一条 */
function byDay(rows: Array<{ rate: Decimal; rateDate: Date }>): Map<number, Decimal> {
  const map = new Map<number, Decimal>();
  for (const row of rows) map.set(row.rateDate.getTime(), row.rate);
  return map;
}

/**
 * 加载某个币种对在区间内的日度序列，支持三种推导：
 *
 *   1. 直接行 from→to（人工交叉对走这条）
 *   2. 反向行 to→from 取倒数
 *   3. 两条 USD 腿按日套算：(USD→to)/(USD→from)
 *
 * 优先直接行；没有直接行时才退回反向或套算。迁移后自动同步只写 USD→X，
 * 因此「直接行」基本等价于「人工录入的权威值」，应优先于任何推算结果。
 * 逐日套算要求两条腿当天都有数据，缺一条即跳过该日，而不是用近似值填充。
 */
export async function loadPairSeries(
  prisma: PrismaClient,
  from: string,
  to: string,
  range: { gte: Date; lte: Date },
): Promise<PairSeries> {
  const select = { rate: true, rateDate: true } as const;
  const load = (base: string, quote: string) =>
    prisma.exchangeRate.findMany({
      where: { baseCurrency: base, quoteCurrency: quote, rateDate: range },
      orderBy: { rateDate: 'asc' },
      take: ROW_LIMIT,
      select,
    });

  const needPivot = from !== STORAGE_ANCHOR && to !== STORAGE_ANCHOR;

  const [direct, reverse, pivotFrom, pivotTo] = await Promise.all([
    load(from, to),
    load(to, from),
    needPivot ? load(STORAGE_ANCHOR, from) : Promise.resolve([]),
    needPivot ? load(STORAGE_ANCHOR, to) : Promise.resolve([]),
  ]);

  if (direct.length > 0) {
    return {
      rows: direct.map((row) => ({ rateDate: row.rateDate, rate: toDecimal(row.rate.toString()) })),
      inverted: false,
      derivation: 'direct',
    };
  }

  if (reverse.length > 0) {
    return {
      rows: reverse.map((row) => ({
        rateDate: row.rateDate,
        rate: new Decimal(1).div(toDecimal(row.rate.toString())),
      })),
      inverted: true,
      derivation: 'inverse',
    };
  }

  if (needPivot && pivotFrom.length > 0 && pivotTo.length > 0) {
    const fromByDay = byDay(pivotFrom.map((row) => ({ rateDate: row.rateDate, rate: toDecimal(row.rate.toString()) })));
    const toByDay = byDay(pivotTo.map((row) => ({ rateDate: row.rateDate, rate: toDecimal(row.rate.toString()) })));

    const rows: SeriesRow[] = [];
    for (const [day, denominator] of fromByDay) {
      const numerator = toByDay.get(day);
      if (!numerator || denominator.lte(0)) continue;
      rows.push({
        rateDate: new Date(day),
        rate: new Decimal(numerator.toString())
          .div(new Decimal(denominator.toString()))
          .toDecimalPlaces(30, Decimal.ROUND_HALF_UP),
      });
    }
    rows.sort((a, b) => a.rateDate.getTime() - b.rateDate.getTime());
    return { rows, inverted: false, derivation: 'cross' };
  }

  return { rows: [], inverted: false, derivation: 'direct' };
}
