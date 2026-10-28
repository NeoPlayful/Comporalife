import { useTranslation } from 'react-i18next';

const STEP_KEYS = ['upload', 'mapping', 'validate', 'duplicates', 'result'] as const;

export default function ImportStepper({
  current,
  onSelect,
}: {
  current: number;
  /** 只允许回到已完成的步骤，不能跳步 */
  onSelect?: (step: number) => void;
}) {
  const { t } = useTranslation('imports');

  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {STEP_KEYS.map((key, index) => {
        const step = index + 1;
        const done = step < current;
        const active = step === current;
        const clickable = done && onSelect;

        return (
          <li key={key} className="flex items-center gap-2">
            {/* 当前步骤是状态而非操作：不设 disabled，否则会套上禁用底色，高亮就没了 */}
            <button
              type="button"
              disabled={!clickable && !active}
              aria-current={active ? 'step' : undefined}
              onClick={() => clickable && onSelect(step)}
              className={`flex items-center gap-2 rounded-full px-3 py-1 transition-colors ${
                active
                  ? 'btn-action'
                  : done
                    ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                    : 'text-[var(--color-content-muted)]'
              } ${clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
            >
              <span className="grid size-5 place-items-center rounded-full bg-black/10 text-xs dark:bg-white/10">
                {step}
              </span>
              {t(`stepper.${key}`)}
            </button>
            {step < STEP_KEYS.length && <span className="text-[var(--color-content-muted)]">›</span>}
          </li>
        );
      })}
    </ol>
  );
}
