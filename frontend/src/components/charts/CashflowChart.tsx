import type { CashflowPoint } from '@/lib/dashboard';
import './echarts';
import ReactECharts from 'echarts-for-react';
import EmptyState from '../ui/EmptyState';

export default function CashflowChart({
  points,
  currency,
}: {
  points: CashflowPoint[];
  currency: string;
}) {
  if (points.length === 0) {
    return <EmptyState title="暂无现金流数据" description="记录收入或支出后即可看到月度趋势。" />;
  }

  const option = {
    grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
    legend: {
      top: 0,
      right: 0,
      textStyle: { color: 'rgba(255,255,255,0.55)', fontSize: 11 },
      itemWidth: 10,
      itemHeight: 10,
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(30,32,38,0.95)',
      borderWidth: 0,
      textStyle: { color: '#e8e9ed', fontSize: 12 },
      valueFormatter: (value: number) => `${value.toLocaleString('zh-CN')} ${currency}`,
    },
    xAxis: {
      type: 'category',
      data: points.map((point) => point.period),
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
      axisLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 11 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
      axisLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 11 },
    },
    series: [
      {
        name: '收入',
        type: 'bar',
        barMaxWidth: 22,
        itemStyle: { color: '#4ea87c', borderRadius: [3, 3, 0, 0] },
        data: points.map((point) => Number(point.income)),
      },
      {
        name: '支出',
        type: 'bar',
        barMaxWidth: 22,
        itemStyle: { color: '#c76a5e', borderRadius: [3, 3, 0, 0] },
        data: points.map((point) => Number(point.expense)),
      },
      {
        name: '结余',
        type: 'line',
        smooth: true,
        symbolSize: 5,
        lineStyle: { width: 2, color: '#5b8def' },
        itemStyle: { color: '#5b8def' },
        data: points.map((point) => Number(point.net)),
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 260 }} notMerge lazyUpdate />;
}
