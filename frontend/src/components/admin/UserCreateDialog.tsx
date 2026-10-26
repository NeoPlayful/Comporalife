import Modal from '@/components/ui/Modal';
import type { AdminRole } from '@/lib/admin';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface UserCreateInput {
  email: string;
  nickname: string;
  password: string;
  role: AdminRole;
  language: string;
}

const LANGUAGES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
];

/**
 * 后台建号弹窗。
 *
 * 密码由管理员设定且不强制修改，因此表单里要如实提醒「请通过安全渠道交付」，
 * 而不是把它当成一句可忽略的帮助文案。
 * 角色选项按权限收敛：非超管只能建普通用户，避免提交后才收到 403。
 */
export default function UserCreateDialog({
  open,
  canAssignRole,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** 是否允许创建管理员 / 超管：与后端 requireSuperAdmin 保持一致 */
  canAssignRole: boolean;
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: UserCreateInput) => void;
}) {
  const { t } = useTranslation('admin');
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AdminRole>('user');
  const [language, setLanguage] = useState('zh-CN');

  const dirty = email.trim() !== '' || nickname.trim() !== '' || password !== '' || role !== 'user';

  // 与前端的 passwordSchema 对齐：至少 8 位且同时含字母与数字
  const passwordOk = password.length >= 8 && /[a-zA-Z]/.test(password) && /\d/.test(password);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit = emailOk && nickname.trim() !== '' && passwordOk && !saving;

  return (
    <Modal
      open={open}
      size="lg"
      title={t('users.create_title')}
      description={t('users.create_description')}
      dirty={dirty}
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
          >
            {t('common:actions.cancel')}
          </button>
          <button
            type="submit"
            form="user-create-form"
            disabled={!canSubmit}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? t('common:actions.saving') : t('users.create_submit')}
          </button>
        </>
      }
    >
      <form
        id="user-create-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onSubmit({
            email: email.trim(),
            nickname: nickname.trim(),
            password,
            role,
            language,
          });
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-[var(--color-content-muted)]">
            {t('users.create_email')}
          </span>
          <input
            className="input"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            data-autofocus
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-xs text-[var(--color-content-muted)]">
            {t('users.create_nickname')}
          </span>
          <input
            className="input"
            maxLength={50}
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-xs text-[var(--color-content-muted)]">
            {t('users.create_password')}
          </span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span className="mt-1 block text-xs text-[var(--color-content-muted)]">
            {t('users.create_password_hint')}
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-[var(--color-content-muted)]">
              {t('users.create_role')}
            </span>
            <select
              className="input"
              value={role}
              disabled={!canAssignRole}
              onChange={(event) => setRole(event.target.value as AdminRole)}
            >
              <option value="user">{t('roles.user')}</option>
              {canAssignRole && <option value="admin">{t('roles.admin')}</option>}
              {canAssignRole && <option value="super_admin">{t('roles.super_admin')}</option>}
            </select>
            {!canAssignRole && (
              <span className="mt-1 block text-xs text-[var(--color-content-muted)]">
                {t('users.create_role_hint')}
              </span>
            )}
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs text-[var(--color-content-muted)]">
              {t('users.create_language')}
            </span>
            <select className="input" value={language} onChange={(event) => setLanguage(event.target.value)}>
              {LANGUAGES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="rounded-lg bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          {t('users.create_note')}
        </p>
      </form>
    </Modal>
  );
}
