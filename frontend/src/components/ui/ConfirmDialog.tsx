import { useTranslation } from 'react-i18next';
import Modal from './Modal';

/**
 * 统一确认弹窗。
 *
 * 取代 `window.confirm`：原生框不认主题、移动端样式由浏览器决定、也没法把
 * 「删除」这类动作标成红色。这里复用 Modal 的焦点、Esc 与层级管理，只补
 * 确认框需要的那点差异——危险动作的主按钮配色、以及提交中转圈。
 *
 * 它是受控组件：调用方持有「要确认的对象」，因此可以把对象名直接拼进文案。
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger 用于删除、撤销等不可逆动作，主按钮转为红色 */
  tone?: 'default' | 'danger';
  /** 提交中：禁止重复点击与 Esc 关闭 */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('common');

  const confirmClass =
    tone === 'danger'
      ? 'rounded-lg bg-[var(--color-negative)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50'
      : 'rounded-lg btn-action px-3 py-2 text-sm font-medium';

  return (
    <Modal
      open={open}
      size="sm"
      title={title}
      busy={busy}
      onClose={onCancel}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
          >
            {cancelLabel ?? t('actions.cancel')}
          </button>
          <button
            type="button"
            data-autofocus
            onClick={onConfirm}
            disabled={busy}
            className={confirmClass}
          >
            {confirmLabel ?? t('actions.confirm')}
          </button>
        </>
      }
    >
      <p className="text-sm text-[var(--color-content-muted)]">{message}</p>
    </Modal>
  );
}
