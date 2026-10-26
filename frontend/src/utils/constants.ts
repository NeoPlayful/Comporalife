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

/**
 * 币种显示名。与后端 constants 里的同名字段保持一致：界面按名称搜索时，
 * 服务端也按名称匹配，两侧词表不同就会出现「搜得到却不显示」。
 */
export const CURRENCY_NAMES: Record<string, { zh: string; en: string }> = {
  CNY: { zh: '人民币', en: 'Chinese Yuan' },
  USD: { zh: '美元', en: 'US Dollar' },
  EUR: { zh: '欧元', en: 'Euro' },
  GBP: { zh: '英镑', en: 'British Pound' },
  JPY: { zh: '日元', en: 'Japanese Yen' },
  HKD: { zh: '港币', en: 'Hong Kong Dollar' },
  AUD: { zh: '澳元', en: 'Australian Dollar' },
  CAD: { zh: '加元', en: 'Canadian Dollar' },
  SGD: { zh: '新加坡元', en: 'Singapore Dollar' },
  KRW: { zh: '韩元', en: 'South Korean Won' },
  CHF: { zh: '瑞士法郎', en: 'Swiss Franc' },
  TWD: { zh: '新台币', en: 'New Taiwan Dollar' },
};

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
