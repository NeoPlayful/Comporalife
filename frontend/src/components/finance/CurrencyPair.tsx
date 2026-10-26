import CurrencyFlag from '@/components/finance/CurrencyFlag';

/**
 * 币种对展示：旗帜 + 等宽代码。
 *
 * 汇率表里同一屏内会出现大量三字母代码，单靠文字很难快速扫读；
 * 旗帜提供的是「一眼定位到哪一对」的视觉锚点，因此这里让旗帜承担辨认，
 * 代码仍然保留——旗帜不应该成为唯一的信息来源。
 */
export default function CurrencyPair({
  from,
  to,
  className = '',
}: {
  from: string;
  to: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <CurrencyFlag code={from} className="size-3.5" />
      <span className="font-mono">{from}</span>
      <span className="text-[var(--color-content-muted)]">→</span>
      <CurrencyFlag code={to} className="size-3.5" />
      <span className="font-mono">{to}</span>
    </span>
  );
}
