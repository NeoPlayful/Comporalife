import type { BudgetLevel } from '@/lib/budgets';
import { useTranslation } from 'react-i18next';

const LEVEL_COLORS: Record<BudgetLevel, string> = {
  ok: 'bg-[#4ea87c]',
  warning: 'bg-[#d3a35a]',
  exceeded: 'bg-[#c76a5e]',
  unknown: 'bg-black/25 dark:bg-white/25',
};

/**
 * 进度条状态同时用颜色与文字表达，不只靠颜色区分。
 */
export default function BudgetProgressBar({
  usageRatio,
  level,
}: {
  usageRatio: string | null;
  level: BudgetLevel;
}) {
  const { t } = useTranslation('budgets');
  const percent = usageRatio === null ? 0 : Math.min(Number(usageRatio) * 100, 100);

  return (
    <div className="space-y-1">
      <div className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${LEVEL_COLORS[level]}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-[var(--color-content-muted)]">
        <span>
          {usageRatio === null ? '—' : t('summary.usage', { value: `${(Number(usageRatio) * 100).toFixed(1)}%` })}
        </span>
        <span
          className={
            level === 'exceeded'
              ? 'text-[var(--color-negative)]'
              : level === 'warning'
                ? 'text-[#d3a35a]'
                : undefined
          }
        >
          {t(`status.${level}`)}
        </span>
      </div>
    </div>
  );
}
