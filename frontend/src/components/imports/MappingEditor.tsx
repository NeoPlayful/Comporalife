import { useMemo, useState } from 'react';
import type { ColumnMapping } from '@/lib/imports';
import DateFormatPicker from './DateFormatPicker';

type FieldKey = Exclude<keyof ColumnMapping, 'amountMode' | 'dateFormat'>;

const FIELD_LABELS: Array<{ key: FieldKey; label: string; required?: boolean }> = [
  { key: 'occurredAt', label: '交易日期', required: true },
  { key: 'amount', label: '金额（单列）' },
  { key: 'debit', label: '支出 / 借方' },
  { key: 'credit', label: '收入 / 贷方' },
  { key: 'currency', label: '币种' },
  { key: 'description', label: '摘要' },
  { key: 'merchant', label: '商户 / 对方' },
  { key: 'externalId', label: '流水号' },
  { key: 'balanceAfter', label: '余额' },
];

export default function MappingEditor({
  headers,
  mapping,
  onChange,
  dateSample,
}: {
  headers: string[];
  mapping: ColumnMapping;
  onChange: (mapping: ColumnMapping) => void;
  dateSample?: string | null;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const visibleFields = useMemo(
    () =>
      FIELD_LABELS.filter(({ key }) => {
        if (key === 'amount') return mapping.amountMode === 'signed';
        if (key === 'debit' || key === 'credit') return mapping.amountMode === 'debitCredit';
        return true;
      }),
    [mapping.amountMode],
  );

  const primary: FieldKey[] = ['occurredAt', 'amount', 'debit', 'credit', 'description', 'merchant'];
  const secondary: FieldKey[] = ['currency', 'externalId', 'balanceAfter'];

  function setColumn(key: FieldKey, value: string) {
    const next: ColumnMapping = { ...mapping };
    if (value === '') delete next[key];
    else next[key] = Number(value);
    onChange(next);
  }

  const renderField = ({ key, label, required }: (typeof FIELD_LABELS)[number]) => (
    <div key={key} className="space-y-1">
      <label htmlFor={`map-${key}`} className="block text-sm">
        {label}
        {required && <span className="ml-1 text-[var(--color-negative)]">*</span>}
      </label>
      <select
        id={`map-${key}`}
        value={mapping[key] === undefined ? '' : String(mapping[key])}
        onChange={(event) => setColumn(key, event.target.value)}
        className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
      >
        <option value="">未映射</option>
        {headers.map((header, index) => (
          <option key={`${header}-${index}`} value={index}>
            {header || `列 ${index + 1}`}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <span className="block text-sm">金额模式</span>
          <div className="flex gap-2">
            {(['signed', 'debitCredit'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onChange({ ...mapping, amountMode: mode })}
                className={`flex-1 rounded-lg border px-3 py-1.5 text-sm ${
                  mapping.amountMode === mode
                    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                    : 'border-[var(--color-border-subtle)] text-[var(--color-content-muted)]'
                }`}
              >
                {mode === 'signed' ? '单列有符号' : '借贷两列'}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <span className="block text-sm">日期格式</span>
          <DateFormatPicker
            value={mapping.dateFormat}
            sample={dateSample}
            onChange={(value) => onChange({ ...mapping, dateFormat: value })}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">{visibleFields.filter((f) => primary.includes(f.key)).map(renderField)}</div>

      <button
        type="button"
        onClick={() => setAdvancedOpen((open) => !open)}
        className="text-sm text-[var(--color-accent)]"
      >
        {advancedOpen ? '收起可选字段' : '展开可选字段（币种 / 流水号 / 余额）'}
      </button>

      {advancedOpen && (
        <div className="grid gap-3 sm:grid-cols-2">{visibleFields.filter((f) => secondary.includes(f.key)).map(renderField)}</div>
      )}
    </div>
  );
}
