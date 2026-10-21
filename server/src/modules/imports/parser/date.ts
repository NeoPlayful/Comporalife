import { fromZonedTime } from 'date-fns-tz';

/**
 * 日期解析：账单日期无时区信息，按用户时区当日零点解释后转 UTC 存储。
 * 歧义格式（DD/MM 与 MM/DD）必须由用户显式选择，绝不猜测。
 */

export type DateFormat =
  | 'YYYY-MM-DD'
  | 'YYYY/MM/DD'
  | 'YYYYMMDD'
  | 'DD/MM/YYYY'
  | 'MM/DD/YYYY'
  | 'YYYY-MM-DD HH:mm'
  | 'YYYY-MM-DD HH:mm:ss'
  | 'auto';

export type DateError = 'DATE_INVALID' | 'DATE_AMBIGUOUS' | 'DATE_OUT_OF_RANGE';

export interface DateParseResult {
  value: Date | null;
  error?: DateError;
}

const MIN_YEAR = 1970;

export function parseDate(
  input: string | null | undefined,
  format: DateFormat,
  timezone: string,
): DateParseResult {
  if (input === null || input === undefined) return { value: null, error: 'DATE_INVALID' };

  const text = input.trim();
  if (text.length === 0) return { value: null, error: 'DATE_INVALID' };

  const parts = format === 'auto' ? parseAuto(text) : parseWithFormat(text, format);

  if (typeof parts === 'string') return { value: null, error: parts };

  const { year, month, day, hour, minute, second } = parts;

  if (!isValidDate(year, month, day, hour, minute, second)) {
    return { value: null, error: 'DATE_INVALID' };
  }

  const maxYear = new Date().getUTCFullYear() + 1;
  if (year < MIN_YEAR || year > maxYear) return { value: null, error: 'DATE_OUT_OF_RANGE' };

  const local = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}`;
  return { value: fromZonedTime(local, timezone) };
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function parseWithFormat(text: string, format: Exclude<DateFormat, 'auto'>): DateParts | DateError {
  switch (format) {
    case 'YYYY-MM-DD': {
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
      return m ? atMidnight(Number(m[1]), Number(m[2]), Number(m[3])) : 'DATE_INVALID';
    }
    case 'YYYY/MM/DD': {
      const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text);
      return m ? atMidnight(Number(m[1]), Number(m[2]), Number(m[3])) : 'DATE_INVALID';
    }
    case 'YYYYMMDD': {
      const m = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
      return m ? atMidnight(Number(m[1]), Number(m[2]), Number(m[3])) : 'DATE_INVALID';
    }
    case 'DD/MM/YYYY': {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
      return m ? atMidnight(Number(m[3]), Number(m[2]), Number(m[1])) : 'DATE_INVALID';
    }
    case 'MM/DD/YYYY': {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
      return m ? atMidnight(Number(m[3]), Number(m[1]), Number(m[2])) : 'DATE_INVALID';
    }
    case 'YYYY-MM-DD HH:mm': {
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/.exec(text);
      return m
        ? {
            year: Number(m[1]),
            month: Number(m[2]),
            day: Number(m[3]),
            hour: Number(m[4]),
            minute: Number(m[5]),
            second: 0,
          }
        : 'DATE_INVALID';
    }
    case 'YYYY-MM-DD HH:mm:ss': {
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})$/.exec(text);
      return m
        ? {
            year: Number(m[1]),
            month: Number(m[2]),
            day: Number(m[3]),
            hour: Number(m[4]),
            minute: Number(m[5]),
            second: Number(m[6]),
          }
        : 'DATE_INVALID';
    }
  }
}

/**
 * 自动模式只在无歧义时接受：
 * 首位是 4 位年份 → 年在前；否则必须有一侧大于 12 才能判定 D/M 顺序。
 */
function parseAuto(text: string): DateParts | DateError {
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$/.test(text)) {
    const withTime = /[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
    const datePart = text.split(/[ T]/)[0]!;
    const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(datePart);
    if (!m) return 'DATE_INVALID';
    return {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      hour: withTime ? Number(withTime[1]) : 0,
      minute: withTime ? Number(withTime[2]) : 0,
      second: withTime?.[3] ? Number(withTime[3]) : 0,
    };
  }

  if (/^\d{8}$/.test(text)) {
    return atMidnight(Number(text.slice(0, 4)), Number(text.slice(4, 6)), Number(text.slice(6, 8)));
  }

  const slash = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(text);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = Number(slash[3]);

    if (first > 12 && second <= 12) return atMidnight(year, second, first);
    if (second > 12 && first <= 12) return atMidnight(year, first, second);
    return 'DATE_AMBIGUOUS';
  }

  return 'DATE_INVALID';
}

function atMidnight(year: number, month: number, day: number): DateParts {
  return { year, month, day, hour: 0, minute: 0, second: 0 };
}

function isValidDate(year: number, month: number, day: number, hour: number, minute: number, second: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  if (second < 0 || second > 59) return false;
  return true;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** 用户时区下的 YYYY-MM-DD，用于指纹与按日去重 */
export function localDateKey(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}
