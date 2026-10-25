import LoadingState from '@/components/ui/LoadingState';
import { adminApi } from '@/lib/admin';
import { ApiError } from '@/lib/client';
import { translateError } from '@/lib/error-message';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/** 单个开关卡片：改动即生效，因此高风险项需要二次确认 */
function ToggleCard({
  title,
  hint,
  enabled,
  canWrite,
  pending,
  onToggle,
}: {
  title: string;
  hint: string;
  enabled: boolean;
  canWrite: boolean;
  pending: boolean;
  onToggle: (next: boolean) => void;
}) {
  const { t } = useTranslation('admin');

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] py-3 last:border-0">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-[var(--color-content-muted)]">{hint}</p>
      </div>
      <button
        type="button"
        onClick={() => onToggle(!enabled)}
        disabled={!canWrite || pending}
        className={`rounded-lg px-3 py-1.5 text-xs text-white disabled:opacity-50 ${
          enabled ? 'bg-emerald-600' : 'bg-red-600'
        }`}
      >
        {enabled ? t('settings.on') : t('settings.off')}
      </button>
    </div>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-border-subtle)] py-2 last:border-0">
      <span className="text-sm">{label}</span>
      <span className="font-mono text-xs text-[var(--color-content-muted)]">{value}</span>
    </div>
  );
}

export default function AdminSettingsPage() {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const overview = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => adminApi.settingsOverview() });

  const save = useMutation({
    mutationFn: (input: { registration?: boolean; emailVerification?: boolean }) =>
      input.registration !== undefined
        ? adminApi.setRegistration(input.registration)
        : adminApi.setEmailVerification(Boolean(input.emailVerification)),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => setError(err instanceof ApiError ? translateError(err, t) : String(err)),
  });

  if (overview.isLoading) return <LoadingState />;

  const data = overview.data;
  const canWrite = data?.capabilities.canWriteSettings ?? false;

  return (
    <div className="max-w-3xl space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t('settings.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('settings.subtitle')}</p>
      </header>

      {!canWrite && data && (
        <p className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
          {t('settings.read_only')}
        </p>
      )}

      {error && <p className="text-sm text-[var(--color-negative)]">{error}</p>}

      <section className="card px-4 py-2">
        <h2 className="py-2 text-sm font-semibold">{t('settings.access')}</h2>
        <ToggleCard
          title={t('settings.registration')}
          hint={t('settings.registration_hint')}
          enabled={data?.registrationEnabled ?? false}
          canWrite={canWrite}
          pending={save.isPending}
          onToggle={(next) => {
            if (!next && !window.confirm(t('settings.registration_off_confirm'))) return;
            save.mutate({ registration: next });
          }}
        />
        <ToggleCard
          title={t('settings.email_verification')}
          hint={t('settings.email_verification_hint')}
          enabled={data?.emailVerificationEnabled ?? false}
          canWrite={canWrite}
          pending={save.isPending}
          onToggle={(next) => {
            // 没有 SMTP 时开启等于承诺一件做不到的事
            if (next && !data?.mailConfigured && !window.confirm(t('settings.no_mail_confirm'))) return;
            save.mutate({ emailVerification: next });
          }}
        />
      </section>

      <section className="card px-4 py-2">
        <h2 className="py-2 text-sm font-semibold">{t('settings.runtime')}</h2>
        <ReadOnlyRow
          label={t('settings.mail')}
          value={data?.mailConfigured ? t('settings.mail_configured') : t('settings.mail_not_configured')}
        />
        <ReadOnlyRow
          label={t('settings.cooling_off')}
          value={t('settings.days', { count: data?.deletionCoolingOffDays ?? 0 })}
        />
        <ReadOnlyRow
          label={t('settings.audit_retention')}
          value={t('settings.days', { count: data?.auditLogRetentionDays ?? 0 })}
        />
        <p className="py-2 text-xs text-[var(--color-content-muted)]">{t('settings.env_hint')}</p>
      </section>
    </div>
  );
}
