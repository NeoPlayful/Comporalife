import { parse } from 'csv-parse/sync';

export interface CsvRow {
  /** 原文件中的起始行号（1 基），引号内换行时与记录序号不同 */
  rowNumber: number;
  cells: string[];
}

export interface CsvParseResult {
  delimiter: string;
  rows: CsvRow[];
  truncated: boolean;
}

const DELIMITER_CANDIDATES = [',', ';', '\t', '|'] as const;

/** 用前 10 行的结构一致性挑选分隔符：多数行列数相同且列数更多者优先 */
export function inferDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(0, 10);
  if (lines.length === 0) return ',';

  let best = ',';
  let bestScore = -1;

  for (const candidate of DELIMITER_CANDIDATES) {
    const counts = lines.map((line) => line.split(candidate).length - 1);
    const total = counts.reduce((sum, count) => sum + count, 0);
    if (total === 0) continue;

    const sorted = [...counts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    if (median === 0) continue;

    const mismatched = counts.filter((count) => count !== median).length;
    const score = median * 10 - mismatched * 5;

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

export function parseCsv(text: string, delimiter: string, rowLimit: number): CsvParseResult {
  const records = parse(text, {
    delimiter,
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    trim: false,
    columns: false,
    info: true,
    // 多取一条用于判断是否超出上限
    to: rowLimit + 2,
  }) as unknown as Array<{ record: string[]; info: { lines: number } }>;

  const truncated = records.length > rowLimit + 1;
  const kept = truncated ? records.slice(0, rowLimit + 1) : records;

  return {
    delimiter,
    rows: kept.map((item) => ({
      rowNumber: item.info.lines,
      cells: item.record.map((cell) => cell ?? ''),
    })),
    truncated,
  };
}
