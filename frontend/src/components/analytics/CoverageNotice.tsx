import type { Coverage } from '@/lib/analytics';
import { formatNumber } from '@/lib/format';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

/**
 * 覆盖率提示：分类图表只展示已分类部分，
 * 不给这一行提示，用户会把「已分类」误读成「全部支出」。
 */
export default function CoverageNotice({ coverage }: { coverage: Coverage }) {
  const { t } = useTranslation('analytics');

  const hasUncategorized = coverage.uncategorizedCount > 0;
  const hasMissingRates = coverage.missingRates.length > 0;

  if (!hasUncategorized && !hasMissingRates) return null;

  return (
    <div className="rounded-lg bg-[var(--color-warning)]/10 px-3 py-2 text-sm">
      <p className="flex items-center gap-1.5 font-medium text-[var(--color-warning)]">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {t('coverage.title', {
          ratio: coverage.coverageRatio
            ? `${(Number(coverage.coverageRatio) * 100).toFixed(1)}%`
            : '—',
        })}
      </p>
      {hasUncategorized && (
        <p className="mt-1 text-[var(--color-content-muted)]">
          {t('coverage.body', {
            amount: formatNumber(coverage.uncategorizedAmount),
            count: coverage.uncategorizedCount,
          })}{' '}
          <Link to="/transactions?uncategorized=true" className="underline">
            {t('coverage.action')}
          </Link>
        </p>
      )}
      {hasMissingRates && (
        <p className="mt-1 text-[var(--color-content-muted)]">
          {t('coverage.missing_rates', {
            currencies: [...new Set(coverage.missingRates.map((item) => item.currency))].join(', '),
          })}
        </p>
      )}
    </div>
  );
}
