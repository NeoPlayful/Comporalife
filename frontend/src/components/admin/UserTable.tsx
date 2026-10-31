import type { AdminUser } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { Ban, ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { LifecycleBadge, RoleBadge, StatusBadge, hasLifecycle } from './UserBadges';
import UserDetailPanel, { type UserAction } from './UserDetailPanel';

/** 行内操作只做最常用的三个；其余动作（撤会话、重置邮件、注销审核）在展开的详情里 */
export type RowAction = 'edit' | 'toggle-status' | 'delete';

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
  openUserId,
  openDetail,
  detailPending,
  actionPending,
  onToggleDetail,
  onAction,
  onDetailAction,
  busyUserId,
}: {
  users: AdminUser[];
  /** 当前展开详情的行；null 表示全部收起 */
  openUserId: string | null;
  /** 展开行的完整详情；未取到前用列表行兜底 */
  openDetail: AdminUser | null;
  detailPending: boolean;
  actionPending: boolean;
  onToggleDetail: (user: AdminUser) => void;
  onAction: (action: RowAction, user: AdminUser) => void;
  onDetailAction: (action: UserAction, user: AdminUser) => void;
  /** 正在执行操作的行：禁用该行按钮，避免连点产生互相覆盖的请求 */
  busyUserId: string | null;
}) {
  const { t } = useTranslation('admin');

  return (
    <>
      {/* 小屏卡片 */}
      <ul className="space-y-2 sm:hidden">
        {users.map((user) => {
          const open = openUserId === user.id;
          return (
            <li key={user.id} className="card p-3">
              {/*
                信息区是展开详情的按钮，操作按钮作为它的兄弟节点：
                按钮不能嵌套按钮，否则 HTML 结构非法，点击行为也会变得不可预测。
              */}
              <button
                type="button"
                onClick={() => onToggleDetail(user)}
                aria-expanded={open}
                className="flex w-full items-start gap-3 text-left"
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
                {open ? (
                  <ChevronDown className="mt-1 size-4 shrink-0 text-[var(--color-content-muted)]" aria-hidden />
                ) : (
                  <ChevronRight className="mt-1 size-4 shrink-0 text-[var(--color-content-muted)]" aria-hidden />
                )}
              </button>

              {/* 手机上只能点进详情才能操作太绕，把三个常用动作直接摆出来 */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-[var(--color-border-subtle)] pt-2">
                <button
                  type="button"
                  disabled={Boolean(user.deletedAt) || busyUserId === user.id}
                  onClick={() => onAction('edit', user)}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-xs disabled:opacity-40"
                >
                  <Pencil className="size-3" aria-hidden />
                  {t('users.edit')}
                </button>
                {!(hasLifecycle(user) && user.deletedAt) && (
                  <button
                    type="button"
                    disabled={busyUserId === user.id}
                    onClick={() => onAction('toggle-status', user)}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-xs disabled:opacity-40"
                  >
                    <Ban className="size-3" aria-hidden />
                    {user.status === 'active' ? t('users.disable') : t('users.enable')}
                  </button>
                )}
                {/* 已软删除的账号仍可永久清除，所以只看忙碌态 */}
                <button
                  type="button"
                  disabled={busyUserId === user.id}
                  onClick={() => onAction('delete', user)}
                  className="inline-flex items-center gap-1 rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-600 disabled:opacity-40 dark:text-red-400"
                >
                  <Trash2 className="size-3" aria-hidden />
                  {t('users.delete')}
                </button>
              </div>

              {open && (
                <div className="mt-3 border-t border-[var(--color-border-subtle)] pt-3">
                  <UserDetailPanel
                    user={user}
                    detail={openDetail}
                    pending={detailPending}
                    actionPending={actionPending}
                    onClose={() => onToggleDetail(user)}
                    onAction={onDetailAction}
                  />
                </div>
              )}
            </li>
          );
        })}
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
            {users.map((user) => {
              const open = openUserId === user.id;
              return (
              <Fragment key={user.id}>
              <tr
                onClick={() => onToggleDetail(user)}
                className="cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                aria-expanded={open}
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
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      aria-label={t('users.edit')}
                      title={t('users.edit')}
                      disabled={Boolean(user.deletedAt) || busyUserId === user.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        onAction('edit', user);
                      }}
                      className="text-[var(--color-content-muted)] hover:text-[var(--color-accent)] disabled:opacity-40"
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </button>

                    {hasLifecycle(user) && user.deletedAt ? null : (
                      <button
                        type="button"
                        aria-label={user.status === 'active' ? t('users.disable') : t('users.enable')}
                        title={user.status === 'active' ? t('users.disable') : t('users.enable')}
                        disabled={busyUserId === user.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          onAction('toggle-status', user);
                        }}
                        className="text-[var(--color-content-muted)] hover:text-[var(--color-warning)] disabled:opacity-40"
                      >
                        <Ban className="size-3.5" aria-hidden />
                      </button>
                    )}

                    <button
                      type="button"
                      aria-label={t('users.delete')}
                      title={t('users.delete')}
                      disabled={busyUserId === user.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        onAction('delete', user);
                      }}
                      className="text-[var(--color-content-muted)] hover:text-[var(--color-negative)] disabled:opacity-40"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>

                    <button
                      type="button"
                      aria-label={open ? t('users.collapse_detail') : t('users.open_detail')}
                      title={open ? t('users.collapse_detail') : t('users.open_detail')}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleDetail(user);
                      }}
                      className="text-[var(--color-content-muted)] hover:text-[var(--color-accent)]"
                    >
                      {open ? (
                        <ChevronDown className="size-4" aria-hidden />
                      ) : (
                        <ChevronRight className="size-4" aria-hidden />
                      )}
                    </button>
                  </div>
                </td>
              </tr>
              {open && (
                <tr className="bg-black/[0.02] dark:bg-white/[0.02]">
                  <td colSpan={7} className="px-4 py-4">
                    <UserDetailPanel
                      user={user}
                      detail={openDetail}
                      pending={detailPending}
                      actionPending={actionPending}
                      onClose={() => onToggleDetail(user)}
                      onAction={onDetailAction}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
