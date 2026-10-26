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
 *
 * 位数取自 CLDR：多数币种 2 位，日元/韩元/越南盾/印尼盾等 0 位，
 * 科威特第纳尔等海湾币种 3 位。缺条目会退化成 2 位，
 * 对 0 位与 3 位币种都是错的，因此新增币种必须在这里显式登记。
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
  NZD: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  INR: 2,
  THB: 2,
  MYR: 2,
  PHP: 2,
  IDR: 0,
  VND: 0,
  BRL: 2,
  MXN: 2,
  ZAR: 2,
  TRY: 2,
  AED: 2,
  SAR: 2,
  PLN: 2,
  CZK: 2,
  HUF: 0,
  ILS: 2,
};

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_DECIMALS);

/**
 * 币种显示名。后台按名称搜索时要能匹配「人民币」「日元」这类说法，
 * 只靠三字母代码对非技术管理员不可用。展示与搜索共用这一份。
 */
export const CURRENCY_NAMES: Record<string, { zh: string; en: string }> = {
  CNY: { zh: '人民币', en: 'Chinese Yuan' },
  USD: { zh: '美元', en: 'US Dollar' },
  EUR: { zh: '欧元', en: 'Euro' },
  GBP: { zh: '英镑', en: 'British Pound' },
  JPY: { zh: '日元', en: 'Japanese Yen' },
  HKD: { zh: '港币', en: 'Hong Kong Dollar' },
  AUD: { zh: '澳元', en: 'Australian Dollar' },
  CAD: { zh: '加元', en: 'Canadian Dollar' },
  SGD: { zh: '新加坡元', en: 'Singapore Dollar' },
  KRW: { zh: '韩元', en: 'South Korean Won' },
  CHF: { zh: '瑞士法郎', en: 'Swiss Franc' },
  TWD: { zh: '新台币', en: 'New Taiwan Dollar' },
  NZD: { zh: '新西兰元', en: 'New Zealand Dollar' },
  SEK: { zh: '瑞典克朗', en: 'Swedish Krona' },
  NOK: { zh: '挪威克朗', en: 'Norwegian Krone' },
  DKK: { zh: '丹麦克朗', en: 'Danish Krone' },
  INR: { zh: '印度卢比', en: 'Indian Rupee' },
  THB: { zh: '泰铢', en: 'Thai Baht' },
  MYR: { zh: '马来西亚林吉特', en: 'Malaysian Ringgit' },
  PHP: { zh: '菲律宾比索', en: 'Philippine Peso' },
  IDR: { zh: '印尼盾', en: 'Indonesian Rupiah' },
  VND: { zh: '越南盾', en: 'Vietnamese Dong' },
  BRL: { zh: '巴西雷亚尔', en: 'Brazilian Real' },
  MXN: { zh: '墨西哥比索', en: 'Mexican Peso' },
  ZAR: { zh: '南非兰特', en: 'South African Rand' },
  TRY: { zh: '土耳其里拉', en: 'Turkish Lira' },
  AED: { zh: '阿联酋迪拉姆', en: 'UAE Dirham' },
  SAR: { zh: '沙特里亚尔', en: 'Saudi Riyal' },
  PLN: { zh: '波兰兹罗提', en: 'Polish Zloty' },
  CZK: { zh: '捷克克朗', en: 'Czech Koruna' },
  HUF: { zh: '匈牙利福林', en: 'Hungarian Forint' },
  ILS: { zh: '以色列新谢克尔', en: 'Israeli New Shekel' },
};

/**
 * 币种符号。
 *
 * 多个币种共用同一个符号（$ 同时是美元、加元、澳元、新加坡元、港币、
 * 新台币、墨西哥比索的符号），因此这里给的是带前缀的消歧写法，
 * 而不是符号本身。
 */
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
  NZD: 'NZ$',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
  INR: '₹',
  THB: '฿',
  MYR: 'RM',
  PHP: '₱',
  IDR: 'Rp',
  VND: '₫',
  BRL: 'R$',
  MXN: 'MX$',
  ZAR: 'R',
  TRY: '₺',
  AED: 'د.إ',
  SAR: '﷼',
  PLN: 'zł',
  CZK: 'Kč',
  HUF: 'Ft',
  ILS: '₪',
};

