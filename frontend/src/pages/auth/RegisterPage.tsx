import { authApi } from '@/api/auth';
import { ApiError } from '@/api/client';
import AuthLayout from '@/components/layout/AuthLayout';
import { useAuthStore } from '@/stores/auth-store';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);

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
      setError('两次输入的密码不一致');
      return;
    }

    setSubmitting(true);
    try {
      const result = await authApi.register({ email, password, nickname });
      setAuth(result.user, result.accessToken);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.code === 'EMAIL_EXISTS' ? '该邮箱已被注册' : err.message);
      } else {
        setError('网络异常，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="创建账号" subtitle="数据保存在你自己的部署中">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="nickname" className="mb-1 block text-sm text-[var(--color-content-muted)]">
            昵称
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
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <p className="mt-1 text-xs text-[var(--color-content-muted)]">至少 8 位，需包含字母和数字</p>
        </div>

        <div>
          <label htmlFor="confirm" className="mb-1 block text-sm text-[var(--color-content-muted)]">
            确认密码
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
          {submitting ? '创建中…' : '创建账号'}
        </button>

        <p className="text-center text-sm text-[var(--color-content-muted)]">
          已有账号？
          <Link to="/login" className="ml-1 hover:text-[var(--color-accent)]">
            去登录
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
