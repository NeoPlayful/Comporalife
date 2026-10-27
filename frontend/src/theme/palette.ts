/**
 * 图表配色。
 *
 * 图表走 canvas，读不到 CSS 变量，所以这里是独立的色值来源。集中成一份是为了
 * 避免同一个蓝色在六处各写一遍——改配色时漏掉一处，同页两个图就会不是同一个蓝。
 * 这几套配色彼此有意区别（分类色板要 7 个可区分的色相，情景对比只要 4 条线），
 * 不要合并成一套。
 */

/** 主序列：折线、单色柱 */
export const SERIES_PRIMARY = '#5b8def';
/** 正向含义：收入、上涨、达标 */
export const SERIES_POSITIVE = '#4ea87c';
/** 负向含义：支出、下跌、超支 */
export const SERIES_NEGATIVE = '#c76a5e';

/** 分类色板：饼图与多分类柱图，需要尽可能多的可区分色相 */
export const CATEGORY_PALETTE = [
  SERIES_PRIMARY,
  SERIES_POSITIVE,
  SERIES_NEGATIVE,
  '#d3a35a',
  '#8b7ec8',
  '#5aa8b8',
  '#c17ba5',
];

/** 情景对比：复利页几条方案线并排，色相少而饱和度高，避免与背景网格抢视线 */
export const SCENARIO_PALETTE = [SERIES_PRIMARY, SERIES_POSITIVE, '#d9a55b', '#b58ce0'];

/** 资产构成：仪表盘与资产页的占比图，色序强调前三类资产 */
export const ASSET_PALETTE = [
  SERIES_PRIMARY,
  SERIES_POSITIVE,
  SERIES_NEGATIVE,
  '#b58ce0',
  '#d9a55b',
  '#5aa9c7',
];
