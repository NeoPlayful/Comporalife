import { describe, expect, it } from 'vitest';
import { CURRENCY_FLAGS } from './currency-flags';
import { CURRENCY_DECIMALS, CURRENCY_NAMES } from './constants';

/**
 * 旗帜映射的完整性。
 *
 * 旗帜组件在缺映射时静默返回 null，这类「什么都不显示」的问题在页面上
 * 很难被注意到，因此用测试把「每个支持的币种都要么有旗帜、要么显式排除」
 * 这条规则钉住。
 */
describe('币种旗帜映射', () => {
  it('每个有旗帜的币种都是受支持的币种', () => {
    for (const code of Object.keys(CURRENCY_FLAGS)) {
      expect(CURRENCY_DECIMALS[code], `${code} 有旗帜但不在币种目录里`).toBeDefined();
    }
  });

  it('所有受支持币种都登记了旗帜', () => {
    const missing = Object.keys(CURRENCY_DECIMALS).filter((code) => !CURRENCY_FLAGS[code]);
    expect(missing).toEqual([]);
  });

  it('旗帜值是两位大写国家/地区码', () => {
    for (const [code, country] of Object.entries(CURRENCY_FLAGS)) {
      expect(country, `${code} 的旗帜代码不是两位大写字母`).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('欧元区用欧盟旗而不是某一个国家', () => {
    expect(CURRENCY_FLAGS.EUR).toBe('EU');
  });

  it('旗帜映射与币种名称表同源，不存在孤立的旗帜条目', () => {
    for (const code of Object.keys(CURRENCY_FLAGS)) {
      expect(CURRENCY_NAMES[code], `${code} 有旗帜但没有名称`).toBeDefined();
    }
  });
});
