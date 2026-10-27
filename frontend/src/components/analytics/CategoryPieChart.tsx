import type { CategoryItem } from '@/lib/analytics';
import { formatNumber } from '@/lib/format';
import { useTranslation } from 'react-i18next';
import EmptyState from '../ui/EmptyState';
import '../charts/echarts';
import { useChartTheme } from '@/theme/chart-theme';
import { CATEGORY_PALETTE } from '@/theme/palette';
import ReactECharts from 'echarts-for-react';


export default function CategoryPieChart({
  items,
  currency,
}: {
  items: CategoryItem[];
  currency: string;
}) {
  const { t } = useTranslation('analytics');
  const chartTheme = useChartTheme();

  if (items.length === 0) {
    return <EmptyState title={t('categories.chart_empty')} />;
  }

  const option = {
    tooltip: {
      trigger: 'item',
      backgroundColor: chartTheme.tooltipBg,
      borderWidth: 0,
      textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
      valueFormatter: (value: number) => `${formatNumber(value)} ${currency}`,
    },
    legend: {
      type: 'scroll',
      orient: 'vertical',
      right: 0,
      top: 'middle',
      textStyle: { color: chartTheme.legend, fontSize: 11 },
      itemWidth: 10,
      itemHeight: 10,
    },
    color: CATEGORY_PALETTE,
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
