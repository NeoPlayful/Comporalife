import UserCreateDialog, { type UserCreateInput } from '@/components/admin/UserCreateDialog';
import UserDetailDrawer, { type UserAction } from '@/components/admin/UserDetailDrawer';
import UserEditDialog, { type UserEditInput } from '@/components/admin/UserEditDialog';
import UserStats from '@/components/admin/UserStats';
import UserTable, { type RowAction } from '@/components/admin/UserTable';
import { deletionFilterOf } from '@/components/admin/UserBadges';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import Modal from '@/components/ui/Modal';
import Pagination from '@/components/ui/Pagination';
import { adminApi, type AdminDeletionFilter, type AdminRole, type AdminUser } from '@/lib/admin';
import { ApiError } from '@/lib/client';
import { translateError } from '@/lib/error-message';
import { toastError, toastSuccess } from '@/lib/toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

const SEARCH_DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 20;

/**
 * 后台用户管理。
 *
 * 列表回答「有哪些账号、哪些需要我动手」：角色、状态、注销生命期都用徽章直接呈现，
 * 不再要求展开才能看出有待审批的注销申请。
 *
 * 筛选与页码写进 URL：管理员常在同一批条件下反复进出详情，
 * 刷新或后退就丢筛选是很实际的损耗。
 */
