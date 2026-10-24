import { z } from 'zod';
import { BACKUP_DOMAINS } from './backup.package.js';

export const createBackupSchema = z.object({
  format: z.literal('json_encrypted').default('json_encrypted'),
  // 手工汇率重建成本高，缺失会让历史折算无法复现，默认包含
  includeRates: z.boolean().default(true),
});

export const backupIdSchema = z.object({
  id: z.string().uuid('备份 ID 必须是 UUID'),
});

export const restorePreviewSchema = z.object({
  // 预览默认全部域，便于用户先看到完整影响面
  domains: z.array(z.enum(BACKUP_DOMAINS)).optional(),
});

export const restoreSchema = z.object({
  domains: z.array(z.enum(BACKUP_DOMAINS)).min(1, '至少选择一个恢复域'),
  conflict: z.enum(['skip', 'overwrite']).default('skip'),
  confirm: z.string(),
});

export const backupListSchema = z.object({
  status: z.enum(['creating', 'ready', 'failed', 'expired']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
