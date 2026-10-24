import * as XLSX from 'xlsx';

/**
 * 导出序列化。
 * CSV 的两条硬规则：带 BOM（否则中文 Windows 的 Excel 会乱码）、
 * 公式注入防护（以 = + - @ 开头的文本会被 Excel 当公式执行）。
 * 但负数不能被误伤——判定前先尝试按数值解析，能解析成数值的一律不加前缀。
 */

export type CellValue = string | number | null | undefined;

const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];
const NUMERIC = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

/** 单元格渲染：数值保持原样，文本做公式注入防护 */
export function escapeCell(value: CellValue): string {
  if (value === null || value === undefined) return '';

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }

  const text = value;

  // 纯数值（含负号）不加前缀，否则负数进入 Excel 会变成文本
  if (NUMERIC.test(text)) return text;

  if (text.length > 0 && FORMULA_PREFIXES.includes(text[0]!)) {
    return `'${text}`;
  }

  return text;
}

/** RFC 4180 字段转义：含分隔符、引号或换行时用双引号包裹，内部引号翻倍 */
export function quoteField(text: string): string {
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export interface CsvSection {
  title?: string;
  header: string[];
  rows: CellValue[][];
}

/** 行优先渲染，表间空一行分隔，便于人工阅读与 Excel 分块理解 */
export function buildCsv(sections: CsvSection[]): string {
  const lines: string[] = [];

  sections.forEach((section, index) => {
    if (index > 0) lines.push('');

    if (section.title) {
      lines.push(quoteField(escapeCell(section.title)));
    }

    lines.push(section.header.map((cell) => quoteField(escapeCell(cell))).join(','));

    for (const row of section.rows) {
      lines.push(row.map((cell) => quoteField(escapeCell(cell))).join(','));
    }
  });

  // \r\n 换行 + UTF-8 BOM
  // 用 charCode 构造，避免源码中出现不可见字符
  const BOM = String.fromCharCode(0xfeff);
  const CRLF = String.fromCharCode(13, 10);
  return BOM + lines.join(CRLF) + CRLF;
}

export interface XlsxSheet {
  name: string;
  header: string[];
  rows: CellValue[][];
}

/** 金额与比率写为数值类型，让 Excel 可直接求和；文本保持字符串 */
export function buildXlsx(sheets: XlsxSheet[]): Buffer {
  const workbook = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const matrix: CellValue[][] = [sheet.header, ...sheet.rows];
    const worksheet = XLSX.utils.aoa_to_sheet(matrix);

    // 列宽按内容长度估算，上限 40 避免超宽列
    const widths = sheet.header.map((title, columnIndex) => {
      let width = String(title).length;
      for (const row of sheet.rows) {
        const cell = row[columnIndex];
        const length = cell === null || cell === undefined ? 0 : String(cell).length;
        if (length > width) width = length;
      }
      return { wch: Math.min(40, Math.max(8, width + 2)) };
    });
    worksheet['!cols'] = widths;

    // sheet 名不能超过 31 字符且不能含 : \ / ? * [ ]
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31));
  }

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** RFC 5987 文件名：ASCII 回退名 + UTF-8 百分号编码 */
export function contentDisposition(asciiName: string, utf8Name: string): string {
  const safeAscii = asciiName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_').slice(0, 120);
  const encoded = encodeURIComponent(utf8Name).replace(/['()]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
}

// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME = new RegExp('[\\\\/:*?"<>|\\x00-\\x1f]', 'g');

/** 文件名清洗：去掉路径分隔符与控制字符，保留中文与空格 */
export function sanitizeFilename(name: string): string {
  return name.replace(UNSAFE_FILENAME, '-').slice(0, 120);
}
