import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnMapping } from '@/lib/imports';
import DateFormatPicker from './DateFormatPicker';

type FieldKey = Exclude<keyof ColumnMapping, 'amountMode' | 'dateFormat'>;

const FIELD_KEYS: Array<{ key: FieldKey; required?: boolean }> = [
  { key: 'occurredAt', required: true },
  { key: 'amount' },
  { key: 'debit' },
  { key: 'credit' },
  { key: 'currency' },
  { key: 'description' },
  { key: 'merchant' },
  { key: 'externalId' },
  { key: 'balanceAfter' },
];

const PRIMARY: FieldKey[] = ['occurredAt', 'amount', 'debit', 'credit', 'description', 'merchant'];
const SECONDARY: FieldKey[] = ['currency', 'externalId', 'balanceAfter'];

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
  const { t } = useTranslation('imports');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const visibleFields = useMemo(
    () =>
      FIELD_KEYS.filter(({ key }) => {
        if (key === 'amount') return mapping.amountMode === 'signed';
        if (key === 'debit' || key === 'credit') return mapping.amountMode === 'debitCredit';
        return true;
      }),
    [mapping.amountMode],
  );

  function setColumn(key: FieldKey, value: string) {
    const next: ColumnMapping = { ...mapping };
    if (value === '') delete next[key];
    else next[key] = Number(value);
    onChange(next);
  }

  const renderField = ({ key, required }: (typeof FIELD_KEYS)[number]) => (
    <div key={key} className="space-y-1">
      <label htmlFor={`map-${key}`} className="block text-sm">
        {t(`mapping.fields.${key}`)}
        {required && <span className="ml-1 text-[var(--color-negative)]">*</span>}
      </label>
      <select
        id={`map-${key}`}
        value={mapping[key] === undefined ? '' : String(mapping[key])}
        onChange={(event) => setColumn(key, event.target.value)}
        className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
      >
        <option value="">{t('mapping.unmapped')}</option>
        {headers.map((header, index) => (
          <option key={`${header}-${index}`} value={index}>
            {header || t('mapping.column', { index: index + 1 })}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <span className="block text-sm">{t('mapping.amount_mode')}</span>
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
                {mode === 'signed' ? t('mapping.signed') : t('mapping.debit_credit')}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <span className="block text-sm">{t('mapping.date_format')}</span>
          <DateFormatPicker
            value={mapping.dateFormat}
            sample={dateSample}
            onChange={(value) => onChange({ ...mapping, dateFormat: value })}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {visibleFields.filter((f) => PRIMARY.includes(f.key)).map(renderField)}
      </div>

      <button
        type="button"
        onClick={() => setAdvancedOpen((open) => !open)}
        className="text-sm text-[var(--color-accent)]"
      >
        {advancedOpen ? t('mapping.collapse_optional') : t('mapping.expand_optional')}
      </button>

      {advancedOpen && (
        <div className="grid gap-3 sm:grid-cols-2">
          {visibleFields.filter((f) => SECONDARY.includes(f.key)).map(renderField)}
        </div>
      )}
    </div>
  );
}