export const SUPPORTED_LANGUAGES = ['zh-CN', 'en-US'] as const;

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

// ===== 收支分析与预算 =====

/** 单次分析区间上限，保证内存聚合可控 */
export const ANALYTICS_MAX_RANGE_DAYS = 1826;

/** 时间序列点数上限，超出自动降级粒度 */
export const ANALYTICS_MAX_SERIES_POINTS = 400;

/** 周期识别默认回溯月份 */
export const ANALYTICS_DEFAULT_LOOKBACK_MONTHS = 24;
export const ANALYTICS_MIN_LOOKBACK_MONTHS = 6;
export const ANALYTICS_MAX_LOOKBACK_MONTHS = 24;

/** 周期识别最少出现次数 */
export const RECURRING_MIN_OCCURRENCES = 3;

/** 大额支出：笔数低于该值时 P95 不稳定，改用中位数倍数 */
export const LARGE_EXPENSE_MIN_SAMPLES = 20;
export const LARGE_EXPENSE_MEDIAN_MULTIPLE = 3;

/** 预算：使用率达到该比例即预警 */
export const BUDGET_WARNING_RATIO = 0.8;

/** 预算结转最多回溯的周期数 */
export const BUDGET_CARRYOVER_MAX_PERIODS = 12;

/** 单个预算最多分类额度数 */
export const BUDGET_MAX_ITEMS = 50;

export const BUDGET_PERIOD_TYPES = ['monthly', 'yearly'] as const;
export const BUDGET_STATUSES = ['active', 'archived'] as const;
export const ANALYTICS_GRANULARITIES = ['day', 'week', 'month'] as const;

// ===== 投资 =====

/** 价格超过该天数视为过期，净值与净资产会标注 stale */
export const INVESTMENT_PRICE_STALE_DAYS = Number(process.env.INVESTMENT_PRICE_STALE_DAYS ?? 7);

/** 收益曲线最大采样点，超出自动降级粒度 */
export const INVESTMENT_MAX_SERIES_POINTS = 400;

/** 单次收益计算允许的外部现金流上限，防止求根迭代爆炸 */
export const INVESTMENT_MAX_CASHFLOWS = 200;

/** 再平衡建议的最小偏离阈值，|drift| 不超过该值不提示交易 */
export const INVESTMENT_REBALANCE_DRIFT_THRESHOLD = 0.05;

/** 单一资产类别占比超过该值视为集中度过高 */
export const INVESTMENT_CONCENTRATION_WARNING_RATIO = 0.6;

/** 再平衡建议数量保留的小数位 */
export const INVESTMENT_REBALANCE_QUANTITY_DECIMALS = 4;

export const ASSET_CLASSES = ['stock', 'etf', 'fund', 'bond', 'cash', 'other'] as const;
export const TRADE_KINDS = ['buy', 'sell', 'dividend', 'interest', 'fee', 'tax'] as const;
export const CASHFLOW_KINDS = ['deposit', 'withdraw'] as const;
export const COST_BASIS_METHODS = ['average'] as const;
export const PORTFOLIO_STATUSES = ['active', 'archived'] as const;
export const ALLOCATION_DIMENSIONS = ['asset_class', 'instrument', 'currency'] as const;

// ===== 风险模拟 =====

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** 单次运行路径上限 */
export const MONTE_CARLO_MAX_PATHS = envInt('MONTE_CARLO_MAX_PATHS', 20_000);

/** 新建方案的默认路径数 */
export const MONTE_CARLO_DEFAULT_PATHS = envInt('MONTE_CARLO_DEFAULT_PATHS', 5_000);

