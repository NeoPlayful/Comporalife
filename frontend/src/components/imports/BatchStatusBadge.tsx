import type { ImportStatus } from '@/lib/imports';
import { useTranslation } from 'react-i18next';

const TONES: Record<ImportStatus, string> = {
  uploaded: 'bg-sky-500/15 text-sky-500',
  parsed: 'bg-sky-500/15 text-sky-500',
  mapped: 'bg-amber-500/15 text-amber-500',
  validated: 'bg-amber-500/15 text-amber-500',
  committing: 'bg-amber-500/15 text-amber-500',
  completed: 'bg-emerald-500/15 text-emerald-500',
  failed: 'bg-red-500/15 text-red-500',
  cancelled: 'bg-black/10 text-[var(--color-content-muted)] dark:bg-white/10',
  rolled_back: 'bg-black/10 text-[var(--color-content-muted)] dark:bg-white/10',
};

export default function BatchStatusBadge({ status }: { status: ImportStatus }) {
  const { t } = useTranslation('imports');

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        TONES[status] ?? 'bg-black/10 text-[var(--color-content-muted)] dark:bg-white/10'
      }`}
    >
      {t(`status.${status}`, { defaultValue: status })}
    </span>
  );
}
