import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';

let app: FastifyInstance;

const EMAIL_DOMAIN = '@auth-test.local';

async function cleanup() {
  await app.prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
}

function randomEmail(prefix = 'user') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${EMAIL_DOMAIN}`;
}

const VALID_PASSWORD = 'TestPass123';

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
});

beforeEach(async () => {
  await cleanup();
});

describe('注册', () => {
  it('注册成功并自动创建分类与设置', async () => {
    const email = randomEmail();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: VALID_PASSWORD, nickname: '测试用户' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe(email);
    expect(body.data.accessToken).toBeTruthy();

    const user = await app.prisma.user.findUniqueOrThrow({ where: { email } });
    const categories = await app.prisma.category.count({ where: { userId: user.id } });
    const settings = await app.prisma.userSettings.findUniqueOrThrow({ where: { userId: user.id } });

    expect(categories).toBeGreaterThan(0);
    expect(settings.baseCurrency).toBe('CNY');
    expect(user.passwordHash).not.toContain(VALID_PASSWORD);
  });

  it('邮箱重复返回 409', async () => {
    const email = randomEmail();
    const payload = { email, password: VALID_PASSWORD, nickname: '重复' };

    await app.inject({ method: 'POST', url: '/api/auth/register', payload });
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_EXISTS');
  });

  it('弱密码被拒绝', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: randomEmail(), password: '123', nickname: '弱密码' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('登录与会话', () => {
  async function registerUser() {
    const email = randomEmail();
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: VALID_PASSWORD, nickname: '登录测试' },
    });
    return email;
  }

  it('密码错误与邮箱不存在返回同样的错误', async () => {
    const email = await registerUser();

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'WrongPass123' },
    });

    const unknownEmail = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: randomEmail('ghost'), password: VALID_PASSWORD },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json().error.message).toBe(unknownEmail.json().error.message);
  });

  it('禁用用户无法登录', async () => {
    const email = await registerUser();
    await app.prisma.user.update({ where: { email }, data: { status: 'disabled' } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: VALID_PASSWORD },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('USER_DISABLED');
  });

  it('刷新令牌轮换后旧令牌立即失效', async () => {
    await registerUser();
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: (await app.prisma.user.findFirstOrThrow({ where: { email: { endsWith: EMAIL_DOMAIN } } })).email, password: VALID_PASSWORD },
    });

    const rawCookies = login.cookies;
    const refreshCookie = rawCookies.find((c) => c.name === 'cl_refresh');
    expect(refreshCookie).toBeTruthy();
    const oldToken = refreshCookie!.value;

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { cl_refresh: oldToken },
    });
    expect(first.statusCode).toBe(200);

    // 旧令牌已被轮换，重放必须失败
    const replay = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { cl_refresh: oldToken },
    });
    expect(replay.statusCode).toBe(401);
    // 重放失败不能清除 Cookie：并发轮换时浏览器可能已持有有效的新令牌
    expect(replay.cookies.find((c) => c.name === 'cl_refresh')).toBeUndefined();
  });

  it('会话过期时才清除刷新 Cookie', async () => {
    await registerUser();
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: (await app.prisma.user.findFirstOrThrow({ where: { email: { endsWith: EMAIL_DOMAIN } } })).email,
        password: VALID_PASSWORD,
      },
    });
    const oldToken = login.cookies.find((c) => c.name === 'cl_refresh')!.value;

    // 直接令会话过期，模拟闲置超过 7 天
    await app.prisma.userSession.updateMany({
      where: { userId: (await app.prisma.user.findFirstOrThrow({ where: { email: { endsWith: EMAIL_DOMAIN } } })).id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { cl_refresh: oldToken },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('SESSION_EXPIRED');
    expect(res.cookies.find((c) => c.name === 'cl_refresh')?.value).toBe('');
  });

  it('未登录访问受保护接口返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('登录后可访问 /api/auth/me', async () => {
    const email = await registerUser();
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: VALID_PASSWORD },
    });
    const token = login.json().data.accessToken as string;

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.email).toBe(email);
  });

  it('改密后其他会话失效且访问令牌版本不匹配', async () => {
    const email = await registerUser();

    const firstLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: VALID_PASSWORD },
    });
    const firstToken = firstLogin.json().data.accessToken as string;

    const secondLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: VALID_PASSWORD },
    });
    const secondToken = secondLogin.json().data.accessToken as string;

    const changed = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${secondToken}` },
      payload: { oldPassword: VALID_PASSWORD, newPassword: 'NewPass456' },
    });
    expect(changed.statusCode).toBe(200);

    // sessionVersion 递增，两个旧令牌都应失效
    for (const token of [firstToken, secondToken]) {
      const me = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(me.statusCode).toBe(401);
    }

    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'NewPass456' },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('会话列表与撤销指定会话', async () => {
    const email = await registerUser();

    const loginA = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: VALID_PASSWORD },
    });
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: VALID_PASSWORD },
    });

    const tokenA = loginA.json().data.accessToken as string;

    const sessions = await app.inject({
      method: 'GET',
      url: '/api/auth/sessions',
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(sessions.statusCode).toBe(200);
    const list = sessions.json().data.sessions as Array<{ id: string; current: boolean }>;
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.filter((s) => s.current).length).toBe(1);

    const other = list.find((s) => !s.current)!;
    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${other.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(revoked.statusCode).toBe(200);
  });

  it('不能撤销他人的会话', async () => {
    const emailA = await registerUser();
    const emailB = await registerUser();

    const loginB = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: emailB, password: VALID_PASSWORD },
    });
    const tokenB = loginB.json().data.accessToken as string;

    const sessionsA = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: emailA, password: VALID_PASSWORD },
    });
    const tokenA = sessionsA.json().data.accessToken as string;

    const listB = await app.inject({
      method: 'GET',
      url: '/api/auth/sessions',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    const sessionBId = (listB.json().data.sessions as Array<{ id: string }>)[0]!.id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${sessionBId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('密码重置', () => {
  it('不存在的邮箱也返回 202，避免账号枚举', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: randomEmail('ghost') },
    });
    expect(res.statusCode).toBe(202);
  });

  it('重置令牌一次性使用', async () => {
    const email = randomEmail();
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: VALID_PASSWORD, nickname: '重置' },
    });

    const user = await app.prisma.user.findUniqueOrThrow({ where: { email } });
    // 开发环境下路由会写日志，这里直接取 Redis 中的令牌键来模拟
    const keys = await app.redis.keys('pwdreset:*');
    await app.redis.flushdb();

    await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email },
    });

    const newKeys = await app.redis.keys('pwdreset:*');
    expect(newKeys.length + keys.length).toBeGreaterThan(0);

    // 直接用服务层生成的有效令牌路径验证：制造一个令牌
    const { createHash } = await import('node:crypto');
    const rawToken = 'known-test-token';
    await app.redis.set(`pwdreset:${createHash('sha256').update(rawToken).digest('hex')}`, user.id, 'EX', 600);

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: rawToken, newPassword: 'ResetPass789' },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: rawToken, newPassword: 'AnotherPass789' },
    });
    expect(second.statusCode).toBe(400);
  });
});

