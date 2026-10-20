import { describe, expect, it } from 'vitest';
import { buildApp } from '@/app';

describe('系统接口', () => {
  it('健康检查不依赖数据库即可返回 200', async () => {
    const app = await buildApp({ withPrisma: false, withRedis: false });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/system/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe('ok');
    } finally {
      await app.close();
    }
  });

  it('就绪检查在依赖不可用时返回 503', async () => {
    const app = await buildApp({ withPrisma: false, withRedis: false });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/system/ready' });
      expect(res.statusCode).toBe(503);
      expect(res.json().data.status).toBe('not_ready');
    } finally {
      await app.close();
    }
  });

  it('未知路由返回统一的 404 结构', async () => {
    const app = await buildApp({ withPrisma: false, withRedis: false });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.meta.requestId).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  it('能力声明包含 Phase 1 可用与计划能力', async () => {
    const app = await buildApp({ withPrisma: false, withRedis: false });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/system/capabilities' });
      const body = res.json();
      expect(body.data.phase).toBe('phase-1');
      expect(body.data.available).toContain('transactions');
      expect(body.data.planned).toContain('monte-carlo');
    } finally {
      await app.close();
    }
  });
});
