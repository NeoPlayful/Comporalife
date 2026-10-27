import { useEffect, useState } from 'react';

/**
 * 图表的主题配色。
 *
 * 设计令牌定义成 CSS 变量，但 ECharts 走 canvas 绘制，canvas 不认识 `var(--x)`：
 * 赋值会被静默忽略，描边退回默认的纯黑——浅色主题下本应是灰线、灰字的地方
 * 全是黑色。因此这里把变量解析成 canvas 认得的颜色串再交给图表。
 */
export interface ChartTheme {
  /** 坐标轴轴线 */
  axisLine: string;
  /** 网格分隔线：比轴线更淡 */
  splitLine: string;
  /** 轴标签 */
  axisLabel: string;
  /** 轴名 */
  axisName: string;
  /** 图例文字 */
  legend: string;
  /** 悬浮提示背景与文字：深色底在两种主题下都保证可读 */
  tooltipBg: string;
  tooltipText: string;
}

const FALLBACK: ChartTheme = {
  axisLine: 'rgba(255,255,255,0.12)',
  splitLine: 'rgba(255,255,255,0.06)',
  axisLabel: 'rgba(255,255,255,0.45)',
  axisName: 'rgba(255,255,255,0.4)',
  legend: 'rgba(255,255,255,0.55)',
  tooltipBg: 'rgba(30,32,38,0.95)',
  tooltipText: '#e8e9ed',
};

/**
 * 把任意 CSS 颜色解析成 `rgba()`。
 *
 * 现代浏览器能直接把 `oklch(...)` 交给 canvas，但采样一次再转 rgba 可以拿到
 * 确定的色值，便于再调透明度。解析不出来（空值、`transparent` 之类）时
 * 返回兜底色——否则又会得到一个 canvas 悄悄忽略的字符串。
 */
function resolveColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return fallback;

  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = trimmed;
  ctx.fillRect(0, 0, 1, 1);

  const [r, g, b, alpha] = ctx.getImageData(0, 0, 1, 1).data;
  const a = alpha ?? 0;
  // 全透明意味着这个值 canvas 没认，交给兜底
  if (a < 8) return fallback;

  return `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})`;
}

/** 给已解析的 rgba 换一个透明度，用于由轴线色派生出更淡的网格线 */
function withAlpha(color: string, alpha: number): string {
  const match = color.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),/);
  if (!match) return color;
  return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})`;
}

/** 从当前文档读取一次配色：主题切换后需要重新调用 */
export function readChartTheme(): ChartTheme {
  if (typeof document === 'undefined') return FALLBACK;

  const styles = getComputedStyle(document.documentElement);
  const border = resolveColor(styles.getPropertyValue('--color-border-subtle'), FALLBACK.axisLine);
  const muted = resolveColor(styles.getPropertyValue('--color-content-muted'), FALLBACK.axisLabel);

  return {
    axisLine: border,
    splitLine: withAlpha(border, 0.4),
    axisLabel: muted,
    axisName: muted,
    legend: muted,
    tooltipBg: FALLBACK.tooltipBg,
    tooltipText: FALLBACK.tooltipText,
  };
}

/**
 * 图表配色；主题切换时返回新对象，调用方据此重绘。
 *
 * 主题是通过给 <html> 加减 `dark` 类切换的，这里用 MutationObserver 盯住
 * class 变化；同时监听系统配色变化，覆盖「跟随系统」这一档。
 */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(readChartTheme);

  useEffect(() => {
    let frame = 0;

    const refresh = () => {
      // 类名刚变化时样式计算可能还没落地，下一帧再取，避免读到上一套配色
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTheme(readChartTheme()));
    };

    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', refresh);

    // 首帧兜底：初始渲染读配色时样式表可能还没落地
    refresh();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      media.removeEventListener('change', refresh);
    };
  }, []);

  return theme;
}
