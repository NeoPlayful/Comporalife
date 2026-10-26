import { describe, expect, it } from 'vitest';
import {
  CURRENCY_DECIMALS,
  CURRENCY_NAMES,
  CURRENCY_SYMBOLS,
  SUPPORTED_CURRENCIES,
} from '@/config/constants';

/**
 * 币种目录的完整性。
 *
 * 三张表靠代码手工维护，最容易出的错是「加了精度表却忘了名称」——
 * 那种情况下后台按名称搜索不到这个币种，而按代码搜索又一切正常，
 * 因此这里逐项对齐。
 */
describe('币种目录完整性', () => {
  it('三张表的键集合完全一致', () => {
    const codes = Object.keys(CURRENCY_DECIMALS).sort();
    expect(Object.keys(CURRENCY_NAMES).sort()).toEqual(codes);
    expect(Object.keys(CURRENCY_SYMBOLS).sort()).toEqual(codes);
    expect([...SUPPORTED_CURRENCIES].sort()).toEqual(codes);
  });

  it('名称与符号都不为空', () => {
    for (const code of SUPPORTED_CURRENCIES) {
      const name = CURRENCY_NAMES[code]!;
      expect(name.zh.trim()).not.toBe('');
      expect(name.en.trim()).not.toBe('');
      expect(CURRENCY_SYMBOLS[code]!.trim()).not.toBe('');
    }
  });

  it('精度只取 0、2、3 位：1 位与 4 位以上的币种不存在', () => {
    for (const [code, decimals] of Object.entries(CURRENCY_DECIMALS)) {
      expect([0, 2, 3], `${code} 的精度是 ${decimals}`).toContain(decimals);
    }
  });

  it('0 位币种被正确登记，不会退化成默认的 2 位', () => {
    // 缺条目时展示层按 2 位处理，对这几个币种会显示出实际不存在的辅币
    for (const code of ['JPY', 'KRW', 'IDR', 'VND', 'HUF']) {
      expect(CURRENCY_DECIMALS[code]).toBe(0);
    }
  });

  it('常用币种都在支持列表里', () => {
    const expected = [
      'CNY', 'USD', 'EUR', 'GBP', 'JPY', 'HKD', 'AUD', 'CAD', 'SGD', 'KRW', 'CHF', 'TWD',
      'NZD', 'SEK', 'NOK', 'DKK', 'INR', 'THB', 'MYR', 'PHP', 'IDR', 'VND', 'BRL', 'MXN',
      'ZAR', 'TRY', 'AED', 'SAR', 'PLN', 'CZK', 'HUF', 'ILS',
    ];
    expect([...SUPPORTED_CURRENCIES].sort()).toEqual(expected.sort());
  });

  it('共用 $ 符号的币种用前缀消歧', () => {
    const dollarCurrencies = ['USD', 'CAD', 'AUD', 'SGD', 'HKD', 'TWD', 'MXN', 'NZD'];
    const symbols = dollarCurrencies.map((code) => CURRENCY_SYMBOLS[code]);
    // 只有美元用裸 $，其余都带前缀，否则列表里分不清是哪个币种
    expect(symbols.filter((symbol) => symbol === '$')).toHaveLength(1);
    expect(CURRENCY_SYMBOLS.USD).toBe('$');
  });
});
