import type { QualityMetric } from '@/lib/data-management';
import { AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  metrics: QualityMetric[];
  onSelect: (key: string) => void;
  activeKey: string | null;
}

export default function QualitySummaryCards({ metrics, onSelect, activeKey }: Props) {
  const { t } = useTranslation('data');

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {metrics.map((metric) => {
        const unavailable = metric.count === null;
        const hasIssue = metric.count !== null && metric.count > 0;
        const active = activeKey === metric.key;

        return (
          <button
            key={metric.key}
            type="button"
            onClick={() => onSelect(metric.key)}
            className={`rounded-xl border p-3 text-left transition-colors ${
              active
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] hover:border-[var(--color-accent)]/50'
            }`}
          >
            <div className="flex items-center gap-1.5">
              {unavailable ? (
                <HelpCircle className="size-4 text-[var(--color-content-muted)]" aria-hidden />
              ) : hasIssue ? (
                <AlertTriangle className="size-4 text-amber-500" aria-hidden />
              ) : (
                <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
              )}
              <p className="min-w-0 truncate text-xs text-[var(--color-content-muted)]">
                {t(`quality.metrics.${metric.key}`)}
              </p>
            </div>

            {/* 不可用时显示原因而不是 0：0 会被读成「没有问题」 */}
            {unavailable ? (
              <p className="mt-2 text-xs text-[var(--color-content-muted)]">
                {metric.unavailableReason ? t(`quality.unavailable.${metric.unavailableReason}`) : '—'}
              </p>
            ) : (
              <p className="mt-2 text-xl font-semibold tabular-nums">{metric.count}</p>
            )}
          </button>
        );
      })}
    </div>
  );
}
