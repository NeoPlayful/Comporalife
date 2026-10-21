import Decimal from 'decimal.js';
import { IMPORT_MAX_ROW_BYTES } from '../../../config/constants.js';
import { parseAmount, parseDebitCredit, validateAmount, type AmountError } from './amount.js';
import { detectEncoding, looksBinary, type EncodingResult, type SupportedEncoding } from './encoding.js';
import { parseCsv, inferDelimiter } from './csv.js';
import { localDateKey, parseDate, type DateError, type DateFormat } from './date.js';
import { buildHeaderSignature, buildFingerprint, normalizeDescription } from './fingerprint.js';
import { detectHeader } from './header.js';
import { parseXlsx, XlsxError } from './xlsx.js';

export type { DateFormat, SupportedEncoding, AmountError, DateError };
export { suggestMapping, FIELD_SYNONYMS } from './field-map.js';
export type { CanonicalField, FieldSuggestion } from './field-map.js';
export { detectEncoding } from './encoding.js';
export { buildHeaderSignature, buildFingerprint, normalizeDescription } from './fingerprint.js';
export { parseAmount, parseDebitCredit } from './amount.js';
export { parseDate, localDateKey } from './date.js';
export { inferDelimiter } from './csv.js';

export class ParseError extends Error {
  readonly reason: 'ENCODING' | 'FORMAT' | 'STRUCTURE' | 'ROW_LIMIT';
  constructor(reason: ParseError['reason'], message: string) {
    super(message);
    this.name = 'ParseError';
    this.reason = reason;
  }
}

export interface RawRow {
  rowNumber: number;
  cells: string[];
}

export interface ParsedFile {
  format: 'csv' | 'xlsx';
  encoding: 'utf-8' | 'gb18030' | '-';
  delimiter?: string;
  sheetNames?: string[];
  sheetName?: string;
  headerRow: number;
  headers: string[];
  headerSignature: string;
  rows: RawRow[];
  truncated: boolean;
}

export interface ParseFileInput {
  buffer: Buffer;
  format: 'csv' | 'xlsx';
  encoding?: SupportedEncoding;
  sheetName?: string;
  rowLimit: number;
  /** 用户显式指定的表头行，覆盖自动推断 */
  headerRow?: number;
}

export function parseFile(input: ParseFileInput): ParsedFile {
  if (input.format === 'csv') {
    if (looksBinary(input.buffer)) {
      throw new ParseError('FORMAT', '文件包含二进制内容，不是有效的 CSV 文本');
    }

    let decoded: EncodingResult;
    try {
      decoded = detectEncoding(input.buffer, input.encoding);
    } catch (err) {
      throw new ParseError('ENCODING', err instanceof Error ? err.message : '文件编码无法识别');
    }

    const delimiter = inferDelimiter(decoded.text);
    const { rows, truncated } = parseCsv(decoded.text, delimiter, input.rowLimit);

    if (truncated) throw new ParseError('ROW_LIMIT', '数据行超过上限');
    if (rows.length === 0) throw new ParseError('STRUCTURE', '文件中没有数据行');

    return buildParsed({
      format: 'csv',
      encoding: decoded.encoding,
      delimiter,
      rows,
      headerRow: input.headerRow,
    });
  }

  let result;
  try {
    result = parseXlsx(input.buffer, input.rowLimit, input.sheetName);
  } catch (err) {
    if (err instanceof XlsxError) {
      const reason = err.message.includes('超过上限') ? 'ROW_LIMIT' : 'FORMAT';
      throw new ParseError(reason, err.message);
    }
    throw new ParseError('STRUCTURE', err instanceof Error ? err.message : 'XLSX 解析失败');
  }

  if (result.truncated) throw new ParseError('ROW_LIMIT', '数据行超过上限');
  if (result.rows.length === 0) throw new ParseError('STRUCTURE', '文件中没有数据行');

  return buildParsed({
    format: 'xlsx',
    encoding: '-',
    sheetNames: result.sheetNames,
    sheetName: result.sheetName,
    rows: result.rows,
    headerRow: input.headerRow,
  });
}

function buildParsed(input: {
  format: 'csv' | 'xlsx';
  encoding: 'utf-8' | 'gb18030' | '-';
  delimiter?: string;
  sheetNames?: string[];
  sheetName?: string;
  rows: RawRow[];
  headerRow?: number;
}): ParsedFile {
  const detected = detectHeader(input.rows);
  const headerRow = input.headerRow ?? detected?.headerRow;

  if (!headerRow) throw new ParseError('STRUCTURE', '无法识别表头行，请手动指定');

  const headerIndex = input.rows.findIndex((row) => row.rowNumber === headerRow);
  if (headerIndex < 0) throw new ParseError('STRUCTURE', '指定的表头行不存在');

  const headers = input.rows[headerIndex]!.cells.map((cell) => cell.trim());
  const dataRows = input.rows.slice(headerIndex + 1);

  return {
    format: input.format,
    encoding: input.encoding,
    ...(input.delimiter ? { delimiter: input.delimiter } : {}),
    ...(input.sheetNames ? { sheetNames: input.sheetNames } : {}),
    ...(input.sheetName ? { sheetName: input.sheetName } : {}),
    headerRow,
    headers,
    headerSignature: buildHeaderSignature(headers),
    rows: dataRows,
    truncated: false,
  };
}

// ===== 规范化 =====

export interface ColumnMapping {
  occurredAt: number;
  amountMode: 'signed' | 'debitCredit';
  amount?: number;
  debit?: number;
  credit?: number;
  currency?: number;
  description?: number;
  merchant?: number;
  externalId?: number;
  balanceAfter?: number;
  dateFormat: DateFormat;
}

