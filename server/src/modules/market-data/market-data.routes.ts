import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ok } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { requireAuth, type AuthContext } from '../../plugins/auth.js';
import {
  acquireSyncLock,
  isRateProviderConfigured,
  isRateSyncEnabled,
  releaseSyncLock,
  runRateSync,
  setRateSyncEnabled,
  shouldAutoDisable,
} from './rate-sync.service.js';
import {
  getRateProviderView,
  isRateProviderAvailable,
} from './rate-provider-config.service.js';
import { getRateSyncSchedule } from './rate-sync.scheduler.js';
import { getRateSyncFrequency } from '../settings/system-settings.service.js';
import { RATE_STALE_DAYS } from '../../config/constants.js';

function requireAdmin(request: FastifyRequest): AuthContext {
  const auth = requireAuth(request);
  if (auth.role !== 'admin' && auth.role !== 'super_admin') {
    throw errors.adminForbidden();
  }
  return auth;
}

const DAY_MS = 86_400_000;

export default async function marketDataRoutes(app: FastifyInstance) {
  /** 供应商配置状态与最近一次运行：管理员可见 */
  app.get('/market-data/providers', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);

    const [enabled, frequency, providerView, available, lastRun] = await Promise.all([
      isRateSyncEnabled(app.prisma),
      getRateSyncFrequency(app.prisma),
      getRateProviderView(app.prisma),
      isRateProviderAvailable(app.prisma),
      app.prisma.rateSyncRun.findFirst({
        orderBy: { startedAt: 'desc' },
        select: {
          startedAt: true,
          finishedAt: true,
          status: true,
          fetchedPairs: true,
          writtenRows: true,
          skippedManual: true,
          failures: true,
          errorCode: true,
          errorMessage: true,
        },
      }),
    ]);

    let disabledReason: string | null = null;
    if (!enabled && (await shouldAutoDisable(app.prisma))) {
      disabledReason = 'consecutive_failures';
    }

    return ok(
      {
        configured: available,
        provider: providerView.provider,
        anchorCurrency: providerView.anchorCurrency,
        // 只返回布尔与末四位：密钥明文与密文永远不出现在任何响应里
        keyConfigured: providerView.keyConfigured,
        keyHint: providerView.keyHint,
        // 数据源来自数据库还是部署环境（回退），用来解释「为什么改了页面却没用」
        configSource: providerView.source,
        customUrlConfigured: providerView.customUrl.length > 0,
        enabled,
        frequency,
        // 由调度器给出：环境变量现算的估值与实际定时器无关，会误导管理员
        nextRunAt: getRateSyncSchedule().nextRunAt,
        lastRun,
        disabledReason,
      },
      request.id,
    );
  });

  /** 按币种对的同步状态：用户可见，只返回自己需要的币种对 */
  app.get('/market-data/status', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const settings = await app.prisma.userSettings.findUniqueOrThrow({
      where: { userId },
      select: { baseCurrency: true },
    });
    const baseCurrency = settings.baseCurrency;

    const [accounts, portfolios, assets, liabilities, lastRun] = await Promise.all([
      app.prisma.account.findMany({ where: { userId, status: 'active' }, select: { currency: true } }),
      app.prisma.portfolio.findMany({ where: { userId, status: 'active' }, select: { currency: true } }),
      app.prisma.asset.findMany({ where: { userId, status: 'active' }, select: { currency: true } }),
      app.prisma.liability.findMany({ where: { userId, status: 'active' }, select: { currency: true } }),
      app.prisma.rateSyncRun.findFirst({
        orderBy: { startedAt: 'desc' },
        select: { failures: true, startedAt: true },
      }),
    ]);

    const required = new Set(
      [...accounts, ...portfolios, ...assets, ...liabilities].map((item) => item.currency),
    );
    required.delete(baseCurrency);

    const failedPairs = new Set(
      Array.isArray(lastRun?.failures)
        ? (lastRun!.failures as Array<{ pair?: string }>).map((item) => item.pair ?? '')
        : [],
    );

    const today = new Date();
    const pairs = [];

    for (const from of [...required].sort()) {
      const row = await app.prisma.exchangeRate.findFirst({
        where: {
          OR: [
            { baseCurrency: from, quoteCurrency: baseCurrency },
            { baseCurrency: baseCurrency, quoteCurrency: from },
          ],
          rateDate: { lte: today },
        },
        orderBy: { rateDate: 'desc' },
        select: { rate: true, rateDate: true, source: true },
      });

      const daysLag = row
        ? Math.floor((today.getTime() - row.rateDate.getTime()) / DAY_MS)
        : null;

      // sync_failed 与 missing 必须分开：前者要管理员看供应商，后者要补录
      const pairKeyText = `${from}->${baseCurrency}`;
      const state = failedPairs.has(pairKeyText)
        ? 'sync_failed'
        : !row
          ? 'missing'
          : daysLag !== null && daysLag > RATE_STALE_DAYS
            ? 'stale'
            : 'fresh';

      pairs.push({
        from,
        to: baseCurrency,
        required: true,
        latestRateDate: row?.rateDate.toISOString().slice(0, 10) ?? null,
        daysLag,
        source: row?.source ?? null,
        state,
      });
    }

    return ok(
      {
        baseCurrency,
        pairs,
        // 与 providers 用同一个来源：调度器没跑起来时就是 null，不编造时间
        nextRunAt: getRateSyncSchedule().nextRunAt,
      },
      request.id,
    );
  });

  /** 手动触发：同步执行，返回本次摘要 */
  app.post('/market-data/refresh', { preHandler: app.authenticate }, async (request) => {
    const actor = requireAdmin(request);

    if (!(await isRateProviderConfigured(app.prisma))) {
      throw errors.rateProviderNotConfigured();
    }

    const token = randomUUID();
    const acquired = await acquireSyncLock(app.redis, token);
    if (!acquired) throw errors.rateSyncInProgress();

    try {
      const summary = await runRateSync(app.prisma, {
        trigger: 'manual',
        triggeredBy: actor.userId,
      });

      // 手动刷新成功即视为人工恢复：此前因连续失败被自动停用的开关重新打开
      if (summary.status === 'succeeded' || summary.status === 'partial') {
        await setRateSyncEnabled(app.prisma, true, actor.userId);
      }

      await app.prisma.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'currency_rate.synced',
          targetType: 'rate_sync_run',
          metadata: {
            trigger: 'manual',
            provider: summary.provider,
            fetchedPairs: summary.fetchedPairs,
            writtenRows: summary.writtenRows,
            skippedManual: summary.skippedManual,
            status: summary.status,
          },
        },
      });

      return ok(summary, request.id);
    } finally {
      await releaseSyncLock(app.redis, token);
    }
  });
}
