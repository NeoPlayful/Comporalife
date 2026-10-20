import Decimal from 'decimal.js';

// 账务金额统一保留 6 位小数，与 Prisma Decimal(20,6) 对齐
Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export const MONEY_SCALE = 6;
export const RATE_SCALE = 10;

export type MoneyInput = Decimal.Value;

export function toDecimal(value: MoneyInput): Decimal {
  return new Decimal(value);
}

export function roundMoney(value: MoneyInput): Decimal {
  return new Decimal(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

export function roundRate(value: MoneyInput): Decimal {
  return new Decimal(value).toDecimalPlaces(RATE_SCALE, Decimal.ROUND_HALF_UP);
}

/** 账务输出的规范字符串表示，避免 JSON 数字精度丢失 */
export function moneyToString(value: MoneyInput): string {
  return roundMoney(value).toFixed(MONEY_SCALE);
}

export function rateToString(value: MoneyInput): string {
  return roundRate(value).toFixed(RATE_SCALE);
}

export function sumDecimals(values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(toDecimal(v)), new Decimal(0));
}

export function isZero(value: MoneyInput): boolean {
  return roundMoney(value).isZero();
}
