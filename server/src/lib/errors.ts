export const ErrorCode = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  EMAIL_EXISTS: 'EMAIL_EXISTS',
  USER_DISABLED: 'USER_DISABLED',
  ACCOUNT_ARCHIVED: 'ACCOUNT_ARCHIVED',
  ACCOUNT_HAS_TRANSACTIONS: 'ACCOUNT_HAS_TRANSACTIONS',
  LEDGER_UNBALANCED: 'LEDGER_UNBALANCED',
  CATEGORY_KIND_MISMATCH: 'CATEGORY_KIND_MISMATCH',
  CROSS_CURRENCY_TRANSFER_UNSUPPORTED: 'CROSS_CURRENCY_TRANSFER_UNSUPPORTED',
  CURRENCY_RATE_MISSING: 'CURRENCY_RATE_MISSING',
  SIMULATION_PARAMETERS_INVALID: 'SIMULATION_PARAMETERS_INVALID',
  MAIL_NOT_CONFIGURED: 'MAIL_NOT_CONFIGURED',
  RATE_LIMITED: 'RATE_LIMITED',
  SYSTEM_ERROR: 'SYSTEM_ERROR',
  // ===== 账单导入 =====
  IMPORT_EMPTY: 'IMPORT_EMPTY',
  IMPORT_FILE_TOO_LARGE: 'IMPORT_FILE_TOO_LARGE',
  IMPORT_FORMAT_UNSUPPORTED: 'IMPORT_FORMAT_UNSUPPORTED',
  IMPORT_PARSE_FAILED: 'IMPORT_PARSE_FAILED',
  IMPORT_ROW_LIMIT_EXCEEDED: 'IMPORT_ROW_LIMIT_EXCEEDED',
  IMPORT_MAPPING_INVALID: 'IMPORT_MAPPING_INVALID',
  IMPORT_NOT_READY: 'IMPORT_NOT_READY',
  IMPORT_STATE_CONFLICT: 'IMPORT_STATE_CONFLICT',
  IMPORT_DUPLICATE_CONFIRMATION_REQUIRED: 'IMPORT_DUPLICATE_CONFIRMATION_REQUIRED',
  IMPORT_ALREADY_UPLOADED: 'IMPORT_ALREADY_UPLOADED',
  IMPORT_ROLLBACK_BLOCKED: 'IMPORT_ROLLBACK_BLOCKED',
  RULE_INVALID: 'RULE_INVALID',
  TRANSFER_MATCH_INVALID: 'TRANSFER_MATCH_INVALID',
  // ===== 分析与预算 =====
  ANALYTICS_RANGE_TOO_LARGE: 'ANALYTICS_RANGE_TOO_LARGE',
  ANALYTICS_RANGE_INVALID: 'ANALYTICS_RANGE_INVALID',
  ANALYTICS_GRANULARITY_INVALID: 'ANALYTICS_GRANULARITY_INVALID',
  BUDGET_PERIOD_EXISTS: 'BUDGET_PERIOD_EXISTS',
  BUDGET_ITEM_INVALID: 'BUDGET_ITEM_INVALID',
  BUDGET_CATEGORY_CONFLICT: 'BUDGET_CATEGORY_CONFLICT',
  BUDGET_ROLLOVER_UNSUPPORTED: 'BUDGET_ROLLOVER_UNSUPPORTED',
  BUDGET_ARCHIVED: 'BUDGET_ARCHIVED',
  BUDGET_NOT_FOUND: 'BUDGET_NOT_FOUND',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ERROR_STATUS: Record<ErrorCodeValue, number> = {
  UNAUTHORIZED: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  EMAIL_EXISTS: 409,
  USER_DISABLED: 403,
  ACCOUNT_ARCHIVED: 409,
  ACCOUNT_HAS_TRANSACTIONS: 409,
  LEDGER_UNBALANCED: 422,
  CATEGORY_KIND_MISMATCH: 422,
  CROSS_CURRENCY_TRANSFER_UNSUPPORTED: 422,
  CURRENCY_RATE_MISSING: 422,
  SIMULATION_PARAMETERS_INVALID: 422,
  MAIL_NOT_CONFIGURED: 503,
  RATE_LIMITED: 429,
  SYSTEM_ERROR: 500,
  IMPORT_EMPTY: 422,
  IMPORT_FILE_TOO_LARGE: 413,
  IMPORT_FORMAT_UNSUPPORTED: 415,
  IMPORT_PARSE_FAILED: 422,
  IMPORT_ROW_LIMIT_EXCEEDED: 422,
  IMPORT_MAPPING_INVALID: 422,
  IMPORT_NOT_READY: 409,
  IMPORT_STATE_CONFLICT: 409,
  IMPORT_DUPLICATE_CONFIRMATION_REQUIRED: 409,
  IMPORT_ALREADY_UPLOADED: 409,
  IMPORT_ROLLBACK_BLOCKED: 409,
  RULE_INVALID: 422,
  TRANSFER_MATCH_INVALID: 422,
  ANALYTICS_RANGE_TOO_LARGE: 400,
  ANALYTICS_RANGE_INVALID: 400,
  ANALYTICS_GRANULARITY_INVALID: 400,
  BUDGET_PERIOD_EXISTS: 409,
  BUDGET_ITEM_INVALID: 422,
  BUDGET_CATEGORY_CONFLICT: 422,
  BUDGET_ROLLOVER_UNSUPPORTED: 422,
  BUDGET_ARCHIVED: 409,
  BUDGET_NOT_FOUND: 404,
};