/** 模拟年限上限：逐年存采样点，取值比复利引擎更保守 */
export const MONTE_CARLO_MAX_YEARS = envInt('MONTE_CARLO_MAX_YEARS', 50);

/** 同步预览的路径上限与时限 */
export const MONTE_CARLO_PREVIEW_PATHS = envInt('MONTE_CARLO_PREVIEW_PATHS', 500);
export const MONTE_CARLO_PREVIEW_TIMEOUT_MS = envInt('MONTE_CARLO_PREVIEW_TIMEOUT_MS', 3_000);

/** 并发执行槽与「排队 + 运行中」总上限 */
export const MONTE_CARLO_MAX_CONCURRENT_RUNS = envInt('MONTE_CARLO_MAX_CONCURRENT_RUNS', 2);
export const MONTE_CARLO_QUEUE_LIMIT = envInt('MONTE_CARLO_QUEUE_LIMIT', 10);

/** 单次运行总时限与心跳超时 */
export const MONTE_CARLO_TIMEOUT_SECONDS = envInt('MONTE_CARLO_TIMEOUT_SECONDS', 120);
export const MONTE_CARLO_HEARTBEAT_TIMEOUT_SECONDS = envInt('MONTE_CARLO_HEARTBEAT_TIMEOUT_SECONDS', 30);

/** 单次分片的时间预算：到点立即让出事件循环，小机器上也不会长时间占用 */
export const MONTE_CARLO_CHUNK_MS = envInt('MONTE_CARLO_CHUNK_MS', 15);

/** 进度与心跳的写入节流间隔 */
export const MONTE_CARLO_PROGRESS_INTERVAL_MS = envInt('MONTE_CARLO_PROGRESS_INTERVAL_MS', 400);

/** 取消标记的轮询间隔 */
export const MONTE_CARLO_CANCEL_POLL_MS = 500;

/** 每个方案保留的终态运行数 */
export const MONTE_CARLO_RUN_RETENTION = envInt('MONTE_CARLO_RUN_RETENTION', 30);

/** 落库的样本路径数与直方图桶数 */
export const MONTE_CARLO_SAMPLE_PATHS = envInt('MONTE_CARLO_SAMPLE_PATHS', 20);
export const MONTE_CARLO_HISTOGRAM_BINS = envInt('MONTE_CARLO_HISTOGRAM_BINS', 20);

/** 中断恢复的最大尝试次数，超出直接置 failed */
export const MONTE_CARLO_MAX_ATTEMPTS = 2;

/** 连通性估计所需的最少价格点数与覆盖天数 */
export const MONTE_CARLO_MIN_SAMPLES = 250;
export const MONTE_CARLO_HIGH_CONFIDENCE_SAMPLES = 750;

/** 单个方案允许的最大资产数 */
export const MONTE_CARLO_MAX_ASSETS = 10;

/** 随机种子上限（含），落在 32 位有符号正整数范围 */
export const MONTE_CARLO_SEED_MAX = 2_147_483_647;

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export const RUN_STAGES = ['preparing', 'simulating', 'aggregating', 'finalizing'] as const;
export const RETURN_MODELS = ['lognormal'] as const;
export const REBALANCE_FREQUENCIES = ['none', 'monthly', 'quarterly', 'annual'] as const;
export const STRESS_PRESETS = ['crash', 'stagflation', 'lost_decade'] as const;
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

// ===== 财富目标与财务报表 =====

/** 单用户活跃目标上限 */
export const GOAL_MAX_COUNT = envInt('GOAL_MAX_COUNT', 50);

/** 反推月供的合理性上限，超过视为无解，而不是返回一个伪解 */
export const GOAL_MAX_REQUIRED_MONTHLY = envInt('GOAL_MAX_REQUIRED_MONTHLY', 1_000_000);

