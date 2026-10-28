import type { NetWorthTrend } from '@/lib/dashboard';
import { formatNumber } from '@/lib/format';
import './echarts';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';
import EmptyState from '../ui/EmptyState';
import { useChartTheme } from '@/theme/chart-theme';
import { SERIES_PRIMARY } from '@/theme/palette';

export default function NetWorthChart({ data }: { data: NetWorthTrend }) {
  const { t } = useTranslation('dashboard');
  const chartTheme = useChartTheme();

  if (data.series.length === 0) {
    return (
      <EmptyState
        title={t('charts.net_worth_empty_title')}
        description={t('charts.net_worth_empty_description')}
      />
    );
  }

  const option = {
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: chartTheme.tooltipBg,
      borderWidth: 0,
      textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
      valueFormatter: (value: number) => `${formatNumber(value)} ${data.baseCurrency}`,
    },
    xAxis: {
      type: 'category',
      data: data.series.map((point) => point.period),
      axisLine: { lineStyle: { color: chartTheme.axisLine } },
      // 日粒度下 30 个日期标签会挤成一团，交给 ECharts 自动跳着显示
      axisLabel: { color: chartTheme.axisLabel, fontSize: 11, hideOverlap: true },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { lineStyle: { color: chartTheme.splitLine } },
      axisLabel: { color: chartTheme.axisLabel, fontSize: 11 },
    },
    series: [
      {
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2, color: SERIES_PRIMARY },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(91,141,239,0.28)' },
              { offset: 1, color: 'rgba(91,141,239,0.02)' },
            ],
          },
        },
        data: data.series.map((point) => Number(point.netWorth)),
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 240 }} notMerge lazyUpdate />;
}
