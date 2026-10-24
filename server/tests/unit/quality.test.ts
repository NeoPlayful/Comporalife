import { describe, expect, it } from 'vitest';
import { recentMonthKeys } from '@/modules/quality/quality.service';

describe('月度键序列', () => {
  it('返回最近 N 个完整月，且不含当月', () => {
    const keys = recentMonthKeys(new Date('2026-10-24T00:00:00Z'), 3);
    expect(keys).toEqual(['2026-07', '2026-08', '2026-09']);
  });

  it('跨年时正确回退', () => {
    const keys = recentMonthKeys(new Date('2026-02-15T00:00:00Z'), 3);
    expect(keys).toEqual(['2025-11', '2025-12', '2026-01']);
  });

  it('月份补零为两位', () => {
    const keys = recentMonthKeys(new Date('2026-12-31T00:00:00Z'), 2);
    expect(keys).toEqual(['2026-10', '2026-11']);
  });

  it('序列严格递增，便于按时间下钻', () => {
    const keys = recentMonthKeys(new Date('2026-10-24T00:00:00Z'), 12);
    expect(keys).toHaveLength(12);
    expect([...keys].sort()).toEqual(keys);
  });
});
