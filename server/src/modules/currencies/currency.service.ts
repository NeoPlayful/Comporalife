import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { roundMoney, toDecimal } from '../../lib/money.js';

export interface RateLookupResult {
  rate: Decimal;
  rateDate: Date;
  inverted: boolean;
}

/**
 * 汇率折算：
 * - 同币种直接返回 1
 * - 查最近一条 rateDate <= asOf 的用户汇率
 * - 缺少直接汇率时尝试反向取倒数
 * - 禁止链式套算（A→B→C），避免中间精度累积成难以解释的偏差
 */
export async function resolveRate(
  prisma: PrismaClient,
  params: { userId: string; from: string; to: string; asOf: Date },
): Promise<RateLookupResult | null> {
  if (params.from === params.to) {
    return { rate: new Decimal(1), rateDate: params.asOf, inverted: false };
  }

  const direct = await prisma.exchangeRate.findFirst({
    where: {
      userId: params.userId,
      baseCurrency: params.from,
      quoteCurrency: params.to,
      rateDate: { lte: params.asOf },
    },
    orderBy: { rateDate: 'desc' },
    select: { rate: true, rateDate: true },
  });

  if (direct) {
    return { rate: toDecimal(direct.rate.toString()), rateDate: direct.rateDate, inverted: false };
  }

  const reverse = await prisma.exchangeRate.findFirst({
    where: {
      userId: params.userId,
      baseCurrency: params.to,
      quoteCurrency: params.from,
      rateDate: { lte: params.asOf },
    },
    orderBy: { rateDate: 'desc' },
    select: { rate: true, rateDate: true },
  });

  if (reverse) {
    const rate = toDecimal(reverse.rate.toString());
    if (rate.isZero()) {
      return null;
    }
    return { rate: new Decimal(1).div(rate), rateDate: reverse.rateDate, inverted: true };
  }

  return null;
}

export interface ConversionResult {
  amount: Decimal;
  missingPairs: string[];
  ratesUsed: Array<{ from: string; to: string; rate: string; rateDate: string; inverted: boolean }>;
}

/** 批量折算到基准币种；缺失汇率时返回缺失清单而不是静默按 1:1 处理 */
export async function convertMany(
  prisma: PrismaClient,
  params: {
    userId: string;
    baseCurrency: string;
    asOf: Date;
    items: Array<{ amount: Decimal; currency: string }>;
  },
): Promise<{ total: Decimal; missingPairs: string[] }> {
  const missing = new Set<string>();
  let total = new Decimal(0);

  const rateCache = new Map<string, RateLookupResult | null>();

  for (const item of params.items) {
    if (item.currency === params.baseCurrency) {
      total = total.plus(item.amount);
      continue;
    }

    const key = `${item.currency}->${params.baseCurrency}`;
    let rate: RateLookupResult | null | undefined = rateCache.get(key);

    if (rate === undefined) {
      rate = await resolveRate(prisma, {
        userId: params.userId,
        from: item.currency,
        to: params.baseCurrency,
        asOf: params.asOf,
      });
      rateCache.set(key, rate);
    }

    if (!rate) {
      missing.add(key);
      continue;
    }

    total = total.plus(item.amount.mul(rate.rate));
  }

  return { total: roundMoney(total), missingPairs: [...missing] };
}
