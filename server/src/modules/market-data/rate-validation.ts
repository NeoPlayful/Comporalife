import Decimal from 'decimal.js';
import { SUPPORTED_CURRENCIES } from '../../config/constants.js';
import { RATE_SCALE } from '../../lib/money.js';
import type { RateQuote } from './rate-provider.js';

export type RateRejectCode =
  | 'UNSUPPORTED_CURRENCY'
  | 'RATE_INVALID'
  | 'RATE_OVERFLOW'
  | 'DATE_INVALID'
  | 'RATE_DEVIATION';

export interface RejectedQuote {
  pair: string;
  code: RateRejectCode;
}

export interface ValidatedQuotes {
  accepted: RateQuote[];
  rejected: RejectedQuote[];
}

/** DECIMAL(20,10) 只留 10 位整数位 */
const MAX_INTEGER_DIGITS = 10;

export function pairKey(base: string, quote: string): string {
  return `${base}->${quote}`;
}

/**
 * 校验供应商返回的每一条报价。
 *
 * 单条不合法只丢弃该条并记录原因，不抛错：一批里一个坏值不应让其他币种对
 * 也拿不到汇率。
 *
 * previous 是「该币种对最近一条已有汇率」，用于偏离护栏。离开护栏时供应商
 * 返回被放大的值会安静地让净资产翻倍，这是唯一能挡住它的机制。
 */
export function validateQuotes(params: {
  quotes: RateQuote[];
  asOf: string;
  previous: Map<string, Decimal>;
  maxDeviationPct: number;
}): ValidatedQuotes {
  const accepted: RateQuote[] = [];
  const rejected: RejectedQuote[] = [];

  for (const quote of params.quotes) {
    const pair = pairKey(quote.base, quote.quote);

    if (
      !SUPPORTED_CURRENCIES.includes(quote.base) ||
      !SUPPORTED_CURRENCIES.includes(quote.quote) ||
      quote.base === quote.quote
    ) {
      rejected.push({ pair, code: 'UNSUPPORTED_CURRENCY' });
      continue;
    }

    if (!quote.rate.isFinite() || quote.rate.lte(0)) {
      rejected.push({ pair, code: 'RATE_INVALID' });
      continue;
    }

    // 整数位溢出：写库会直接报错，提前拦下并说明原因
    const integerDigits = quote.rate.abs().toFixed(0).replace(/^-/, '').length;
    if (integerDigits > MAX_INTEGER_DIGITS) {
      rejected.push({ pair, code: 'RATE_OVERFLOW' });
      continue;
    }

    // 极小值按 10 位舍入后变成 0：这种值写进去等同于没有汇率
    const rounded = quote.rate.toDecimalPlaces(RATE_SCALE, Decimal.ROUND_HALF_UP);
    if (rounded.lte(0)) {
      rejected.push({ pair, code: 'RATE_INVALID' });
      continue;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(quote.date) || quote.date > params.asOf) {
      rejected.push({ pair, code: 'DATE_INVALID' });
      continue;
    }

    const previous = params.previous.get(pair);
    if (previous && previous.gt(0)) {
      const deviation = rounded.minus(previous).abs().div(previous).mul(100);
      // 严格大于才拒绝：恰好卡在阈值上的值是合法的
      if (deviation.gt(params.maxDeviationPct)) {
        rejected.push({ pair, code: 'RATE_DEVIATION' });
        continue;
      }
    }

    accepted.push({ ...quote, rate: rounded });
  }

  return { accepted, rejected };
}

/**
 * 中间精度必须高于 10 位。先舍入再相除会把误差放大到无法解释的程度。
 */
const INTERMEDIATE_SCALE = 30;

/**
 * Decimal.js 默认精度是 20 位有效数字，对两次除法不够：先把两个报价按 10 位
 * 落库再相除，误差会在最后一两位上翻倍。这里用独立的高精度构造器，不去改
 * 全局 Decimal 配置，避免影响金额计算。
 */
const HighPrecision = Decimal.clone({ precision: INTERMEDIATE_SCALE });

/** 中间精度计算：暴露给测试，确保实现不会退化为 10 位 */
export function preciseRatio(numerator: Decimal, denominator: Decimal): Decimal {
  return new HighPrecision(numerator.toString())
    .div(new HighPrecision(denominator.toString()))
    .toDecimalPlaces(INTERMEDIATE_SCALE, Decimal.ROUND_HALF_UP);
}
