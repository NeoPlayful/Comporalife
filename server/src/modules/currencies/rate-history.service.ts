import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { rateToString, toDecimal } from '../../lib/money.js';

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
  /** 该桶内最后一个可用日的汇率，表达为 1 from = rate to */
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
  /** 整段序列是否由反向汇率的倒数求得 */
  inverted: boolean;
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
 * 方向沿用整段序列口径，与自选列表的解析保持一致：窗口内只要有正向记录就
 * 全部用正向，一条都没有才退回反向取倒数，并用 inverted 标出来。
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

  const select = { rate: true, rateDate: true } as const;
  const range = { gte: windowStart, lte: asOf };

  const direct = await prisma.exchangeRate.findMany({
    where: {
      baseCurrency: params.from,
      quoteCurrency: params.to,
      rateDate: range,
    },
    orderBy: { rateDate: 'asc' },
    take: ROW_LIMIT,
    select,
  });

  const inverted = direct.length === 0;
  const rows =
    direct.length > 0
      ? direct
      : await prisma.exchangeRate.findMany({
          where: {
            baseCurrency: params.to,
            quoteCurrency: params.from,
            rateDate: range,
          },
          orderBy: { rateDate: 'asc' },
          take: ROW_LIMIT,
          select,
        });

  // 按周期桶归并：行已按日期升序，后写覆盖前写即得「桶内最后一个可用日」
  const bucketsByKey = new Map<string, { rate: Decimal; samples: number }>();
  for (const row of rows) {
    const raw = toDecimal(row.rate.toString());
    const value = inverted ? new Decimal(1).div(raw) : raw;
    const key = dayKey(periodStart(row.rateDate, params.granularity));
    const bucket = bucketsByKey.get(key);
    if (bucket) {
      bucket.rate = value;
      bucket.samples += 1;
    } else {
      bucketsByKey.set(key, { rate: value, samples: 1 });
    }
  }

  const points = [...bucketsByKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodStartKey, bucket]) => ({
      periodStart: periodStartKey,
      rate: rateToString(bucket.rate),
      samples: bucket.samples,
    }));

  return {
    from: params.from,
    to: params.to,
    granularity: params.granularity,
    buckets,
    inverted,
    points,
  };
}
