import { authApi } from '@/api/auth';
import AuthLayout from '@/components/layout/AuthLayout';
import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch {
      setError('邮件服务暂不可用，请联系站点管理员配置 SMTP');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="找回密码" subtitle="我们会向你的邮箱发送重置链接">
      {sent ? (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-content-muted)]">
            如果该邮箱已注册，重置链接已发送。链接 30 分钟内有效，且只能使用一次。
          </p>
          <Link
            to="/login"
            className="block rounded-lg border border-[var(--color-border-subtle)] py-2 text-center text-sm"
          >
            返回登录
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-[var(--color-content-muted)]">
              邮箱
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
            className="w-full rounded-lg bg-[var(--color-accent)] py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {submitting ? '发送中…' : '发送重置链接'}
          </button>

          <p className="text-center text-sm text-[var(--color-content-muted)]">
            <Link to="/login" className="hover:text-[var(--color-accent)]">
              返回登录
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
