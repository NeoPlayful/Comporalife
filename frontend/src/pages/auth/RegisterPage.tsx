import { authApi } from '@/lib/auth';
import { translateError } from '@/lib/error-message';
import { ApiError } from '@/lib/client';
import AuthLayout from '@/components/layout/AuthLayout';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

export default function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const language = useUiStore((state) => state.language);
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError(t('auth:register.error_mismatch'));
      return;
    }

    setSubmitting(true);
    try {
      // 传当前界面语言，注册时生成的系统分类按该语言命名
      const result = await authApi.register({ email, password, nickname, language });
      setAuth(result.user, result.accessToken);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.code === 'EMAIL_EXISTS' ? t('auth:register.error_exists') : translateError(err, t));
      } else {
        setError(translateError(err, t));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title={t('auth:register.title')} subtitle={t('auth:register.subtitle')}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="nickname" className="mb-1 block text-sm text-[var(--color-content-muted)]">
            {t('auth:register.nickname')}
          </label>
          <input
            id="nickname"
            required
            maxLength={50}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </div>

        <div>
          <label htmlFor="email" className="mb-1 block text-sm text-[var(--color-content-muted)]">
            {t('auth:register.email')}
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
            {t('auth:register.password')}
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
          <p className="mt-1 text-xs text-[var(--color-content-muted)]">
            {t('auth:register.password_hint')}
          </p>
        </div>

        <div>
          <label htmlFor="confirm" className="mb-1 block text-sm text-[var(--color-content-muted)]">
            {t('auth:register.confirm')}
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
          className="w-full rounded-lg bg-[var(--color-accent)] py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {submitting ? t('auth:register.submitting') : t('auth:register.submit')}
        </button>

        <p className="text-center text-sm text-[var(--color-content-muted)]">
          {t('auth:register.have_account')}
          <Link to="/login" className="ml-1 hover:text-[var(--color-accent)]">
            {t('auth:register.login_link')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