/** 预测与 ETA 的最大月数（50 年） */
export const GOAL_PROJECTION_MAX_MONTHS = envInt('GOAL_PROJECTION_MAX_MONTHS', 600);

/** 进度历史的最大重算月数 */
export const GOAL_HISTORY_MAX_MONTHS = envInt('GOAL_HISTORY_MAX_MONTHS', 120);

/** 目标名称长度上限 */
export const GOAL_NAME_MAX_LENGTH = 80;

/** 默认安全提取率与允许区间 */
export const FI_DEFAULT_WITHDRAWAL_RATE = 0.04;
export const FI_MIN_WITHDRAWAL_RATE = 0.02;
export const FI_MAX_WITHDRAWAL_RATE = 0.1;

/** 年化支出的最小月数：不足时返回 null，不按现有月份外推 */
export const FI_MIN_EXPENSE_MONTHS = envInt('FI_MIN_EXPENSE_MONTHS', 6);

/** 报表生成与导出的行数上限 */
export const REPORT_MAX_ROWS = envInt('REPORT_MAX_ROWS', 50_000);

/** 每用户保留的最新报表数 */
export const REPORT_RETENTION = envInt('REPORT_RETENTION', 100);

/** 同步导出的时间预算（用于告警，不作为中断条件） */
export const EXPORT_TIMEOUT_MS = envInt('EXPORT_TIMEOUT_MS', 3_000);

/** 报表标题长度上限 */
export const REPORT_TITLE_MAX_LENGTH = 120;

/** CSV 导出单文件大小预警（字节），超出时日志告警但不阻断 */
export const EXPORT_MAX_BYTES = envInt('EXPORT_MAX_BYTES', 20 * 1024 * 1024);

export const GOAL_TYPES = [
  'savings',
  'purchase',
  'education',
  'retirement',
  'emergency_fund',
  'financial_independence',
  'custom',
] as const;
export const GOAL_FUNDING_SOURCES = ['net_worth', 'account', 'portfolio'] as const;
export const GOAL_STATUSES = ['active', 'achieved', 'archived'] as const;
export const REPORT_TYPES = [
  'net_worth',
  'cashflow',
  'analytics',
  'investment',
  'goals',
  'simulation',
] as const;
export const REPORT_FORMATS = ['csv', 'xlsx'] as const;

// ===== 数据管理与运维 =====

/** 同步导出的行数阈值，超过走异步任务 */
export const EXPORT_SYNC_MAX_ROWS = envInt('EXPORT_SYNC_MAX_ROWS', 20_000);

/** 单次导出的行数上限 */
export const EXPORT_MAX_ROWS = envInt('EXPORT_MAX_ROWS', 200_000);

/** 导出文件保留天数 */
export const EXPORT_RETENTION_DAYS = envInt('EXPORT_RETENTION_DAYS', 7);

/** 每用户保留的备份份数 */
export const BACKUP_RETENTION_COUNT = envInt('BACKUP_RETENTION_COUNT', 10);

/** 备份文件保留天数 */
export const BACKUP_RETENTION_DAYS = envInt('BACKUP_RETENTION_DAYS', 90);

/** 备份包结构版本：新建包一律写当前版本 */
export const BACKUP_SCHEMA_VERSION = 'comporalife-backup-v3';

/**
 * 可读取的备份结构版本。
 * v1 不含标的计价、标签关联、目标权重、分类规则、导入模板、对账记录与汇率；
 * 读取时按缺域处理并告警，而不是拒绝恢复。
 */
export const BACKUP_SUPPORTED_VERSIONS = [
  'comporalife-backup-v1',
  'comporalife-backup-v2',
  // v3 起汇率移出用户备份域；读 v2 包时该域被忽略并给出警告
  'comporalife-backup-v3',
] as const;

/** 导出包结构版本 */
export const EXPORT_SCHEMA_VERSION = 'comporalife-export-v1';

