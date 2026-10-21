import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import BatchStatusBadge from '@/components/imports/BatchStatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { ApiError } from '@/lib/client';
import { importsApi, type ImportStatus } from '@/lib/imports';

const FILTERS: Array<{ value: ImportStatus | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'parsed', label: '待映射' },
  { value: 'validated', label: '待提交' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
];

export default function ImportsPage() {
  const [status, setStatus] = useState<ImportStatus | 'all'>('all');
  const [page, setPage] = useState(1);

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['imports', status, page],
    queryFn: () => importsApi.list(status, page, 20),
  });

  if (isPending) return <LoadingState label="加载导入批次…" />;

  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiError ? error.message : '加载失败'}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">账单导入</h1>
        <div className="flex gap-2">
          <Link
            to="/imports/rules"
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
          >
            分类规则
          </Link>
          <Link
            to="/imports/unmatched"
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
          >
            待匹配流水
          </Link>
          <Link
            to="/imports/new"
            className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
          >
            导入账单
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => {
              setStatus(item.value);
              setPage(1);
            }}
            className={`rounded-lg px-3 py-1 text-sm ${
              status === item.value
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                : 'text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {data.batches.length === 0 ? (
        <EmptyState
          title="还没有导入记录"
          description="上传银行导出的 CSV 或 XLSX 账单，预览确认后批量入账。"
          action={
            <Link
              to="/imports/new"
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
            >
              开始导入
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)]">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-[var(--color-border-subtle)] text-left text-xs text-[var(--color-content-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">文件</th>
                <th className="px-3 py-2 font-medium">账户</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium">行数</th>
                <th className="px-3 py-2 font-medium">导入</th>
                <th className="px-3 py-2 font-medium">创建时间</th>
              </tr>
            </thead>
            <tbody>
              {data.batches.map((batch) => (
                <tr key={batch.id} className="border-b border-[var(--color-border-subtle)]/50 last:border-0">
                  <td className="px-3 py-2">
                    <Link to={`/imports/${batch.id}`} className="hover:text-[var(--color-accent)]">
                      {batch.originalFilename}
                    </Link>
                    <p className="text-xs text-[var(--color-content-muted)]">{batch.format.toUpperCase()}</p>
                  </td>
                  <td className="px-3 py-2">{batch.accountName}</td>
                  <td className="px-3 py-2">
                    <BatchStatusBadge status={batch.status} />
                  </td>
                  <td className="px-3 py-2">{batch.counts.total}</td>
                  <td className="px-3 py-2">{batch.counts.imported}</td>
                  <td className="px-3 py-2 text-[var(--color-content-muted)]">
                    {new Date(batch.createdAt).toLocaleString('zh-CN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--color-content-muted)]">
            第 {data.pagination.page} / {data.pagination.totalPages} 页，共 {data.pagination.total} 条
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1 disabled:opacity-50"
            >
              上一页
            </button>
            <button
              type="button"
              disabled={page >= data.pagination.totalPages}
              onClick={() => setPage((value) => value + 1)}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1 disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
