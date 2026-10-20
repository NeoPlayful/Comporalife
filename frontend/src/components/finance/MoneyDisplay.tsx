import { CURRENCY_DECIMALS } from '@/utils/constants';

interface MoneyDisplayProps {
  /** 后端返回的十进制字符串，避免浮点误差 */
  amount: string | number;
  currency?: string;
  /** 是否显示正负号颜色 */
  colorize?: boolean;
  className?: string;
}

function formatAmount(amount: string | number, decimals: number): string {
  const numeric = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(numeric)) return '—';

  return numeric.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export default function MoneyDisplay({
  amount,
  currency = 'CNY',
  colorize = false,
  className = '',
}: MoneyDisplayProps) {
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  const numeric = typeof amount === 'string' ? Number(amount) : amount;
  const tone = colorize
    ? numeric > 0
      ? 'text-[var(--color-positive)]'
      : numeric < 0
        ? 'text-[var(--color-negative)]'
        : ''
    : '';

  return (
    <span className={`tabular-nums ${tone} ${className}`}>
      {formatAmount(amount, decimals)}
      <span className="ml-1 text-xs text-[var(--color-content-muted)]">{currency}</span>
    </span>
  );
}
