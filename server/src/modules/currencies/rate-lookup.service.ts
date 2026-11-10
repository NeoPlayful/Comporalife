import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { STORAGE_ANCHOR } from '../../config/constants.js';
import { toDecimal } from '../../lib/money.js';

/**
 * 汇率方向来源。
 *
 * - direct：库里直接有 from→to
 * - inverse：库里只有 to→from，取其倒数
 * - cross：两条 USD 腿相除（(USD→to)/(USD→from)）
 */
export type RateDerivation = 'direct' | 'inverse' | 'cross';

export interface RateLookupResult {
  rate: Decimal;
  /** 参与计算的各腿里最旧的日期：套算时两条腿日期可能不同，取较旧的一条更保守 */
  rateDate: Date;
  /** 等价于 derivation === 'inverse'，保留给只认布尔的老接口 */
  inverted: boolean;
  derivation: RateDerivation;
  /** 实际用到的存储行方向，形如 ['USD->CNY', 'USD->EUR']，用于前端解释数值来源 */
  legs: string[];
  /** 任一条腿是人工录入即为 manual，否则 provider */
  source: 'manual' | 'provider';
}

interface StoredRate {
  rate: Decimal;
  rateDate: Date;
  source: 'manual' | 'provider';
}

/**
 * 一次取回若干方向不晚于 asOf 的最新一条。
 *
 * 单次查询而非逐方向查询：折算内核会在按币种、按日的循环里被调用，
 * 每个方向一次往返会迅速吃满连接池（集成测试并跑时表现为 P2037）。
 * 这里把最多四个方向塞进一个 OR 查询，内存里再挑每个方向的最新一条。
 */
async function latestRates(
  prisma: PrismaClient,
  pairs: Array<{ base: string; quote: string }>,
  asOf: Date,
): Promise<Map<string, StoredRate>> {
  const result = new Map<string, StoredRate>();
  if (pairs.length === 0) return result;

  const rows = await prisma.exchangeRate.findMany({
    where: {
      OR: pairs.map((pair) => ({ baseCurrency: pair.base, quoteCurrency: pair.quote })),
      rateDate: { lte: asOf },
    },
    orderBy: { rateDate: 'desc' },
    select: { baseCurrency: true, quoteCurrency: true, rate: true, rateDate: true, source: true },
  });

  for (const row of rows) {
    const key = `${row.baseCurrency}->${row.quoteCurrency}`;
    // 已按日期倒序，第一条即该方向最新
    if (result.has(key)) continue;
    result.set(key, {
      rate: toDecimal(row.rate.toString()),
      rateDate: row.rateDate,
      source: row.source,
    });
  }

  return result;
}

interface Candidate {
  rate: Decimal;
  rateDate: Date;
  source: 'manual' | 'provider';
  derivation: RateDerivation;
  legs: string[];
}

/**
 * 候选排序：人工行恒为权威值，先比来源再比日期，最后按直接→反向→套算定序。
 *
 * 迁移后自动化同步只写 USD→X，因此非 USD 的直接行只可能来自人工录入；
 * 人工交叉对（如 EUR→CNY）即使比套算值旧，也应当优先——管理员录进来
 * 就是为了覆盖推算结果。
 */
function better(a: Candidate, b: Candidate | undefined): boolean {
  if (!b) return true;
  const aManual = a.source === 'manual';
  const bManual = b.source === 'manual';
  if (aManual !== bManual) return aManual;
  if (a.rateDate.getTime() !== b.rateDate.getTime()) {
    return a.rateDate.getTime() > b.rateDate.getTime();
  }
  const rank: Record<RateDerivation, number> = { direct: 0, inverse: 1, cross: 2 };
  return rank[a.derivation] < rank[b.derivation];
}

/**
 * 把两条腿相除，套算出任意币种对。
 *
 * 中间精度必须高于落库的 10 位：先各舍入到 10 位再相除，误差会在末位上
 * 放大到可观测的程度（见单元测试 preciseRatio）。
 */
function divideLegs(numerator: Decimal, denominator: Decimal): Decimal {
  return new Decimal(numerator.toString())
    .div(new Decimal(denominator.toString()))
    .toDecimalPlaces(30, Decimal.ROUND_HALF_UP);
}

/**
 * 统一汇率读取。
 *
 * 存储形态是「USD→X」单一方向（人工可留任意方向作为权威覆盖）。任意 A→B：
 *   1. 库里直接有 A→B 就用它（人工交叉对走这条）
 *   2. 只有 B→A 就取倒数
 *   3. 否则用 (USD→B)/(USD→A) 套算
 *
 * 同币种直接返回 1，不查库。
 */
export async function lookupRate(
  prisma: PrismaClient,
  params: { from: string; to: string; asOf: Date },
): Promise<RateLookupResult | null> {
  const { from, to, asOf } = params;

  if (from === to) {
    return {
      rate: new Decimal(1),
      rateDate: asOf,
      inverted: false,
      derivation: 'direct',
      legs: [],
      source: 'provider',
    };
  }

  const needPivot = from !== STORAGE_ANCHOR && to !== STORAGE_ANCHOR;

  const lookups: Array<{ base: string; quote: string }> = [
    { base: from, quote: to },
    { base: to, quote: from },
  ];
  if (needPivot) {
    lookups.push({ base: STORAGE_ANCHOR, quote: from }, { base: STORAGE_ANCHOR, quote: to });
  }

  const latest = await latestRates(prisma, lookups, asOf);
  const direct = latest.get(`${from}->${to}`);
  const reverse = latest.get(`${to}->${from}`);
  const pivotFrom = needPivot ? latest.get(`${STORAGE_ANCHOR}->${from}`) : undefined;
  const pivotTo = needPivot ? latest.get(`${STORAGE_ANCHOR}->${to}`) : undefined;

  let best: Candidate | undefined;

  if (direct) {
    best = {
      rate: direct.rate,
      rateDate: direct.rateDate,
      source: direct.source,
      derivation: 'direct',
      legs: [`${from}->${to}`],
    };
  }

  if (reverse && reverse.rate.gt(0)) {
    const candidate: Candidate = {
      rate: new Decimal(1).div(reverse.rate),
      rateDate: reverse.rateDate,
      source: reverse.source,
      derivation: 'inverse',
      legs: [`${to}->${from}`],
    };
    if (better(candidate, best)) best = candidate;
  }

  if (pivotFrom && pivotTo && pivotFrom.rate.gt(0)) {
    const candidate: Candidate = {
      rate: divideLegs(pivotTo.rate, pivotFrom.rate),
      rateDate:
        pivotTo.rateDate.getTime() <= pivotFrom.rateDate.getTime()
          ? pivotTo.rateDate
          : pivotFrom.rateDate,
      // 套算值的「来源」按较旧的那条腿定：只要有一条腿是人工录入，结果就沾了人工值
      source:
        pivotTo.source === 'manual' || pivotFrom.source === 'manual' ? 'manual' : 'provider',
      derivation: 'cross',
      legs: [`${STORAGE_ANCHOR}->${to}`, `${STORAGE_ANCHOR}->${from}`],
    };
    if (better(candidate, best)) best = candidate;
  }

  if (!best) return null;

  return {
    rate: best.rate,
    rateDate: best.rateDate,
    inverted: best.derivation === 'inverse',
    derivation: best.derivation,
    legs: best.legs,
    source: best.source,
  };
}
