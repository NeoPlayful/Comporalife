import Modal from '@/components/ui/Modal';
import type { AdminUser } from '@/lib/admin';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface UserEditInput {
  nickname?: string;
  email?: string;
  language?: string;
}

const LANGUAGES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
];

/**
 * 修改账号资料。
 *
 * 只提交真正改动过的字段：为空对象的请求只会写一条「改了但没变」的审计，
 * 而后端也据此判断是否落库。改邮箱会让账号重新标记为已验证（后端处理），
 * 因此这里明确提示新地址立即生效，避免管理员以为还要再走一次验证。
 */
export default function UserEditDialog({
  user,
  saving,
  onClose,
  onSubmit,
}: {
  user: AdminUser | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: UserEditInput) => void;
}) {
  const { t } = useTranslation('admin');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [language, setLanguage] = useState('zh-CN');

  // 每次打开都从该账号的当前值重建表单，避免残留上一次编辑的内容
  useEffect(() => {
    if (!user) return;
    setNickname(user.nickname);
    setEmail(user.email);
    setLanguage('zh-CN');
  }, [user]);

  if (!user) return null;

  const nicknameTrimmed = nickname.trim();
  const emailTrimmed = email.trim();

  const nicknameChanged = nicknameTrimmed !== user.nickname;
  const emailChanged = emailTrimmed.toLowerCase() !== user.email.toLowerCase();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed);
  const nicknameOk = nicknameTrimmed.length > 0;

  const canSubmit =
    nicknameOk &&
    (!emailChanged || emailOk) &&
    (nicknameChanged || emailChanged) &&
    !saving;

  function submit() {
    if (!canSubmit) return;
    onSubmit({
      ...(nicknameChanged ? { nickname: nicknameTrimmed } : {}),
      ...(emailChanged ? { email: emailTrimmed } : {}),
      ...(language !== 'zh-CN' ? { language } : {}),
    });
  }

  return (
    <Modal
      open
      size="lg"
      title={t('users.edit_title')}
      description={t('users.edit_description')}
      dirty={nicknameChanged || emailChanged || language !== 'zh-CN'}
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

        <p className="text-xs text-[var(--color-content-muted)]">{t('users.edit_password_note')}</p>
      </div>
    </Modal>
  );
}
