import type { TrendResponse } from '@/lib/analytics';
import { formatNumber } from '@/lib/format';
import { useTranslation } from 'react-i18next';
import EmptyState from '../ui/EmptyState';
import '../charts/echarts';
import { useChartTheme } from '../charts/chart-theme';
import ReactECharts from 'echarts-for-react';

export default function TrendComparisonChart({
  points,
  currency,
}: {
  points: TrendResponse['points'];
  currency: string;
}) {
  const { t } = useTranslation('analytics');
  const chartTheme = useChartTheme();

  if (points.length === 0) {
    return <EmptyState title={t('trend.empty')} />;
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
      // 无流水的周期追加标记，避免被读成零支出
      data: points.map((point) => (point.isComplete ? point.period : `${point.period} ·`)),
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
        name: t('metrics.income'),
        type: 'bar',
        barMaxWidth: 20,
        itemStyle: { color: '#4ea87c', borderRadius: [3, 3, 0, 0] },
        data: points.map((point) => Number(point.income)),
      },
      {
        name: t('metrics.expense'),
        type: 'bar',
        barMaxWidth: 20,
        itemStyle: { color: '#c76a5e', borderRadius: [3, 3, 0, 0] },
        data: points.map((point) => Number(point.expense)),
      },
      {
        name: t('metrics.net'),
        type: 'line',
        smooth: true,
        symbolSize: 5,
        lineStyle: { width: 2, color: '#5b8def' },
        itemStyle: { color: '#5b8def' },
        data: points.map((point) => (point.isComplete ? Number(point.net) : null)),
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 300 }} notMerge lazyUpdate />;
}
