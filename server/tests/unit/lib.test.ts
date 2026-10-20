import { describe, expect, it } from 'vitest';
import { buildPagination, parsePageParams } from '@/lib/api-utils';
import { moneyToString, rateToString, roundMoney, sumDecimals } from '@/lib/money';

describe('分页参数', () => {
  it('缺省时使用默认页码与页大小', () => {
    expect(parsePageParams({})).toEqual({ page: 1, pageSize: 20, skip: 0, take: 20 });
  });

  it('页大小超过上限被截断', () => {
    expect(parsePageParams({ page: '2', pageSize: '500' })).toEqual({
      page: 2,
      pageSize: 100,
      skip: 100,
      take: 100,
    });
  });

  it('非法输入回落到默认值', () => {
    expect(parsePageParams({ page: '-3', pageSize: 'abc' })).toEqual({
      page: 1,
      pageSize: 20,
      skip: 0,
      take: 20,
    });
  });

  it('分页元数据计算总页数', () => {
    expect(buildPagination(1, 20, 45)).toEqual({ page: 1, pageSize: 20, total: 45, totalPages: 3 });
    expect(buildPagination(2, 20, 45)).toEqual({ page: 2, pageSize: 20, total: 45, totalPages: 3 });
  });
});

describe('金额精度', () => {
  it('避免浮点累加误差', () => {
    expect(sumDecimals(['0.1', '0.2']).toString()).toBe('0.3');
  });

  it('金额统一保留 6 位小数', () => {
    expect(moneyToString('1234.5')).toBe('1234.500000');
    expect(roundMoney('0.0000005').toString()).toBe('0.000001');
  });

  it('汇率保留 10 位小数', () => {
    expect(rateToString('7.1234567890123')).toBe('7.1234567890');
  });

  it('负数金额保持符号', () => {
    expect(sumDecimals(['-100.123456', '50']).toString()).toBe('-50.123456');
  });
});
