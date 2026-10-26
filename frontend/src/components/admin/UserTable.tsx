import type { AdminUser } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LifecycleBadge, RoleBadge, StatusBadge, hasLifecycle } from './UserBadges';

/** 头像取昵称首字符；邮箱脱敏后可能只剩一个字母，用昵称更稳定 */
function Avatar({ nickname }: { nickname: string }) {
  const initial = nickname.trim().slice(0, 1).toUpperCase() || '?';
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/12 text-xs font-semibold text-[var(--color-accent)]"
    >
      {initial}
    </span>
  );
}

/**
 * 账号列表。
 *
 * 桌面用表格承载可比较的列，小屏退化成卡片：账号信息一旦横向溢出，
 * 状态与注销标记就会被挤出视口，而这两列恰恰是管理员最需要看到的。
 */
export default function UserTable({
  users,
  onOpen,
}: {
  users: AdminUser[];
  onOpen: (user: AdminUser) => void;
}) {
  const { t } = useTranslation('admin');

  return (
    <>
      {/* 小屏卡片 */}
      <ul className="space-y-2 sm:hidden">
        {users.map((user) => (
          <li key={user.id}>
            <button
              type="button"
              onClick={() => onOpen(user)}
              className="card flex w-full items-start gap-3 p-3 text-left hover:bg-black/5 dark:hover:bg-white/5"
            >
              <Avatar nickname={user.nickname} />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{user.nickname}</p>
                    <p className="truncate text-xs text-[var(--color-content-muted)]">{user.email}</p>
                  </div>
                  {hasLifecycle(user) && <LifecycleBadge user={user} />}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <RoleBadge role={user.role} />
                  <StatusBadge status={user.status} />
                </div>
                <p className="text-xs text-[var(--color-content-muted)]">
                  {t('users.joined', { time: formatDateTime(user.createdAt) })} ·{' '}
                  {user.lastLoginAt
                    ? t('users.last_login', { time: formatDateTime(user.lastLoginAt) })
                    : t('users.never_logged_in')}
                </p>
              </div>
              <ChevronRight className="mt-1 size-4 shrink-0 text-[var(--color-content-muted)]" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      {/* 桌面表格 */}
      <div className="card hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-[var(--color-border-subtle)] text-left text-xs text-[var(--color-content-muted)]">
            <tr>
              <th className="px-3 py-2">{t('users.col_account')}</th>
              <th className="px-3 py-2">{t('users.col_role')}</th>
              <th className="px-3 py-2">{t('users.col_status')}</th>
              <th className="px-3 py-2">{t('users.col_lifecycle')}</th>
              <th className="px-3 py-2">{t('users.col_joined')}</th>
              <th className="px-3 py-2">{t('users.col_last_login')}</th>
              <th className="px-3 py-2 text-right">{t('users.col_actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-subtle)]">
            {users.map((user) => (
              <tr
                key={user.id}
                onClick={() => onOpen(user)}
                className="cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
              >
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar nickname={user.nickname} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{user.nickname}</p>
                      <p className="truncate text-xs text-[var(--color-content-muted)]">{user.email}</p>
                    </div>
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <RoleBadge role={user.role} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <StatusBadge status={user.status} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  {hasLifecycle(user) ? (
                    <LifecycleBadge user={user} />
                  ) : (
                    <span className="text-xs text-[var(--color-content-muted)]">{t('users.never')}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[var(--color-content-muted)]">
                  {formatDateTime(user.createdAt)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                  {user.lastLoginAt ? (
                    <span className="text-[var(--color-content-muted)]">
                      {formatDateTime(user.lastLoginAt)}
                      {user.lastLoginIp && <span className="ml-1.5 font-mono">{user.lastLoginIp}</span>}
                    </span>
                  ) : (
                    <span className="text-[var(--color-content-muted)]">{t('users.never_logged_in')}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  <button
                    type="button"
                    aria-label={t('users.open_detail')}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(user);
                    }}
                    className="text-[var(--color-content-muted)] hover:text-[var(--color-accent)]"
                  >
                    <ChevronRight className="size-4" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