/** 恢复预览中冲突条目上限 */
export const RESTORE_PREVIEW_LIMIT = envInt('RESTORE_PREVIEW_LIMIT', 200);

/** 恢复批量写入大小 */
export const RESTORE_BATCH_SIZE = envInt('RESTORE_BATCH_SIZE', 500);

/** 恢复确认标记：必须精确匹配才执行 */
export const RESTORE_CONFIRM_TOKEN = 'RESTORE';

/** 通用任务最大重试次数 */
export const TASK_MAX_ATTEMPTS = envInt('TASK_MAX_ATTEMPTS', 3);

/** 通用任务并发上限 */
export const TASK_MAX_CONCURRENT = envInt('TASK_MAX_CONCURRENT', 2);

/** 通用任务超时 */
export const TASK_TIMEOUT_SECONDS = envInt('TASK_TIMEOUT_SECONDS', 600);

/** 通用任务分片时间预算 */
export const TASK_CHUNK_MS = envInt('TASK_CHUNK_MS', 15);

/** 通用任务进度写入节流 */
export const TASK_PROGRESS_INTERVAL_MS = envInt('TASK_PROGRESS_INTERVAL_MS', 400);

/** 通用任务心跳超时 */
export const TASK_HEARTBEAT_TIMEOUT_SECONDS = envInt('TASK_HEARTBEAT_TIMEOUT_SECONDS', 60);

/** 疑似重复的日期窗口（天） */
export const DUPLICATE_WINDOW_DAYS = envInt('DUPLICATE_WINDOW_DAYS', 3);

/** 汇率滞后的天数阈值 */
export const RATE_STALE_DAYS = envInt('RATE_STALE_DAYS', 7);

/** 汇率同步运行记录的保留天数 */
export const RATE_SYNC_RUN_RETENTION_DAYS = envInt('RATE_SYNC_RUN_RETENTION_DAYS', 90);

/** 数据质量总览默认回看的月数 */
export const QUALITY_LOOKBACK_MONTHS = envInt('QUALITY_LOOKBACK_MONTHS', 12);

/** 单个质量问题明细的默认条数 */
export const QUALITY_ITEM_LIMIT = envInt('QUALITY_ITEM_LIMIT', 100);

/** 审计日志查询的默认条数 */
export const AUDIT_LOG_PAGE_SIZE = envInt('AUDIT_LOG_PAGE_SIZE', 50);

/** 注册开关在 system_settings 中的键 */
export const SETTING_REGISTRATION_ENABLED = 'registration.enabled';

/** 邮箱验证开关：默认关闭，自部署单用户场景下强制验证只会抬高门槛 */
export const SETTING_EMAIL_VERIFICATION_ENABLED = 'auth.email_verification_enabled';

/**
 * 后台代建账号开关：默认关闭。
 * 管理员直接设定用户初始密码、且不强制改密，属于高风险能力，必须显式开启。
 */
export const SETTING_ADMIN_USER_CREATE_ENABLED = 'admin.user_create_enabled';

/** 汇率自动同步开关在 system_settings 中的键 */
export const SETTING_RATE_SYNC_ENABLED = 'rate_sync_enabled';

/** 汇率同步频率在 system_settings 中的键 */
export const SETTING_RATE_SYNC_FREQUENCY = 'rate_sync_frequency';

/**
 * 外部汇率源配置在 system_settings 中的键。
 *
 * 与频率不同，这里含密钥：入库前用 FILE_ENCRYPTION_KEY 加密，
 * 接口只回显末四位。密钥放在库里是为了让管理员不必改环境变量重启服务，
 * 代价是必须假定数据库读权限者可能看到密文，因此不能明文落库。
 */
export const SETTING_RATE_PROVIDER = 'rate_provider';

/** 密文绑定的用途标签：挪到别的字段上会解不开 */
export const RATE_PROVIDER_KEY_PURPOSE = 'rate-provider';

