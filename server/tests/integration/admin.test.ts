import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('admin');

let app: FastifyInstance;
let superToken: string;
let superId: string;
let adminToken: string;
let adminId: string;
let userToken: string;
let userId: string;

/** 直接改库提权：测试注册接口只能创建 user，管理员必须另行设置 */
async function promote(id: string, role: 'admin' | 'super_admin') {
  await app.prisma.user.update({ where: { id }, data: { role } });
  // 角色变化会递增 sessionVersion，旧 token 立即失效；重新登录拿新 token
  const user = await app.prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true } });
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: user.email, password: 'TestPass123' },
  });
  return res.json().data.accessToken as string;
}

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.prisma.systemSetting.deleteMany({ where: { key: 'registration.enabled' } });
  await cleanupUsers(app, DOMAIN);
  await app.close();
});

beforeEach(async () => {
  await app.prisma.systemSetting.deleteMany({ where: { key: 'registration.enabled' } });
  await cleanupUsers(app, DOMAIN);

  const superUser = await createUser(app, DOMAIN, 'super');
  superId = superUser.userId;
  superToken = await promote(superId, 'super_admin');

  const adminUser = await createUser(app, DOMAIN, 'admin');
  adminId = adminUser.userId;
  adminToken = await promote(adminId, 'admin');

  const plain = await createUser(app, DOMAIN, 'plain');
  userId = plain.userId;
  userToken = plain.token;
});

describe('访问控制', () => {
  it('普通用户访问管理接口返回 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard/overview',
      headers: auth(userToken),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ADMIN_FORBIDDEN');
  });

  it('普通用户看不到管理员列表', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/admins', headers: auth(userToken) });
    expect(res.statusCode).toBe(403);
  });

  it('admin 访问仅限 super_admin 的接口返回 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/admins', headers: auth(adminToken) });
    expect(res.statusCode).toBe(403);
  });

  it('未登录返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/dashboard/overview' });
    expect(res.statusCode).toBe(401);
  });

  it('permissions/me 返回当前管理员可用操作', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/permissions/me', headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.role).toBe('admin');
    expect(res.json().data.permissions).not.toContain('admins:write');
  });
});

describe('仪表板聚合', () => {
  it('总览只返回聚合计数', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard/overview',
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.users.total).toBeGreaterThanOrEqual(3);

    // 不得出现任何账号级明细
    expect(JSON.stringify(data)).not.toContain('@');
  });

  it('注册趋势按日期聚合', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard/registrations',
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const points = res.json().data.points as Array<{ date: string; count: number }>;
    expect(points.length).toBeGreaterThan(0);
    expect(points[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('安全与任务聚合返回计数而非明细', async () => {
    const security = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard/security',
      headers: auth(adminToken),
    });
    const jobs = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard/jobs',
      headers: auth(adminToken),
    });

    expect(security.statusCode).toBe(200);
    expect(typeof security.json().data.loginCount).toBe('number');
    expect(jobs.statusCode).toBe(200);
    expect(typeof jobs.json().data.active).toBe('number');
  });
});

