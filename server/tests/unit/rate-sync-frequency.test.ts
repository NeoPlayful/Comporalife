import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATE_SYNC_FREQUENCY,
  isRateSyncFrequency,
  RATE_SYNC_FREQUENCIES,
  RATE_SYNC_FREQUENCY_MS,
} from '@/config/constants';
import { getRateSyncFrequency } from '@/modules/settings/system-settings.service';

/** 最小可用的 prisma 替身：只实现本函数会调到的 findUnique */
function fakePrisma(value: unknown) {
  return {
    systemSetting: {
      findUnique: async () => (value === undefined ? null : { value }),
    },
  } as never;
}

describe('同步频率取值', () => {
  it('三档都对应明确的毫秒数', () => {
    expect(RATE_SYNC_FREQUENCY_MS.hourly).toBe(60 * 60 * 1000);
    expect(RATE_SYNC_FREQUENCY_MS.daily).toBe(24 * 60 * 60 * 1000);
    expect(RATE_SYNC_FREQUENCY_MS.weekly).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('只认三档字面量', () => {
    expect(RATE_SYNC_FREQUENCIES.every((item) => isRateSyncFrequency(item))).toBe(true);
    expect(isRateSyncFrequency('minutely')).toBe(false);
    expect(isRateSyncFrequency(undefined)).toBe(false);
    expect(isRateSyncFrequency(3600)).toBe(false);
  });
});

describe('读取同步频率', () => {
  it('没有配置时按每日一次', async () => {
    expect(await getRateSyncFrequency(fakePrisma(undefined))).toBe(DEFAULT_RATE_SYNC_FREQUENCY);
    expect(DEFAULT_RATE_SYNC_FREQUENCY).toBe('daily');
  });

  it('读到合法值就原样返回', async () => {
    expect(await getRateSyncFrequency(fakePrisma('hourly'))).toBe('hourly');
    expect(await getRateSyncFrequency(fakePrisma('weekly'))).toBe('weekly');
  });

  it('库里存了非法值时回退到每日一次，而不是抛错', async () => {
    // 同步停摆比频率不准严重得多：坏数据不能让调度直接崩掉
    expect(await getRateSyncFrequency(fakePrisma('every-minute'))).toBe('daily');
    expect(await getRateSyncFrequency(fakePrisma(null))).toBe('daily');
  });
});
