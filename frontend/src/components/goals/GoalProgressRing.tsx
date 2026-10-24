interface Props {
  /** 0–1，允许超过 1 */
  progress: number | null;
  size?: number;
  label?: string;
}

/**
 * 进度环：视觉上封顶 100%，但悬停标题展示真实数值——
 * 超额完成必须可见，不能因为环形画满就丢掉 140% 这个事实。
 */
export default function GoalProgressRing({ progress, size = 64, label }: Props) {
  if (progress === null) {
    return (
      <div
        className="grid shrink-0 place-items-center rounded-full border border-dashed border-[var(--color-border-subtle)] text-[10px] text-[var(--color-content-muted)]"
        style={{ width: size, height: size }}
        title={label}
      >
        —
      </div>
    );
  }

  const clamped = Math.max(0, Math.min(1, progress));
  const stroke = size >= 56 ? 6 : 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`${(progress * 100).toFixed(1)}%`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-[var(--color-border-subtle)]"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={clamped >= 1 ? 'stroke-[var(--color-positive)]' : 'stroke-[var(--color-accent)]'}
          style={{ transition: 'stroke-dashoffset 300ms ease' }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-xs font-semibold tabular-nums">
        {(progress * 100).toFixed(0)}%
      </span>
    </div>
  );
}
