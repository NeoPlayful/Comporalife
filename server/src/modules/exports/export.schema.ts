import { z } from 'zod';
import { EXPORT_SCOPES } from '../../config/constants.js';

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');

export const createExportSchema = z.object({
  scope: z.enum(EXPORT_SCOPES).default('full'),
  from: dateText.nullish(),
  to: dateText.nullish(),
  includeArchived: z.boolean().default(true),
  format: z.literal('csv_zip').default('csv_zip'),
});

export const exportIdSchema = z.object({
  id: z.string().uuid('导出 ID 必须是 UUID'),
});

export const exportListSchema = z.object({
  scope: z.enum(EXPORT_SCOPES).optional(),
  status: z.enum(['queued', 'running', 'ready', 'failed', 'expired']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
