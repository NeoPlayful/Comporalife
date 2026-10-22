import { useTranslation } from 'react-i18next';

export default function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation('common');

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16" role="status" aria-live="polite">
      <div className="size-6 animate-spin rounded-full border-2 border-[var(--color-border-subtle)] border-t-[var(--color-accent)]" />
      <p className="text-sm text-[var(--color-content-muted)]">{label ?? t('actions.loading')}</p>
    </div>
  );
}
