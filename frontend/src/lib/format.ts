import i18n from '@/i18n';

export type DateFormatPattern = 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';

function currentLocale(): string {
  return i18n.resolvedLanguage ?? i18n.language ?? 'zh-CN';
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function parseDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 数字按当前语言格式化千分位，保留调用方指定的小数位 */
export function formatNumber(
  value: number | string | null | undefined,
  options: Intl.NumberFormatOptions = {},
): string {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (numeric == null || Number.isNaN(numeric)) return '—';

  return numeric.toLocaleString(currentLocale(), options);
}

/**
 * 日期按用户偏好格式输出。
 * 用户显式选择的 pattern 优先，未指定时按语言给默认顺序。
 */
export function formatDate(
  value: string | number | Date | null | undefined,
  pattern?: DateFormatPattern,
): string {
  if (value == null || value === '') return '—';

  const date = parseDate(value);
  if (!date) return '—';

  const resolved =
    pattern ??
    (currentLocale().toLowerCase().startsWith('en') ? 'MM/DD/YYYY' : 'YYYY-MM-DD');

  const year = String(date.getFullYear());
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());

  if (resolved === 'DD/MM/YYYY') return `${day}/${month}/${year}`;
  if (resolved === 'MM/DD/YYYY') return `${month}/${day}/${year}`;
  return `${year}-${month}-${day}`;
}

/** 日期时间，时间部分跟随语言惯用格式 */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  pattern?: DateFormatPattern,
): string {
  if (value == null || value === '') return '—';

  const date = parseDate(value);
  if (!date) return '—';

  const datePart = formatDate(date, pattern);
  const timePart = date.toLocaleTimeString(currentLocale(), {
    hour: '2-digit',
    minute: '2-digit',
  });

  return `${datePart} ${timePart}`;
}
