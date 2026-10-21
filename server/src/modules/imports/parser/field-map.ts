import { normalizeDescription } from './fingerprint.js';

/**
 * 字段同义词表与自动推断。
 * 推断结果只是候选，前端必须展示并让用户确认，不静默使用。
 */

export type CanonicalField =
  | 'occurredAt'
  | 'amount'
  | 'debit'
  | 'credit'
  | 'direction'
  | 'currency'
  | 'description'
  | 'merchant'
  | 'externalId'
  | 'balanceAfter';

export const FIELD_SYNONYMS: Record<CanonicalField, string[]> = {
  occurredAt: ['日期', '交易日期', '记账日期', '发生日期', '交易时间', '时间', 'date', 'transactiondate', 'postingdate'],
  amount: ['金额', '交易金额', '发生额', '交易额', 'amount'],
  debit: ['支出', '借方', '借方金额', '付款', '转出', 'debit', 'withdrawal'],
  credit: ['收入', '贷方', '贷方金额', '收款', '转入', 'credit', 'deposit'],
  direction: ['方向', '收支', '借贷', '借贷标志', '收付标志', 'direction', 'type'],
  currency: ['币种', '货币', '交易币种', 'currency', 'ccy'],
  description: ['摘要', '备注', '交易说明', '用途', '交易摘要', 'description', 'memo', 'narrative'],
  merchant: ['商户', '对方户名', '交易对方', '对手方', '对方名称', 'merchant', 'payee'],
  externalId: ['流水号', '交易号', '交易编号', '参考号', '凭证号', '业务流水号', 'reference', 'transactionid'],
  balanceAfter: ['余额', '账户余额', '交易后余额', '可用余额', 'balance'],
};

const FIELD_PRIORITY: CanonicalField[] = [
  'occurredAt',
  'externalId',
  'debit',
  'credit',
  'amount',
  'direction',
  'currency',
  'merchant',
  'description',
  'balanceAfter',
];

export interface FieldSuggestion {
  field: CanonicalField;
  columnIndex: number;
  header: string;
  /** 精确匹配置信度高，包含匹配需要用户确认 */
  exact: boolean;
}

/**
 * 按优先级为每个规范字段挑选一个尚未占用的列。
 * 先完整匹配再包含匹配，避免「交易金额」抢走本应属于 amount 的列。
 */
export function suggestMapping(headers: string[]): FieldSuggestion[] {
  const normalizedHeaders = headers.map((header) => normalizeDescription(header));
  const used = new Set<number>();
  const suggestions: FieldSuggestion[] = [];

  for (const pass of ['exact', 'contains'] as const) {
    for (const field of FIELD_PRIORITY) {
      if (suggestions.some((item) => item.field === field)) continue;

      const synonyms = FIELD_SYNONYMS[field].map((item) => normalizeDescription(item));

      for (let index = 0; index < normalizedHeaders.length; index += 1) {
        if (used.has(index)) continue;
        const header = normalizedHeaders[index]!;
        if (header.length === 0) continue;

        const hit =
          pass === 'exact'
            ? synonyms.includes(header)
            : synonyms.some((synonym) => header.includes(synonym) || synonym.includes(header));

        if (hit) {
          used.add(index);
          suggestions.push({ field, columnIndex: index, header: headers[index] ?? '', exact: pass === 'exact' });
          break;
        }
      }
    }
  }

  return suggestions;
}
