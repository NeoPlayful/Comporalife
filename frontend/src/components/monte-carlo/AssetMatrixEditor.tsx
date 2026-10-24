import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ScenarioAssetInput } from '@/lib/monte-carlo';

interface Props {
  assets: ScenarioAssetInput[];
  onChange: (assets: ScenarioAssetInput[]) => void;
  maxAssets?: number;
}

/**
 * 资产权重 / 预期收益 / 波动率编辑。
 * 权重合计实时校验，不为 1 时就地提示并阻止保存。
 */
export default function AssetMatrixEditor({ assets, onChange, maxAssets = 10 }: Props) {
  const { t } = useTranslation('monte-carlo');

  const total = assets.reduce((sum, asset) => sum + (Number(asset.weight) || 0), 0);
  const valid = Math.abs(total - 1) <= 1e-6;

  const update = (index: number, patch: Partial<ScenarioAssetInput>) => {
    onChange(assets.map((asset, i) => (i === index ? { ...asset, ...patch } : asset)));
  };

  const add = () => {
    if (assets.length >= maxAssets) return;
    const remaining = Math.max(0, 1 - total);
    onChange([
      ...assets,
      {
        key: `asset-${Date.now()}`,
        label: t('asset.new_label', { index: assets.length + 1 }),
        weight: remaining.toFixed(6),
        expectedAnnualReturn: '0.070000',
        annualVolatility: '0.150000',
      },
    ]);
  };

  const remove = (index: number) => {
    if (assets.length <= 1) return;
    onChange(assets.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <div className="hidden gap-2 text-xs text-[var(--color-content-muted)] sm:grid sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
        <span>{t('asset.name')}</span>
        <span>{t('asset.weight')}</span>
        <span>{t('asset.return')}</span>
        <span>{t('asset.volatility')}</span>
        <span />
      </div>

      {/* 窄屏改为卡片布局，避免 4 个输入框被挤成不可读的宽度 */}
      <div className="flex flex-col gap-2 sm:hidden">
        {assets.map((asset, index) => (
          <div key={asset.key} className="card space-y-2 p-3">
            <div className="flex items-center gap-2">
              <input
                className="input min-w-0 flex-1"
                value={asset.label}
                onChange={(event) => update(index, { label: event.target.value })}
                aria-label={t('asset.name')}
              />
              <button
                type="button"
                className="rounded-lg p-2 text-[var(--color-content-muted)] hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
                onClick={() => remove(index)}
                disabled={assets.length <= 1}
                aria-label={t('asset.remove')}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <LabeledInput
                label={t('asset.weight')}
                value={asset.weight}
                onChange={(value) => update(index, { weight: value })}
              />
              <LabeledInput
                label={t('asset.return')}
                value={asset.expectedAnnualReturn}
                onChange={(value) => update(index, { expectedAnnualReturn: value })}
              />
              <LabeledInput
                label={t('asset.volatility')}
                value={asset.annualVolatility}
                onChange={(value) => update(index, { annualVolatility: value })}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="hidden flex-col gap-2 sm:flex">
        {assets.map((asset, index) => (
          <div
            key={asset.key}
            className="grid grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] items-center gap-2"
          >
            <input
              className="input min-w-0"
              value={asset.label}
              onChange={(event) => update(index, { label: event.target.value })}
              aria-label={t('asset.name')}
            />
            <input
              className="input min-w-0 font-mono"
              value={asset.weight}
              onChange={(event) => update(index, { weight: event.target.value })}
              aria-label={t('asset.weight')}
            />
            <input
              className="input min-w-0 font-mono"
              value={asset.expectedAnnualReturn}
              onChange={(event) => update(index, { expectedAnnualReturn: event.target.value })}
              aria-label={t('asset.return')}
            />
            <input
              className="input min-w-0 font-mono"
              value={asset.annualVolatility}
              onChange={(event) => update(index, { annualVolatility: event.target.value })}
              aria-label={t('asset.volatility')}
            />
            <button
              type="button"
              className="rounded-lg p-2 text-[var(--color-content-muted)] hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
              onClick={() => remove(index)}
              disabled={assets.length <= 1}
              aria-label={t('asset.remove')}
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm disabled:opacity-50"
          onClick={add}
          disabled={assets.length >= maxAssets}
        >
          <Plus className="size-4" aria-hidden />
          {t('asset.add')}
        </button>

        <p
          className={`text-xs font-mono ${valid ? 'text-[var(--color-content-muted)]' : 'text-amber-400'}`}
          role={valid ? undefined : 'alert'}
        >
          {t('asset.total', { total: total.toFixed(6) })}
          {!valid && ` · ${t('asset.total_invalid')}`}
        </p>
      </div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-[var(--color-content-muted)]">{label}</span>
      <input
        className="input mt-0.5 w-full font-mono text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
