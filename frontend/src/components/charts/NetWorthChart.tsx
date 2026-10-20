import type { NetWorthTrend } from '@/api/dashboard';
import './echarts';
import ReactECharts from 'echarts-for-react';
import EmptyState from '../ui/EmptyState';

export default function NetWorthChart({ data }: { data: NetWorthTrend }) {
  if (data.series.length === 0) {
    return <EmptyState title="暂无净资产数据" description="创建账户并记账后即可看到趋势。" />;
  }

  const option = {
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(30,32,38,0.95)',
      borderWidth: 0,
      textStyle: { color: '#e8e9ed', fontSize: 12 },
      valueFormatter: (value: number) => `${value.toLocaleString('zh-CN')} ${data.baseCurrency}`,
    },
    xAxis: {
      type: 'category',
      data: data.series.map((point) => point.period),
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
      axisLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 11 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
      axisLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 11 },
    },
    series: [
      {
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2, color: '#5b8def' },
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
