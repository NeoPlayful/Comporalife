import { ApiError } from '@/lib/client';
import { authApi } from '@/lib/auth';
import AuthLayout from '@/components/layout/AuthLayout';
import { useAuthStore } from '@/stores/auth-store';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((state) => state.setAuth);

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
            ? '账号已被禁用，请联系管理员'
            : err.status === 429
              ? '尝试次数过多，请稍后再试'
              : '邮箱或密码错误',
        );
      } else {
        setError('网络异常，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="登录 Comporalife" subtitle="管理你的资产、现金流与长期复利">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm text-[var(--color-content-muted)]">
            邮箱
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
            密码
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
          {submitting ? '登录中…' : '登录'}
        </button>

        <div className="flex items-center justify-between text-sm text-[var(--color-content-muted)]">
          <Link to="/register" className="hover:text-[var(--color-accent)]">
            注册账号
          </Link>
          <Link to="/forgot-password" className="hover:text-[var(--color-accent)]">
            忘记密码
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}
