const STEPS = ['上传', '映射', '预览与校验', '重复确认', '结果'];

export default function ImportStepper({
  current,
  onSelect,
}: {
  current: number;
  /** 只允许回到已完成的步骤，不能跳步 */
  onSelect?: (step: number) => void;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {STEPS.map((label, index) => {
        const step = index + 1;
        const done = step < current;
        const active = step === current;
        const clickable = done && onSelect;

        return (
          <li key={label} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSelect(step)}
              className={`flex items-center gap-2 rounded-full px-3 py-1 transition-colors ${
                active
                  ? 'bg-[var(--color-accent)] text-white'
                  : done
                    ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                    : 'text-[var(--color-content-muted)]'
              } ${clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
            >
              <span className="grid size-5 place-items-center rounded-full bg-black/10 text-xs dark:bg-white/10">
                {step}
              </span>
              {label}
            </button>
            {step < STEPS.length && <span className="text-[var(--color-content-muted)]">›</span>}
          </li>
        );
      })}
    </ol>
  );
}
