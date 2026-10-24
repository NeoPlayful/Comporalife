import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { createNotification } from '@/modules/notifications/notification.service';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('notifications');

let app: FastifyInstance;
let token: string;
let userId: string;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await cleanupUsers(app, DOMAIN);
  await app.close();
});

beforeEach(async () => {
  await cleanupUsers(app, DOMAIN);
  const user = await createUser(app, DOMAIN);
  token = user.token;
  userId = user.userId;
});

describe('站内通知', () => {
  it('列表为空时未读数为 0', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.notifications).toEqual([]);
    expect(res.json().data.unreadCount).toBe(0);
  });

  it('按时间倒序返回并统计未读数', async () => {
    await createNotification(app.prisma, { userId, kind: 'export_ready', metadata: { exportId: 'a' } });
    await createNotification(app.prisma, { userId, kind: 'backup_ready', metadata: { backupId: 'b' } });

    const res = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(token) });
    const data = res.json().data;

    expect(data.notifications).toHaveLength(2);
    expect(data.unreadCount).toBe(2);
    // 最新的一条在前
    expect(data.notifications[0].kind).toBe('backup_ready');
  });

  it('标记单条已读后未读数下降', async () => {
    await createNotification(app.prisma, { userId, kind: 'export_ready' });
    const list = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(token) });
    const id = list.json().data.notifications[0].id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/notifications/${id}/read`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.unreadCount).toBe(0);
  });

  it('全部已读清空未读数', async () => {
    await createNotification(app.prisma, { userId, kind: 'export_ready' });
    await createNotification(app.prisma, { userId, kind: 'backup_ready' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/read-all',
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.marked).toBe(2);

    const list = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(token) });
    expect(list.json().data.unreadCount).toBe(0);
  });

  it('unreadOnly 只返回未读', async () => {
    await createNotification(app.prisma, { userId, kind: 'export_ready' });
    await createNotification(app.prisma, { userId, kind: 'backup_ready' });

    const list = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(token) });
    const first = list.json().data.notifications[0].id;
    await app.inject({ method: 'PATCH', url: `/api/notifications/${first}/read`, headers: auth(token) });

    const unread = await app.inject({
      method: 'GET',
      url: '/api/notifications?unreadOnly=true',
      headers: auth(token),
    });
    expect(unread.json().data.notifications).toHaveLength(1);
  });

  it('跨用户访问他人通知返回 404', async () => {
    await createNotification(app.prisma, { userId, kind: 'export_ready' });
    const list = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(token) });
    const id = list.json().data.notifications[0].id;

    const other = await createUser(app, DOMAIN, 'other');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/notifications/${id}/read`,
      headers: auth(other.token),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOTIFICATION_NOT_FOUND');
  });

  it('通知写失败不抛异常', async () => {
    // 用户不存在会触发外键错误；这里的约定是静默失败，不阻断调用方
    await expect(
      createNotification(app.prisma, {
        userId: '00000000-0000-0000-0000-000000000000',
        kind: 'export_ready',
      }),
    ).resolves.toBeUndefined();
  });
});
