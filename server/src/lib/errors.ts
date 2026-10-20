export const ErrorCode = {
  UNAUTHORIZED: 'UNAUTHORIZED',
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
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ERROR_STATUS: Record<ErrorCodeValue, number> = {
  UNAUTHORIZED: 401,
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
};

export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCodeValue, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = ERROR_STATUS[code];
    this.details = details;
  }
}

export const errors = {
  unauthorized: (message = '未登录或会话已失效') => new AppError(ErrorCode.UNAUTHORIZED, message),
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
};
