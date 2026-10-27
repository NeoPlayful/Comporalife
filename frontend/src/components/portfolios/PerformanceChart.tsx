import type { PerformanceResponse, ReturnsResponse } from '@/lib/portfolios';
import { formatNumber } from '@/lib/format';
import { useTranslation } from 'react-i18next';
import EmptyState from '../ui/EmptyState';
import '../charts/echarts';
import { useChartTheme } from '../charts/chart-theme';
import ReactECharts from 'echarts-for-react';
import { useState } from 'react';

function pct(value: string | null): string {
  if (value === null) return '—';
  return `${(Number(value) * 100).toFixed(2)}%`;
}

export default function PerformanceChart({
  performance,
  returns,
  currency,
}: {
  performance: PerformanceResponse;
  returns?: ReturnsResponse;
  currency: string;
}) {
  const { t } = useTranslation('portfolios');
  const chartTheme = useChartTheme();
  const { t: tEnums } = useTranslation('enums');
  const [showSegments, setShowSegments] = useState(false);

  if (performance.points.length === 0) {
    return (
      <EmptyState title={t('performance.empty')} description={t('performance.empty_hint')} />
    );
  }

  const option = {
    grid: { left: 12, right: 16, top: 24, bottom: 28, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: chartTheme.tooltipBg,
      borderWidth: 0,
      textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
      valueFormatter: (value: number | null) =>
        value === null ? '—' : `${formatNumber(value)} ${currency}`,
    },
    xAxis: {
      type: 'category',
      data: performance.points.map((point) => point.date),
      axisLine: { lineStyle: { color: chartTheme.axisLine } },
      axisLabel: { color: chartTheme.axisLabel, fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: chartTheme.splitLine } },
      axisLabel: { color: chartTheme.axisLabel, fontSize: 10 },
    },
    series: [
      {
        name: t('summary.portfolio_value'),
        type: 'line',
        smooth: true,
        showSymbol: false,
        connectNulls: false,
        // 缺价处断开，不做插值连线
        data: performance.points.map((point) => (point.complete ? Number(point.value) : null)),
        lineStyle: { width: 2, color: '#5b8def' },
        areaStyle: { color: 'rgba(91,141,239,0.12)' },
      },
    ],
  };

  const missing = performance.missingValuations.slice(0, 5).join(', ');
  // 有多少点是靠手工快照撑起来的，必须显式说明，否则用户会以为是重算结果
  const snapshotPoints = performance.points.filter(
    (point) => point.valuationSource === 'manual_snapshot',
  ).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{t('performance.title')}</h3>
        <p className="text-xs text-[var(--color-content-muted)]">
          {t(`performance.granularity_${performance.granularity}`)}
          {performance.downgraded &&
            ` · ${t('performance.downgraded', {
              granularity: t(`performance.granularity_${performance.granularity}`),
            })}`}
        </p>
      </div>

      <ReactECharts option={option} style={{ height: 280 }} notMerge />

      {!performance.isComplete && missing && (
        <p className="rounded-lg bg-[var(--color-warning,#d3a35a)]/10 px-3 py-2 text-xs">
          {t('performance.missing_dates', { dates: missing })}
        </p>
      )}

      {snapshotPoints > 0 && (
        <p className="rounded-lg bg-[var(--color-accent)]/10 px-3 py-2 text-xs">
          {t('performance.snapshot_points', { count: snapshotPoints })}
        </p>
      )}

      {returns && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--color-border-subtle)] p-3">
            <p className="text-xs text-[var(--color-content-muted)]">{t('summary.twr')}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{pct(returns.twr.value)}</p>
            <p className="mt-1 text-xs text-[var(--color-content-muted)]">
              {returns.twr.reason
                ? t('performance.reason', {
                    reason: tEnums(`performance_reason.${returns.twr.reason}`),
                  })
                : t('performance.twr_hint')}
            </p>
            {returns.twr.segments.length > 0 && (
              <button
                type="button"
                onClick={() => setShowSegments((prev) => !prev)}
                className="mt-2 text-xs text-[var(--color-accent)] underline"
              >
                {t('performance.segments')}
              </button>
            )}
          </div>

          <div className="rounded-lg border border-[var(--color-border-subtle)] p-3">
            <p className="text-xs text-[var(--color-content-muted)]">{t('summary.xirr')}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{pct(returns.xirr.value)}</p>
            <p className="mt-1 text-xs text-[var(--color-content-muted)]">
              {returns.xirr.reason
                ? t('performance.reason', {
                    reason: tEnums(`performance_reason.${returns.xirr.reason}`),
                  })
                : t('performance.xirr_hint')}
            </p>
          </div>
        </div>
      )}

      {showSegments && returns && returns.twr.segments.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border-subtle)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border-subtle)] text-left text-[var(--color-content-muted)]">
                <th className="px-2 py-1.5 font-normal">{t('performance.segment_from')}</th>
                <th className="px-2 py-1.5 font-normal">{t('performance.segment_to')}</th>
                <th className="px-2 py-1.5 text-right font-normal">
                  {t('performance.segment_start')}
                </th>
                <th className="px-2 py-1.5 text-right font-normal">{t('performance.segment_end')}</th>
                <th className="px-2 py-1.5 text-right font-normal">{t('performance.segment_flow')}</th>
                <th className="px-2 py-1.5 text-right font-normal">
                  {t('performance.segment_return')}
                </th>
              </tr>
            </thead>
            <tbody>
              {returns.twr.segments.map((segment) => (
                <tr key={`${segment.from}-${segment.to}`} className="border-b border-[var(--color-border-subtle)]/50">
                  <td className="px-2 py-1.5 tabular-nums">{segment.from}</td>
                  <td className="px-2 py-1.5 tabular-nums">{segment.to}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatNumber(segment.startValue)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatNumber(segment.endValue)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatNumber(segment.netFlow)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{pct(segment.return)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
