import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 列表分页条：左侧总数，右侧页码与翻页。
 *
 * 页码按窗口收敛（首页、末页、当前页前后各一页，其余显示省略号），
 * 避免页数很多时把整行按钮铺满。
 */
export default function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  /** 总数文案的命名空间键，默认「共 N 条」 */
  totalLabel,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalLabel?: string;
}) {
  const { t } = useTranslation('common');

  const pages = useMemo<(number | 'gap')[]>(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const items: (number | 'gap')[] = [1];
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);

    if (start > 2) items.push('gap');
    for (let current = start; current <= end; current += 1) items.push(current);
    if (end < totalPages - 1) items.push('gap');
    items.push(totalPages);

    return items;
  }, [page, totalPages]);

  const showPager = totalPages > 1;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-[var(--color-content-muted)]">
        {totalLabel
          ? t(totalLabel, { total })
          : t('pagination.total', { total })}
        {pageSize > 0 && total > 0 ? ` · ${t('pagination.page', { page, totalPages })}` : ''}
      </span>

      {showPager && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label={t('pagination.prev')}
            className="rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1 disabled:opacity-40"
          >
            {t('pagination.prev')}
          </button>

          {pages.map((item, index) =>
            item === 'gap' ? (
              <span
                key={`gap-${index}`}
                className="px-1 text-[var(--color-content-muted)]"
                aria-hidden="true"
              >
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => onPageChange(item)}
                aria-current={item === page ? 'page' : undefined}
                className={`min-w-8 rounded-lg border px-2 py-1 tabular-nums ${
                  item === page
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                    : 'border-[var(--color-border-subtle)] hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                {item}
              </button>
            ),
          )}

          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label={t('pagination.next')}
            className="rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1 disabled:opacity-40"
          >
            {t('pagination.next')}
          </button>
        </div>
      )}
    </div>
  );
}
