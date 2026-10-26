import EmptyState from '@/components/ui/EmptyState';
import '@/components/charts/echarts';
import { adminApi, type AdminRateHistoryPoint } from '@/lib/admin';
import { ApiError } from '@/lib/client';
import { translateError } from '@/lib/error-message';
import { formatRate } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import ReactECharts from 'echarts-for-react';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

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
  const [range, setRange] = useState<Range>(90);

  const query = useQuery({
    queryKey: ['admin', 'exchange-rate-history', pair?.from, pair?.to, range],
    queryFn: () => adminApi.exchangeRateHistory({ from: pair!.from, to: pair!.to, days: range }),
    enabled: pair !== null,
  });

  if (!pair) return null;

  const points: AdminRateHistoryPoint[] = query.data?.points ?? [];
  const inverted = query.data?.inverted ?? false;

  const option = {
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(30,32,38,0.95)',
      borderWidth: 0,
      textStyle: { color: '#e8e9ed', fontSize: 12 },
      valueFormatter: (value: number) => formatRate(value),
    },
    xAxis: {
      type: 'category',
      data: points.map((point) => point.rateDate.slice(5)),
      boundaryGap: false,
      axisLine: { lineStyle: { color: 'var(--color-border-subtle)' } },
      axisLabel: { color: 'var(--color-content-muted)', fontSize: 10 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { lineStyle: { color: 'var(--color-border-subtle)', opacity: 0.4 } },
      axisLabel: {
        color: 'var(--color-content-muted)',
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="card flex max-h-[90vh] w-full max-w-2xl flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">
              {t('exchangeRates.history.title')}
              <span className="ml-2 font-mono text-xs text-[var(--color-content-muted)]">
                1 {pair.from} → {pair.to}
              </span>
            </h2>
            {inverted && (
              <p className="mt-1 text-xs text-[var(--color-content-muted)]">
                {t('exchangeRates.history.inverted_hint')}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('exchangeRates.history.close')}
            className="text-[var(--color-content-muted)] hover:text-[var(--color-content-strong)]"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border-subtle)] px-4 py-2">
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

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
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
                  {/* 新的在上面：看走势时最关心最近几次改动 */}
                  {[...points].reverse().map((point) => (
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
