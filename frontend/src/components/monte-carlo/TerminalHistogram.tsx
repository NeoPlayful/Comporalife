import { formatNumber } from '@/lib/format';
import type { SimulationResult } from '@/lib/monte-carlo';
import { useTranslation } from 'react-i18next';
import EmptyState from '../ui/EmptyState';
import '../charts/echarts';
import { useChartTheme } from '../charts/chart-theme';
import ReactECharts from 'echarts-for-react';

interface Props {
  histogram: SimulationResult['histogram'];
  currency: string;
}

export default function TerminalHistogram({ histogram, currency }: Props) {
  const { t } = useTranslation('monte-carlo');
  const chartTheme = useChartTheme();

  const total = histogram.bins.reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return <EmptyState title={t('result.empty')} />;
  }

  const min = Number(histogram.min);
  const max = Number(histogram.max);
  const width = (max - min) / histogram.bins.length;

  // x 轴用区间中值，tooltip 显示区间与占比，避免出现「不知道这根柱代表什么范围」
  const labels = histogram.bins.map((_, index) => {
    const left = min + width * index;
    return formatNumber(left, { notation: 'compact', maximumFractionDigits: 1 });
  });

  const option = {
    grid: { left: 8, right: 16, top: 20, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: chartTheme.tooltipBg,
      borderWidth: 0,
      textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
      formatter: (params: Array<{ dataIndex: number }>) => {
        const index = params[0]?.dataIndex ?? 0;
        const count = histogram.bins[index] ?? 0;
        const left = min + width * index;
        const right = left + width;
        const share = total > 0 ? (count / total) * 100 : 0;

        return [
          `${formatNumber(left, { maximumFractionDigits: 0 })} – ${formatNumber(right, { maximumFractionDigits: 0 })} ${currency}`,
          t('chart.paths', { count }),
          t('chart.share', { share: share.toFixed(1) }),
        ].join('<br/>');
      },
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: chartTheme.axisLabel, fontSize: 10, interval: 1 },
      axisLine: { lineStyle: { color: chartTheme.axisLine } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: chartTheme.axisLabel, fontSize: 11 },
      splitLine: { lineStyle: { color: chartTheme.splitLine } },
    },
    series: [
      {
        type: 'bar',
        data: histogram.bins,
        itemStyle: { color: '#5b8def', borderRadius: [3, 3, 0, 0] },
        barCategoryGap: '12%',
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 260 }} notMerge />;
}
