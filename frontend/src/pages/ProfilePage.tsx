import { authApi } from '@/api/auth';
import { ApiError } from '@/api/client';
import LoadingState from '@/components/ui/LoadingState';
import { useAuthStore } from '@/stores/auth-store';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

export default function ProfilePage() {
  const user = useAuthStore((state) => state.user);
  const clear = useAuthStore((state) => state.clear);
  const queryClient = useQueryClient();

  const [nickname, setNickname] = useState(user?.nickname ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const sessionsQuery = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: authApi.sessions,
  });

  const updateProfile = useMutation({
    mutationFn: () => authApi.updateProfile({ nickname }),
    onSuccess: () => {
      setMessage('昵称已更新');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
    onError: (err) => {
      setMessage(null);
      setError(err instanceof ApiError ? err.message : '保存失败');
    },
  });

  const changePassword = useMutation({
    mutationFn: () => authApi.changePassword({ oldPassword, newPassword }),
    onSuccess: async () => {
      setOldPassword('');
      setNewPassword('');
      // 改密会撤销其他会话并使当前令牌失效，直接要求重新登录
      await authApi.logout().catch(() => undefined);
      clear();
      window.location.assign('/login');
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : '修改失败');
    },
  });

  const revokeSession = useMutation({
    mutationFn: (id: string) => authApi.revokeSession(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] }),
  });

  const revokeOthers = useMutation({
    mutationFn: () => authApi.revokeOtherSessions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] }),
  });

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">个人资料</h1>

      {(message || error) && (
        <p
          role="status"
          className={`rounded-lg px-3 py-2 text-sm ${
            error
              ? 'bg-[var(--color-negative)]/10 text-[var(--color-negative)]'
              : 'bg-[var(--color-positive)]/10 text-[var(--color-positive)]'
          }`}
        >
          {error ?? message}
        </p>
      )}

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-medium">基本信息</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--color-content-muted)]">邮箱</span>
            <input
              value={user?.email ?? ''}
              readOnly
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-black/5 px-3 py-2 text-sm text-[var(--color-content-muted)] dark:bg-white/5"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--color-content-muted)]">昵称</span>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={50}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => updateProfile.mutate()}
          disabled={updateProfile.isPending || nickname.trim().length === 0}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {updateProfile.isPending ? '保存中…' : '保存'}
        </button>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-medium">修改密码</h2>
        <p className="text-xs text-[var(--color-content-muted)]">
          修改后其他设备上的登录会立即失效，你需要重新登录。
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--color-content-muted)]">当前密码</span>
            <input
              type="password"
              autoComplete="current-password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--color-content-muted)]">新密码</span>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => changePassword.mutate()}
          disabled={changePassword.isPending || !oldPassword || newPassword.length < 8}
          className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 text-sm disabled:opacity-60"
        >
          {changePassword.isPending ? '提交中…' : '修改密码'}
        </button>
      </section>

      <section className="card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">登录会话</h2>
          <button
            type="button"
            onClick={() => revokeOthers.mutate()}
            disabled={revokeOthers.isPending}
            className="text-sm text-[var(--color-content-muted)] hover:text-[var(--color-negative)]"
          >
            退出其他设备
          </button>
        </div>

        {sessionsQuery.isLoading && <LoadingState label="加载会话…" />}

        {sessionsQuery.data && (
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {sessionsQuery.data.sessions.map((session) => (
              <li key={session.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {session.userAgent ?? '未知设备'}
                    {session.current && (
                      <span className="ml-2 rounded bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-xs text-[var(--color-accent)]">
                        当前
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--color-content-muted)]">
                    {session.ip ?? '未记录 IP'} · 最近使用{' '}
                    {new Date(session.lastUsedAt ?? session.createdAt).toLocaleString('zh-CN')}
                  </p>
                </div>

                {!session.current && (
                  <button
                    type="button"
                    onClick={() => revokeSession.mutate(session.id)}
                    className="shrink-0 text-sm text-[var(--color-content-muted)] hover:text-[var(--color-negative)]"
                  >
                    撤销
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
