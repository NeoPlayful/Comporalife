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
  const [keyword, setKeyword] = useState('');
  /** 已提交的关键词：搜索是显式动作，避免每次输入都查库 */
  const [submitted, setSubmitted] = useState('');
  const [error, setError] = useState<string | null>(null);

  const admins = useQuery({ queryKey: ['admin', 'admins'], queryFn: () => adminApi.admins() });

  const candidates = useQuery({
    queryKey: ['admin', 'user-search', submitted],
    queryFn: () => adminApi.searchUsers(submitted),
    enabled: submitted.length >= 2,
  });

  const act = useMutation({
    mutationFn: (input: { id: string; action: 'grant' | 'revoke' }) =>
      input.action === 'grant' ? adminApi.grant(input.id) : adminApi.revoke(input.id),
    onSuccess: () => {
      setError(null);
      setKeyword('');
      setSubmitted('');
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

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(keyword.trim());
        }}
      >
        <label className="text-xs">
          <span className="block text-[var(--color-content-muted)]">{t('admins.grant_hint')}</span>
          <input
            className="input mt-1 w-64"
            placeholder={t('admins.grant_placeholder')}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={keyword.trim().length < 2}
          className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {t('admins.search')}
        </button>
      </form>

      {error && <p className="text-sm text-[var(--color-negative)]">{error}</p>}

      {submitted.length >= 2 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">{t('admins.candidates')}</h2>
          {candidates.isLoading && (
            <p className="text-xs text-[var(--color-content-muted)]">{t('common:actions.loading')}</p>
          )}
          {candidates.isError && <p className="text-xs text-[var(--color-negative)]">{t('users.load_failed')}</p>}
          {candidates.data && candidates.data.users.length === 0 && (
            <p className="text-sm text-[var(--color-content-muted)]">{t('admins.no_candidates')}</p>
          )}
          {candidates.data && candidates.data.users.length > 0 && (
            <ul className="divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)]">
              {candidates.data.users.map((candidate) => (
                <li key={candidate.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {candidate.email} · {t(`roles.${candidate.role}`)}
                    </p>
                    <p className="text-xs text-[var(--color-content-muted)]">
                      {candidate.nickname} · {t(`statuses.${candidate.status}`)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={act.isPending || candidate.role !== 'user'}
                    title={candidate.role !== 'user' ? t('admins.already_admin') : undefined}
                    onClick={() => {
                      if (window.confirm(t('admins.grant_confirm', { email: candidate.email }))) {
                        act.mutate({ id: candidate.id, action: 'grant' });
                      }
                    }}
                    className="rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-xs disabled:opacity-40"
                  >
                    {candidate.role === 'user' ? t('admins.grant') : t('admins.already_admin')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">{t('admins.current')}</h2>
        {admins.data && admins.data.admins.length === 0 && (
          <p className="text-sm text-[var(--color-content-muted)]">{t('admins.empty')}</p>
        )}
        {admins.data && admins.data.admins.length > 0 && (
          <ul className="divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)]">
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
                    disabled={act.isPending}
                    onClick={() => {
                      if (window.confirm(t('admins.revoke_confirm', { email: admin.email }))) {
                        act.mutate({ id: admin.id, action: 'revoke' });
                      }
                    }}
                    className="rounded-lg border border-red-500/40 px-2.5 py-1.5 text-xs text-red-600 disabled:opacity-50 dark:text-red-400"
                  >
                    {t('admins.revoke')}
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
