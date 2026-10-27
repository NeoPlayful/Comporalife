import { formatNumber } from '@/lib/format';
import type { SimulationResult } from '@/lib/monte-carlo';
import { useTranslation } from 'react-i18next';
import EmptyState from '../ui/EmptyState';
import '../charts/echarts';
import { useChartTheme } from '@/theme/chart-theme';
import ReactECharts from 'echarts-for-react';

interface Props {
  bands: SimulationResult['yearlyBands'];
  currency: string;
  samplePaths?: Array<{ index: number; values: string[] }>;
  compact?: boolean;
}

export default function FanChart({ bands, currency, samplePaths = [], compact = false }: Props) {
  const { t } = useTranslation('monte-carlo');
  const chartTheme = useChartTheme();

  if (bands.length === 0) {
    return <EmptyState title={t('result.empty')} />;
  }

  const years = bands.map((band) => String(band.year));
  const toNumber = (value: string) => Number(value);

  // 宽屏展示两层区间带，窄屏只保留 P10–P90 与中位线，避免带子挤成一团
  const series: unknown[] = [];

  if (!compact) {
    // 外层 P10–P90：用「下界透明 + 差值填充」的堆叠技巧画出区间带
    series.push({
      name: t('chart.band_outer'),
      type: 'line',
      data: bands.map((band) => toNumber(band.p10)),
      stack: 'outer',
      lineStyle: { opacity: 0 },
      symbol: 'none',
      areaStyle: { color: 'rgba(91,141,239,0.16)' },
      silent: true,
      legendHoverLink: false,
    });
    series.push({
      name: t('chart.band_outer'),
      type: 'line',
      data: bands.map((band) => toNumber(band.p90) - toNumber(band.p10)),
      stack: 'outer',
      lineStyle: { opacity: 0 },
      symbol: 'none',
      areaStyle: { color: 'rgba(91,141,239,0.16)' },
      silent: true,
      legendHoverLink: false,
      showInLegend: false,
    });

    series.push({
      name: t('chart.band_inner'),
      type: 'line',
      data: bands.map((band) => toNumber(band.p25)),
      stack: 'inner',
      lineStyle: { opacity: 0 },
      symbol: 'none',
      areaStyle: { color: 'rgba(78,168,124,0.22)' },
      silent: true,
      legendHoverLink: false,
    });
    series.push({
      name: t('chart.band_inner'),
      type: 'line',
      data: bands.map((band) => toNumber(band.p75) - toNumber(band.p25)),
      stack: 'inner',
      lineStyle: { opacity: 0 },
      symbol: 'none',
      areaStyle: { color: 'rgba(78,168,124,0.22)' },
      silent: true,
      legendHoverLink: false,
      showInLegend: false,
    });
  } else {
    series.push({
      name: t('chart.band_outer'),
      type: 'line',
      data: bands.map((band) => toNumber(band.p10)),
      stack: 'outer',
      lineStyle: { opacity: 0 },
      symbol: 'none',
      areaStyle: { color: 'rgba(91,141,239,0.16)' },
      silent: true,
    });
    series.push({
      name: t('chart.band_outer'),
      type: 'line',
      data: bands.map((band) => toNumber(band.p90) - toNumber(band.p10)),
      stack: 'outer',
      lineStyle: { opacity: 0 },
      symbol: 'none',
      areaStyle: { color: 'rgba(91,141,239,0.16)' },
      silent: true,
      showInLegend: false,
    });
  }

  // 抽样路径只作形状参考，不代表特定路径
  for (const path of samplePaths.slice(0, 20)) {
    series.push({
      name: t('chart.sample'),
      type: 'line',
      data: path.values.map((value) => toNumber(value)),
      symbol: 'none',
      lineStyle: { width: 0.8, opacity: 0.35 },
      emphasis: { disabled: true },
      showInLegend: false,
    });
  }

  series.push({
    name: t('chart.median'),
    type: 'line',
    data: bands.map((band) => toNumber(band.p50)),
    symbol: 'none',
    // 中位线除颜色外还用虚线区分，色觉障碍下依然可读
    lineStyle: { width: 2, type: 'dashed' },
    z: 10,
  });

  const option = {
    grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
    legend: {
      top: 0,
      right: 0,
      textStyle: { color: chartTheme.legend, fontSize: 11 },
      itemWidth: 12,
      itemHeight: 8,
      data: [t('chart.band_outer'), ...(compact ? [] : [t('chart.band_inner')]), t('chart.median')],
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: chartTheme.tooltipBg,
      borderWidth: 0,
      textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
      formatter: (params: Array<{ dataIndex: number }>) => {
        const index = params[0]?.dataIndex ?? 0;
        const band = bands[index];
        if (!band) return '';

        const line = (label: string, value: string) =>
          `${label}: ${formatNumber(value, { maximumFractionDigits: 0 })} ${currency}`;

        return [
          t('chart.year', { year: band.year }),
          line('P90', band.p90),
          line('P75', band.p75),
          line(t('chart.median_short'), band.p50),
          line('P25', band.p25),
          line('P10', band.p10),
        ].join('<br/>');
      },
    },
    xAxis: {
      type: 'category',
      data: years,
      axisLabel: { color: chartTheme.axisLabel, fontSize: 11 },
      axisLine: { lineStyle: { color: chartTheme.axisLine } },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: chartTheme.axisLabel,
        fontSize: 11,
        formatter: (value: number) => formatNumber(value, { notation: 'compact', maximumFractionDigits: 1 }),
      },
      splitLine: { lineStyle: { color: chartTheme.splitLine } },
    },
    series,
  };

  return <ReactECharts option={option} style={{ height: 320 }} notMerge />;
}
