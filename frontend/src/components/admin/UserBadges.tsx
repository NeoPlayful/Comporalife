import type { AdminDeletionFilter, AdminRole, AdminUser } from '@/lib/admin';
import { useTranslation } from 'react-i18next';

const ROLE_CLASS: Record<AdminRole, string> = {
  super_admin: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  admin: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  user: 'bg-black/5 text-[var(--color-content-muted)] dark:bg-white/10',
};

const STATUS_CLASS: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  disabled: 'bg-red-500/10 text-red-600 dark:text-red-400',
  pending_verification: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
};

export function RoleBadge({ role }: { role: AdminRole }) {
  const { t } = useTranslation('admin');
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_CLASS[role]}`}>
      {t(`roles.${role}`)}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('admin');
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        STATUS_CLASS[status] ?? 'bg-black/5 text-[var(--color-content-muted)] dark:bg-white/10'
      }`}
    >
      {t(`statuses.${status}`, { defaultValue: status })}
    </span>
  );
}

/**
 * 注销生命周期徽章。
 *
 * 三种状态按「要不要管理员动手」区分强调程度：可批准是红色实心，
 * 待审批只是琥珀描边（还没到能处理的时机），已注销用中性灰。
 */
export function LifecycleBadge({ user }: { user: AdminUser }) {
  const { t } = useTranslation('admin');

  if (user.deletedAt) {
    return (
      <span className="inline-flex rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 text-xs text-[var(--color-content-muted)]">
        {t('users.deleted_badge')}
      </span>
    );
  }

  if (!user.deletionRequestedAt) return null;

  if (user.coolingOffElapsed) {
    return (
      <span className="inline-flex rounded-full bg-red-500 px-2 py-0.5 text-xs font-medium text-white">
        {t('users.deletion_ready')}
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full border border-amber-500/40 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
      {t('users.deletion_pending')}
    </span>
  );
}

/** 列表行上是否要显示注销徽章 */
export function hasLifecycle(user: AdminUser): boolean {
  return Boolean(user.deletedAt || user.deletionRequestedAt);
}

export function deletionFilterOf(user: AdminUser): AdminDeletionFilter | null {
  if (user.deletedAt) return 'deleted';
  if (!user.deletionRequestedAt) return null;
  return user.coolingOffElapsed ? 'ready' : 'pending';
}
