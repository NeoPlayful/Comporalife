import { useTranslation } from 'react-i18next';

export default function BudgetCarryoverNote({
  rollover,
  chain,
  truncated,
}: {
  rollover: boolean;
  chain: number;
  truncated: boolean;
}) {
  const { t } = useTranslation('budgets');

  if (!rollover) {
    return <p className="text-xs text-[var(--color-content-muted)]">{t('carryover.disabled')}</p>;
  }

  return (
    <div className="space-y-1 text-xs text-[var(--color-content-muted)]">
      <p>{t('carryover.body', { count: chain })}</p>
      {truncated && <p>{t('carryover.truncated')}</p>}
    </div>
  );
}
