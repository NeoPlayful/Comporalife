import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 复用 tsconfig 的 paths，避免测试解析与类型检查两套配置漂移
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    // 通过 vitest 注入到 worker 进程，不依赖开发者本地 .env
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://comporalife:comporalife@localhost:5432/comporalife',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      JWT_SECRET: process.env.JWT_SECRET ?? 'test-secret-at-least-32-characters-long',
      LOG_LEVEL: 'fatal',
      // 测试用固定密钥，仅用于本地与 CI，不是生产凭据
      FILE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      FILE_STORAGE_DIR: './data/test-imports',
    },
  },
});
