import { ApiError } from '@/lib/client';
import { translateError } from '@/lib/error-message';
import { authApi } from '@/lib/auth';
import AuthLayout from '@/components/layout/AuthLayout';
import { useAuthStore } from '@/stores/auth-store';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((state) => state.setAuth);
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await authApi.login({ email, password });
      setAuth(result.user, result.accessToken);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.code === 'USER_DISABLED'
            ? t('auth:login.error_disabled')
            : err.status === 429
              ? t('auth:login.error_rate_limited')
              : t('auth:login.error_credentials'),
        );
      } else {
        setError(translateError(err, t));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title={t('auth:login.title')} subtitle={t('auth:login.subtitle')}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm text-[var(--color-content-muted)]">
            {t('auth:login.email')}
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-sm text-[var(--color-content-muted)]">
            {t('auth:login.password')}
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
          className="w-full rounded-lg bg-[var(--color-accent)] py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {submitting ? t('auth:login.submitting') : t('auth:login.submit')}
        </button>

        <div className="flex items-center justify-between text-sm text-[var(--color-content-muted)]">
          <Link to="/register" className="hover:text-[var(--color-accent)]">
            {t('auth:login.register_link')}
          </Link>
          <Link to="/forgot-password" className="hover:text-[var(--color-accent)]">
            {t('auth:login.forgot_link')}
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}
