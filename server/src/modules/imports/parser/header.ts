/**
 * 表头推断：银行导出常在真正的表头之前插入账户信息行。
 * 评分只依赖「非空且互异」与「不像数字」，不做语义猜测。
 */

const HEADER_SCAN_ROWS = 20;
const MIN_SCORE = 2;

export interface HeaderDetection {
  headerRow: number;
  headers: string[];
}

export function detectHeader(rows: Array<{ rowNumber: number; cells: string[] }>): HeaderDetection | null {
  let best: { rowNumber: number; cells: string[]; score: number } | null = null;

  for (const row of rows.slice(0, HEADER_SCAN_ROWS)) {
    const nonEmpty = row.cells.map((cell) => cell.trim()).filter((cell) => cell.length > 0);
    if (nonEmpty.length < MIN_SCORE) continue;

    const distinct = new Set(nonEmpty).size;
    const numeric = nonEmpty.filter(isNumericLike).length;
    const score = distinct - numeric;

    if (score < MIN_SCORE) continue;
    if (!best || score > best.score) {
      best = { rowNumber: row.rowNumber, cells: row.cells, score };
    }
  }

  if (!best) return null;
  return { headerRow: best.rowNumber, headers: best.cells.map((cell) => cell.trim()) };
}

/** 带时间或金额的单元格视为数据行而不是表头 */
function isNumericLike(cell: string): boolean {
  return /^-?[\d,]+(\.\d+)?$/.test(cell) || /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(cell);
}
