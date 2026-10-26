/**
 * 整行可点的布尔开关。
 *
 * 状态由调用方持有——二次确认、接口提交、回滚都留在业务侧，这里只负责呈现
 * 与键盘/读屏语义。点击后若调用方因确认被取消没有改变 checked，开关视觉也
 * 保持原样，不会出现「看着打开了其实没生效」。
 */
export default function SwitchRow({
  title,
  hint,
  checked,
  onCheckedChange,
  disabled = false,
  disabledHint,
  pending = false,
  onLabel,
  offLabel,
  className = '',
}: {
  title: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  disabledHint?: string;
  pending?: boolean;
  onLabel?: string;
  offLabel?: string;
  className?: string;
}) {
  const showStateLabel = Boolean(onLabel && offLabel);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={title}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      onClick={() => onCheckedChange(!checked)}
      className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed ${className}`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        {hint && (
          <span className="mt-0.5 block text-xs text-[var(--color-content-muted)]">{hint}</span>
        )}
        {disabled && disabledHint && (
          <span className="mt-1 block text-xs text-[var(--color-content-muted)]">
            {disabledHint}
          </span>
        )}
      </span>

      <span className="flex shrink-0 items-center gap-2">
        {showStateLabel && (
          <span className="text-xs text-[var(--color-content-muted)]">
            {checked ? onLabel : offLabel}
          </span>
        )}

        <span
          aria-hidden
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors motion-reduce:transition-none ${
            checked ? 'bg-[var(--color-switch-on)]' : 'bg-[var(--color-switch-off)]'
          } ${disabled ? 'opacity-40' : ''}`}
        >
          <span
            className={`absolute flex size-5 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-all motion-reduce:transition-none ${
              checked ? 'left-[1.375rem]' : 'left-0.5'
            }`}
          >
            {pending && (
              <span className="size-3 animate-spin rounded-full border-2 border-[var(--color-border-subtle)] border-t-[var(--color-accent)] motion-reduce:animate-none" />
            )}
          </span>
        </span>
      </span>
    </button>
  );
}
