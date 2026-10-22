import Decimal from 'decimal.js';
import {
  addDays,
  addMonths,
  addYears,
  differenceInCalendarDays,
  endOfMonth,
  endOfYear,
  startOfMonth,
  startOfYear,
} from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export type Granularity = 'day' | 'week' | 'month';
export type PeriodGranularity = 'month' | 'year';

/**
 * 把用户时区下的「自然日」区间解析为 UTC 瞬时值。
 * 前端传 yyyy-MM-dd，服务端按用户时区解释当日 00:00 与 23:59:59.999，
 * 不在服务端二次猜测时区。
 */
export function resolveRange(
  fromText: string,
  toText: string,
  timezone: string,
): { from: Date; to: Date; days: number } {
  const from = fromZonedTime(`${fromText}T00:00:00.000`, timezone);
  const to = fromZonedTime(`${toText}T23:59:59.999`, timezone);
  const days = differenceInCalendarDays(to, from) + 1;
  return { from, to, days };
}

/** 按用户时区取周期键，与 cashflow.service 的口径保持一致 */
export function periodKeyOf(date: Date, timezone: string, granularity: PeriodGranularity): string {
  return formatInTimeZone(date, timezone, granularity === 'year' ? 'yyyy' : 'yyyy-MM');
}

export function dayKeyOf(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'yyyy-MM-dd');
}

/** 以周一为一周起点，返回该周的键（周日期的日期） */
export function weekKeyOf(date: Date, timezone: string): string {
  const dayText = formatInTimeZone(date, timezone, 'yyyy-MM-dd');
  const weekday = Number(formatInTimeZone(date, timezone, 'i')); // 1 = 周一
  const weekEnd = addDays(fromZonedTime(`${dayText}T00:00:00.000`, timezone), 7 - weekday);
  return formatInTimeZone(weekEnd, timezone, 'yyyy-MM-dd');
}

export interface PeriodWindow {
  fromText: string;
  toText: string;
}

/** 自然月 / 自然年窗口；自定义区间由调用方直接给出 */
export function resolvePeriodWindow(
  granularity: PeriodGranularity,
  anchor: Date,
  timezone: string,
): PeriodWindow {
  const inZone = fromZonedTime(
    `${formatInTimeZone(anchor, timezone, 'yyyy-MM-dd')}T00:00:00.000`,
    timezone,
  );
  const start = granularity === 'month' ? startOfMonth(inZone) : startOfYear(inZone);
  const end = granularity === 'month' ? endOfMonth(inZone) : endOfYear(inZone);

  return {
    fromText: formatInTimeZone(start, timezone, 'yyyy-MM-dd'),
    toText: formatInTimeZone(end, timezone, 'yyyy-MM-dd'),
  };
}

/**
 * 环比：与上一个等长周期比较。
 * 自然月/自然年按日历平移；自定义区间按天数向前平移。
 */
export function previousWindow(
  window: PeriodWindow & { mode: PeriodGranularity | 'custom' },
  timezone: string,
): PeriodWindow {
  if (window.mode === 'month' || window.mode === 'year') {
    const fromInZone = fromZonedTime(`${window.fromText}T00:00:00.000`, timezone);
    const shifted = window.mode === 'month' ? addMonths(fromInZone, -1) : addYears(fromInZone, -1);
    return resolvePeriodWindow(window.mode, shifted, timezone);
  }

  const { from, to } = resolveRange(window.fromText, window.toText, timezone);
  const spanDays = differenceInCalendarDays(to, from) + 1;
  return {
    fromText: formatInTimeZone(addDays(from, -spanDays), timezone, 'yyyy-MM-dd'),
    toText: formatInTimeZone(addDays(from, -1), timezone, 'yyyy-MM-dd'),
  };
}

/** 同比：向前平移 12 个月；自定义区间按同一天平移一年 */
export function yearAgoWindow(
  window: PeriodWindow & { mode: PeriodGranularity | 'custom' },
  timezone: string,
): PeriodWindow {
  if (window.mode === 'month' || window.mode === 'year') {
    const fromInZone = fromZonedTime(`${window.fromText}T00:00:00.000`, timezone);
    return resolvePeriodWindow(window.mode, addYears(fromInZone, -1), timezone);
  }

  const fromInZone = fromZonedTime(`${window.fromText}T00:00:00.000`, timezone);
  const toInZone = fromZonedTime(`${window.toText}T00:00:00.000`, timezone);
  return {
    fromText: formatInTimeZone(addYears(fromInZone, -1), timezone, 'yyyy-MM-dd'),
    toText: formatInTimeZone(addYears(toInZone, -1), timezone, 'yyyy-MM-dd'),
  };
}

/** 变化率 = (本期 − 上期) / |上期|；上期为 0 时返回 null，不产生 Infinity */
export function changeRatio(current: Decimal, previous: Decimal): string | null {
  if (previous.isZero()) return null;
  return current.minus(previous).div(previous.abs()).toDecimalPlaces(4).toFixed(4);
}

/** 判断给定日期是否已有足够历史用于同比 */
export function hasYearOfHistory(earliest: Date | null, window: PeriodWindow, timezone: string): boolean {
  if (!earliest) return false;
  const threshold = fromZonedTime(`${window.fromText}T00:00:00.000`, timezone);
  return earliest <= addYears(threshold, -1);
}

/** 按粒度枚举区间内的全部周期键，用于补齐没有流水的周期 */
export function enumeratePeriodKeys(
  from: Date,
  to: Date,
  timezone: string,
  granularity: Granularity,
): string[] {
  const keys: string[] = [];
  let cursor = fromZonedTime(`${formatInTimeZone(from, timezone, 'yyyy-MM-dd')}T00:00:00.000`, timezone);

  if (granularity === 'month') {
    cursor = startOfMonth(cursor);
    while (cursor <= to) {
      keys.push(formatInTimeZone(cursor, timezone, 'yyyy-MM'));
      cursor = addMonths(cursor, 1);
    }
    return keys;
  }

  if (granularity === 'week') {
    const weekEndKey = weekKeyOf(cursor, timezone);
    keys.push(weekEndKey);
    let nextWeekEnd = fromZonedTime(`${weekEndKey}T00:00:00.000`, timezone);
    while (true) {
      nextWeekEnd = addDays(nextWeekEnd, 7);
      if (nextWeekEnd > to) break;
      keys.push(formatInTimeZone(nextWeekEnd, timezone, 'yyyy-MM-dd'));
    }
    return keys;
  }

  while (cursor <= to) {
    keys.push(formatInTimeZone(cursor, timezone, 'yyyy-MM-dd'));
    cursor = addDays(cursor, 1);
  }
  return keys;
}
