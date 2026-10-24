import { adminApi } from '@/lib/admin';
import { ApiError } from '@/lib/client';
import { translateError } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function AdminAdminsPage() {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const admins = useQuery({ queryKey: ['admin', 'admins'], queryFn: () => adminApi.admins() });

  const act = useMutation({
    mutationFn: (input: { id: string; action: 'grant' | 'revoke' }) =>
      input.action === 'grant' ? adminApi.grant(input.id) : adminApi.revoke(input.id),
    onSuccess: () => {
      setError(null);
      setTargetId('');
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => setError(err instanceof ApiError ? translateError(err, t) : String(err)),
  });

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t('admins.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('subtitle')}</p>
      </header>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="block text-[var(--color-content-muted)]">{t('admins.grant_hint')}</span>
          <input
            className="input mt-1 w-64"
            placeholder={t('admins.grant_placeholder')}
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={!targetId || act.isPending}
          onClick={() => act.mutate({ id: targetId, action: 'grant' })}
          className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {t('admins.grant')}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {admins.data && (
        <ul className="divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)]">
          {admins.data.admins.length === 0 && (
            <li className="p-3 text-sm text-[var(--color-content-muted)]">{t('admins.empty')}</li>
          )}

          {admins.data.admins.map((admin) => (
            <li key={admin.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div>
                <p className="font-medium">
                  {admin.email} · {t(`roles.${admin.role}`)}
                </p>
                <p className="text-xs text-[var(--color-content-muted)]">{formatDateTime(admin.createdAt)}</p>
              </div>

              {admin.role === 'admin' && (
                <button
                  type="button"
                  onClick={() => act.mutate({ id: admin.id, action: 'revoke' })}
                  className="rounded-lg border border-red-500/40 px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400"
                >
                  {t('admins.revoke')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
