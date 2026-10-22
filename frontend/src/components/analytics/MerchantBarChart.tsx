import type { MerchantResponse } from '@/lib/analytics';
import { formatNumber } from '@/lib/format';
import { useTranslation } from 'react-i18next';
import EmptyState from '../ui/EmptyState';
import '../charts/echarts';
import ReactECharts from 'echarts-for-react';

export default function MerchantBarChart({
  items,
  currency,
}: {
  items: MerchantResponse['items'];
  currency: string;
}) {
  const { t } = useTranslation('analytics');

  if (items.length === 0) {
    return <EmptyState title={t('merchants.empty')} />;
  }

  // 横向条形图，最贵的商户排在最上
  const top = [...items].slice(0, 15).reverse();

  const option = {
    grid: { left: 8, right: 24, top: 12, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(30,32,38,0.95)',
      borderWidth: 0,
      textStyle: { color: '#e8e9ed', fontSize: 12 },
      valueFormatter: (value: number) => `${formatNumber(value)} ${currency}`,
    },
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
      axisLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 11 },
    },
    yAxis: {
      type: 'category',
      data: top.map((item) => item.merchant),
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
      axisLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 11, width: 120, overflow: 'truncate' },
      axisTick: { show: false },
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 16,
        itemStyle: { color: '#c76a5e', borderRadius: [0, 3, 3, 0] },
        data: top.map((item) => Number(item.amount)),
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: Math.max(220, top.length * 26) }} notMerge lazyUpdate />;
}
