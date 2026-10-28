import { authApi } from '@/lib/auth';
import { translateError } from '@/lib/error-message';
import AuthLayout from '@/components/layout/AuthLayout';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const { t } = useTranslation('auth');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError(t('register.error_mismatch'));
      return;
    }

    setSubmitting(true);
    try {
      await authApi.resetPassword({ token, newPassword: password });
      setDone(true);
    } catch (err) {
      setError(translateError(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout title={t('reset.invalid_title')}>
        <p className="text-sm text-[var(--color-content-muted)]">{t('reset.invalid_body')}</p>
        <Link to="/forgot-password" className="mt-4 block text-center text-sm hover:text-[var(--color-accent)]">
          {t('reset.reapply')}
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('reset.title')}>
      {done ? (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-content-muted)]">{t('reset.done')}</p>
          <Link
            to="/login"
            className="block rounded-lg btn-action py-2 text-center text-sm font-medium"
          >
            {t('reset.relogin')}
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="mb-1 block text-sm text-[var(--color-content-muted)]">
              {t('reset.password')}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </div>

          <div>
            <label htmlFor="confirm" className="mb-1 block text-sm text-[var(--color-content-muted)]">
              {t('reset.confirm')}
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
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
            {submitting ? t('reset.submitting') : t('reset.submit')}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
