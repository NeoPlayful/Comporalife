import { CURRENCY_FLAGS } from '@/utils/currency-flags';
import { CURRENCY_DECIMALS, CURRENCY_NAMES } from '@/utils/constants';
import {
  AE,
  AU,
  BR,
  CA,
  CH,
  CN,
  CZ,
  DK,
  EU,
  GB,
  HK,
  HU,
  ID,
  IL,
  IN,
  JP,
  KR,
  MX,
  MY,
  NO,
  NZ,
  PH,
  PL,
  SA,
  SE,
  SG,
  TH,
  TR,
  TW,
  US,
  VN,
  ZA,
} from 'country-flag-icons/react/3x2';
/**
 * 包自带的组件类型是 `(props: HTMLAttributes & SVGAttributes) => JSX.Element`，
 * 与 React.ComponentType 不兼容，直接推导签名而不是另写一份。
 */
type FlagComponent = typeof CN;

/**
 * 币种旗帜。
 *
 * 用自托管 SVG 而不是国旗 emoji：Windows 的 Segoe UI Emoji 不含国家旗帜字形，
 * Chrome 在 Windows 上会把 🇨🇳 渲染成「CN」两个字母，而 macOS 与移动端正常。
 * 这类「只在部分平台坏掉」的差异最难排查，所以直接不用 emoji。
 *
 * 这里逐个具名导入而不是 `import * as Flags`：命名空间导入会让打包器
 * 无法 tree-shake，把全部两百多个国家的旗帜都塞进产物（实测 236 kB）。
 *
 * 未登记或找不到组件时不渲染任何东西：留下来的空位比一个错旗更安全。
 */
const FLAG_COMPONENTS: Record<string, FlagComponent> = {
  AE,
  AU,
  BR,
  CA,
  CH,
  CN,
  CZ,
  DK,
  EU,
  GB,
  HK,
  HU,
  ID,
  IL,
  IN,
  JP,
  KR,
  MX,
  MY,
  NO,
  NZ,
  PH,
  PL,
  SA,
  SE,
  SG,
  TH,
  TR,
  TW,
  US,
  VN,
  ZA,
};

export default function CurrencyFlag({
  code,
  className = 'size-4',
}: {
  code: string;
  className?: string;
}) {
  const country = CURRENCY_FLAGS[code];
  if (!country) return null;

  const Flag = FLAG_COMPONENTS[country];
  if (!Flag) return null;

  const name = CURRENCY_NAMES[code];
  return (
    <Flag
      aria-label={name ? `${code} ${name.zh}` : code}
      role="img"
      className={`${className} shrink-0 rounded-[2px] object-cover`}
    />
  );
}

/**
 * 币种选项的显示文本。
 *
 * 只显示三字母代码在 12 个币种时还能忍，三十多个之后就无法在原生下拉里
 * 快速定位了，所以带上当前语言的名称。
 *
 * 注意原生 <option> 不能包含 SVG，旗帜无法画进选项里；旗帜放在下拉框旁边
 * 表示当前选中项，见 CurrencySelect。
 */
export function currencyOptionLabel(code: string, locale: string): string {
  const name = CURRENCY_NAMES[code];
  return name ? `${code} · ${locale.startsWith('zh') ? name.zh : name.en}` : code;
}

/** 供下拉排序：先按是否常用，再按代码字母序，避免大列表里常用币种被埋掉 */
const PRIORITY = [
  'CNY',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'HKD',
  'AUD',
  'CAD',
  'SGD',
  'KRW',
  'CHF',
  'TWD',
];

export function sortedCurrencyCodes(): string[] {
  const all = Object.keys(CURRENCY_DECIMALS);
  const priority = PRIORITY.filter((code) => all.includes(code));
  const rest = all.filter((code) => !PRIORITY.includes(code)).sort();
  return [...priority, ...rest];
}
