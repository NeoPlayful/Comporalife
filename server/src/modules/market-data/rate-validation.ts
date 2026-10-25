import Decimal from 'decimal.js';
import { SUPPORTED_CURRENCIES } from '../../config/constants.js';
import { RATE_SCALE } from '../../lib/money.js';
import type { RateQuote } from './rate-provider.js';

export type RateRejectCode =
  | 'UNSUPPORTED_CURRENCY'
  | 'RATE_INVALID'
  | 'RATE_OVERFLOW'
  | 'DATE_INVALID'
  | 'RATE_DEVIATION'
  | 'ANCHOR_TO_BASE_MISSING';

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
 * 把供应商的锚定币报价换算成用户需要的直接币种对。
 *
 * 折算内核禁止链式套算（A→B→C），所以换算必须在写入阶段完成：落库的每一行
 * 都是直接对，读取侧永远只见直接对。
 *
 * 中间精度必须高于 10 位。先舍入再相除会把误差放大到无法解释的程度。
 */
const INTERMEDIATE_SCALE = 30;

/**
 * Decimal.js 默认精度是 20 位有效数字，对两次除法不够：先把两个报价按 10 位
 * 落库再相除，误差会在最后一两位上翻倍。这里用独立的高精度构造器，不去改
 * 全局 Decimal 配置，避免影响金额计算。
 */
const HighPrecision = Decimal.clone({ precision: INTERMEDIATE_SCALE });

export function convertToBasePairs(params: {
  quotes: RateQuote[];
  anchor: string;
  baseCurrency: string;
  targets: string[];
}): { pairs: Array<{ base: string; quote: string; rate: Decimal; date: string }>; rejected: RejectedQuote[] } {
  const { anchor, baseCurrency, targets } = params;
  const pairs: Array<{ base: string; quote: string; rate: Decimal; date: string }> = [];
  const rejected: RejectedQuote[] = [];

  const byQuote = new Map(params.quotes.map((item) => [item.quote, item]));

  // 锚定币兑基准币是所有派生对的分母，缺了它任何换算都无法解释
  const anchorToBase = anchor === baseCurrency ? null : byQuote.get(baseCurrency);
  if (anchor !== baseCurrency && !anchorToBase) {
    for (const target of targets) {
      if (target !== anchor && target !== baseCurrency) {
        // 缺的是基准币报价，而不是目标币：原因码必须能区分，否则用户会去查错方向
        rejected.push({ pair: pairKey(target, baseCurrency), code: 'ANCHOR_TO_BASE_MISSING' });
      }
    }
    return { pairs, rejected };
  }

  for (const target of targets) {
    if (target === baseCurrency) continue;

    const date = byQuote.get(target)?.date ?? anchorToBase?.date ?? params.quotes[0]?.date;
    if (!date) continue;

    let rate: Decimal;

    if (target === anchor) {
      // 锚定币兑基准币：直接取供应商的锚定报价
      if (!anchorToBase) continue;
      rate = anchorToBase.rate;
    } else {
      const targetQuote = byQuote.get(target);
      if (!targetQuote) {
        rejected.push({ pair: pairKey(target, baseCurrency), code: 'RATE_INVALID' });
        continue;
      }
      if (anchor === baseCurrency) {
        // 基准币就是锚定币：外币兑基准币等于供应商报价的倒数
        rate = new HighPrecision(1).div(targetQuote.rate);
      } else {
        // 常规情形：R(anchor→base) / R(anchor→target)
        rate = preciseRatio(anchorToBase!.rate, targetQuote.rate);
      }
    }

    const rounded = rate.toDecimalPlaces(RATE_SCALE, Decimal.ROUND_HALF_UP);
    if (!rounded.isFinite() || rounded.lte(0)) {
      rejected.push({ pair: pairKey(target, baseCurrency), code: 'RATE_INVALID' });
      continue;
    }

    pairs.push({ base: target, quote: baseCurrency, rate: rounded, date });
  }

  return { pairs, rejected };
}

/** 中间精度计算：暴露给测试，确保实现不会退化为 10 位 */
export function preciseRatio(numerator: Decimal, denominator: Decimal): Decimal {
  return new HighPrecision(numerator.toString())
    .div(new HighPrecision(denominator.toString()))
    .toDecimalPlaces(INTERMEDIATE_SCALE, Decimal.ROUND_HALF_UP);
}
