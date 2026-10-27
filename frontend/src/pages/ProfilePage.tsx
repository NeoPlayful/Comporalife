import { authApi } from '@/lib/auth';
import { translateError } from '@/lib/error-message';
import { toastError, toastSuccess } from '@/lib/toast';
import { formatDateTime } from '@/lib/format';
import LoadingState from '@/components/ui/LoadingState';
import { useAuthStore } from '@/stores/auth-store';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function ProfilePage() {
  const user = useAuthStore((state) => state.user);
  const clear = useAuthStore((state) => state.clear);
  const queryClient = useQueryClient();
  const { t } = useTranslation('settings');

  const [nickname, setNickname] = useState(user?.nickname ?? '');

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const sessionsQuery = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: authApi.sessions,
  });

  const updateProfile = useMutation({
    mutationFn: () => authApi.updateProfile({ nickname }),
    onSuccess: () => {
      toastSuccess(t('profile.nickname_updated'));
      queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
    onError: (err) => toastError(translateError(err, t)),
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
    onError: (err) => toastError(translateError(err, t)),
  });

  const revokeSession = useMutation({
    mutationFn: (id: string) => authApi.revokeSession(id),
    onSuccess: () => {
      toastSuccess(t('profile.sessions.revoked'));
      queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
  });

  const revokeOthers = useMutation({
    mutationFn: () => authApi.revokeOtherSessions(),
    onSuccess: () => {
      toastSuccess(t('profile.sessions.revoked_others'));
      queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
  });

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">{t('profile.title')}</h1>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-medium">{t('profile.basic')}</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--color-content-muted)]">
              {t('profile.email')}
            </span>
            <input
              value={user?.email ?? ''}
              readOnly
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-black/5 px-3 py-2 text-sm text-[var(--color-content-muted)] dark:bg-white/5"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--color-content-muted)]">
              {t('profile.nickname')}
            </span>
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
          {updateProfile.isPending ? t('profile.saving') : t('profile.save')}
        </button>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-medium">{t('profile.password.title')}</h2>
        <p className="text-xs text-[var(--color-content-muted)]">{t('profile.password.hint')}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--color-content-muted)]">
              {t('profile.password.current')}
            </span>
            <input
              type="password"
              autoComplete="current-password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--color-content-muted)]">
              {t('profile.password.new')}
            </span>
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
          {changePassword.isPending ? t('profile.password.submitting') : t('profile.password.submit')}
        </button>
      </section>

      <section className="card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">{t('profile.sessions.title')}</h2>
          <button
            type="button"
            onClick={() => revokeOthers.mutate()}
            disabled={revokeOthers.isPending}
            className="text-sm text-[var(--color-content-muted)] hover:text-[var(--color-negative)]"
          >
            {t('profile.sessions.revoke_others')}
          </button>
        </div>

        {sessionsQuery.isLoading && <LoadingState label={t('profile.sessions.loading')} />}

        {sessionsQuery.data && (
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {sessionsQuery.data.sessions.map((session) => (
              <li key={session.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {session.userAgent ?? t('profile.sessions.unknown_device')}
                    {session.current && (
                      <span className="ml-2 rounded bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-xs text-[var(--color-accent)]">
                        {t('profile.sessions.current_badge')}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--color-content-muted)]">
                    {session.ip ?? t('profile.sessions.no_ip')} ·{' '}
                    {t('profile.sessions.last_used', {
                      time: formatDateTime(session.lastUsedAt ?? session.createdAt),
                    })}
                  </p>
                </div>

                {!session.current && (
                  <button
                    type="button"
                    onClick={() => revokeSession.mutate(session.id)}
                    className="shrink-0 text-sm text-[var(--color-content-muted)] hover:text-[var(--color-negative)]"
                  >
                    {t('profile.sessions.revoke')}
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
