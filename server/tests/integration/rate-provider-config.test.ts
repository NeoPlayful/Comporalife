import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { SETTING_RATE_PROVIDER } from '@/config/constants';
import { env } from '@/config/env';
import {
  getRateProviderConfig,
  getRateProviderView,
  isRateProviderAvailable,
  saveRateProviderConfig,
} from '@/modules/market-data/rate-provider-config.service';
import { buildProvider, isRateProviderConfigured } from '@/modules/market-data/rate-sync.service';
import { auth, cleanupUsers, createUser, promoteToAdmin, testDomain } from '../helpers';

const DOMAIN = testDomain('rate-provider-config');

let app: FastifyInstance;
let superToken: string;
let adminToken: string;
let userToken: string;

async function resetProviderSetting(): Promise<void> {
  await app.prisma.systemSetting.deleteMany({ where: { key: SETTING_RATE_PROVIDER } });
}

beforeAll(async () => {
  app = await buildApp();

  // 账号只在开始时建一次：argon2 很慢，逐用例重建会显著抬高并行测试的整体负载，
  // 把别的套件里「作业需在 drain 窗口内完成」这类时序断言推向超时。
  const superUser = await createUser(app, DOMAIN);
  superToken = await promoteToAdmin(app, superUser.userId, 'super_admin');

  const adminUser = await createUser(app, DOMAIN);
  adminToken = await promoteToAdmin(app, adminUser.userId, 'admin');

  const plainUser = await createUser(app, DOMAIN);
  userToken = plainUser.token;
});

afterAll(async () => {
  await resetProviderSetting();
  await app.prisma.auditLog.deleteMany({ where: { action: 'admin.rate_provider_updated' } });
  await cleanupUsers(app, DOMAIN);
  await app.close();
});

beforeEach(async () => {
  await resetProviderSetting();
});

describe('配置读取', () => {
  it('没有任何配置时视为不可用', async () => {
    // 测试环境没有设置 RATE_PROVIDER_URL，因此回退分支也是空的
    expect(env.RATE_PROVIDER_URL).toBeFalsy();
    expect(await getRateProviderConfig(app.prisma)).toBeNull();
    expect(await isRateProviderAvailable(app.prisma)).toBe(false);
  });

  it('保存后读取到数据库配置', async () => {
    await saveRateProviderConfig(
      app.prisma,
      { provider: 'exchangerate-api', anchorCurrency: 'USD' },
      null,
    );

    const resolved = await getRateProviderConfig(app.prisma);
    expect(resolved?.source).toBe('database');
    expect(resolved?.config.provider).toBe('exchangerate-api');
    expect(await isRateProviderAvailable(app.prisma)).toBe(true);
  });

  it('自定义源缺少地址时不可用', async () => {
    await saveRateProviderConfig(
      app.prisma,
      { provider: 'custom', anchorCurrency: 'USD', customUrl: '' },
      null,
    );
    expect(await isRateProviderAvailable(app.prisma)).toBe(false);
  });

  it('需要密钥的预设缺密钥时不可用，补齐后可用', async () => {
    await saveRateProviderConfig(
      app.prisma,
      { provider: 'openexchangerates', anchorCurrency: 'USD' },
      null,
    );
    expect(await isRateProviderAvailable(app.prisma)).toBe(false);

    await saveRateProviderConfig(
      app.prisma,
      { provider: 'openexchangerates', anchorCurrency: 'USD', apiKey: 'app-id-xyz' },
      null,
    );
    expect(await isRateProviderAvailable(app.prisma)).toBe(true);
  });

  it('锚定币不在支持列表时拒绝保存', async () => {
    await expect(
      saveRateProviderConfig(
        app.prisma,
        { provider: 'exchangerate-api', anchorCurrency: 'XXX' },
        null,
      ),
    ).rejects.toThrow(/不支持的锚定币种/);
  });
});

