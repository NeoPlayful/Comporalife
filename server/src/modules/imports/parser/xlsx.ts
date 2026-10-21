import * as XLSX from 'xlsx';
import { IMPORT_MAX_UNZIPPED_BYTES } from '../../../config/constants.js';

/**
 * XLSX 只读解析：关闭公式、样式与宏。
 * 直接读取 zip 目录并累加解压后大小，防御 zip 炸弹。
 */

export interface SheetRows {
  /** 工作表内的真实行号（1 基） */
  rowNumber: number;
  cells: string[];
}

export interface XlsxParseResult {
  sheetNames: string[];
  sheetName: string;
  rows: SheetRows[];
  truncated: boolean;
}

export class XlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxError';
  }
}

/** 遍历 zip 中央目录，累加解压后大小；超过上限即拒绝 */
export function assertNotZipBomb(buffer: Buffer): void {
  const EOCD_SIGNATURE = 0x06054b50;
  const CENTRAL_SIGNATURE = 0x02014b50;

  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66_000); i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError('不是有效的 XLSX（zip）文件');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);

  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    throw new XlsxError('不支持 ZIP64 格式的 XLSX 文件');
  }

  let cursor = centralOffset;
  let totalUnzipped = 0;

  for (let i = 0; i < entryCount; i += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new XlsxError('XLSX 目录结构损坏');
    }

    totalUnzipped += buffer.readUInt32LE(cursor + 24);
    if (totalUnzipped > IMPORT_MAX_UNZIPPED_BYTES) {
      throw new XlsxError('XLSX 解压后体积超过上限');
    }

    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
}

export function parseXlsx(buffer: Buffer, rowLimit: number, sheetName?: string): XlsxParseResult {
  assertNotZipBomb(buffer);

  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    cellNF: false,
    cellText: false,
    bookVBA: false,
    cellDates: true,
    // 多读一行用于判断是否超出上限
    sheetRows: rowLimit + 2,
  });

  if (workbook.SheetNames.length === 0) throw new XlsxError('工作簿中没有工作表');

  const target =
    sheetName && workbook.SheetNames.includes(sheetName)
      ? sheetName
      : (workbook.SheetNames.find((name) => hasContent(workbook.Sheets[name])) ?? workbook.SheetNames[0]!);

  const sheet = workbook.Sheets[target];
  if (!sheet) throw new XlsxError('无法读取目标工作表');

  const rangeRef = sheet['!ref'];
  if (!rangeRef) return { sheetNames: workbook.SheetNames, sheetName: target, rows: [], truncated: false };

  const range = XLSX.utils.decode_range(rangeRef);
  const rows: SheetRows[] = [];
  let truncated = false;

  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const cells: string[] = [];

    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      cells.push(cellToText(cell));
    }

    if (cells.every((cell) => cell.trim().length === 0)) continue;

    if (rows.length >= rowLimit + 1) {
      truncated = true;
      break;
    }

    rows.push({ rowNumber: r + 1, cells });
  }

  return { sheetNames: workbook.SheetNames, sheetName: target, rows, truncated };
}

function hasContent(sheet: XLSX.WorkSheet | undefined): boolean {
  if (!sheet?.['!ref']) return false;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (cell?.v !== undefined && cell.v !== null && String(cell.v).trim().length > 0) return true;
    }
  }
  return false;
}

/**
 * 日期单元格统一输出为 YYYY-MM-DD（含时间时带 HH:mm:ss）。
 * 直接按 Excel 序列号解析为「墙上时间」，不经过 JS Date，
 * 因此结果与运行时区无关，同一次导入在任何机器上都得到相同字符串。
 */
function cellToText(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return '';

  if (cell.t === 'n' && typeof cell.v === 'number' && cell.z && XLSX.SSF.is_date(cell.z)) {
    return formatSerialDate(cell.v);
  }

  if (cell.t === 'd' && cell.v instanceof Date) {
    return formatSerialDate(dateToSerial(cell.v));
  }

  if (cell.t === 'n' && typeof cell.v === 'number') {
    return String(cell.v);
  }

  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';

  return String(cell.v);
}

function formatSerialDate(serial: number): string {
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed) return String(serial);

  const date = `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`;
  if (parsed.H === 0 && parsed.M === 0 && parsed.S === 0) return date;

  return `${date} ${pad(parsed.H)}:${pad(parsed.M)}:${pad(Math.floor(parsed.S))}`;
}

/** 把 Date 的 UTC 分量换算成 Excel 序列号（1899-12-30 为 0） */
function dateToSerial(date: Date): number {
  const epoch = Date.UTC(1899, 11, 30);
  const ms =
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
    ) - epoch;
  return ms / 86_400_000;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
