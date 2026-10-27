import './echarts';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/lib/format';
import EmptyState from '../ui/EmptyState';
import { useChartTheme } from '@/theme/chart-theme';
import { SCENARIO_PALETTE } from '@/theme/palette';

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
  const { t } = useTranslation('dashboard');
  const chartTheme = useChartTheme();
  const primary = series[0];
  if (!primary || primary.points.length === 0) {
    return (
      <EmptyState
        title={t('charts.compound_empty_title')}
        description={t('charts.compound_empty_description')}
      />
    );
  }

  const comparisonMode = series.length > 1;

  // 对比模式下只画名义价值曲线，避免本金堆叠把多条曲线挤在一起看不清
  const option = comparisonMode
    ? {
        grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
        legend: {
          top: 0,
          right: 0,
          textStyle: { color: chartTheme.legend, fontSize: 11 },
          itemWidth: 12,
          itemHeight: 8,
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
          data: primary.points.map((point) => point.year),
          name: t('charts.year'),
          nameTextStyle: { color: chartTheme.axisName, fontSize: 11 },
          axisLine: { lineStyle: { color: chartTheme.axisLine } },
          axisLabel: { color: chartTheme.axisLabel, fontSize: 11 },
          axisTick: { show: false },
        },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { color: chartTheme.splitLine } },
          axisLabel: { color: chartTheme.axisLabel, fontSize: 11 },
        },
        series: series.map((item, index) => ({
          name: item.label,
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: {
            width: 2,
            color: SCENARIO_PALETTE[index % SCENARIO_PALETTE.length],
          },
          data: item.points.map((point) => Number(point.nominalValue)),
        })),
      }
    : {
        grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
        legend: {
          top: 0,
          right: 0,
          textStyle: { color: chartTheme.legend, fontSize: 11 },
          itemWidth: 12,
          itemHeight: 8,
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
          data: primary.points.map((point) => point.year),
          name: t('charts.year'),
          nameTextStyle: { color: chartTheme.axisName, fontSize: 11 },
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
            name: t('charts.compound_principal'),
            type: 'line',
            stack: 'total',
            symbol: 'none',
            lineStyle: { width: 0 },
            areaStyle: { color: 'rgba(91,141,239,0.35)' },
            data: primary.points.map((point) => Number(point.totalContributed)),
          },
          {
            name: t('charts.compound_interest'),
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