describe('密钥存储', () => {
  it('数据库里存的是密文，不是明文', async () => {
    await saveRateProviderConfig(
      app.prisma,
      { provider: 'openexchangerates', anchorCurrency: 'USD', apiKey: 'my-plain-secret' },
      null,
    );

    const row = await app.prisma.systemSetting.findUniqueOrThrow({
      where: { key: SETTING_RATE_PROVIDER },
    });
    const raw = JSON.stringify(row.value);
    expect(raw).not.toContain('my-plain-secret');
    expect((row.value as { apiKeySealed: string }).apiKeySealed.length).toBeGreaterThan(0);
  });

  it('读取时能还原明文密钥', async () => {
    await saveRateProviderConfig(
      app.prisma,
      { provider: 'openexchangerates', anchorCurrency: 'USD', apiKey: 'my-plain-secret' },
      null,
    );
    const resolved = await getRateProviderConfig(app.prisma);
    expect(resolved?.config.apiKey).toBe('my-plain-secret');
  });

  it('省略 apiKey 时保留现有密钥', async () => {
    await saveRateProviderConfig(
      app.prisma,
      { provider: 'openexchangerates', anchorCurrency: 'USD', apiKey: 'keep-me' },
      null,
    );
    // 只改锚定币，不带密钥字段
    await saveRateProviderConfig(
      app.prisma,
      { provider: 'openexchangerates', anchorCurrency: 'EUR' },
      null,
    );

    const resolved = await getRateProviderConfig(app.prisma);
    expect(resolved?.config.apiKey).toBe('keep-me');
    expect(resolved?.config.anchorCurrency).toBe('EUR');
  });

  it('传空串时清除密钥', async () => {
    await saveRateProviderConfig(
      app.prisma,
      { provider: 'openexchangerates', anchorCurrency: 'USD', apiKey: 'remove-me' },
      null,
    );
    await saveRateProviderConfig(
      app.prisma,
      { provider: 'openexchangerates', anchorCurrency: 'USD', apiKey: '' },
      null,
    );

    const resolved = await getRateProviderConfig(app.prisma);
    expect(resolved?.config.apiKey).toBe('');
    expect(await isRateProviderAvailable(app.prisma)).toBe(false);
  });

  it('密文被改坏时按「无密钥」处理，不抛错', async () => {
    await app.prisma.systemSetting.create({
      data: {
        key: SETTING_RATE_PROVIDER,
        value: {
          provider: 'openexchangerates',
          anchorCurrency: 'USD',
          apiKeySealed: 'bm90LWEtcmVhbC1jaXBoZXJ0ZXh0',
        },
      },
    });

    const resolved = await getRateProviderConfig(app.prisma);
    expect(resolved?.config.apiKey).toBe('');
  });
});

