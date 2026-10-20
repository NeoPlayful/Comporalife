import './echarts';
import ReactECharts from 'echarts-for-react';
import EmptyState from '../ui/EmptyState';

export interface CompoundSeriesPoint {
  year: number;
  totalContributed: string;
  nominalValue: string;
}

interface Props {
  series: Array<{ label: string; points: CompoundSeriesPoint[] }>;
  currency?: string;
}

export default function CompoundChart({ series, currency = 'CNY' }: Props) {
  const primary = series[0];
  if (!primary || primary.points.length === 0) {
    return <EmptyState title="暂无模拟数据" description="调整参数后图表会实时更新。" />;
  }

  const comparisonMode = series.length > 1;

  // 对比模式下只画名义价值曲线，避免本金堆叠把多条曲线挤在一起看不清
  const option = comparisonMode
    ? {
        grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
        legend: {
          top: 0,
          right: 0,
          textStyle: { color: 'rgba(255,255,255,0.55)', fontSize: 11 },
          itemWidth: 12,
          itemHeight: 8,
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
          data: primary.points.map((point) => point.year),
          name: '年',
          nameTextStyle: { color: 'rgba(255,255,255,0.4)', fontSize: 11 },
          axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
          axisLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 11 },
          axisTick: { show: false },
        },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
          axisLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 11 },
        },
        series: series.map((item, index) => ({
          name: item.label,
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: {
            width: 2,
            color: ['#5b8def', '#4ea87c', '#d9a55b', '#b58ce0'][index % 4],
          },
          data: item.points.map((point) => Number(point.nominalValue)),
        })),
      }
    : {
        grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
        legend: {
          top: 0,
          right: 0,
          textStyle: { color: 'rgba(255,255,255,0.55)', fontSize: 11 },
          itemWidth: 12,
          itemHeight: 8,
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
          data: primary.points.map((point) => point.year),
          name: '年',
          nameTextStyle: { color: 'rgba(255,255,255,0.4)', fontSize: 11 },
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
            name: '累计本金',
            type: 'line',
            stack: 'total',
            symbol: 'none',
            lineStyle: { width: 0 },
            areaStyle: { color: 'rgba(91,141,239,0.35)' },
            data: primary.points.map((point) => Number(point.totalContributed)),
          },
          {
            name: '复利收益',
            type: 'line',
            stack: 'total',
            symbol: 'none',
            lineStyle: { width: 0 },
            areaStyle: { color: 'rgba(78,168,124,0.35)' },
            data: primary.points.map(
              (point) => Math.max(Number(point.nominalValue) - Number(point.totalContributed), 0),
            ),
          },
        ],
      };

  return <ReactECharts option={option} style={{ height: 300 }} notMerge lazyUpdate />;
}