export default function AdminUsersPage() {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  const search = params.get('search') ?? '';
  const role = (params.get('role') ?? '') as AdminRole | '';
  const status = params.get('status') ?? '';
  const deletion = (params.get('deletion') ?? '') as AdminDeletionFilter | '';
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const pageSize = Number(params.get('pageSize') ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE;

  const [searchInput, setSearchInput] = useState(search);
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [confirm, setConfirm] = useState<{ action: UserAction; user: AdminUser } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [permanent, setPermanent] = useState(false);

  function patchParams(patch: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    // 条件一变就回第一页，否则会停在一个空页上
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  }

  // 搜索框每击键都换 queryKey 会让整张表闪成加载态，等停顿后再落到 URL
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== search) patchParams({ search: searchInput || null });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // patchParams 每次渲染都是新函数，这里只跟随输入值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', search, role, status, deletion, page, pageSize],
    queryFn: () =>
      adminApi.users({
        page,
        pageSize,
        ...(search ? { search } : {}),
        ...(role ? { role } : {}),
        ...(status ? { status } : {}),
        ...(deletion ? { deletion } : {}),
      }),
    // 换页或改筛选时保留上一份结果，避免表格闪成空白
    placeholderData: (previous) => previous,
  });

  const statsQuery = useQuery({
    queryKey: ['admin', 'dashboard-overview'],
    queryFn: () => adminApi.overview(),
  });

  const settingsQuery = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => adminApi.settingsOverview(),
  });

  const openUser = usersQuery.data?.data.users.find((item) => item.id === openUserId) ?? null;

  const detailQuery = useQuery({
    queryKey: ['admin', 'user', openUserId],
    queryFn: () => adminApi.user(openUserId!),
    enabled: Boolean(openUserId),
    placeholderData: (previous) => previous,
  });

  const list = usersQuery.data?.data.users ?? [];
  const pagination = usersQuery.data?.pagination ?? null;
  const canManageAdmins = settingsQuery.data?.capabilities.canManageAdmins ?? false;
  const createEnabled = settingsQuery.data?.adminUserCreateEnabled ?? false;

  const act = useMutation<unknown, Error, { id: string; action: UserAction }>({
    mutationFn: (input) => {
      if (input.action === 'disable') return adminApi.disableUser(input.id);
      if (input.action === 'enable') return adminApi.enableUser(input.id);
      if (input.action === 'revoke') return adminApi.revokeSessions(input.id);
      if (input.action === 'reset-mail') return adminApi.sendPasswordReset(input.id);
      if (input.action === 'reject-deletion') return adminApi.reviewDeletion(input.id, 'reject');
      return adminApi.reviewDeletion(input.id, 'approve');
    },
    onSuccess: () => {
      setConfirm(null);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => {
      setConfirm(null);
      toastError(err instanceof ApiError ? translateError(err, t) : String(err));
    },
  });

  const create = useMutation({
    mutationFn: (input: UserCreateInput) =>
      adminApi.createUser({
        email: input.email,
        nickname: input.nickname,
        password: input.password,
        role: input.role,
        language: input.language,
      }),
    onSuccess: (result) => {
      setCreating(false);
      toastSuccess(t('users.create_success', { email: result.user.email }));
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => toastError(err instanceof ApiError ? translateError(err, t) : String(err)),
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UserEditInput }) =>
      adminApi.updateUser(id, input),
    onSuccess: (result) => {
      setEditing(null);
      toastSuccess(t('users.edit_success', { email: result.user.email }));
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => toastError(err instanceof ApiError ? translateError(err, t) : String(err)),
  });

  const remove = useMutation({
    mutationFn: ({ id, permanent }: { id: string; permanent: boolean }) =>
      adminApi.deleteUser(id, permanent ? { permanent: true } : {}),
    onSuccess: (_result, variables) => {
      setDeleteTarget(null);
      setPermanent(false);
      toastSuccess(variables.permanent ? t('users.delete_permanent_success') : t('users.delete_success'));
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => {
      setDeleteTarget(null);
      setPermanent(false);
      toastError(err instanceof ApiError ? translateError(err, t) : String(err));
    },
  });

  const activeFilters = useMemo(() => {
    const chips: { key: string; label: string; onClear: () => void }[] = [];
    if (search) chips.push({ key: 'search', label: search, onClear: () => setSearchInput('') });
    if (role) {
      chips.push({
        key: 'role',
        label: t(`roles.${role}`),
        onClear: () => patchParams({ role: null }),
      });
    }
    if (status) {
      chips.push({
        key: 'status',
        label: t(`statuses.${status}`, { defaultValue: status }),
        onClear: () => patchParams({ status: null }),
      });
    }
    if (deletion) {
      chips.push({
        key: 'deletion',
        label: t(`users.deletion_${deletion}`),
        onClear: () => patchParams({ deletion: null }),
      });
    }
    return chips;
    // patchParams 依赖当前 params，随渲染重建即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, role, status, deletion, t]);

  /** 需要二次确认的动作；启用是纯恢复操作，直接执行 */
  function requestAction(action: UserAction, user: AdminUser) {
    if (action === 'enable') {
      act.mutate({ id: user.id, action });
      return;
    }
    setConfirm({ action, user });
  }

  /** 行内操作：修改直接开弹窗，删除二次确认，启停沿用详情抽屉的确认口径 */
  function requestRowAction(action: RowAction, user: AdminUser) {
    if (action === 'edit') {
      setEditing(user);
      return;
    }
    if (action === 'delete') {
      setDeleteTarget(user);
      return;
    }
    requestAction(user.status === 'active' ? 'disable' : 'enable', user);
  }

  const confirmCopy = confirm
    ? {
        disable: { title: t('users.disable'), body: t('users.disable_confirm'), danger: true },
        revoke: { title: t('users.revoke_sessions'), body: t('users.revoke_confirm'), danger: false },
        'reset-mail': {
          title: t('users.reset_mail'),
          body: t('users.reset_mail_confirm', { email: confirm.user.email }),
          danger: false,
        },
        deletion: {
          title: t('users.approve_deletion'),
          body: t('users.approve_deletion_confirm', { email: confirm.user.email }),
          danger: true,
        },
        'reject-deletion': {
          title: t('users.reject_deletion'),
          body: t('users.reject_deletion_confirm', { email: confirm.user.email }),
          danger: false,
        },
      }[confirm.action as Exclude<UserAction, 'enable'>]
    : null;

  const hasFilters = Boolean(search || role || status || deletion);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{t('users.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('subtitle')}</p>
          <p className="mt-1 text-xs text-[var(--color-content-muted)]">
            {t('users.notice_no_financial')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void usersQuery.refetch()}
            aria-label={t('users.refresh')}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
          >
            <RefreshCw className={`size-4 ${usersQuery.isFetching ? 'animate-spin' : ''}`} aria-hidden />
            <span className="hidden sm:inline">{t('users.refresh')}</span>
          </button>
          <button
            type="button"
            disabled={!createEnabled}
            title={createEnabled ? t('users.new_hint') : t('users.create_disabled')}
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg btn-action px-3 py-2 text-sm font-medium"
          >
            <Plus className="size-4" aria-hidden />
            {t('users.new')}
          </button>
        </div>
      </header>

      <UserStats overview={statsQuery.data ?? null} />

      {/* 工具栏：搜索与三组筛选，隐私开关单独靠右 */}
      <section className="card space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input sm:max-w-xs"
            placeholder={t('users.search_placeholder')}
            aria-label={t('users.search_placeholder')}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />

          <select
            className="input sm:w-auto"
            aria-label={t('users.col_role')}
            value={role}
            onChange={(event) => patchParams({ role: event.target.value || null })}
          >
            <option value="">{t('users.all_roles')}</option>
            <option value="user">{t('roles.user')}</option>
            <option value="admin">{t('roles.admin')}</option>
            <option value="super_admin">{t('roles.super_admin')}</option>
          </select>

          <select
            className="input sm:w-auto"
            aria-label={t('users.col_status')}
            value={status}
            onChange={(event) => patchParams({ status: event.target.value || null })}
          >
            <option value="">{t('users.all_statuses')}</option>
            <option value="active">{t('statuses.active')}</option>
            <option value="disabled">{t('statuses.disabled')}</option>
            <option value="pending_verification">{t('statuses.pending_verification')}</option>
          </select>

          <select
            className="input sm:w-auto"
            aria-label={t('users.filter_deletion')}
            value={deletion}
            onChange={(event) => patchParams({ deletion: event.target.value || null })}
          >
            <option value="">{t('users.all_deletions')}</option>
            <option value="pending">{t('users.deletion_pending')}</option>
            <option value="ready">{t('users.deletion_ready')}</option>
            <option value="deleted">{t('users.deletion_deleted')}</option>
          </select>
        </div>

        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-[var(--color-content-muted)]">{t('users.active_filters')}</span>
            {activeFilters.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.onClear}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 text-xs hover:bg-black/5 dark:hover:bg-white/5"
              >
                {chip.label}
                <X className="size-3" aria-hidden />
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setParams(new URLSearchParams(), { replace: true });
              }}
              className="text-xs text-[var(--color-content-muted)] underline-offset-2 hover:underline"
            >
              {t('users.clear_filters')}
            </button>
          </div>
        )}
      </section>

      {usersQuery.isLoading && <LoadingState />}
      {usersQuery.isError && <ErrorState onRetry={() => void usersQuery.refetch()} />}

      {usersQuery.data && list.length === 0 && (
        <EmptyState
          title={t('users.empty_title')}
          description={hasFilters ? t('users.empty_description') : t('users.empty')}
          action={
            !hasFilters && createEnabled ? (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="rounded-lg btn-action px-3 py-2 text-sm font-medium"
              >
                {t('users.new')}
              </button>
            ) : undefined
          }
        />
      )}

      {list.length > 0 && (
        <UserTable
          users={list}
          onOpen={(user) => setOpenUserId(user.id)}
          onAction={requestRowAction}
          busyUserId={act.isPending || remove.isPending ? (act.variables?.id ?? deleteTarget?.id ?? null) : null}
        />
      )}

      {pagination && pagination.total > 0 && (
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={(next) => patchParams({ page: String(next) }, false)}
          onPageSizeChange={(size) => patchParams({ pageSize: String(size), page: null }, false)}
          totalLabel="pagination.total_accounts"
        />
      )}

      <UserDetailDrawer
        user={openUser}
        detail={detailQuery.data?.user ?? null}
        pending={detailQuery.isFetching && !detailQuery.data}
        actionPending={act.isPending}
        onClose={() => setOpenUserId(null)}
        onAction={requestAction}
      />

      <UserCreateDialog
        open={creating}
        canAssignRole={canManageAdmins}
        saving={create.isPending}
        onClose={() => setCreating(false)}
        onSubmit={(input) => create.mutate(input)}
      />

      <UserEditDialog
        user={editing}
        saving={update.isPending}
        onClose={() => setEditing(null)}
        onSubmit={(input) => editing && update.mutate({ id: editing.id, input })}
      />

      <Modal
        open={deleteTarget !== null}
        size="md"
        title={t('users.delete')}
        busy={remove.isPending}
        onClose={() => {
          setDeleteTarget(null);
          setPermanent(false);
        }}
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setDeleteTarget(null);
                setPermanent(false);
              }}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
            >
              {t('common:actions.cancel')}
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => deleteTarget && remove.mutate({ id: deleteTarget.id, permanent })}
              className="rounded-lg bg-[var(--color-negative)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {permanent ? t('users.delete_permanent_submit') : t('users.delete')}
            </button>
          </>
        }
      >
        {deleteTarget && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-content-muted)]">
              {deleteTarget.nickname} · {deleteTarget.email}
            </p>

            {/*
              两个选项互斥且默认软删除：永久删除不可恢复，
              不能让它在一次误点里被执行，所以必须先明确勾选。
            */}
            <div className="space-y-2">
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--color-border-subtle)] p-3">
                <input
                  type="radio"
                  name="delete-mode"
                  className="mt-0.5"
                  checked={!permanent}
                  onChange={() => setPermanent(false)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t('users.delete_soft')}</span>
                  <span className="mt-0.5 block text-xs text-[var(--color-content-muted)]">
                    {t('users.delete_soft_hint')}
                  </span>
                </span>
              </label>

              <label
                className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${
                  permanent ? 'border-[var(--color-negative)]/50 bg-[var(--color-negative)]/5' : 'border-[var(--color-border-subtle)]'
                }`}
              >
                <input
                  type="radio"
                  name="delete-mode"
                  className="mt-0.5"
                  checked={permanent}
                  onChange={() => setPermanent(true)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t('users.delete_permanent')}</span>
                  <span className="mt-0.5 block text-xs text-[var(--color-content-muted)]">
                    {t('users.delete_permanent_hint')}
                  </span>
                </span>
              </label>
            </div>

            {permanent && (
              <p className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-xs text-[var(--color-negative)]">
                {t('users.delete_permanent_warning')}
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={confirm !== null}
        size="sm"
        title={confirmCopy?.title ?? ''}
        description={confirmCopy?.body}
        busy={act.isPending}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirm(null)}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
            >
              {t('common:actions.cancel')}
            </button>
            <button
              type="button"
              disabled={act.isPending}
              onClick={() => confirm && act.mutate({ id: confirm.user.id, action: confirm.action })}
              className={`rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                confirmCopy?.danger ? 'bg-[var(--color-negative)]' : 'btn-action'
              }`}
            >
              {confirmCopy?.title ?? t('common:actions.confirm')}
            </button>
          </>
        }
      >
        {confirm && (
          <p className="text-sm text-[var(--color-content-muted)]">
            {confirm.user.nickname} · {confirm.user.email}
            {deletionFilterOf(confirm.user) === 'ready' && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">
                {t('users.detail_cooling_done')}
              </span>
            )}
          </p>
        )}
      </Modal>
    </div>
  );
}
