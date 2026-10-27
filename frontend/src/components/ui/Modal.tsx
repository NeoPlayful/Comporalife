import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export type ModalVariant = 'center' | 'drawer' | 'sheet';

/**
 * 弹窗外壳。
 *
 * 只负责「一个浮层应该有的行为」：焦点进入与回收、Tab 不跑到遮罩后面、
 * Esc 关闭、背景不滚动、层级递增。表单校验、提交与二次确认都留在调用方。
 *
 * 有未保存内容时关闭要经 confirm 拦一次——点遮罩或按 Esc 直接丢掉已填内容
 * 是这类弹窗最容易踩的坑，因此把拦截放在外壳里，避免每个页面各写一遍。
 */

// 多个弹窗可能叠开（列表 → 详情 → 确认），滚动锁按层计数，最外层关闭才解锁。
// 页面滚动发生在 <main> 上而不是 body，两处都要锁，否则遮罩后面的内容仍能滚。
let openCount = 0;
let previousOverflow = '';
let previousMainOverflow = '';

function scrollContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('main');
}

function lockScroll() {
  if (openCount === 0) {
    previousOverflow = document.body.style.overflow;
    previousMainOverflow = scrollContainer()?.style.overflow ?? '';
    document.body.style.overflow = 'hidden';
    const main = scrollContainer();
    if (main) main.style.overflow = 'hidden';
  }
  openCount += 1;
}

function unlockScroll() {
  openCount = Math.max(0, openCount - 1);
  if (openCount === 0) {
    document.body.style.overflow = previousOverflow;
    const main = scrollContainer();
    if (main) main.style.overflow = previousMainOverflow;
  }
}

// 叠开时靠 DOM 顺序决定谁在上面并不可靠，这里显式分配层级：
// 后打开的遮住先打开的，关闭时把自己的层号还回去
let nextLayer = 0;
const freeLayers: number[] = [];
// 打开顺序栈：只有最上层弹窗响应 Esc 与 Tab，否则一次 Esc 会连带关掉底层
const layerStack: number[] = [];

function acquireLayer(): number {
  const layer = freeLayers.pop() ?? nextLayer++;
  layerStack.push(layer);
  return layer;
}

function releaseLayer(layer: number) {
  const index = layerStack.lastIndexOf(layer);
  if (index !== -1) layerStack.splice(index, 1);
  freeLayers.push(layer);
}

function isTopLayer(layer: number): boolean {
  return layerStack[layerStack.length - 1] === layer;
}

// 只排除明确隐藏的节点：不用 offsetParent 判可见性，那在 jsdom 里恒为 null，
// 会把全部可聚焦项误判成不可见
const FOCUSABLE = [
  'a[href]:not([hidden])',
  'button:not([disabled]):not([hidden])',
  'input:not([disabled]):not([type="hidden"]):not([hidden])',
  'select:not([disabled]):not([hidden])',
  'textarea:not([disabled]):not([hidden])',
  '[tabindex]:not([tabindex="-1"]):not([hidden])',
].join(',');

export default function Modal({
  open,
  title,
  description,
  variant = 'center',
  size = 'md',
  dirty = false,
  dismissible = true,
  busy = false,
  footer,
  onClose,
  children,
}: {
  open: boolean;
  /** 标题可能是「文字 + 等宽币种对」这类组合，因此接受节点 */
  title: ReactNode;
  description?: ReactNode;
  variant?: ModalVariant;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /** 有未保存内容时为 true：关闭前会要求确认 */
  dirty?: boolean;
  /** 只读详情类弹窗不需要脏数据确认，可整体关掉关闭入口 */
  dismissible?: boolean;
  /** 提交中：屏蔽 Esc 与遮罩关闭，避免请求途中把用户甩出去 */
  busy?: boolean;
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation('common');
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [layer, setLayer] = useState<number | null>(null);
  // 脏数据关窗的二次确认：不用 window.confirm，原生框不认主题也不能叠在本弹窗之上
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // 关闭前统一走这里：脏数据与提交中都要拦
  function requestClose() {
    if (busy) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  useEffect(() => {
    if (!open) return;

    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockScroll();
    const assigned = acquireLayer();
    setLayer(assigned);

    // 初始焦点优先给标了 data-autofocus 的元素，其次是第一个可聚焦项
    const panel = panelRef.current;
    const initial =
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel;
    initial?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      // 只有最上层响应键位：否则在确认层按 Esc 会把下面的编辑层也一起关掉
      if (!isTopLayer(assigned)) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        requestClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement;

      // 焦点跑到弹窗外的元素上时，下一次 Tab 直接拉回开头
      if (!panel.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      unlockScroll();
      releaseLayer(assigned);
      setLayer(null);
      // 触发按钮可能已被卸载（例如创建成功后列表重绘），此时不再夺回焦点
      const target = restoreRef.current;
      if (target && document.contains(target)) target.focus();
    };
    // requestClose 依赖 busy/dirty，二者变化时重建监听即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy, dirty]);

  if (!open) return null;

  const sizeClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
    '2xl': 'max-w-4xl',
  }[size];

  // sheet 是移动端底部抽屉：小屏贴底、大屏居中，避免键盘弹出后弹窗被顶出视口
  const containerClass =
    variant === 'sheet'
      ? 'fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4'
      : 'fixed inset-0 z-50 flex items-center justify-center p-4';

  const panelClass =
    variant === 'drawer'
      ? `absolute inset-y-0 right-0 flex w-full ${sizeClass} flex-col border-l border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] shadow-2xl`
      : variant === 'sheet'
        ? `card relative flex max-h-[92vh] w-full ${sizeClass} flex-col rounded-b-none rounded-t-xl sm:rounded-xl`
        : `card relative flex max-h-[90vh] w-full ${sizeClass} flex-col`;

  // 基础层号低于侧边栏移动导航(z-40)，弹窗始终盖在页面之上；叠开时逐层递增
  const zIndex = 50 + (layer ?? 0);

  return (
    <div className={containerClass} style={{ zIndex }}>
      <button
        type="button"
        aria-label={t('actions.close')}
        onClick={requestClose}
        tabIndex={-1}
        className="absolute inset-0 bg-black/50"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className={panelClass}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            {description && (
              <div className="mt-1 text-xs text-[var(--color-content-muted)]">{description}</div>
            )}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={requestClose}
              disabled={busy}
              aria-label={t('actions.close')}
              className="-mr-1 shrink-0 rounded-lg p-1.5 text-[var(--color-content-muted)] hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] px-5 py-3">
            {footer}
          </footer>
        )}
      </div>

      {/* 丢弃确认叠在本弹窗之上：原内容保持可见，确认层单独接管 Esc 与焦点 */}
      <Modal
        open={confirmDiscard}
        size="sm"
        title={t('modal.discard_title')}
        onClose={() => setConfirmDiscard(false)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmDiscard(false)}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
            >
              {t('modal.discard_keep_editing')}
            </button>
            <button
              type="button"
              data-autofocus
              onClick={() => {
                setConfirmDiscard(false);
                onClose();
              }}
              className="rounded-lg bg-[var(--color-negative)] px-3 py-2 text-sm font-medium text-white"
            >
              {t('modal.discard_confirm_action')}
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-content-muted)]">{t('modal.discard_confirm')}</p>
      </Modal>
    </div>
  );
}
