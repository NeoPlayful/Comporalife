import { authApi } from '@/api/auth';
import AuthLayout from '@/components/layout/AuthLayout';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }

    setSubmitting(true);
    try {
      await authApi.resetPassword({ token, newPassword: password });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置失败，链接可能已过期');
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout title="链接无效">
        <p className="text-sm text-[var(--color-content-muted)]">重置链接缺少令牌，请重新申请。</p>
        <Link to="/forgot-password" className="mt-4 block text-center text-sm hover:text-[var(--color-accent)]">
          重新申请
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="设置新密码">
      {done ? (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-content-muted)]">
            密码已重置，所有设备上的登录会话均已失效。
          </p>
          <Link
            to="/login"
            className="block rounded-lg bg-[var(--color-accent)] py-2 text-center text-sm font-medium text-white"
          >
            重新登录
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="mb-1 block text-sm text-[var(--color-content-muted)]">
              新密码
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
              确认新密码
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
            {submitting ? '提交中…' : '重置密码'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
