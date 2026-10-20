export const API_PREFIX = '/api';

export const PAGINATION = {
  defaultPage: 1,
  defaultPageSize: 20,
  maxPageSize: 100,
} as const;

export const BULK_OPERATION_LIMIT = 500;

/**
 * 币种精度：用于展示层小数位与舍入。
 * 账务存储统一 DECIMAL(20,6)，此处只影响展示与输入校验。
 */
export const CURRENCY_DECIMALS: Record<string, number> = {
  CNY: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  HKD: 2,
  AUD: 2,
  CAD: 2,
  SGD: 2,
  KRW: 0,
  CHF: 2,
  TWD: 2,
};

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_DECIMALS);

export const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  HKD: 'HK$',
  AUD: 'A$',
  CAD: 'C$',
  SGD: 'S$',
  KRW: '₩',
  CHF: 'CHF',
  TWD: 'NT$',
};

export const LIABILITY_ACCOUNT_TYPES = ['credit_card', 'loan'] as const;

export const ACCOUNT_TYPES = ['cash', 'bank', 'credit_card', 'brokerage', 'loan', 'other'] as const;

export const TRANSACTION_TYPES = ['income', 'expense', 'transfer', 'adjustment'] as const;

export const SESSION_COOKIE_NAME = 'cl_refresh';

export const PASSWORD_RESET_TTL_SECONDS = 30 * 60;

export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export const MAX_SIMULATION_YEARS = 100;
export const MIN_SIMULATION_YEARS = 1;