describe('资料与设置', () => {
  async function registerAndLogin() {
    const email = randomEmail();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: VALID_PASSWORD, nickname: '资料测试' },
    });
    return { email, token: res.json().data.accessToken as string, userId: res.json().data.user.id as string };
  }

  it('可以更新昵称', async () => {
    const { token } = await registerAndLogin();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { nickname: '新昵称' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.nickname).toBe('新昵称');
  });

  it('非法时区被拒绝', async () => {
    const { token } = await registerAndLogin();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/profile/preferences',
      headers: { authorization: `Bearer ${token}` },
      payload: { timezone: 'Mars/Olympus' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('非法币种被拒绝', async () => {
    const { token } = await registerAndLogin();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/profile/preferences',
      headers: { authorization: `Bearer ${token}` },
      payload: { baseCurrency: 'XYZ' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('偏好修改持久化', async () => {
    const { token } = await registerAndLogin();

    await app.inject({
      method: 'PATCH',
      url: '/api/profile/preferences',
      headers: { authorization: `Bearer ${token}` },
      payload: { baseCurrency: 'USD', timezone: 'America/New_York', theme: 'light' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/profile/preferences',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.json().data.preferences.baseCurrency).toBe('USD');
    expect(res.json().data.preferences.timezone).toBe('America/New_York');
    expect(res.json().data.preferences.theme).toBe('light');
  });

  it('界面语言偏好可保存并对非法值返回 400', async () => {
    const { token } = await registerAndLogin();

    const saved = await app.inject({
      method: 'PATCH',
      url: '/api/profile/preferences',
      headers: { authorization: `Bearer ${token}` },
      payload: { language: 'en-US' },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.preferences.language).toBe('en-US');

    const invalid = await app.inject({
      method: 'PATCH',
      url: '/api/profile/preferences',
      headers: { authorization: `Bearer ${token}` },
      payload: { language: 'fr-FR' },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('注册时按传入语言生成系统分类名称', async () => {
    const email = randomEmail('lang');

    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: VALID_PASSWORD, nickname: 'Lang', language: 'en-US' },
    });

    const user = await app.prisma.user.findUniqueOrThrow({ where: { email } });
    const names = await app.prisma.category.findMany({
      where: { userId: user.id },
      select: { name: true },
    });
    const settings = await app.prisma.userSettings.findUniqueOrThrow({ where: { userId: user.id } });

    expect(settings.language).toBe('en-US');
    expect(names.map((item) => item.name)).toContain('Salary');
  });
});
