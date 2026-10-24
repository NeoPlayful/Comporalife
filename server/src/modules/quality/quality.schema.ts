import { z } from 'zod';
import { QUALITY_ITEM_LIMIT } from '../../config/constants.js';

const pageSchema = {
  limit: z.coerce.number().int().min(1).max(500).default(QUALITY_ITEM_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
};

export const qualityListSchema = z.object(pageSchema);

export const missingMonthsSchema = z.object({
  months: z.coerce.number().int().min(1).max(60).default(12),
});

export const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  action: z.string().max(64).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const auditLogIdSchema = z.object({
  id: z.string().uuid('审计事件 ID 必须是 UUID'),
});
