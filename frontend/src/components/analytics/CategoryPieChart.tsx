import type { CategoryItem } from '@/lib/analytics';
import { formatNumber } from '@/lib/format';
import { useTranslation } from 'react-i18next';
import EmptyState from '../ui/EmptyState';
import '../charts/echarts';
import ReactECharts from 'echarts-for-react';

const PALETTE = ['#5b8def', '#4ea87c', '#c76a5e', '#d3a35a', '#8b7ec8', '#5aa8b8', '#c17ba5'];

export default function CategoryPieChart({
  items,
  currency,
}: {
  items: CategoryItem[];
  currency: string;
}) {
  const { t } = useTranslation('analytics');

  if (items.length === 0) {
    return <EmptyState title={t('categories.chart_empty')} />;
  }

  const option = {
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(30,32,38,0.95)',
      borderWidth: 0,
      textStyle: { color: '#e8e9ed', fontSize: 12 },
      valueFormatter: (value: number) => `${formatNumber(value)} ${currency}`,
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
        type: 'pie',
        radius: ['48%', '72%'],
        center: ['38%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: { borderWidth: 2, borderColor: 'transparent' },
        label: { show: false },
        data: items.map((item) => ({ name: item.name, value: Number(item.amount) })),
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 300 }} notMerge lazyUpdate />;
}
