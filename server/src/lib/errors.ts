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
  MAIL_DELIVERY_FAILED: 'MAIL_DELIVERY_FAILED',
  EMAIL_VERIFICATION_DISABLED: 'EMAIL_VERIFICATION_DISABLED',
  EMAIL_VERIFICATION_TOKEN_INVALID: 'EMAIL_VERIFICATION_TOKEN_INVALID',
  EMAIL_RESEND_TOO_FREQUENT: 'EMAIL_RESEND_TOO_FREQUENT',
  DELETION_NOT_REVIEWABLE: 'DELETION_NOT_REVIEWABLE',
  DELETION_ALREADY_REQUESTED: 'DELETION_ALREADY_REQUESTED',
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  ASSET_HAS_VALUATIONS: 'ASSET_HAS_VALUATIONS',
  ASSET_NAME_EXISTS: 'ASSET_NAME_EXISTS',
  ASSET_ARCHIVED: 'ASSET_ARCHIVED',
  ASSET_VALUATION_EXISTS: 'ASSET_VALUATION_EXISTS',
  LIABILITY_NOT_FOUND: 'LIABILITY_NOT_FOUND',
  LIABILITY_HAS_SNAPSHOTS: 'LIABILITY_HAS_SNAPSHOTS',
  LIABILITY_NAME_EXISTS: 'LIABILITY_NAME_EXISTS',
  LIABILITY_ARCHIVED: 'LIABILITY_ARCHIVED',
  LIABILITY_SNAPSHOT_EXISTS: 'LIABILITY_SNAPSHOT_EXISTS',
  NOTIFICATION_NOT_FOUND: 'NOTIFICATION_NOT_FOUND',
  SOLVE_UNREACHABLE: 'SOLVE_UNREACHABLE',
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
  // ===== 投资 =====
  PORTFOLIO_NOT_FOUND: 'PORTFOLIO_NOT_FOUND',
  PORTFOLIO_ACCOUNT_INVALID: 'PORTFOLIO_ACCOUNT_INVALID',
  PORTFOLIO_HAS_TRADES: 'PORTFOLIO_HAS_TRADES',
  PORTFOLIO_ARCHIVED: 'PORTFOLIO_ARCHIVED',
  INSTRUMENT_NOT_FOUND: 'INSTRUMENT_NOT_FOUND',
  INSTRUMENT_SYMBOL_EXISTS: 'INSTRUMENT_SYMBOL_EXISTS',
  INSTRUMENT_IN_USE: 'INSTRUMENT_IN_USE',
  INSTRUMENT_CURRENCY_MISMATCH: 'INSTRUMENT_CURRENCY_MISMATCH',
  PRICE_DATE_INVALID: 'PRICE_DATE_INVALID',
  PRICE_NOT_FOUND: 'PRICE_NOT_FOUND',
  TRADE_NOT_FOUND: 'TRADE_NOT_FOUND',
  TRADE_INVALID: 'TRADE_INVALID',
  TRADE_SELL_EXCEEDS_HOLDING: 'TRADE_SELL_EXCEEDS_HOLDING',
  TRADE_CATEGORY_REQUIRED: 'TRADE_CATEGORY_REQUIRED',
  CASHFLOW_NOT_FOUND: 'CASHFLOW_NOT_FOUND',
  CASHFLOW_AMOUNT_INVALID: 'CASHFLOW_AMOUNT_INVALID',
  VALUATION_DATE_EXISTS: 'VALUATION_DATE_EXISTS',
  PORTFOLIO_VALUATION_NOT_FOUND: 'PORTFOLIO_VALUATION_NOT_FOUND',
  ALLOCATION_TARGETS_INVALID: 'ALLOCATION_TARGETS_INVALID',
  ALLOCATION_TARGETS_MISMATCH: 'ALLOCATION_TARGETS_MISMATCH',
  PORTFOLIO_RANGE_INVALID: 'PORTFOLIO_RANGE_INVALID',
  PORTFOLIO_TOO_MANY_CASHFLOWS: 'PORTFOLIO_TOO_MANY_CASHFLOWS',
  // ===== 风险模拟 =====
  MC_SCENARIO_NOT_FOUND: 'MC_SCENARIO_NOT_FOUND',
  MC_SCENARIO_NAME_EXISTS: 'MC_SCENARIO_NAME_EXISTS',
  MC_PARAMETERS_INVALID: 'MC_PARAMETERS_INVALID',
  MC_WEIGHTS_INVALID: 'MC_WEIGHTS_INVALID',
  MC_CORRELATION_INVALID: 'MC_CORRELATION_INVALID',
  MC_RUN_NOT_FOUND: 'MC_RUN_NOT_FOUND',
  MC_RUN_NOT_READY: 'MC_RUN_NOT_READY',
  MC_RUN_FAILED: 'MC_RUN_FAILED',
  MC_RUN_ALREADY_FINISHED: 'MC_RUN_ALREADY_FINISHED',
  MC_QUEUE_FULL: 'MC_QUEUE_FULL',
  MC_PREVIEW_LIMIT_EXCEEDED: 'MC_PREVIEW_LIMIT_EXCEEDED',
  MC_PATH_INDEX_INVALID: 'MC_PATH_INDEX_INVALID',
  MC_COMPARE_INCOMPATIBLE: 'MC_COMPARE_INCOMPATIBLE',
  MC_STRESS_PRESET_UNKNOWN: 'MC_STRESS_PRESET_UNKNOWN',
  MC_RANGE_INVALID: 'MC_RANGE_INVALID',
  // ===== 财富目标与财务报表 =====
  GOAL_NOT_FOUND: 'GOAL_NOT_FOUND',
  GOAL_NAME_EXISTS: 'GOAL_NAME_EXISTS',
  GOAL_PARAMETERS_INVALID: 'GOAL_PARAMETERS_INVALID',
  GOAL_FUNDING_INVALID: 'GOAL_FUNDING_INVALID',
  GOAL_LIMIT_EXCEEDED: 'GOAL_LIMIT_EXCEEDED',
  GOAL_PROJECTION_UNAVAILABLE: 'GOAL_PROJECTION_UNAVAILABLE',
  FI_PARAMETERS_INVALID: 'FI_PARAMETERS_INVALID',
  REPORT_NOT_FOUND: 'REPORT_NOT_FOUND',
  REPORT_TYPE_UNSUPPORTED: 'REPORT_TYPE_UNSUPPORTED',
  REPORT_PARAMETERS_INVALID: 'REPORT_PARAMETERS_INVALID',
  REPORT_RANGE_INVALID: 'REPORT_RANGE_INVALID',
  REPORT_TOO_LARGE: 'REPORT_TOO_LARGE',
  REPORT_FORMAT_UNSUPPORTED: 'REPORT_FORMAT_UNSUPPORTED',
  // ===== 数据管理与运维 =====
  EXPORT_NOT_FOUND: 'EXPORT_NOT_FOUND',
  EXPORT_NOT_READY: 'EXPORT_NOT_READY',
  EXPORT_TOO_LARGE: 'EXPORT_TOO_LARGE',
  EXPORT_RANGE_INVALID: 'EXPORT_RANGE_INVALID',
  EXPORT_SCOPE_UNSUPPORTED: 'EXPORT_SCOPE_UNSUPPORTED',
  BACKUP_NOT_FOUND: 'BACKUP_NOT_FOUND',
  BACKUP_NOT_READY: 'BACKUP_NOT_READY',
  BACKUP_CORRUPTED: 'BACKUP_CORRUPTED',
  BACKUP_VERSION_UNSUPPORTED: 'BACKUP_VERSION_UNSUPPORTED',
  BACKUP_DECRYPT_FAILED: 'BACKUP_DECRYPT_FAILED',
  RESTORE_PARAMETERS_INVALID: 'RESTORE_PARAMETERS_INVALID',
  RESTORE_CONFLICT_UNRESOLVED: 'RESTORE_CONFLICT_UNRESOLVED',
  RESTORE_FAILED: 'RESTORE_FAILED',
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  TASK_NOT_CANCELLABLE: 'TASK_NOT_CANCELLABLE',
  TASK_NOT_RETRYABLE: 'TASK_NOT_RETRYABLE',
  ADMIN_FORBIDDEN: 'ADMIN_FORBIDDEN',
  ADMIN_SELF_MODIFICATION: 'ADMIN_SELF_MODIFICATION',
  ADMIN_LAST_SUPER_ADMIN: 'ADMIN_LAST_SUPER_ADMIN',
  REGISTRATION_DISABLED: 'REGISTRATION_DISABLED',
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
  MAIL_DELIVERY_FAILED: 502,
  EMAIL_VERIFICATION_DISABLED: 400,
  EMAIL_VERIFICATION_TOKEN_INVALID: 400,
  EMAIL_RESEND_TOO_FREQUENT: 429,
  DELETION_NOT_REVIEWABLE: 409,
  DELETION_ALREADY_REQUESTED: 409,
  ASSET_NOT_FOUND: 404,
  ASSET_HAS_VALUATIONS: 409,
  ASSET_NAME_EXISTS: 409,
  ASSET_ARCHIVED: 409,
  ASSET_VALUATION_EXISTS: 409,
  LIABILITY_NOT_FOUND: 404,
  LIABILITY_HAS_SNAPSHOTS: 409,
  LIABILITY_NAME_EXISTS: 409,
  LIABILITY_ARCHIVED: 409,
  LIABILITY_SNAPSHOT_EXISTS: 409,
  NOTIFICATION_NOT_FOUND: 404,
  SOLVE_UNREACHABLE: 422,
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
  PORTFOLIO_NOT_FOUND: 404,
  PORTFOLIO_ACCOUNT_INVALID: 422,
  PORTFOLIO_HAS_TRADES: 409,
  PORTFOLIO_ARCHIVED: 409,
  INSTRUMENT_NOT_FOUND: 404,
  INSTRUMENT_SYMBOL_EXISTS: 409,
  INSTRUMENT_IN_USE: 409,
  INSTRUMENT_CURRENCY_MISMATCH: 422,
  PRICE_DATE_INVALID: 422,
  PRICE_NOT_FOUND: 404,
  TRADE_NOT_FOUND: 404,
  TRADE_INVALID: 422,
  TRADE_SELL_EXCEEDS_HOLDING: 422,
  TRADE_CATEGORY_REQUIRED: 422,
  CASHFLOW_NOT_FOUND: 404,
  CASHFLOW_AMOUNT_INVALID: 422,
  VALUATION_DATE_EXISTS: 409,
  PORTFOLIO_VALUATION_NOT_FOUND: 404,
  ALLOCATION_TARGETS_INVALID: 422,
  ALLOCATION_TARGETS_MISMATCH: 422,
  PORTFOLIO_RANGE_INVALID: 400,
  PORTFOLIO_TOO_MANY_CASHFLOWS: 400,
  MC_SCENARIO_NOT_FOUND: 404,
  MC_SCENARIO_NAME_EXISTS: 409,
  MC_PARAMETERS_INVALID: 422,
  MC_WEIGHTS_INVALID: 422,
  MC_CORRELATION_INVALID: 422,
  MC_RUN_NOT_FOUND: 404,
  MC_RUN_NOT_READY: 409,
  MC_RUN_FAILED: 409,
  MC_RUN_ALREADY_FINISHED: 409,
  MC_QUEUE_FULL: 429,
  MC_PREVIEW_LIMIT_EXCEEDED: 422,
  MC_PATH_INDEX_INVALID: 422,
  MC_COMPARE_INCOMPATIBLE: 422,
  MC_STRESS_PRESET_UNKNOWN: 422,
  MC_RANGE_INVALID: 400,
  GOAL_NOT_FOUND: 404,
  GOAL_NAME_EXISTS: 409,
  GOAL_PARAMETERS_INVALID: 422,
  GOAL_FUNDING_INVALID: 422,
  GOAL_LIMIT_EXCEEDED: 422,
  GOAL_PROJECTION_UNAVAILABLE: 409,
  FI_PARAMETERS_INVALID: 422,
  REPORT_NOT_FOUND: 404,
  REPORT_TYPE_UNSUPPORTED: 422,
  REPORT_PARAMETERS_INVALID: 422,
  REPORT_RANGE_INVALID: 400,
  REPORT_TOO_LARGE: 422,
  REPORT_FORMAT_UNSUPPORTED: 415,
  EXPORT_NOT_FOUND: 404,
  EXPORT_NOT_READY: 409,
  EXPORT_TOO_LARGE: 422,
  EXPORT_RANGE_INVALID: 400,
  EXPORT_SCOPE_UNSUPPORTED: 422,
  BACKUP_NOT_FOUND: 404,
  BACKUP_NOT_READY: 409,
  BACKUP_CORRUPTED: 422,
  BACKUP_VERSION_UNSUPPORTED: 422,
  BACKUP_DECRYPT_FAILED: 422,
  RESTORE_PARAMETERS_INVALID: 422,
  RESTORE_CONFLICT_UNRESOLVED: 409,
  RESTORE_FAILED: 500,
  TASK_NOT_FOUND: 404,
  TASK_NOT_CANCELLABLE: 409,
  TASK_NOT_RETRYABLE: 409,
  ADMIN_FORBIDDEN: 403,
  ADMIN_SELF_MODIFICATION: 422,
  ADMIN_LAST_SUPER_ADMIN: 422,
  REGISTRATION_DISABLED: 403,
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
  mailDeliveryFailed: () => new AppError(ErrorCode.MAIL_DELIVERY_FAILED, '邮件投递失败'),
  emailVerificationDisabled: () =>
    new AppError(ErrorCode.EMAIL_VERIFICATION_DISABLED, '邮箱验证未开启'),
  emailVerificationTokenInvalid: () =>
    new AppError(ErrorCode.EMAIL_VERIFICATION_TOKEN_INVALID, '验证链接无效或已过期'),
  emailResendTooFrequent: () =>
    new AppError(ErrorCode.EMAIL_RESEND_TOO_FREQUENT, '重发过于频繁，请稍后再试'),
  deletionNotReviewable: (reason: string) =>
    new AppError(ErrorCode.DELETION_NOT_REVIEWABLE, '当前状态不能批准注销申请', { reason }),
  deletionAlreadyRequested: () =>
    new AppError(ErrorCode.DELETION_ALREADY_REQUESTED, '已存在进行中的注销申请'),

  // ===== 资产与负债 =====
  assetNotFound: () => new AppError(ErrorCode.ASSET_NOT_FOUND, '资产不存在'),
  assetHasValuations: (count: number) =>
    new AppError(ErrorCode.ASSET_HAS_VALUATIONS, `该资产有 ${count} 条估值记录，只能归档`, { count }),
  assetNameExists: () => new AppError(ErrorCode.ASSET_NAME_EXISTS, '同名资产已存在'),
  assetArchived: () => new AppError(ErrorCode.ASSET_ARCHIVED, '已归档的资产不可修改'),
  assetValuationExists: () =>
    new AppError(ErrorCode.ASSET_VALUATION_EXISTS, '该日期已有估值，需显式确认覆盖'),
  liabilityNotFound: () => new AppError(ErrorCode.LIABILITY_NOT_FOUND, '负债不存在'),
  liabilityHasSnapshots: (count: number) =>
    new AppError(ErrorCode.LIABILITY_HAS_SNAPSHOTS, `该负债有 ${count} 条余额快照，只能归档`, { count }),
  liabilityNameExists: () => new AppError(ErrorCode.LIABILITY_NAME_EXISTS, '同名负债已存在'),
  liabilityArchived: () => new AppError(ErrorCode.LIABILITY_ARCHIVED, '已归档的负债不可修改'),
  liabilitySnapshotExists: () =>
    new AppError(ErrorCode.LIABILITY_SNAPSHOT_EXISTS, '该日期已有余额快照，需显式确认覆盖'),
  notificationNotFound: () => new AppError(ErrorCode.NOTIFICATION_NOT_FOUND, '通知不存在'),
  solveUnreachable: (message: string) => new AppError(ErrorCode.SOLVE_UNREACHABLE, message),
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

  portfolioNotFound: () => new AppError(ErrorCode.PORTFOLIO_NOT_FOUND, '投资组合不存在'),
  portfolioAccountInvalid: (message = '绑定的资金账户不合法') =>
    new AppError(ErrorCode.PORTFOLIO_ACCOUNT_INVALID, message),
  portfolioHasTrades: () =>
    new AppError(ErrorCode.PORTFOLIO_HAS_TRADES, '组合已有交易，无法修改账户或成本方法'),
  portfolioArchived: () => new AppError(ErrorCode.PORTFOLIO_ARCHIVED, '组合已归档，无法修改'),
  instrumentNotFound: () => new AppError(ErrorCode.INSTRUMENT_NOT_FOUND, '投资标的不存在'),
  instrumentSymbolExists: () => new AppError(ErrorCode.INSTRUMENT_SYMBOL_EXISTS, '该标的代码已存在'),
  instrumentInUse: () => new AppError(ErrorCode.INSTRUMENT_IN_USE, '标的已有交易记录，无法删除'),
  instrumentCurrencyMismatch: (message = '标的币种与资金账户币种不一致') =>
    new AppError(ErrorCode.INSTRUMENT_CURRENCY_MISMATCH, message),
  priceDateInvalid: (message: string) => new AppError(ErrorCode.PRICE_DATE_INVALID, message),
  priceNotFound: () => new AppError(ErrorCode.PRICE_NOT_FOUND, '价格记录不存在'),
  tradeNotFound: () => new AppError(ErrorCode.TRADE_NOT_FOUND, '投资交易不存在'),
  tradeInvalid: (message: string) => new AppError(ErrorCode.TRADE_INVALID, message),
  tradeSellExceedsHolding: (requested: string, available: string) =>
    new AppError(
      ErrorCode.TRADE_SELL_EXCEEDS_HOLDING,
      '卖出数量超过该时点持仓',
      { requested, available },
    ),
  tradeCategoryRequired: () =>
    new AppError(ErrorCode.TRADE_CATEGORY_REQUIRED, '股息、利息、费用与税费需要指定分类'),
  cashflowNotFound: () => new AppError(ErrorCode.CASHFLOW_NOT_FOUND, '资金流记录不存在'),
  cashflowAmountInvalid: () => new AppError(ErrorCode.CASHFLOW_AMOUNT_INVALID, '现金流金额必须为正数'),
  valuationDateExists: (valuationId?: string) =>
    new AppError(
      ErrorCode.VALUATION_DATE_EXISTS,
      '该日期的估值快照已存在',
      valuationId ? { valuationId } : undefined,
    ),
  portfolioValuationNotFound: () => new AppError(ErrorCode.PORTFOLIO_VALUATION_NOT_FOUND, '估值快照不存在'),
  allocationTargetsInvalid: (message: string, details?: unknown) =>
    new AppError(ErrorCode.ALLOCATION_TARGETS_INVALID, message, details),
  allocationTargetsMismatch: (total: string) =>
    new AppError(ErrorCode.ALLOCATION_TARGETS_MISMATCH, '同一维度的目标权重合计必须为 1', { total }),
  portfolioRangeInvalid: (message: string) => new AppError(ErrorCode.PORTFOLIO_RANGE_INVALID, message),
  portfolioTooManyCashflows: (max: number) =>
    new AppError(
      ErrorCode.PORTFOLIO_TOO_MANY_CASHFLOWS,
      `区间内现金流超过 ${max} 条，请缩小区间`,
      undefined,
      { max },
    ),

  mcScenarioNotFound: () => new AppError(ErrorCode.MC_SCENARIO_NOT_FOUND, '模拟方案不存在'),
  mcScenarioNameExists: () => new AppError(ErrorCode.MC_SCENARIO_NAME_EXISTS, '该方案名称已存在'),
  mcParametersInvalid: (message: string, details?: unknown) =>
    new AppError(ErrorCode.MC_PARAMETERS_INVALID, message, details),
  mcWeightsInvalid: (total: string) =>
    new AppError(ErrorCode.MC_WEIGHTS_INVALID, '资产权重必须为非负数且合计为 1', { total }),
  mcCorrelationInvalid: (reason: string, message = '相关系数矩阵不合法') =>
    new AppError(ErrorCode.MC_CORRELATION_INVALID, message, { reason }),
  mcRunNotFound: () => new AppError(ErrorCode.MC_RUN_NOT_FOUND, '模拟运行不存在'),
  mcRunNotReady: () => new AppError(ErrorCode.MC_RUN_NOT_READY, '模拟尚未完成，结果不可用'),
  mcRunFailed: () => new AppError(ErrorCode.MC_RUN_FAILED, '模拟已失败或已取消，无结果'),
  mcRunAlreadyFinished: () => new AppError(ErrorCode.MC_RUN_ALREADY_FINISHED, '该运行已结束，无法取消'),
  mcQueueFull: (limit: number) =>
    new AppError(
      ErrorCode.MC_QUEUE_FULL,
      `当前排队与运行中的模拟已达 ${limit} 个上限，请稍后再试`,
      undefined,
      { limit },
    ),
  mcPreviewLimitExceeded: (limit: number) =>
    new AppError(
      ErrorCode.MC_PREVIEW_LIMIT_EXCEEDED,
      `同步预览最多 ${limit} 条路径，请改用完整模拟`,
      undefined,
      { limit },
    ),
  mcPathIndexInvalid: (pathCount: number) =>
    new AppError(ErrorCode.MC_PATH_INDEX_INVALID, '路径索引越界', { pathCount }),
  mcCompareIncompatible: (reason: string) =>
    new AppError(ErrorCode.MC_COMPARE_INCOMPATIBLE, '所选运行无法直接对比', { reason }),
  mcStressPresetUnknown: (key: string) =>
    new AppError(ErrorCode.MC_STRESS_PRESET_UNKNOWN, '未知的压力情景', { key }),
  mcRangeInvalid: (message: string) => new AppError(ErrorCode.MC_RANGE_INVALID, message),
  // ===== 财富目标与财务报表 =====
  goalNotFound: () => new AppError(ErrorCode.GOAL_NOT_FOUND, '目标不存在'),
  goalNameExists: () => new AppError(ErrorCode.GOAL_NAME_EXISTS, '该目标名称已存在'),
  goalParametersInvalid: (message: string, details?: unknown) =>
    new AppError(ErrorCode.GOAL_PARAMETERS_INVALID, message, details),
  goalFundingInvalid: (message = '绑定的资金来源不可用', details?: unknown) =>
    new AppError(ErrorCode.GOAL_FUNDING_INVALID, message, details),
  goalLimitExceeded: (limit: number) =>
    new AppError(ErrorCode.GOAL_LIMIT_EXCEEDED, `活跃目标最多 ${limit} 个`, undefined, { limit }),
  goalProjectionUnavailable: (reason: string) =>
    new AppError(ErrorCode.GOAL_PROJECTION_UNAVAILABLE, '缺少预测所需的参数', { reason }),
  fiParametersInvalid: (message: string, details?: unknown) =>
    new AppError(ErrorCode.FI_PARAMETERS_INVALID, message, details),
  reportNotFound: () => new AppError(ErrorCode.REPORT_NOT_FOUND, '报表不存在'),
  reportTypeUnsupported: (type: string) =>
    new AppError(ErrorCode.REPORT_TYPE_UNSUPPORTED, '不支持的报表类型', { type }),
  reportParametersInvalid: (message: string, details?: unknown) =>
    new AppError(ErrorCode.REPORT_PARAMETERS_INVALID, message, details),
  reportRangeInvalid: (message: string) => new AppError(ErrorCode.REPORT_RANGE_INVALID, message),
  reportTooLarge: (rows: number, maxRows: number) =>
    new AppError(
      ErrorCode.REPORT_TOO_LARGE,
      `报表明细 ${rows} 行，超过 ${maxRows} 行上限，请缩小时间区间`,
      undefined,
      { rows, maxRows },
    ),
  reportFormatUnsupported: (format: string) =>
    new AppError(ErrorCode.REPORT_FORMAT_UNSUPPORTED, '不支持的导出格式', { format }),
  // ===== 数据管理与运维 =====
  exportNotFound: () => new AppError(ErrorCode.EXPORT_NOT_FOUND, '导出记录不存在'),
  exportNotReady: (status: string) =>
    new AppError(ErrorCode.EXPORT_NOT_READY, '导出尚未完成或已过期', { status }),
  exportTooLarge: (rows: number, maxRows: number) =>
    new AppError(
      ErrorCode.EXPORT_TOO_LARGE,
      `导出数据 ${rows} 行，超过 ${maxRows} 行上限，请缩小范围`,
      undefined,
      { rows, maxRows },
    ),
  exportRangeInvalid: (message: string) => new AppError(ErrorCode.EXPORT_RANGE_INVALID, message),
  exportScopeUnsupported: (scope: string) =>
    new AppError(ErrorCode.EXPORT_SCOPE_UNSUPPORTED, '不支持的导出范围', { scope }),
  backupNotFound: () => new AppError(ErrorCode.BACKUP_NOT_FOUND, '备份不存在'),
  backupNotReady: (status: string) =>
    new AppError(ErrorCode.BACKUP_NOT_READY, '备份尚未完成或已失败', { status }),
  backupCorrupted: () =>
    new AppError(ErrorCode.BACKUP_CORRUPTED, '备份文件校验失败，内容可能已损坏'),
  backupVersionUnsupported: (version: string, expected: string) =>
    new AppError(ErrorCode.BACKUP_VERSION_UNSUPPORTED, '备份结构版本不兼容', { version, expected }),
  backupDecryptFailed: () =>
    new AppError(ErrorCode.BACKUP_DECRYPT_FAILED, '备份文件无法解密，密钥或文件已损坏'),
  restoreParametersInvalid: (message: string, details?: unknown) =>
    new AppError(ErrorCode.RESTORE_PARAMETERS_INVALID, message, details),
  restoreConflictUnresolved: () =>
    new AppError(ErrorCode.RESTORE_CONFLICT_UNRESOLVED, '存在冲突，但未指定冲突处理策略'),
  restoreFailed: (message = '恢复失败，已回滚全部写入') =>
    new AppError(ErrorCode.RESTORE_FAILED, message),
  taskNotFound: () => new AppError(ErrorCode.TASK_NOT_FOUND, '任务不存在'),
  taskNotCancellable: (status: string) =>
    new AppError(ErrorCode.TASK_NOT_CANCELLABLE, '该任务已结束，无法取消', { status }),
  taskNotRetryable: (status: string, attempts: number) =>
    new AppError(ErrorCode.TASK_NOT_RETRYABLE, '该任务不可重试', { status, attempts }),
  adminForbidden: () => new AppError(ErrorCode.ADMIN_FORBIDDEN, '需要管理员权限'),
  adminSelfModification: (message: string) => new AppError(ErrorCode.ADMIN_SELF_MODIFICATION, message),
  adminLastSuperAdmin: () =>
    new AppError(ErrorCode.ADMIN_LAST_SUPER_ADMIN, '不能降级或禁用最后一个超级管理员'),
  registrationDisabled: () =>
    new AppError(ErrorCode.REGISTRATION_DISABLED, '当前已关闭公开注册'),
};
