import EmptyState from '@/components/ui/EmptyState';
import LoadingState from '@/components/ui/LoadingState';
import ErrorState from '@/components/ui/ErrorState';
import Modal from '@/components/ui/Modal';
import '@/components/charts/echarts';
import { useChartTheme } from '@/theme/chart-theme';
import { SERIES_PRIMARY } from '@/theme/palette';
import {
  exchangeRatesApi,
  type RateGranularity,
  type RateHistoryPoint,
} from '@/lib/dashboard';
import { currencyName, formatDate, formatRate } from '@/lib/format';
import CurrencyPair from '@/components/finance/CurrencyPair';
import { useQuery } from '@tanstack/react-query';
import ReactECharts from 'echarts-for-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 每档粒度的可切换窗口（桶数）。
 *
 * 与后端默认窗口保持一致：日线看近月、周线看近年、月/季/年线拉长到十年以上，
 * 让「粒度为主」的操作模型不需要用户再手填日期。
 */
const RANGE_OPTIONS: Record<RateGranularity, Array<{ buckets: number; key: string }>> = {
  day: [
    { buckets: 30, key: 'range_30d' },
    { buckets: 90, key: 'range_90d' },
    { buckets: 365, key: 'range_1y' },
  ],
  week: [
    { buckets: 26, key: 'range_26w' },
    { buckets: 52, key: 'range_1y' },
    { buckets: 156, key: 'range_3y' },
  ],
  month: [
    { buckets: 12, key: 'range_12m' },
    { buckets: 60, key: 'range_5y' },
    { buckets: 120, key: 'range_10y' },
  ],
  quarter: [
    { buckets: 8, key: 'range_2y' },
    { buckets: 20, key: 'range_5y' },
    { buckets: 40, key: 'range_10y' },
  ],
  year: [
    { buckets: 10, key: 'range_10y' },
    { buckets: 20, key: 'range_20y' },
    { buckets: 50, key: 'range_50y' },
  ],
};

const GRANULARITIES: RateGranularity[] = ['day', 'week', 'month', 'quarter', 'year'];

/** 各档粒度的默认桶数，与所选窗口选项的第一档对齐 */
const DEFAULT_BUCKETS: Record<RateGranularity, number> = {
  day: 90,
  week: 52,
  month: 60,
  quarter: 20,
  year: 20,
};

const DETAIL_PAGE_SIZE = 12;

function pct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function changeTone(value: number): string {
  if (value > 0) return 'var(--color-positive)';
  if (value < 0) return 'var(--color-negative)';
  return 'var(--color-content-muted)';
}

/**
 * 汇率走势弹窗。
 *
 * 汇率主表本身就是「每对每天一条」的日度数据，所以这里只是把同一份数据
 * 按日/周/月/季/年重新聚合（后端取每周期最后一个可用日），不引入新数据源。
 * 图上最后一个点与列表卡片的当前汇率同口径（同一天时相等）。
 */
