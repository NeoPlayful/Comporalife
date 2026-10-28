import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  const { t } = useTranslation('common');

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <p className="text-5xl font-bold text-[var(--color-content-muted)]">404</p>
      <p className="text-sm text-[var(--color-content-muted)]">{t('not_found.title')}</p>
      <Link
        to="/dashboard"
        className="rounded-lg btn-action px-4 py-2 text-sm font-medium"
      >
        {t('not_found.back_dashboard')}
      </Link>
    </div>
  );
}
