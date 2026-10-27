import EmptyState from '@/components/ui/EmptyState';
import { formatNumber } from '@/lib/format';
import type { GoalHistoryPoint } from '@/lib/goals';
import { useTranslation } from 'react-i18next';
import '../charts/echarts';
import { useChartTheme } from '../charts/chart-theme';
import ReactECharts from 'echarts-for-react';

interface Props {
  points: GoalHistoryPoint[];
  currency: string;
  targetAmount: string;
}

export default function GoalHistoryChart({ points, currency, targetAmount }: Props) {
  const { t } = useTranslation('goals');
  const chartTheme = useChartTheme();

  if (points.length === 0) {
    return <EmptyState title={t('detail.history_empty')} />;
  }

  const months = points.map((point) => point.asOf.slice(0, 7));
  const values = points.map((point) => Number(point.currentAmount));
  const target = Number(targetAmount);

  const option = {
    grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: chartTheme.tooltipBg,
      borderWidth: 0,
      textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
      valueFormatter: (value: number) => `${formatNumber(value, { maximumFractionDigits: 2 })} ${currency}`,
    },
    legend: {
      data: [t('chart.actual'), t('chart.target')],
      right: 0,
      top: 0,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: chartTheme.legend, fontSize: 11 },
    },
    xAxis: {
      type: 'category',
      data: months,
      axisLabel: {
        color: chartTheme.axisLabel,
        fontSize: 10,
        interval: Math.max(0, Math.floor(months.length / 6) - 1),
      },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: chartTheme.axisLine } },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: chartTheme.axisLabel,
        fontSize: 10,
        formatter: (value: number) => formatNumber(value, { notation: 'compact', maximumFractionDigits: 1 }),
      },
      splitLine: { lineStyle: { color: chartTheme.splitLine } },
    },
    series: [
      {
        name: t('chart.actual'),
        type: 'line',
        data: values,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.12 },
      },
      {
        // 目标线用虚线，满足不只靠颜色区分的要求
        name: t('chart.target'),
        type: 'line',
        data: months.map(() => target),
        showSymbol: false,
        lineStyle: { width: 1.5, type: 'dashed' },
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 240 }} notMerge />;
}
