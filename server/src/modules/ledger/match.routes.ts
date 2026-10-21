import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ok } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { requireAuth } from '../../plugins/auth.js';
import { buildCandidates, loadUnmatchedTransactions, matchTransfer, unmatchTransfer } from './match.service.js';

const unmatchedQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
});

const matchSchema = z.object({
  transactionIdA: z.string().uuid(),
  transactionIdB: z.string().uuid(),
});

const transferIdSchema = z.object({
  id: z.string().uuid('转账 ID 格式不正确'),
});

export default async function matchRoutes(app: FastifyInstance) {
  app.get('/transactions/unmatched', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = unmatchedQuerySchema.parse(request.query);

    const transactions = await loadUnmatchedTransactions(app.prisma, userId, {
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      limit: query.limit,
    });

    return ok(
      {
        transactions,
        candidates: buildCandidates(transactions),
      },
      request.id,
    );
  });

  app.post('/transfers/match', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = matchSchema.parse(request.body);

    if (body.transactionIdA === body.transactionIdB) {
      throw errors.transferMatchInvalid('不能与自己匹配');
    }

    const result = await matchTransfer(app.prisma, {
      userId,
      transactionIdA: body.transactionIdA,
      transactionIdB: body.transactionIdB,
    });

    return reply.status(201).send(ok(result, request.id));
  });

  app.post('/transfers/:id/unmatch', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = transferIdSchema.parse(request.params);

    const result = await unmatchTransfer(app.prisma, { userId, transferId: id });
    return ok(result, request.id);
  });
}
