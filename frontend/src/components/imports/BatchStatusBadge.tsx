import type { ImportStatus } from '@/lib/imports';

const LABELS: Record<ImportStatus, { text: string; tone: string }> = {
  uploaded: { text: '已上传', tone: 'bg-sky-500/15 text-sky-500' },
  parsed: { text: '待映射', tone: 'bg-sky-500/15 text-sky-500' },
  mapped: { text: '待校验', tone: 'bg-amber-500/15 text-amber-500' },
  validated: { text: '待提交', tone: 'bg-amber-500/15 text-amber-500' },
  committing: { text: '提交中', tone: 'bg-amber-500/15 text-amber-500' },
  completed: { text: '已完成', tone: 'bg-emerald-500/15 text-emerald-500' },
  failed: { text: '失败', tone: 'bg-red-500/15 text-red-500' },
  cancelled: { text: '已取消', tone: 'bg-black/10 text-[var(--color-content-muted)] dark:bg-white/10' },
  rolled_back: { text: '已撤销', tone: 'bg-black/10 text-[var(--color-content-muted)] dark:bg-white/10' },
};

export default function BatchStatusBadge({ status }: { status: ImportStatus }) {
  const item = LABELS[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${item.tone}`}>
      {item.text}
    </span>
  );
}
