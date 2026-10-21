export const API_PREFIX = '/api';

export const PAGINATION = {
  defaultPage: 1,
  defaultPageSize: 20,
  maxPageSize: 100,
} as const;

export const BULK_OPERATION_LIMIT = 500;

/**
 * 币种精度：用于展示层小数位与舍入。
 * 账务存储统一 DECIMAL(20,6)，此处只影响展示与输入校验。
 */
export const CURRENCY_DECIMALS: Record<string, number> = {
  CNY: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  HKD: 2,
  AUD: 2,
  CAD: 2,
  SGD: 2,
  KRW: 0,
  CHF: 2,
  TWD: 2,
};

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_DECIMALS);

export const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  HKD: 'HK$',
  AUD: 'A$',
  CAD: 'C$',
  SGD: 'S$',
  KRW: '₩',
  CHF: 'CHF',
  TWD: 'NT$',
};

export const LIABILITY_ACCOUNT_TYPES = ['credit_card', 'loan'] as const;

export const ACCOUNT_TYPES = ['cash', 'bank', 'credit_card', 'brokerage', 'loan', 'other'] as const;

export const TRANSACTION_TYPES = ['income', 'expense', 'transfer', 'adjustment'] as const;

export const SESSION_COOKIE_NAME = 'cl_refresh';

export const PASSWORD_RESET_TTL_SECONDS = 30 * 60;

export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export const MAX_SIMULATION_YEARS = 100;
export const MIN_SIMULATION_YEARS = 1;

// ===== 账单导入 =====

/** 单行最多保留的错误条数，避免错误信息撑爆行记录 */
export const IMPORT_ROW_ERROR_LIMIT = 10;

/** 单行文本上限，超出视为结构异常 */
export const IMPORT_MAX_ROW_BYTES = 8 * 1024;

/** 写库时的分批大小，避免单次 SQL 参数过多 */
export const IMPORT_WRITE_CHUNK_SIZE = 500;

/** XLSX 解压后总大小上限，防御 zip 炸弹 */
export const IMPORT_MAX_UNZIPPED_BYTES = 200 * 1024 * 1024;

/** committing 状态超时后自动回落到 validated，秒 */
export const IMPORT_COMMITTING_TIMEOUT_SECONDS = 10 * 60;

/** 上传限流：每小时每用户次数 */
export const IMPORT_UPLOAD_RATE_LIMIT = 10;

/** 重复候选查询的日期窗口（天） */
export const IMPORT_SUSPECTED_DATE_WINDOW_DAYS = 3;

export const IMPORT_STATUSES = [
  'uploaded',
  'parsed',
  'mapped',
  'validated',
  'committing',
  'completed',
  'failed',
  'cancelled',
  'rolled_back',
] as const;

export const IMPORT_ROW_STATUSES = [
  'pending',
  'valid',
  'invalid',
  'duplicate',
  'suspected',
  'skipped',
  'imported',
  'failed',
] as const;

export const IMPORT_FORMATS = ['csv', 'xlsx'] as const;

export const IMPORT_DATE_FORMATS = [
  'YYYY-MM-DD',
  'YYYY/MM/DD',
  'YYYYMMDD',
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'YYYY-MM-DD HH:mm',
  'YYYY-MM-DD HH:mm:ss',
  'auto',
] as const;

export const IMPORT_AMOUNT_MODES = ['signed', 'debitCredit'] as const;