export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly statusCode: number;
  readonly details?: unknown;
  /** 供前端按错误码插值的参数，例如 { maxMb: 10 } */
  readonly params?: Record<string, unknown>;

  constructor(
    code: ErrorCodeValue,
    message: string,
    details?: unknown,
    params?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = ERROR_STATUS[code];
    this.details = details;
    this.params = params;
  }
}

export const errors = {
  unauthorized: (message = '未登录或会话已失效') => new AppError(ErrorCode.UNAUTHORIZED, message),
  sessionExpired: () => new AppError(ErrorCode.SESSION_EXPIRED, '会话已失效，请重新登录'),
  forbidden: (message = '无权访问该资源') => new AppError(ErrorCode.FORBIDDEN, message),
  notFound: (message = '资源不存在') => new AppError(ErrorCode.NOT_FOUND, message),
  validation: (message = '参数校验失败', details?: unknown) =>
    new AppError(ErrorCode.VALIDATION_ERROR, message, details),
  conflict: (message = '数据冲突', details?: unknown) => new AppError(ErrorCode.CONFLICT, message, details),
  emailExists: () => new AppError(ErrorCode.EMAIL_EXISTS, '该邮箱已被注册'),
  userDisabled: () => new AppError(ErrorCode.USER_DISABLED, '账号已被禁用'),
  accountArchived: () => new AppError(ErrorCode.ACCOUNT_ARCHIVED, '账户已归档，无法记账'),
  accountHasTransactions: () =>
    new AppError(ErrorCode.ACCOUNT_HAS_TRANSACTIONS, '账户存在历史流水，请改为归档'),
  ledgerUnbalanced: (message = '交易分录不平衡') => new AppError(ErrorCode.LEDGER_UNBALANCED, message),
  categoryKindMismatch: () =>
    new AppError(ErrorCode.CATEGORY_KIND_MISMATCH, '分类类型与交易类型不匹配'),
  crossCurrencyTransfer: () =>
    new AppError(ErrorCode.CROSS_CURRENCY_TRANSFER_UNSUPPORTED, '当前版本不支持跨币种转账'),
  rateMissing: (pairs: string[]) =>
    new AppError(ErrorCode.CURRENCY_RATE_MISSING, '缺少折算所需汇率', { missingPairs: pairs }),
  simulationInvalid: (message: string) => new AppError(ErrorCode.SIMULATION_PARAMETERS_INVALID, message),
  mailNotConfigured: () => new AppError(ErrorCode.MAIL_NOT_CONFIGURED, '邮件服务未配置'),
  system: (message = '服务内部错误') => new AppError(ErrorCode.SYSTEM_ERROR, message),

  importEmpty: () => new AppError(ErrorCode.IMPORT_EMPTY, '文件中没有可导入的数据行'),
  importFileTooLarge: (maxMb: number) =>
    new AppError(
      ErrorCode.IMPORT_FILE_TOO_LARGE,
      `文件超过 ${maxMb} MB 上限`,
      undefined,
      { maxMb },
    ),
  importFormatUnsupported: (message = '仅支持 CSV 与 XLSX 文件') =>
    new AppError(ErrorCode.IMPORT_FORMAT_UNSUPPORTED, message),
  importParseFailed: (message = '文件解析失败') => new AppError(ErrorCode.IMPORT_PARSE_FAILED, message),
  importRowLimitExceeded: (max: number) =>
    new AppError(
      ErrorCode.IMPORT_ROW_LIMIT_EXCEEDED,
      `数据行超过 ${max} 行上限，请拆分文件`,
      undefined,
      { max },
    ),
  importMappingInvalid: (message = '列映射无效', details?: unknown) =>
    new AppError(ErrorCode.IMPORT_MAPPING_INVALID, message, details),
  importNotReady: (message = '导入尚未通过校验') => new AppError(ErrorCode.IMPORT_NOT_READY, message),
  importStateConflict: (message = '当前状态不允许该操作') =>
    new AppError(ErrorCode.IMPORT_STATE_CONFLICT, message),
  importDuplicateConfirmation: (rowNumbers: number[]) =>
    new AppError(
      ErrorCode.IMPORT_DUPLICATE_CONFIRMATION_REQUIRED,
      '存在未确认的疑似重复行',
      { rowNumbers },
    ),
  importAlreadyUploaded: (batchId: string) =>
    new AppError(ErrorCode.IMPORT_ALREADY_UPLOADED, '该文件已完成过导入', { batchId }),
  importRollbackBlocked: (blocked: Array<{ transactionId: string; reason: string }>) =>
    new AppError(ErrorCode.IMPORT_ROLLBACK_BLOCKED, '存在依赖，无法撤销该批次', { blockedTransactions: blocked }),
  ruleInvalid: (message: string, details?: unknown) => new AppError(ErrorCode.RULE_INVALID, message, details),
  transferMatchInvalid: (message: string) => new AppError(ErrorCode.TRANSFER_MATCH_INVALID, message),

  analyticsRangeTooLarge: (maxDays: number) =>
    new AppError(
      ErrorCode.ANALYTICS_RANGE_TOO_LARGE,
      `分析区间不能超过 ${maxDays} 天`,
      undefined,
      { maxDays },
    ),
  analyticsRangeInvalid: (message: string) => new AppError(ErrorCode.ANALYTICS_RANGE_INVALID, message),
  analyticsGranularityInvalid: (message: string) =>
    new AppError(ErrorCode.ANALYTICS_GRANULARITY_INVALID, message),

  budgetPeriodExists: (budgetId?: string) =>
    new AppError(
      ErrorCode.BUDGET_PERIOD_EXISTS,
      '该周期的预算已存在',
      budgetId ? { budgetId } : undefined,
    ),
  budgetItemInvalid: (message: string, details?: unknown) =>
    new AppError(ErrorCode.BUDGET_ITEM_INVALID, message, details),
  budgetCategoryConflict: (categoryIds: string[]) =>
    new AppError(
      ErrorCode.BUDGET_CATEGORY_CONFLICT,
      '同一预算内不能同时为父子分类设置额度',
      { categoryIds },
    ),
  budgetRolloverUnsupported: () =>
    new AppError(ErrorCode.BUDGET_ROLLOVER_UNSUPPORTED, '年度预算不支持结转'),
  budgetArchived: () => new AppError(ErrorCode.BUDGET_ARCHIVED, '预算已归档，无法修改'),
  budgetNotFound: () => new AppError(ErrorCode.BUDGET_NOT_FOUND, '预算不存在'),
};
