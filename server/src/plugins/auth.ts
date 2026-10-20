import type { UserRole } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { verifyAccessToken } from '../lib/auth.js';
import { errors } from '../lib/errors.js';

export interface AuthContext {
  userId: string;
  role: UserRole;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice(7);
  }
  return null;
}

async function authPlugin(app: FastifyInstance) {
  app.decorateRequest('auth');

  app.decorate('authenticate', async (request: FastifyRequest) => {
    const token = extractToken(request);
    if (!token) {
      throw errors.unauthorized();
    }

    let payload;
    try {
      payload = await verifyAccessToken(token);
    } catch {
      throw errors.unauthorized();
    }

    const user = await app.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, status: true, sessionVersion: true },
    });

    // 用户不存在、被禁用或会话版本已递增时，旧令牌立即失效
    if (!user || user.status !== 'active') {
      throw errors.unauthorized();
    }

    if (user.sessionVersion !== payload.sv) {
      throw errors.unauthorized();
    }

    request.auth = {
      userId: user.id,
      role: user.role,
      sessionId: payload.sessionId,
    };
  });
}

export default fp(authPlugin, { name: 'auth' });

/** 路由内部取认证上下文，缺失即为编程错误而非用户错误 */
export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) {
    throw errors.unauthorized();
  }
  return request.auth;
}
