import Modal from '@/components/ui/Modal';
import type { AdminRole, AdminUser } from '@/lib/admin';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface UserEditInput {
  nickname?: string;
  email?: string;
  language?: string;
  /** 角色变更（仅超管可提交） */
  role?: AdminRole;
  /** 新密码；留空表示不改 */
  password?: string;
}

const LANGUAGES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
];

/**
 * 修改账号。
 *
 * 三件事在这里一起提交，但走的是三个独立接口：
 * 昵称/邮箱/语言走资料接口，角色走改角色接口（仅超管），新密码走设置密码接口。
 * 只提交真正改动过的部分——空提交只会产生一条「改了但没变」的审计。
 * 改邮箱会让账号重新标记为已验证（后端处理），这里的提示要说清楚。
 */
export default function UserEditDialog({
  user,
  saving,
  canManageRole,
  onClose,
  onSubmit,
}: {
  user: AdminUser | null;
  saving: boolean;
  /** 是否允许修改角色：与后端 requireSuperAdmin 保持一致 */
  canManageRole: boolean;
  onClose: () => void;
  onSubmit: (input: UserEditInput) => void;
}) {
  const { t } = useTranslation('admin');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [language, setLanguage] = useState('zh-CN');
  const [role, setRole] = useState<AdminRole>('user');
  const [password, setPassword] = useState('');

  // 每次打开都从该账号的当前值重建表单，避免残留上一次编辑的内容
  useEffect(() => {
    if (!user) return;
    setNickname(user.nickname);
    setEmail(user.email);
    setLanguage('zh-CN');
    setRole(user.role);
    setPassword('');
  }, [user]);

  if (!user) return null;

  const nicknameTrimmed = nickname.trim();
  const emailTrimmed = email.trim();

  const nicknameChanged = nicknameTrimmed !== user.nickname;
  const emailChanged = emailTrimmed.toLowerCase() !== user.email.toLowerCase();
  const roleChanged = canManageRole && role !== user.role;
  const passwordChanged = password !== '';

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed);
  const nicknameOk = nicknameTrimmed.length > 0;
  // 与后端 passwordSchema 对齐：至少 8 位且同时含字母与数字
  const passwordOk = password.length >= 8 && /[a-zA-Z]/.test(password) && /\d/.test(password);

  const profileChanged = nicknameChanged || emailChanged;

  const canSubmit =
    nicknameOk &&
    (!emailChanged || emailOk) &&
    (!passwordChanged || passwordOk) &&
    (profileChanged || roleChanged || passwordChanged) &&
    !saving;

  function submit() {
    if (!canSubmit) return;
    onSubmit({
      ...(nicknameChanged ? { nickname: nicknameTrimmed } : {}),
      ...(emailChanged ? { email: emailTrimmed } : {}),
      ...(language !== 'zh-CN' ? { language } : {}),
      ...(roleChanged ? { role } : {}),
      ...(passwordChanged ? { password } : {}),
    });
  }

  return (
    <Modal
      open
      size="lg"
      title={t('users.edit_title')}
      description={t('users.edit_description')}
      dirty={nicknameChanged || emailChanged || language !== 'zh-CN' || roleChanged || passwordChanged}
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
          >
            {t('common:actions.cancel')}
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="rounded-lg btn-action px-3 py-2 text-sm font-medium"
          >
            {saving ? t('common:actions.saving') : t('users.edit_submit')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-[var(--color-content-muted)]">
            {t('users.create_nickname')}
          </span>
          <input
            className="input"
            maxLength={50}
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            data-autofocus
          />
          {!nicknameOk && (
            <span className="mt-1 block text-xs text-[var(--color-negative)]">
              {t('users.edit_nickname_required')}
            </span>
          )}
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-xs text-[var(--color-content-muted)]">
            {t('users.create_email')}
          </span>
          <input
            className="input"
            type="email"
            autoComplete="off"
            maxLength={255}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {emailChanged && !emailOk && (
            <span className="mt-1 block text-xs text-[var(--color-negative)]">
              {t('users.edit_email_invalid')}
            </span>
          )}
          {emailChanged && emailOk && (
            <span className="mt-1 block text-xs text-[var(--color-content-muted)]">
              {t('users.edit_email_note')}
            </span>
          )}
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
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

          {canManageRole && (
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-[var(--color-content-muted)]">
                {t('users.role_title')}
              </span>
              <select
                className="input"
                value={role}
                onChange={(event) => setRole(event.target.value as AdminRole)}
              >
                <option value="user">{t('roles.user')}</option>
                <option value="admin">{t('roles.admin')}</option>
                <option value="super_admin">{t('roles.super_admin')}</option>
              </select>
            </label>
          )}
        </div>

        {canManageRole && roleChanged && (
          <p className="text-xs text-[var(--color-content-muted)]">{t('users.role_hint')}</p>
        )}

        <label className="block text-sm">
          <span className="mb-1 block text-xs text-[var(--color-content-muted)]">
            {t('users.password_new')}
          </span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {passwordChanged && !passwordOk ? (
            <span className="mt-1 block text-xs text-[var(--color-negative)]">
              {t('users.create_password_hint')}
            </span>
          ) : (
            <span className="mt-1 block text-xs text-[var(--color-content-muted)]">
              {t('users.password_note')}
            </span>
          )}
        </label>
      </div>
    </Modal>
  );
}
