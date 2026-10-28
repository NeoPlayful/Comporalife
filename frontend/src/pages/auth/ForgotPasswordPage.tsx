import { authApi } from '@/lib/auth';
import AuthLayout from '@/components/layout/AuthLayout';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { t } = useTranslation('auth');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch {
      setError(t('forgot.error_unavailable'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title={t('forgot.title')} subtitle={t('forgot.subtitle')}>
      {sent ? (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-content-muted)]">{t('forgot.sent')}</p>
          <Link
            to="/login"
            className="block rounded-lg border border-[var(--color-border-subtle)] py-2 text-center text-sm"
          >
            {t('forgot.back_login')}
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-[var(--color-content-muted)]">
              {t('forgot.email')}
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg btn-action py-2 text-sm font-medium"
          >
            {submitting ? t('forgot.submitting') : t('forgot.submit')}
          </button>

          <p className="text-center text-sm text-[var(--color-content-muted)]">
            <Link to="/login" className="hover:text-[var(--color-accent)]">
              {t('forgot.back_login')}
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
