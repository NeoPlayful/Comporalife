import { z } from 'zod';
import { REPORT_FORMATS, REPORT_TITLE_MAX_LENGTH, REPORT_TYPES } from '../../config/constants.js';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');

export const createReportSchema = z.object({
  type: z.enum(REPORT_TYPES),
  from: dateString,
  to: dateString,
  title: z.string().trim().min(1).max(REPORT_TITLE_MAX_LENGTH).nullable().optional(),
  params: z.record(z.unknown()).optional(),
});

const buildOnlySchema = z.object({
  from: dateString,
  to: dateString,
  title: z.string().trim().min(1).max(REPORT_TITLE_MAX_LENGTH).nullable().optional(),
  params: z.record(z.unknown()).optional(),
});

export const netWorthReportSchema = buildOnlySchema;
export const cashflowReportSchema = buildOnlySchema;
export const analyticsReportSchema = buildOnlySchema;
export const investmentReportSchema = buildOnlySchema;
export const goalsReportSchema = buildOnlySchema;
export const simulationReportSchema = buildOnlySchema;

export const listReportsSchema = z.object({
  type: z.enum(REPORT_TYPES).optional(),
});

export const reportIdSchema = z.object({ id: z.string().uuid('报表 ID 格式不正确') });

export const downloadQuerySchema = z.object({
  format: z.enum(REPORT_FORMATS).default('csv'),
});