export interface NormalizeContext {
  userId: string;
  accountId: string;
  accountCurrency: string;
  timezone: string;
}

export interface RowError {
  field: string;
  code: string;
  message: string;
}

export interface NormalizedRow {
  rowNumber: number;
  cells?: string[];
  raw: Record<string, string>;
  occurredAt: Date | null;
  amount: Decimal | null;
  currency: string | null;
  description: string | null;
  merchant: string | null;
  externalId: string | null;
  balanceAfter: Decimal | null;
  direction: 'income' | 'expense' | null;
  fingerprint: string | null;
  errors: RowError[];
}

const ROW_ERROR_MESSAGES: Record<string, string> = {
  DATE_INVALID: '日期格式无法识别',
  DATE_AMBIGUOUS: '日期存在歧义，请显式选择格式',
  DATE_OUT_OF_RANGE: '日期超出合理范围',
  AMOUNT_INVALID: '金额无法识别',
  AMOUNT_PRECISION_INVALID: '金额小数位超过 6 位',
  AMOUNT_CONFLICT: '借贷两列同时有值',
  AMOUNT_ZERO_INVALID: '金额不能为 0',
  CURRENCY_MISMATCH: '币种与账户不一致',
  COLUMN_COUNT_MISMATCH: '列数与表头不一致',
  ROW_TOO_LONG: '单行内容过长',
  DUPLICATE_IN_FILE: '批次内存在完全相同的行',
};

export function normalizeRows(
  parsed: ParsedFile,
  mapping: ColumnMapping,
  context: NormalizeContext,
): NormalizedRow[] {
  const seenFingerprints = new Set<string>();

  return parsed.rows.map((row) => {
    const errors: RowError[] = [];
    const raw = buildRawRecord(parsed.headers, row.cells);

    if (row.cells.length !== parsed.headers.length) {
      errors.push({
        field: 'row',
        code: 'COLUMN_COUNT_MISMATCH',
        message: `${ROW_ERROR_MESSAGES.COLUMN_COUNT_MISMATCH}（期望 ${parsed.headers.length}，实际 ${row.cells.length}）`,
      });
    }

    if (Buffer.byteLength(row.cells.join(','), 'utf8') > IMPORT_MAX_ROW_BYTES) {
      errors.push({ field: 'row', code: 'ROW_TOO_LONG', message: ROW_ERROR_MESSAGES.ROW_TOO_LONG! });
    }

    const dateResult = parseDate(cell(row.cells, mapping.occurredAt), mapping.dateFormat, context.timezone);
    if (dateResult.error) errors.push(toRowError('occurredAt', dateResult.error));

    const amountResult =
      mapping.amountMode === 'debitCredit'
        ? parseDebitCredit(cell(row.cells, mapping.debit), cell(row.cells, mapping.credit))
        : parseAmount(cell(row.cells, mapping.amount));

    const validated = validateAmount(amountResult.value, amountResult.error);
    if (validated.error) errors.push(toRowError('amount', validated.error));

    const currencyCell = mapping.currency === undefined ? null : cell(row.cells, mapping.currency);
    const currency = currencyCell && currencyCell.trim().length > 0
      ? currencyCell.trim().toUpperCase()
      : context.accountCurrency;

    if (currency !== context.accountCurrency) {
      errors.push({
        field: 'currency',
        code: 'CURRENCY_MISMATCH',
        message: `账单币种 ${currency} 与账户币种 ${context.accountCurrency} 不一致`,
      });
    }

    const balanceResult =
      mapping.balanceAfter === undefined ? { value: null as Decimal | null } : parseAmount(cell(row.cells, mapping.balanceAfter));

    const occurredAt = dateResult.value;
    const amount = validated.value;

    let fingerprint: string | null = null;
    if (occurredAt && amount) {
      fingerprint = buildFingerprint({
        userId: context.userId,
        accountId: context.accountId,
        occurredAt,
        timezone: context.timezone,
        amount,
        currency: context.accountCurrency,
        externalId: cell(row.cells, mapping.externalId),
        description: cell(row.cells, mapping.description) ?? cell(row.cells, mapping.merchant),
        balanceAfter: balanceResult.value,
      });

      if (seenFingerprints.has(fingerprint)) {
        errors.push({
          field: 'row',
          code: 'DUPLICATE_IN_FILE',
          message: ROW_ERROR_MESSAGES.DUPLICATE_IN_FILE!,
        });
      } else {
        seenFingerprints.add(fingerprint);
      }
    }

    const description = cleanText(cell(row.cells, mapping.description));
    const merchant = cleanText(cell(row.cells, mapping.merchant));

    if (!description && !merchant) {
      errors.push({ field: 'description', code: 'DESCRIPTION_MISSING', message: '缺少摘要与商户' });
    }

    return {
      rowNumber: row.rowNumber,
      cells: row.cells,
      raw,
      occurredAt,
      amount,
      currency,
      description,
      merchant,
      externalId: cleanText(cell(row.cells, mapping.externalId)),
      balanceAfter: balanceResult.value,
      direction: amount ? (amount.isNegative() ? 'expense' : 'income') : null,
      fingerprint,
      errors,
    };
  });
}

export function buildRawRecord(headers: string[], cells: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    // 重名表头追加序号，避免后者覆盖前者
    const key = header.length > 0 ? header : `列${index + 1}`;
    record[key in record ? `${key}_${index + 1}` : key] = cells[index] ?? '';
  });
  return record;
}

function cell(cells: string[], index: number | undefined): string | null {
  if (index === undefined) return null;
  return cells[index] ?? null;
}

function cleanText(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toRowError(field: string, code: string): RowError {
  return { field, code, message: ROW_ERROR_MESSAGES[code] ?? code };
}
