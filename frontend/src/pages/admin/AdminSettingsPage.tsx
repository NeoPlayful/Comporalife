import LoadingState from '@/components/ui/LoadingState';
import SwitchRow from '@/components/ui/SwitchRow';
import { adminApi } from '@/lib/admin';
import { ApiError } from '@/lib/client';
import { translateError } from '@/lib/error-message';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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

  type SettingField = 'registration' | 'emailVerification' | 'adminUserCreate';

  const save = useMutation({
    mutationFn: (input: { field: SettingField; next: boolean }) => {
      if (input.field === 'registration') return adminApi.setRegistration(input.next);
      if (input.field === 'emailVerification') return adminApi.setEmailVerification(input.next);
      return adminApi.setAdminUserCreation(input.next);
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => setError(err instanceof ApiError ? translateError(err, t) : String(err)),
  });

  // 多个开关共用一次 mutation，只有正在提交的那一行才显示忙碌
  const savingKey: SettingField | null = save.isPending ? (save.variables?.field ?? null) : null;

  if (overview.isLoading) return <LoadingState />;

  const data = overview.data;
  const canWrite = data?.capabilities.canWriteSettings ?? false;
  // 代建开关的写权限是超管专属，比「能改设置」更窄
  const canManageAdmins = data?.capabilities.canManageAdmins ?? false;

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
        <SwitchRow
          title={t('settings.registration')}
          hint={t('settings.registration_hint')}
          checked={data?.registrationEnabled ?? false}
          disabled={!canWrite}
          disabledHint={!canWrite ? t('settings.read_only_short') : undefined}
          pending={savingKey === 'registration'}
          onLabel={t('settings.on')}
          offLabel={t('settings.off')}
          onCheckedChange={(next) => {
            if (!next && !window.confirm(t('settings.registration_off_confirm'))) return;
            save.mutate({ field: 'registration', next });
          }}
          className="border-b border-[var(--color-border-subtle)] py-3 last:border-0"
        />
        <SwitchRow
          title={t('settings.email_verification')}
          hint={t('settings.email_verification_hint')}
          checked={data?.emailVerificationEnabled ?? false}
          disabled={!canWrite}
          disabledHint={!canWrite ? t('settings.read_only_short') : undefined}
          pending={savingKey === 'emailVerification'}
          onLabel={t('settings.on')}
          offLabel={t('settings.off')}
          onCheckedChange={(next) => {
            // 没有 SMTP 时开启等于承诺一件做不到的事
            if (next && !data?.mailConfigured && !window.confirm(t('settings.no_mail_confirm'))) return;
            save.mutate({ field: 'emailVerification', next });
          }}
          className="border-b border-[var(--color-border-subtle)] py-3 last:border-0"
        />
        <SwitchRow
          title={t('settings.admin_user_create')}
          hint={
            canManageAdmins
              ? t('settings.admin_user_create_hint')
              : t('settings.admin_user_create_super_only')
          }
          checked={data?.adminUserCreateEnabled ?? false}
          disabled={!canManageAdmins}
          disabledHint={!canManageAdmins ? t('settings.admin_user_create_super_only') : undefined}
          pending={savingKey === 'adminUserCreate'}
          onLabel={t('settings.on')}
          offLabel={t('settings.off')}
          onCheckedChange={(next) => {
            if (next && !window.confirm(t('settings.admin_user_create_on_confirm'))) return;
            save.mutate({ field: 'adminUserCreate', next });
          }}
          className="border-b border-[var(--color-border-subtle)] py-3 last:border-0"
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