describe('同步实际采用数据库配置', () => {
  it('buildProvider 按库里保存的数据源构造适配器', async () => {
    await saveRateProviderConfig(
      app.prisma,
      {
        provider: 'custom',
        anchorCurrency: 'EUR',
        customUrl: 'https://example.test/rates',
        apiKey: 'custom-key',
      },
      null,
    );

    const provider = await buildProvider(app.prisma);
    expect(provider.name).toBe('custom');
    expect(provider.anchorCurrency).toBe('EUR');
  });

  it('未配置时 buildProvider 抛 PROVIDER_ERROR，且判定为未配置', async () => {
    await expect(buildProvider(app.prisma)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(await isRateProviderConfigured(app.prisma)).toBe(false);
  });

  it('保存后判定为已配置，清除自定义地址后重新变为未配置', async () => {
    await saveRateProviderConfig(
      app.prisma,
      { provider: 'custom', anchorCurrency: 'USD', customUrl: 'https://example.test/rates' },
      null,
    );
    expect(await isRateProviderConfigured(app.prisma)).toBe(true);

    await saveRateProviderConfig(
      app.prisma,
      { provider: 'custom', anchorCurrency: 'USD', customUrl: '' },
      null,
    );
    expect(await isRateProviderConfigured(app.prisma)).toBe(false);
  });
});

describe('环境变量回退', () => {
  it('数据库无配置时读环境变量，且仍按 URL 模板构造适配器', async () => {
    const original = {
      url: env.RATE_PROVIDER_URL,
      anchor: env.RATE_PROVIDER_ANCHOR,
      key: env.RATE_PROVIDER_KEY,
      keyParam: env.RATE_PROVIDER_KEY_PARAM,
      ratesPath: env.RATE_PROVIDER_RATES_PATH,
      datePath: env.RATE_PROVIDER_DATE_PATH,
    };

    // env 是启动时解析出的常量对象，这里直接改字段模拟老部署
    (
      env as unknown as {
        RATE_PROVIDER_URL?: string;
        RATE_PROVIDER_KEY: string;
        RATE_PROVIDER_DATE_PATH?: string;
      }
    ).RATE_PROVIDER_URL = 'https://legacy.example/rates?date={date}&symbols={quotes}&key={key}';
    (env as unknown as { RATE_PROVIDER_KEY: string }).RATE_PROVIDER_KEY = 'legacy-key';
    (env as unknown as { RATE_PROVIDER_DATE_PATH?: string }).RATE_PROVIDER_DATE_PATH = '';

    try {
      const resolved = await getRateProviderConfig(app.prisma);
      expect(resolved?.source).toBe('environment');
      expect(resolved?.config.apiKey).toBe('legacy-key');
      expect(await isRateProviderConfigured(app.prisma)).toBe(true);

      // 模板适配器保留 {date}/{quotes}/{key} 占位符语义
      const provider = await buildProvider(app.prisma);
      expect(provider.name).toBe('generic-json');
      expect(provider.anchorCurrency).toBe(original.anchor);
    } finally {
      (env as unknown as { RATE_PROVIDER_URL?: string }).RATE_PROVIDER_URL = original.url;
      (env as unknown as { RATE_PROVIDER_KEY: string }).RATE_PROVIDER_KEY = original.key ?? '';
      (env as unknown as { RATE_PROVIDER_DATE_PATH?: string }).RATE_PROVIDER_DATE_PATH = original.datePath;
    }
  });
});

describe('回显脱敏', () => {
  it('视图只给末四位，不含明文', async () => {
    await saveRateProviderConfig(
      app.prisma,
      { provider: 'openexchangerates', anchorCurrency: 'USD', apiKey: 'abcdefghijklmnop' },
      null,
    );

    const view = await getRateProviderView(app.prisma);
    expect(view.keyConfigured).toBe(true);
    expect(view.keyHint).toBe('••••mnop');
    expect(JSON.stringify(view)).not.toContain('abcdefghijklmnop');
  });
});

describe('未配置状态', () => {
  /**
   * none 必须与环境变量回退区分开：抽屉用这个值判断表单上显示的是默认值
   * 还是管理员的选择。混成 environment 会让界面把从未配置说成来自环境变量，
   * 又会因为逐字段比较相等而始终不允许保存。
   */
  it('完全没有配置时视图来源为 none 并给出默认值', async () => {
    const view = await getRateProviderView(app.prisma);
    expect(view.source).toBe('none');
    expect(view.provider).toBe('exchangerate-api');
    expect(view.anchorCurrency).toBe('USD');
    expect(view.keyConfigured).toBe(false);
  });

  it('按视图给出的默认值原样保存即可建立配置', async () => {
    const draft = await getRateProviderView(app.prisma);
    expect(draft.source).toBe('none');

    const saved = await saveRateProviderConfig(
      app.prisma,
      {
        provider: draft.provider,
        anchorCurrency: draft.anchorCurrency,
        customUrl: draft.customUrl,
        ratesPath: draft.ratesPath,
        datePath: draft.datePath,
      },
      null,
    );

    expect(saved.source).toBe('database');
    expect(saved.provider).toBe('exchangerate-api');
    // 免密钥数据源保存后立刻可用，管理员不必再填任何凭据
    expect(await isRateProviderAvailable(app.prisma)).toBe(true);
  });
});

describe('接口权限', () => {
  it('普通用户读取数据源配置返回 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/rate-sync/provider',
      headers: auth(userToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('普通管理员可读、不可写', async () => {
    const read = await app.inject({
      method: 'GET',
      url: '/api/admin/rate-sync/provider',
      headers: auth(adminToken),
    });
    expect(read.statusCode).toBe(200);

    const write = await app.inject({
      method: 'PATCH',
      url: '/api/admin/rate-sync/provider',
      headers: auth(adminToken),
      payload: { provider: 'exchangerate-api', anchorCurrency: 'USD' },
    });
    expect(write.statusCode).toBe(403);
  });

  it('超管写入后响应不含密钥明文或密文', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/rate-sync/provider',
      headers: auth(superToken),
      payload: {
        provider: 'openexchangerates',
        anchorCurrency: 'USD',
        apiKey: 'super-secret-value',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('super-secret-value');
    expect(res.body).not.toMatch(/apiKeySealed/);
    expect(res.json().data.keyHint).toBe('••••alue');
  });

  it('非 https 的自定义地址被拒', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/rate-sync/provider',
      headers: auth(superToken),
      payload: {
        provider: 'custom',
        anchorCurrency: 'USD',
        customUrl: 'http://insecure.example/rates',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('锚定币不在支持列表时返回 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/rate-sync/provider',
      headers: auth(superToken),
      payload: { provider: 'exchangerate-api', anchorCurrency: 'XXX' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('写审计且审计内容不含密钥', async () => {
    await app.prisma.auditLog.deleteMany({ where: { action: 'admin.rate_provider_updated' } });

    await app.inject({
      method: 'PATCH',
      url: '/api/admin/rate-sync/provider',
      headers: auth(superToken),
      payload: {
        provider: 'openexchangerates',
        anchorCurrency: 'USD',
        apiKey: 'audit-secret-value',
      },
    });

    const log = await app.prisma.auditLog.findFirstOrThrow({
      where: { action: 'admin.rate_provider_updated' },
    });
    const raw = JSON.stringify(log.metadata);
    expect(raw).not.toContain('audit-secret-value');
    expect(log.metadata).toMatchObject({ provider: 'openexchangerates', keyAction: 'set' });

    await app.prisma.auditLog.deleteMany({ where: { action: 'admin.rate_provider_updated' } });
  });

  it('只改锚定币时审计记为密钥未变', async () => {
    await app.prisma.auditLog.deleteMany({ where: { action: 'admin.rate_provider_updated' } });
    await saveRateProviderConfig(
      app.prisma,
      { provider: 'openexchangerates', anchorCurrency: 'USD', apiKey: 'keep' },
      null,
    );

    await app.inject({
      method: 'PATCH',
      url: '/api/admin/rate-sync/provider',
      headers: auth(superToken),
      payload: { provider: 'openexchangerates', anchorCurrency: 'EUR' },
    });

    const log = await app.prisma.auditLog.findFirstOrThrow({
      where: { action: 'admin.rate_provider_updated' },
    });
    expect(log.metadata).toMatchObject({ keyAction: 'kept' });

    await app.prisma.auditLog.deleteMany({ where: { action: 'admin.rate_provider_updated' } });
  });
});

describe('供应商状态接口', () => {
  it('未配置时 configured 为 false，配置后为 true 并带上脱敏信息', async () => {
    const before = await app.inject({
      method: 'GET',
      url: '/api/market-data/providers',
      headers: auth(adminToken),
    });
    expect(before.statusCode).toBe(200);
    expect(before.json().data.configured).toBe(false);
    // 前端据此判断「要不要给出一键建立默认配置」
    expect(before.json().data.configSource).toBe('none');

    await saveRateProviderConfig(
      app.prisma,
      { provider: 'openexchangerates', anchorCurrency: 'USD', apiKey: 'status-secret' },
      null,
    );

    const after = await app.inject({
      method: 'GET',
      url: '/api/market-data/providers',
      headers: auth(adminToken),
    });
    const data = after.json().data;
    expect(data.configured).toBe(true);
    expect(data.provider).toBe('openexchangerates');
    expect(data.anchorCurrency).toBe('USD');
    expect(data.keyConfigured).toBe(true);
    expect(data.keyHint).toBe('••••cret');
    expect(data.configSource).toBe('database');
    expect(after.body).not.toContain('status-secret');
  });
});
