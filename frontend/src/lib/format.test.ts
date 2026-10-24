import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatNumber } from './format';

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
