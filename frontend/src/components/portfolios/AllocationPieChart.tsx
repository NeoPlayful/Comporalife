import { formatNumber } from '@/lib/format';
import { useTranslation } from 'react-i18next';
import EmptyState from '../ui/EmptyState';
import '../charts/echarts';
import ReactECharts from 'echarts-for-react';

const PALETTE = ['#5b8def', '#4ea87c', '#c76a5e', '#d3a35a', '#8b7ec8', '#5aa8b8', '#c17ba5'];

export default function AllocationPieChart({
  items,
  currency,
  title,
}: {
  items: Array<{ key: string; label: string; value: string; weight: string | null }>;
  currency: string;
  title?: string;
}) {
  const { t } = useTranslation('portfolios');

  if (items.length === 0) {
    return <EmptyState title={t('allocation.empty')} />;
  }

  const option = {
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(30,32,38,0.95)',
      borderWidth: 0,
      textStyle: { color: '#e8e9ed', fontSize: 12 },
      formatter: (params: { name: string; value: number; percent: number }) =>
        `${params.name}<br/>${formatNumber(params.value)} ${currency} · ${params.percent.toFixed(2)}%`,
    },
    legend: {
      type: 'scroll',
      orient: 'vertical',
      right: 0,
      top: 'middle',
      textStyle: { color: 'rgba(255,255,255,0.55)', fontSize: 11 },
      itemWidth: 10,
      itemHeight: 10,
    },
    color: PALETTE,
    series: [
      {
        name: title ?? t('allocation.current'),
        type: 'pie',
        radius: ['48%', '72%'],
        center: ['38%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: { borderWidth: 2, borderColor: 'transparent' },
        label: { show: false },
        emphasis: {
          label: { show: true, fontSize: 12, color: '#e8e9ed', formatter: '{b}\n{d}%' },
        },
        data: items.map((item) => ({ name: item.label, value: Number(item.value) })),
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 300 }} notMerge />;
}
