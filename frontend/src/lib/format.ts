import i18n from '@/i18n';
import { CURRENCY_NAMES } from '@/utils/constants';

export type DateFormatPattern = 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';

export function currentLocale(): string {
  return i18n.resolvedLanguage ?? i18n.language ?? 'zh-CN';
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function parseDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 币种显示名：按当前语言取中文或英文名，未知币种退回代码 */
export function currencyName(code: string): string {
  const name = CURRENCY_NAMES[code];
  if (!name) return code;
  return currentLocale().startsWith('zh') ? name.zh : name.en;
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
 * 价格是 DECIMAL(20,8)。
 * 用 formatNumber 的默认位数会截断报价的有效位，这里按字段位宽给上限。
 */
export function formatPrice(value: number | string | null | undefined): string {
  return formatNumber(value, { maximumFractionDigits: 8 });
}

/** 常规汇率的展示位数 */
const RATE_DISPLAY_DIGITS = 4;
/** 极小汇率的展示位数：4 位会把它们抹成 0.0000 */
const SMALL_RATE_DISPLAY_DIGITS = 8;
/** 小于这个值的汇率按极小汇率处理，例如 VND、IDR 的反向报价 */
const SMALL_RATE_THRESHOLD = 0.01;

/**
 * 汇率展示。
 *
 * 存储仍是 DECIMAL(20,10)：小币种的反向报价（1 VND ≈ 0.0000387 USD）在写库时
 * 就需要 10 位才有意义，截断存储会让它归零，折算随之失败。展示收窄到 4 位只是
 * 让表格可读，不参与任何计算。
 *
 * 小于 0.01 的汇率放开到 8 位，否则越南盾、印尼盾这类币种会显示成 0.0000，
 * 看起来像没有数据。
 */
export function formatRate(value: number | string | null | undefined): string {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (numeric == null || Number.isNaN(numeric)) return '—';

  const digits =
    numeric !== 0 && Math.abs(numeric) < SMALL_RATE_THRESHOLD
      ? SMALL_RATE_DISPLAY_DIGITS
      : RATE_DISPLAY_DIGITS;

  return formatNumber(numeric, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * 去掉小数末尾的零，用于把接口返回的定长字符串放回输入框。
 * 不能用 Number(x).toString()：极小汇率会被转成 1.23e-8，提交时校验不通过。
 */
export function trimTrailingZeros(value: string): string {
  if (!value.includes('.')) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '');
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
