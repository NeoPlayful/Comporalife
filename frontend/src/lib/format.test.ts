import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatNumber, formatPrice, formatRate, trimTrailingZeros } from './format';

describe('formatNumber', () => {
  it('按指定小数位格式化并加千分位', () => {
    expect(formatNumber('1234567.891', { minimumFractionDigits: 2, maximumFractionDigits: 2 })).toBe(
      '1,234,567.89',
    );
  });

  it('零小数位不保留小数', () => {
    expect(formatNumber(1234.56, { maximumFractionDigits: 0 })).toBe('1,235');
  });

  it('非法输入返回占位符而不是 NaN', () => {
    expect(formatNumber('abc')).toBe('—');
    expect(formatNumber(null)).toBe('—');
  });
});

describe('formatDate', () => {
  it('默认输出 yyyy-MM-dd', () => {
    expect(formatDate('2026-03-05T10:00:00Z', 'YYYY-MM-DD')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('支持 DD/MM/YYYY 与 MM/DD/YYYY', () => {
    expect(formatDate(new Date(2026, 2, 5), 'DD/MM/YYYY')).toBe('05/03/2026');
    expect(formatDate(new Date(2026, 2, 5), 'MM/DD/YYYY')).toBe('03/05/2026');
  });

  it('空值与非法值返回占位符', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });
});

describe('formatDateTime', () => {
  it('同时包含日期与时间', () => {
    const result = formatDateTime('2026-03-05T10:00:00Z', 'YYYY-MM-DD');
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(result).toMatch(/\d{2}:\d{2}/);
  });

  it('空值返回占位符', () => {
    expect(formatDateTime(undefined)).toBe('—');
  });
});

describe('价格与汇率的位宽', () => {
  it('价格保留 8 位小数，不截断为金额的默认位数', () => {
    expect(formatPrice('0.12345678')).toBe('0.12345678');
    expect(formatPrice('12.5')).toBe('12.5');
  });

  it('汇率默认保留 4 位小数', () => {
    expect(formatRate('6.6837510000')).toBe('6.6838');
    expect(formatRate('0.8939350000')).toBe('0.8939');
    expect(formatRate('151.0000000000')).toBe('151.0000');
    expect(formatRate('1')).toBe('1.0000');
  });

  it('极小汇率放开到 8 位，不会被抹成 0.0000', () => {
    // 1 VND ≈ 0.0000387 USD：按 4 位会显示成 0.0000，看起来像没有数据
    expect(formatRate('0.0000387124')).toBe('0.00003871');
    expect(formatRate('0.0000551000')).toBe('0.00005510');
  });

  it('空值与非数字显示为占位符，不报错', () => {
    expect(formatRate(null)).toBe('—');
    expect(formatRate(undefined)).toBe('—');
    expect(formatRate('abc')).toBe('—');
  });

  it('0 仍按常规位数显示，不走小币种分支', () => {
    expect(formatRate(0)).toBe('0.0000');
  });

  it('编辑汇率时去掉尾零，且不出现科学计数法', () => {
    expect(trimTrailingZeros('7.2450000000')).toBe('7.245');
    expect(trimTrailingZeros('0.0000001200')).toBe('0.00000012');
    // 用 Number(x).toString() 会得到 1.2e-7，提交时校验不通过
    expect(trimTrailingZeros('0.0000001200')).not.toContain('e');
    expect(trimTrailingZeros('100')).toBe('100');
  });
});
