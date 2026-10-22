import Decimal from 'decimal.js';

/**
 * 分位数（线性插值）。
 * 采用 index = (n - 1) * p 的位置插值，与常见统计口径一致；
 * 空数组返回 null，单元素直接返回该元素。
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  if (p < 0 || p > 1) throw new RangeError('percentile p must be within [0, 1]');

  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;

  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  const lowerValue = sorted[lower]!;
  const upperValue = sorted[upper]!;

  return lowerValue + (upperValue - lowerValue) * weight;
}

export function median(values: number[]): number | null {
  return percentile(values, 0.5);
}

/** 变异系数 = 标准差 / 均值；均值为 0 时返回 null，避免除零产生 Infinity */
export function coefficientOfVariation(values: Decimal[]): Decimal | null {
  if (values.length === 0) return null;

  const mean = values.reduce((sum, value) => sum.plus(value), new Decimal(0)).div(values.length);
  if (mean.isZero()) return null;

  const variance = values
    .reduce((sum, value) => sum.plus(value.minus(mean).pow(2)), new Decimal(0))
    .div(values.length);

  return variance.sqrt().div(mean.abs());
}
