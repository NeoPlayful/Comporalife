import EmptyState from '@/components/ui/EmptyState';
import Modal from '@/components/ui/Modal';
import '@/components/charts/echarts';
import { useChartTheme } from '@/components/charts/chart-theme';
import { adminApi, type AdminRateHistoryPoint } from '@/lib/admin';
import { ApiError } from '@/lib/client';
import { translateError } from '@/lib/error-message';
import { formatRate } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import ReactECharts from 'echarts-for-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];
const DETAIL_PAGE_SIZE = 10;

/**
 * 单个币种对的汇率走势。
 *
 * 汇率主表本身就是「每对每天一条」，因此这里不需要额外的历史表。
 * 折算方向与后端一致：没有正向记录时用反向的倒数，界面上明确标出来，
 * 避免把两个方向的数字看成同一条线。
 */
export default function RateHistoryDialog({
  pair,
  onClose,
}: {
  pair: { from: string; to: string } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('admin');
  const chartTheme = useChartTheme();
  const [range, setRange] = useState<Range>(90);
  const [detailPage, setDetailPage] = useState(1);

  const query = useQuery({
    queryKey: ['admin', 'exchange-rate-history', pair?.from, pair?.to, range],
    queryFn: () => adminApi.exchangeRateHistory({ from: pair!.from, to: pair!.to, days: range }),
    enabled: pair !== null,
  });

  // 换区间后回到第一页，否则可能停在已经不存在的页码上
  useEffect(() => {
    setDetailPage(1);
  }, [pair?.from, pair?.to, range]);

  if (!pair) return null;

  const points: AdminRateHistoryPoint[] = query.data?.points ?? [];
  // 空数据时不提示「图为反向倒数」：没有图可看，提示只会让人以为加载坏了
  const inverted = (query.data?.inverted ?? false) && points.length > 0;

  // 明细新的在上面：看走势时最关心最近几次改动
  const ordered = [...points].reverse();
  const detailTotalPages = Math.max(1, Math.ceil(ordered.length / DETAIL_PAGE_SIZE));
  const safeDetailPage = Math.min(detailPage, detailTotalPages);
  const detailRows = ordered.slice(
    (safeDetailPage - 1) * DETAIL_PAGE_SIZE,
    safeDetailPage * DETAIL_PAGE_SIZE,
  );

  const option = {
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: chartTheme.tooltipBg,
      borderWidth: 0,
      textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
      valueFormatter: (value: number) => formatRate(value),
    },
    xAxis: {
      type: 'category',
      data: points.map((point) => point.rateDate.slice(5)),
      boundaryGap: false,
      axisLine: { lineStyle: { color: chartTheme.axisLine } },
      axisLabel: { color: chartTheme.axisLabel, fontSize: 10 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { lineStyle: { color: chartTheme.splitLine } },
      axisLabel: {
        color: chartTheme.axisLabel,
        fontSize: 10,
        formatter: (value: number) => formatRate(value),
      },
    },
    series: [
      {
        type: 'line',
        data: points.map((point) => Number(point.rate)),
        smooth: true,
        showSymbol: points.length <= 14,
        lineStyle: { width: 2, color: '#5b8def' },
        itemStyle: { color: '#5b8def' },
        areaStyle: { opacity: 0.12, color: '#5b8def' },
      },
    ],
  };

  return (
    <Modal
      open
      size="2xl"
      title={
        <>
          {t('exchangeRates.history.title')}
          <span className="ml-2 font-mono text-xs font-normal text-[var(--color-content-muted)]">
            1 {pair.from} → {pair.to}
          </span>
        </>
      }
      description={inverted ? t('exchangeRates.history.inverted_hint') : undefined}
      onClose={onClose}
    >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {RANGES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRange(value)}
              className={`rounded-lg px-2.5 py-1 text-xs ${
                range === value
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'border border-[var(--color-border-subtle)] hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              {t('exchangeRates.history.range_days', { count: value })}
            </button>
          ))}
        </div>

        <div>
          {query.isPending && (
            <p className="py-12 text-center text-sm text-[var(--color-content-muted)]">
              {t('exchangeRates.history.loading')}
            </p>
          )}

          {query.isError && (
            <p className="py-12 text-center text-sm text-[var(--color-negative)]">
              {query.error instanceof ApiError
                ? translateError(query.error, t)
                : t('exchangeRates.history.load_failed')}
            </p>
          )}

          {query.isSuccess && points.length === 0 && (
            <EmptyState
              title={t('exchangeRates.history.empty_title')}
              description={t('exchangeRates.history.empty_description')}
            />
          )}

          {query.isSuccess && points.length > 0 && (
            <div className="space-y-3">
              <ReactECharts option={option} style={{ height: 240 }} notMerge />
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--color-border-subtle)] text-left text-xs text-[var(--color-content-muted)]">
                  <tr>
                    <th className="px-2 py-1.5">{t('exchangeRates.history.date')}</th>
                    <th className="px-2 py-1.5 text-right">{t('exchangeRates.rate')}</th>
                    <th className="px-2 py-1.5">{t('exchangeRates.source')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {detailRows.map((point) => (
                    <tr key={point.rateDate}>
                      <td className="px-2 py-1.5 font-mono text-xs text-[var(--color-content-muted)]">
                        {point.rateDate}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                        {formatRate(point.rate)}
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        {point.source === 'provider'
                          ? t('exchangeRates.source_provider')
                          : t('exchangeRates.source_manual')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {ordered.length > DETAIL_PAGE_SIZE && (
                <div className="flex items-center justify-between border-t border-[var(--color-border-subtle)] px-2 py-2 text-xs text-[var(--color-content-muted)]">
                  <span>{t('exchangeRates.history.detail_total', { total: ordered.length })}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setDetailPage(safeDetailPage - 1)}
                      disabled={safeDetailPage <= 1}
                      className="rounded-md px-2 py-1 hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
                    >
                      {t('exchangeRates.history.prev')}
                    </button>
                    <span>
                      {safeDetailPage} / {detailTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setDetailPage(safeDetailPage + 1)}
                      disabled={safeDetailPage >= detailTotalPages}
                      className="rounded-md px-2 py-1 hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
                    >
                      {t('exchangeRates.history.next')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
    </Modal>
  );
}