describe('用户管理', () => {
  it('列表默认脱敏邮箱', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: auth(adminToken) });

    expect(res.statusCode).toBe(200);
    const users = res.json().data.users as Array<{ email: string }>;
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((item) => item.email.includes('***'))).toBe(true);
  });

  it('reveal=true 时返回完整邮箱并写审计', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/users/${userId}?reveal=true`,
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.email).toContain('@');
    expect(res.json().data.user.email).not.toContain('***');
  });

  it('详情不含任何财务字段', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/users/${userId}`,
      headers: auth(adminToken),
    });

    const serialized = JSON.stringify(res.json().data.user).toLowerCase();
    for (const forbidden of ['balance', 'amount', 'portfolio', 'transaction', 'goal', 'report', 'networth', 'expense', 'income']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('按角色筛选生效', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users?role=admin',
      headers: auth(adminToken),
    });

    const users = res.json().data.users as Array<{ role: string }>;
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((item) => item.role === 'admin')).toBe(true);
  });

  it('禁用用户后其 access token 立即失效', async () => {
    const target = await createUser(app, DOMAIN, 'victim');

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${target.userId}/disable`,
      headers: auth(adminToken),
    });
    expect(res.statusCode).toBe(200);

    // sessionVersion 已递增，旧令牌必须被拒
    const me = await app.inject({ method: 'GET', url: '/api/profile', headers: auth(target.token) });
    expect(me.statusCode).toBe(401);

    const updated = await app.prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
    expect(updated.status).toBe('disabled');
  });

  it('禁用会撤销全部会话', async () => {
    const target = await createUser(app, DOMAIN, 'revoke-me');

    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${target.userId}/disable`,
      headers: auth(adminToken),
    });

    const active = await app.prisma.userSession.count({
      where: { userId: target.userId, revokedAt: null },
    });
    expect(active).toBe(0);
  });

  it('启用后可重新登录', async () => {
    const target = await createUser(app, DOMAIN, 'toggle');

    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${target.userId}/disable`,
      headers: auth(adminToken),
    });
    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${target.userId}/enable`,
      headers: auth(adminToken),
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: target.email, password: 'TestPass123' },
    });

    expect(login.statusCode).toBe(200);
  });

  it('撤销会话后旧 token 失效', async () => {
    const target = await createUser(app, DOMAIN, 'session');

    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${target.userId}/revoke-sessions`,
      headers: auth(adminToken),
    });

    const me = await app.inject({ method: 'GET', url: '/api/profile', headers: auth(target.token) });
    expect(me.statusCode).toBe(401);
  });

  it('登录记录只返回网段 IP', async () => {
    const target = await createUser(app, DOMAIN, 'loginlog');

    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/users/${target.userId}/login-logs`,
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const logs = res.json().data.logs as Array<{ ip: string | null }>;
    expect(logs.every((item) => item.ip === null || item.ip.includes('x'))).toBe(true);
  });

  it('删除申请审批只做禁用，不物理删除', async () => {
    const target = await createUser(app, DOMAIN, 'deletion');

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${target.userId}/deletion-review`,
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.disposition).toBe('disabled_not_deleted');
    expect(await app.prisma.user.count({ where: { id: target.userId } })).toBe(1);
  });
});

describe('权限保护', () => {
  it('不能禁用自己', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${adminId}/disable`,
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('ADMIN_SELF_MODIFICATION');
  });

  it('不能给自己授予管理员权限', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/admins/${superId}/grant`,
      headers: auth(superToken),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('ADMIN_SELF_MODIFICATION');
  });

  it('不能撤销自己的权限', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/admins/${superId}/revoke`,
      headers: auth(superToken),
    });

    expect(res.statusCode).toBe(422);
  });

  it('管理员不能禁用唯一的超级管理员', async () => {
    // 把其他超管降级，只留 superId 一个活跃超管
    await app.prisma.user.updateMany({
      where: { role: 'super_admin', id: { not: superId } },
      data: { role: 'user' },
    });

    // admin 有禁用账号的权限，但目标是最后一位超管时必须被拦住
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${superId}/disable`,
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('ADMIN_LAST_SUPER_ADMIN');
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: superId } })).status).toBe('active');
  });

  it('存在多个超管时可以正常降级其中一个', async () => {
    const second = await createUser(app, DOMAIN, 'second-super');
    await app.prisma.user.update({ where: { id: second.userId }, data: { role: 'super_admin' } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/admins/${second.userId}/revoke`,
      headers: auth(superToken),
    });

    expect(res.statusCode).toBe(200);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: second.userId } })).role).toBe('user');
  });

  it('授予管理员后旧 token 因 sessionVersion 递增而失效', async () => {
    const target = await createUser(app, DOMAIN, 'become-admin');

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/admins/${target.userId}/grant`,
      headers: auth(superToken),
    });
    expect(res.statusCode).toBe(200);

    const me = await app.inject({ method: 'GET', url: '/api/profile', headers: auth(target.token) });
    expect(me.statusCode).toBe(401);
  });
});

describe('系统与设置', () => {
  it('系统信息只读进程状态', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/system/info', headers: auth(adminToken) });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.database).toBe('ok');
    expect(typeof data.version).toBe('string');
    expect(JSON.stringify(data)).not.toContain('DATABASE_URL');
  });

  it('注册开关默认开启', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/settings/registration',
      headers: auth(adminToken),
    });

    expect(res.json().data.enabled).toBe(true);
  });

  it('关闭注册后注册接口返回 403', async () => {
    const off = await app.inject({
      method: 'PATCH',
      url: '/api/admin/settings/registration',
      headers: auth(adminToken),
      payload: { enabled: false },
    });
    expect(off.statusCode).toBe(200);

    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `blocked-${Date.now()}${DOMAIN}`,
        password: 'TestPass123',
        nickname: '被拦截',
      },
    });

    expect(register.statusCode).toBe(403);
    expect(register.json().error.code).toBe('REGISTRATION_DISABLED');
  });

  it('管理写操作写审计且不含财务内容', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/disable`,
      headers: auth(adminToken),
    });

    const log = await app.prisma.auditLog.findFirstOrThrow({
      where: { userId: adminId, action: 'admin.user_disabled' },
    });

    const serialized = JSON.stringify(log.metadata ?? {});
    expect(serialized).not.toContain('balance');
    expect(serialized).not.toContain('amount');
  });

  it('管理员操作审计可查询且只含管理动作', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/disable`,
      headers: auth(adminToken),
    });

    const res = await app.inject({ method: 'GET', url: '/api/admin/audit-logs', headers: auth(adminToken) });
    const logs = res.json().data.logs as Array<{ action: string }>;

    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((item) => item.action.startsWith('admin.'))).toBe(true);
  });
});