export default function RateTrendDialog({
  pair,
  onClose,
}: {
  pair: { from: string; to: string } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('settings');
  const chartTheme = useChartTheme();

  const [granularity, setGranularity] = useState<RateGranularity>('day');
  const [buckets, setBuckets] = useState<number>(DEFAULT_BUCKETS.day);
  // 明细页码；换币种对、粒度或窗口时归零（见下方 switchGranularity）
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['exchange-rates', 'history', pair?.from, pair?.to, granularity, buckets],
    queryFn: () =>
      exchangeRatesApi.history({
        from: pair!.from,
        to: pair!.to,
        granularity,
        buckets,
      }),
    enabled: pair !== null,
  });

  if (!pair) return null;

  function switchGranularity(next: RateGranularity) {
    setGranularity(next);
    setBuckets(DEFAULT_BUCKETS[next]);
    setPage(1);
  }

  function switchBuckets(next: number) {
    setBuckets(next);
    setPage(1);
  }

  const points: RateHistoryPoint[] = query.data?.points ?? [];
  const inverted = (query.data?.inverted ?? false) && points.length > 0;

  const last = points[points.length - 1] ?? null;
  const prev = points[points.length - 2] ?? null;
  const first = points[0] ?? null;

  const periodChange =
    last && prev && Number(prev.rate) !== 0
      ? (Number(last.rate) - Number(prev.rate)) / Number(prev.rate)
      : null;
  const rangeChange =
    last && first && points.length > 1 && Number(first.rate) !== 0
      ? (Number(last.rate) - Number(first.rate)) / Number(first.rate)
      : null;

  // 明细倒序：最近的变化最值得看
  const ordered = [...points].reverse();
  const totalPages = Math.max(1, Math.ceil(ordered.length / DETAIL_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const detailRows = ordered.slice((safePage - 1) * DETAIL_PAGE_SIZE, safePage * DETAIL_PAGE_SIZE);

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
      data: points.map((point) => point.periodStart),
      boundaryGap: false,
      axisLine: { lineStyle: { color: chartTheme.axisLine } },
      axisLabel: {
        color: chartTheme.axisLabel,
        fontSize: 10,
        // 点多时只显示一部分刻度，避免标签糊成一片
        hideOverlap: true,
      },
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
        smooth: false,
        showSymbol: points.length <= 14,
        lineStyle: { width: 2, color: SERIES_PRIMARY },
        itemStyle: { color: SERIES_PRIMARY },
        areaStyle: { opacity: 0.12, color: SERIES_PRIMARY },
      },
    ],
  };

  const headerTitle = (
    <>
      {t('exchange_rates.history.title')}
      <span className="ml-2 inline-flex items-center text-xs font-normal text-[var(--color-content-muted)]">
        <CurrencyPair from={pair.from} to={pair.to} className="mr-1" />
      </span>
    </>
  );

  const granularityLabel: Record<RateGranularity, string> = {
    day: t('exchange_rates.history.granularity.day'),
    week: t('exchange_rates.history.granularity.week'),
    month: t('exchange_rates.history.granularity.month'),
    quarter: t('exchange_rates.history.granularity.quarter'),
    year: t('exchange_rates.history.granularity.year'),
  };

  return (
    <Modal
      open
      size="2xl"
      title={headerTitle}
      description={
        inverted
          ? t('exchange_rates.history.inverted_hint', {
              from: pair.to,
              to: pair.from,
            })
          : t('exchange_rates.history.description', {
              fromName: currencyName(pair.from),
              toName: currencyName(pair.to),
            })
      }
      onClose={onClose}
    >
      <div className="space-y-4">
        {/* 粒度切换 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--color-content-muted)]">
            {t('exchange_rates.history.granularity_label')}
          </span>
          <div className="inline-flex overflow-hidden rounded-lg border border-[var(--color-border-subtle)]">
            {GRANULARITIES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => switchGranularity(item)}
                className={`px-3 py-1 text-xs ${
                  granularity === item
                    ? 'btn-action'
                    : 'hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                {granularityLabel[item]}
              </button>
            ))}
          </div>
        </div>

        {/* 区间切换：随粒度联动 */}
        <div className="flex flex-wrap items-center gap-2">
          {RANGE_OPTIONS[granularity].map((option) => (
            <button
              key={option.buckets}
              type="button"
              onClick={() => switchBuckets(option.buckets)}
              className={`rounded-lg px-2.5 py-1 text-xs ${
                buckets === option.buckets
                  ? 'btn-action'
                  : 'border border-[var(--color-border-subtle)] hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              {t(`exchange_rates.history.${option.key}`)}
            </button>
          ))}
        </div>

        {query.isPending && <LoadingState />}
        {query.isError && <ErrorState onRetry={() => void query.refetch()} />}

        {query.isSuccess && points.length === 0 && (
          <EmptyState
            title={t('exchange_rates.history.empty_title')}
            description={t('exchange_rates.history.empty_description')}
          />
        )}

        {query.isSuccess && points.length === 1 && last && (
          <div className="space-y-2">
            <p className="text-3xl font-semibold tabular-nums">{formatRate(last.rate)}</p>
            <p className="text-xs text-[var(--color-content-muted)]">
              {t('exchange_rates.history.single_point', {
                date: formatDate(last.periodStart),
                count: last.samples,
              })}
            </p>
          </div>
        )}

        {query.isSuccess && points.length > 1 && last && (
          <>
            {/* 头部关键数字：当前汇率 + 环比 + 区间涨跌 */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--color-border-subtle)] p-3">
                <p className="text-xs text-[var(--color-content-muted)]">
                  {t('exchange_rates.history.current')}
                </p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {formatRate(last.rate)}
                </p>
                <p className="mt-1 text-xs text-[var(--color-content-muted)]">
                  {formatDate(last.periodStart)}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--color-border-subtle)] p-3">
                <p className="text-xs text-[var(--color-content-muted)]">
                  {t('exchange_rates.history.change_vs_prev', { unit: granularityLabel[granularity] })}
                </p>
                <p
                  className="mt-1 text-xl font-semibold tabular-nums"
                  style={{ color: periodChange === null ? undefined : changeTone(periodChange) }}
                >
                  {periodChange === null ? '—' : pct(periodChange)}
                </p>
                <p className="mt-1 text-xs text-[var(--color-content-muted)]">
                  {prev
                    ? t('exchange_rates.history.prev_value', { rate: formatRate(prev.rate) })
                    : '—'}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--color-border-subtle)] p-3">
                <p className="text-xs text-[var(--color-content-muted)]">
                  {t('exchange_rates.history.change_in_range')}
                </p>
                <p
                  className="mt-1 text-xl font-semibold tabular-nums"
                  style={{ color: rangeChange === null ? undefined : changeTone(rangeChange) }}
                >
                  {rangeChange === null ? '—' : pct(rangeChange)}
                </p>
                <p className="mt-1 text-xs text-[var(--color-content-muted)]">
                  {first ? formatDate(first.periodStart) : '—'} · {t('exchange_rates.history.to_now')}
                </p>
              </div>
            </div>

            <ReactECharts option={option} style={{ height: 260 }} notMerge />

            {/* 明细：按日期倒序、分页 */}
            <div>
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--color-border-subtle)] text-left text-xs text-[var(--color-content-muted)]">
                  <tr>
                    <th className="px-2 py-1.5">{t('exchange_rates.history.period')}</th>
                    <th className="px-2 py-1.5 text-right">{t('exchange_rates.rate')}</th>
                    <th className="px-2 py-1.5 text-right">
                      {t('exchange_rates.history.samples')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {detailRows.map((point) => (
                    <tr key={point.periodStart}>
                      <td className="px-2 py-1.5 font-mono text-xs text-[var(--color-content-muted)]">
                        {formatDate(point.periodStart)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                        {formatRate(point.rate)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs text-[var(--color-content-muted)]">
                        {granularity === 'day'
                          ? '—'
                          : t('exchange_rates.history.samples_value', { count: point.samples })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {ordered.length > DETAIL_PAGE_SIZE && (
                <div className="flex items-center justify-between border-t border-[var(--color-border-subtle)] px-2 py-2 text-xs text-[var(--color-content-muted)]">
                  <span>{t('exchange_rates.history.detail_total', { total: ordered.length })}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPage(safePage - 1)}
                      disabled={safePage <= 1}
                      className="rounded-md px-2 py-1 hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
                    >
                      {t('exchange_rates.history.prev')}
                    </button>
                    <span>
                      {safePage} / {totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPage(safePage + 1)}
                      disabled={safePage >= totalPages}
                      className="rounded-md px-2 py-1 hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
                    >
                      {t('exchange_rates.history.next')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
