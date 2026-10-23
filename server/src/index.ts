import { buildApp } from './app.js';
import { env } from './config/env.js';
import { scheduleImportCleanup } from './modules/imports/cleanup.js';

async function main() {
  const app = await buildApp();

  const stopCleanup = scheduleImportCleanup(app.prisma, (err) => {
    app.log.warn({ err }, '账单文件清理任务失败');
  });
  app.addHook('onClose', async () => stopCleanup());

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, '收到退出信号，开始优雅关闭');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, '优雅关闭失败');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ port: env.PORT, host: env.HOST });

    // 监听成功后再启动执行器：先恢复被中断的运行，再开始消费队列。
    // 顺序不能颠倒，否则恢复出来的作业会与正在领取的槽争抢。
    await app.jobs.start();
  } catch (err) {
    app.log.error({ err }, '服务启动失败');
    process.exit(1);
  }
}

void main();
