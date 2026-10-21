import { z } from 'zod';

const textOp = z.enum(['equals', 'contains', 'startsWith']);

export const ruleConditionSchema = z
  .object({
    logic: z.enum(['all', 'any']).default('all'),
    accountIds: z.array(z.string().uuid()).max(50).optional(),
    directions: z.array(z.enum(['income', 'expense'])).max(2).optional(),
    merchant: z.object({ op: textOp, value: z.string().trim().min(1).max(100) }).optional(),
    description: z.object({ op: textOp, value: z.string().trim().min(1).max(100) }).optional(),
    amount: z
      .object({
        min: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
        max: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
      })
      .optional(),
    onlyUncategorized: z.boolean().optional(),
  })
  .strict();

export const ruleActionSchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    addTagIds: z.array(z.string().uuid()).max(20).optional(),
    markReviewed: z.boolean().optional(),
  })
  .strict();

export const createRuleSchema = z.object({
  name: z.string().trim().min(1, '规则名称不能为空').max(80),
  priority: z.number().int().min(0).max(9999).default(100),
  enabled: z.boolean().default(true),
  conditions: ruleConditionSchema,
  actions: ruleActionSchema,
});

export const updateRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    priority: z.number().int().min(0).max(9999).optional(),
    enabled: z.boolean().optional(),
    conditions: ruleConditionSchema.optional(),
    actions: ruleActionSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要修改一项字段');

export const ruleIdSchema = z.object({
  id: z.string().uuid('规则 ID 格式不正确'),
});

export const applyRulesSchema = z.object({
  transactionIds: z.array(z.string().uuid()).min(1).max(500).optional(),
  onlyUncategorized: z.boolean().default(true),
  overwrite: z.boolean().default(false),
});

export const reorderRulesSchema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), priority: z.number().int().min(0).max(9999) })).min(1).max(200),
});

export type RuleConditions = z.infer<typeof ruleConditionSchema>;
export type RuleActions = z.infer<typeof ruleActionSchema>;
