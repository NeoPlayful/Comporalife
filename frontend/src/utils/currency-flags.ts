/**
 * 币种 → 旗帜。
 *
 * 币种与国家的对应关系不是一一映射，因此无法从代码推导，必须显式列出：
 * - EUR 属于二十多个国家，统一用欧盟旗
 * - 美元、欧元这类跨国流通的货币，旗帜表达的是「主要发行地」而不是主权
 * - 少数币种的旗帜在不同语境下有争议，这里按 ISO 3166 的发行地处理，
 *   不使用任何政治标识
 *
 * 未登记的币种不显示旗帜（组件返回 null），而不是退回到一个占位图标：
 * 一个错旗比没有旗更容易误导人。
 */
export const CURRENCY_FLAGS: Record<string, string> = {
  CNY: 'CN',
  USD: 'US',
  EUR: 'EU',
  GBP: 'GB',
  JPY: 'JP',
  HKD: 'HK',
  AUD: 'AU',
  CAD: 'CA',
  SGD: 'SG',
  KRW: 'KR',
  CHF: 'CH',
  TWD: 'TW',
  NZD: 'NZ',
  SEK: 'SE',
  NOK: 'NO',
  DKK: 'DK',
  INR: 'IN',
  THB: 'TH',
  MYR: 'MY',
  PHP: 'PH',
  IDR: 'ID',
  VND: 'VN',
  BRL: 'BR',
  MXN: 'MX',
  ZAR: 'ZA',
  TRY: 'TR',
  AED: 'AE',
  SAR: 'SA',
  PLN: 'PL',
  CZK: 'CZ',
  HUF: 'HU',
  ILS: 'IL',
};
