import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { AppError, ErrorCode } from '../lib/errors.js';

async function errorHandlerPlugin(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      success: false,
      error: { code: ErrorCode.NOT_FOUND, message: '资源不存在' },
      meta: { requestId: request.id },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          params: error.params,
        },
        meta: { requestId },
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: '参数校验失败',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        meta: { requestId },
      });
    }

    const fastifyError = error as { validation?: unknown; statusCode?: number };

    if (fastifyError.validation) {
      return reply.status(400).send({
        success: false,
        error: { code: ErrorCode.VALIDATION_ERROR, message: '参数校验失败' },
        meta: { requestId },
      });
    }

    if (fastifyError.statusCode === 429) {
      return reply.status(429).send({
        success: false,
        error: { code: ErrorCode.RATE_LIMITED, message: '请求过于频繁，请稍后重试' },
        meta: { requestId },
      });
    }

    // multipart 超过 fileSize 限制时插件抛出 413，统一转换成本项目的错误码
    if (fastifyError.statusCode === 413) {
      return reply.status(413).send({
        success: false,
        error: {
          code: ErrorCode.IMPORT_FILE_TOO_LARGE,
          message: `文件超过 ${env.IMPORT_MAX_FILE_MB} MB 上限`,
        },
        meta: { requestId },
      });
    }

    // Fastify 自身的客户端错误（空 JSON body、不支持的 content-type 等）
    // 属于调用方问题，不能被包装成 500，否则前端会把参数错误当成服务故障
    if (fastifyError.statusCode && fastifyError.statusCode >= 400 && fastifyError.statusCode < 500) {
      return reply.status(fastifyError.statusCode).send({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: (error as Error).message || '请求格式不合法',
        },
        meta: { requestId },
      });
    }

    request.log.error({ err: error }, '未处理的服务端异常');

    return reply.status(500).send({
      success: false,
      error: { code: ErrorCode.SYSTEM_ERROR, message: '服务内部错误' },
      meta: { requestId },
    });
  });
}

export default fp(errorHandlerPlugin, { name: 'error-handler' });
