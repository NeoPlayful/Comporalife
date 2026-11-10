import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { roundMoney } from '../../lib/money.js';
import { lookupRate, type RateLookupResult } from './rate-lookup.service.js';

export type { RateLookupResult } from './rate-lookup.service.js';

/**
 * 汇率折算。
 *
 * 委托给统一读取内核：存储只保留 USD→X 单一方向，任意 A→B 由
 * (USD→B)/(USD→A) 套算，详见 rate-lookup.service.ts。
 *
 * 汇率已全局化：查询不按用户过滤，同一币种对同一天对所有用户是同一个值。
 */
export async function resolveRate(
  prisma: PrismaClient,
  params: { from: string; to: string; asOf: Date },
): Promise<RateLookupResult | null> {
  return lookupRate(prisma, params);
}

/**
 * 批量折算到基准币种；缺失汇率时返回缺失清单而不是静默按 1:1 处理。
 *
 * 逐项调用内核并按「币种→基准币」缓存结果：同一批里重复出现的币种只查一次。
 */
export async function convertMany(
  prisma: PrismaClient,
  params: {
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
      rate = await lookupRate(prisma, {
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
