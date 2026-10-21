import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET 至少需要 32 个字符'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  DEFAULT_CURRENCY: z.string().length(3).default('CNY'),
  SESSION_ACCESS_TTL: z.string().default('15m'),
  SESSION_REFRESH_TTL: z.string().default('7d'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // 仅在开发环境显式开启；生产镜像不安装 pino-pretty
  LOG_PRETTY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // ===== 账单导入 =====
  FILE_STORAGE_DIR: z.string().default('./data/imports'),
  // AES-256-GCM 密钥，base64 编码后必须为 32 字节；长度在此处校验，绝不打印值
  FILE_ENCRYPTION_KEY: z.string().refine((value) => {
    try {
      return Buffer.from(value, 'base64').length === 32;
    } catch {
      return false;
    }
  }, 'FILE_ENCRYPTION_KEY 必须是 base64 编码的 32 字节密钥'),
  IMPORT_MAX_FILE_MB: z.coerce.number().int().positive().default(10),
  IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(20_000),
  IMPORT_FILE_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  IMPORT_ROW_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    // 只打印缺失的变量名与原因，绝不打印变量值，避免密钥进入日志
    console.error('环境变量校验失败：\n' + issues.join('\n'));
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';
