import CurrencyFlag, {
  currencyOptionLabel,
  sortedCurrencyCodes,
} from '@/components/finance/CurrencyFlag';
import { currentLocale } from '@/lib/format';

/**
 * 币种选择器。
 *
 * 原生 <option> 不能包含 SVG，所以旗帜画在下拉框左侧表示「当前选中项」，
 * 选项本身则用「代码 · 名称」区分——三十多个币种只列三字母代码已经没法用。
 * 常用币种排在前面，其余按字母序，避免新加的小币种把 USD、CNY 挤到中间。
 */
export default function CurrencySelect({
  value,
  onChange,
  disabled,
  className = '',
  id,
  name,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
}) {
  const locale = currentLocale();
  const codes = sortedCurrencyCodes();

  return (
    <span className={`relative flex items-center ${className}`}>
      <span className="pointer-events-none absolute left-2.5 flex items-center">
        <CurrencyFlag code={value} className="size-4" />
      </span>
      <select
        id={id}
        name={name}
        className={`input w-full ${value ? 'pl-8' : ''}`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {codes.map((code) => (
          <option key={code} value={code}>
            {currencyOptionLabel(code, locale)}
          </option>
        ))}
      </select>
    </span>
  );
}
