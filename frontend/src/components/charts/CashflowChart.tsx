import type { CashflowPoint } from '@/lib/dashboard';
import { formatNumber } from '@/lib/format';
import './echarts';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';
import EmptyState from '../ui/EmptyState';
import { useChartTheme } from '@/theme/chart-theme';
import { SERIES_NEGATIVE, SERIES_POSITIVE, SERIES_PRIMARY } from '@/theme/palette';

export default function CashflowChart({
  points,
  currency,
}: {
  points: CashflowPoint[];
  currency: string;
}) {
  const { t } = useTranslation('dashboard');
  const chartTheme = useChartTheme();

  if (points.length === 0) {
    return (
      <EmptyState
        title={t('charts.cashflow_empty_title')}
        description={t('charts.cashflow_empty_description')}
      />
    );
  }

  const option = {
    grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
    legend: {
      top: 0,
      right: 0,
      textStyle: { color: chartTheme.legend, fontSize: 11 },
      itemWidth: 10,
      itemHeight: 10,
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: chartTheme.tooltipBg,
      borderWidth: 0,
      textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
      valueFormatter: (value: number) => `${formatNumber(value)} ${currency}`,
    },
    xAxis: {
      type: 'category',
      data: points.map((point) => point.period),
      axisLine: { lineStyle: { color: chartTheme.axisLine } },
      axisLabel: { color: chartTheme.axisLabel, fontSize: 11 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: chartTheme.splitLine } },
      axisLabel: { color: chartTheme.axisLabel, fontSize: 11 },
    },
    series: [
      {
        name: t('charts.cashflow_income'),
        type: 'bar',
        barMaxWidth: 22,
        itemStyle: { color: SERIES_POSITIVE, borderRadius: [3, 3, 0, 0] },
        data: points.map((point) => Number(point.income)),
      },
      {
        name: t('charts.cashflow_expense'),
        type: 'bar',
        barMaxWidth: 22,
        itemStyle: { color: SERIES_NEGATIVE, borderRadius: [3, 3, 0, 0] },
        data: points.map((point) => Number(point.expense)),
      },
      {
        name: t('charts.cashflow_net'),
        type: 'line',
        smooth: true,
        symbolSize: 5,
        lineStyle: { width: 2, color: SERIES_PRIMARY },
        itemStyle: { color: SERIES_PRIMARY },
        data: points.map((point) => Number(point.net)),
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 260 }} notMerge lazyUpdate />;
}
