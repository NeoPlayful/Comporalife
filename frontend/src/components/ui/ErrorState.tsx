import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation('common');

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center" role="alert">
      <AlertTriangle className="size-8 text-[var(--color-negative)]" aria-hidden />
      <p className="text-sm text-[var(--color-content)]">{message ?? t('state.load_failed')}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
        >
          {t('actions.retry')}
        </button>
      )}
    </div>
  );
}