/**
 * 可选的数据源预设。
 *
 * 三个预设覆盖公开免密钥、需 app_id、自建端点三类场景；各自的
 * 地址与响应解析固化在代码里，页面上只填密钥与（自定义源）地址，
 * 不让运维用 URL 模板拼出半个脚本语言。
 */
export const RATE_PROVIDERS = ['exchangerate-api', 'openexchangerates', 'custom'] as const;

export type RateProviderId = (typeof RATE_PROVIDERS)[number];

export const DEFAULT_RATE_PROVIDER: RateProviderId = 'exchangerate-api';

/** 预设的显示名，后台下拉与审计共用同一份口径 */
export const RATE_PROVIDER_LABELS: Record<RateProviderId, string> = {
  'exchangerate-api': 'ExchangeRate API',
  openexchangerates: 'Open Exchange Rates',
  custom: '自定义 API',
};

/** 哪些预设必须提供密钥：缺了就直接报错，不发出无意义的请求 */
export const RATE_PROVIDER_REQUIRES_KEY: Record<RateProviderId, boolean> = {
  'exchangerate-api': false,
  openexchangerates: true,
  custom: false,
};

export function isRateProviderId(value: unknown): value is RateProviderId {
  return typeof value === 'string' && (RATE_PROVIDERS as readonly string[]).includes(value);
}

/**
 * 可选的同步频率。
 *
 * 放在库里而不是环境变量，是因为它属于「运维可在线调整」的业务参数：
 * 改环境变量必须重启进程，而管理员换个频率不该导致服务中断。
 */
export const RATE_SYNC_FREQUENCIES = ['hourly', 'daily', 'weekly'] as const;

export type RateSyncFrequency = (typeof RATE_SYNC_FREQUENCIES)[number];

export const RATE_SYNC_FREQUENCY_MS: Record<RateSyncFrequency, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

/** 没有配置过频率时按每日一次，与历史默认行为一致 */
export const DEFAULT_RATE_SYNC_FREQUENCY: RateSyncFrequency = 'daily';

export function isRateSyncFrequency(value: unknown): value is RateSyncFrequency {
  return typeof value === 'string' && (RATE_SYNC_FREQUENCIES as readonly string[]).includes(value);
}

/** 邮箱验证令牌有效期：72 小时，给用户跨天打开邮件留足窗口 */
export const EMAIL_VERIFY_TTL_SECONDS = 72 * 60 * 60;

/** 重发验证邮件的节流窗口 */
export const EMAIL_VERIFY_RESEND_WINDOW_SECONDS = 10 * 60;

/** 注销申请的冷却期：期间用户可撤销，管理员也不能提前批准 */
export const DELETION_COOLING_OFF_DAYS = envInt('DELETION_COOLING_OFF_DAYS', 7);

/** 站内通知保留天数 */
export const NOTIFICATION_RETENTION_DAYS = envInt('NOTIFICATION_RETENTION_DAYS', 90);

/**
 * 审计日志保留天数。
 * 审计是追责依据，保留期要明显长于业务数据；一年是自部署场景下的保守下限。
 */
export const AUDIT_LOG_RETENTION_DAYS = envInt('AUDIT_LOG_RETENTION_DAYS', 365);

/** 每用户通知条数上限，超出按时间删除最旧的 */
export const NOTIFICATION_MAX_PER_USER = envInt('NOTIFICATION_MAX_PER_USER', 500);

export const EXPORT_STATUSES = ['queued', 'running', 'ready', 'failed', 'expired'] as const;
export const EXPORT_SCOPES = ['full', 'ledger', 'investments', 'simulations', 'planning', 'settings'] as const;
export const BACKUP_STATUSES = ['creating', 'ready', 'failed', 'expired'] as const;
export const BACKUP_FORMATS = ['json_encrypted'] as const;
export const TASK_KINDS = ['export', 'backup', 'restore', 'recheck'] as const;
export const TASK_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
