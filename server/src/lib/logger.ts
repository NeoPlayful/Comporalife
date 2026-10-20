import { env, isTest } from '../config/env.js';

// 仅当 pino-pretty 实际可用时才启用美化输出：
// 生产镜像按 --omit=dev 安装依赖，pino-pretty 不存在，启用会导致进程启动失败
const usePrettyTransport = env.LOG_PRETTY && !isTest;

/** 日志中必须脱敏的字段名（小写比较） */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'passwordHash',
  'newPassword',
  'oldPassword',
  'token',
  'accessToken',
  'refreshToken',
  'refreshTokenHash',
  'amount',
  'openingBalance',
  'statementBalance',
  'computedBalance',
  'rate',
  'secret',
  'apiKey',
];

export const loggerOptions = {
  level: env.LOG_LEVEL,
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  ...(usePrettyTransport
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
};
