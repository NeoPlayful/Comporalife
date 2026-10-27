import Modal from '@/components/ui/Modal';
import SwitchRow from '@/components/ui/SwitchRow';
import type {
  RateProviderConfigView,
  RateProviderId,
  RateProviderStatus,
  RateSyncFrequency,
  RateSyncSettings,
} from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { CheckCircle2, Info, RefreshCw, TriangleAlert, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const FREQUENCY_ORDER: RateSyncFrequency[] = ['hourly', 'daily', 'weekly'];
const PROVIDER_ORDER: RateProviderId[] = ['exchangerate-api', 'openexchangerates', 'custom'];

/** 哪些数据源必须填密钥：与后端 RATE_PROVIDER_REQUIRES_KEY 对齐 */
const REQUIRES_KEY: Record<RateProviderId, boolean> = {
  'exchangerate-api': false,
  openexchangerates: true,
  custom: false,
};

export interface SyncDrawerSave {
  enabled: boolean;
  frequency: RateSyncFrequency;
  provider: RateProviderId;
  anchorCurrency: string;
  /** 省略表示不改密钥 */
  apiKey?: string;
  customUrl: string;
  ratesPath: string;
  datePath: string;
}

/**
 * 汇率同步设置（右侧抽屉）。
 *
 * 两部分合在一个抽屉里：同步策略（开关 + 频率）与数据源（预设 + 密钥 + 自定义
 * 地址）。分开会让人以为它们是两个独立的决定，实际上「能不能同步」同时取决于
 * 两者——开关开着但没有数据源，依然不会跑。
 *
 * 密钥的三态在界面上体现为「留空不改 / 输入替换 / 勾选清除」，而不是给一个
 * 预填了星号的输入框：把密文回填到表单里，等于让每次保存都把密文当成新密钥
 * 再加密一遍。
 *
 * 全部字段都是草稿态，点保存才一起提交。开关单独即时提交会让「改完数据源再关掉」
 * 变成两次不可预期的写入。
 */
export default function RateSyncDrawer({
  open,
  settings,
  provider,
  config,
  canEdit,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  settings: RateSyncSettings | null;
  provider: RateProviderStatus | null;
  config: RateProviderConfigView | null;
  /** 仅超级管理员可改数据源：密钥被改掉等同于把全站折算引向外部 */
  canEdit: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (next: SyncDrawerSave) => void;
}) {
  const { t } = useTranslation('admin');

  const [enabled, setEnabled] = useState(false);
  const [frequency, setFrequency] = useState<RateSyncFrequency>('daily');
  const [providerId, setProviderId] = useState<RateProviderId>('exchangerate-api');
  const [anchorCurrency, setAnchorCurrency] = useState('USD');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [customUrl, setCustomUrl] = useState('');
  const [ratesPath, setRatesPath] = useState('rates');
  const [datePath, setDatePath] = useState('');

  // 每次打开都以服务端当前值为准，避免上次未保存的草稿残留
  useEffect(() => {
    if (!open || !settings) return;
    setEnabled(settings.enabled);
    setFrequency(settings.frequency);
    setApiKey('');
    setClearKey(false);
  }, [open, settings]);

  useEffect(() => {
    if (!open || !config) return;
    setProviderId(config.provider);
    setAnchorCurrency(config.anchorCurrency);
    setCustomUrl(config.customUrl);
    setRatesPath(config.ratesPath || 'rates');
    setDatePath(config.datePath);
  }, [open, config]);

  const lastRun = provider?.lastRun;
  const autoDisabled = provider?.disabledReason === 'consecutive_failures' && !settings?.enabled;

  const providerChanged = config !== null && config.provider !== providerId;
  const anchorChanged = config !== null && config.anchorCurrency !== anchorCurrency;
  const customUrlChanged = config !== null && config.customUrl !== customUrl;
  const pathsChanged =
    config !== null && (config.ratesPath !== (ratesPath || 'rates') || config.datePath !== datePath);
  const keyChanged = apiKey.trim().length > 0 || clearKey;

  const strategyDirty =
    settings !== null && (settings.enabled !== enabled || settings.frequency !== frequency);
  const sourceDirty =
    providerChanged || anchorChanged || customUrlChanged || pathsChanged || keyChanged;
  const dirty = strategyDirty || sourceDirty;

  /**
   * 数据库里从来没有这一行配置。
   *
   * 此时表单上显示的都是服务端给的默认值，与「当前值」逐字段比较必然相等，
   * 于是 dirty 恒为 false、保存按钮永远点不动，而开关又因为没有可用数据源
   * 被禁用——界面自己把自己锁死了。没配置过本身就是一种「可以保存」的状态。
   */
  const needsInitialSetup = config?.source === 'none';

  const needsKey = REQUIRES_KEY[providerId];
  const willHaveKey = clearKey
    ? false
    : apiKey.trim().length > 0
      ? true
      : (config?.keyConfigured ?? false);
  const customUrlOk = providerId !== 'custom' || customUrl.trim().startsWith('https://');
  const keyOk = !needsKey || willHaveKey;
  // 首次建立配置本身就是一次数据源写入，只有超管能做；按钮不能显示成可点
  const canSubmit = (dirty || (needsInitialSetup && canEdit)) && customUrlOk && keyOk;

  /**
   * 开关能否操作。
   *
   * 开启自动同步的前提是有可用数据源。未配置时只有超管能在这一次保存里把它
   * 建起来，普通管理员即使打开开关也只会得到一个永远不会跑的开关。
   */
  const canToggle = canEdit || (provider?.configured ?? false);

  const frequencyLabel = (value: RateSyncFrequency) =>
    t(`exchangeRates.sync.frequency.${value}`);
  const frequencyHint = (value: RateSyncFrequency) =>
    t(`exchangeRates.syncDrawer.frequency_hint.${value}`);

  const keyPlaceholder = (config?.keyConfigured ?? false)
    ? t('exchangeRates.syncDrawer.key_keep_placeholder', { hint: config?.keyHint ?? '' })
    : needsKey
      ? t('exchangeRates.syncDrawer.key_required_placeholder')
      : t('exchangeRates.syncDrawer.key_optional_placeholder');

  return (
    <Modal
      open={open}
      variant="drawer"
      size="md"
      title={t('exchangeRates.syncDrawer.title')}
      description={t('exchangeRates.syncDrawer.subtitle')}
      dirty={dirty}
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
          >
            {t('exchangeRates.syncDrawer.cancel')}
          </button>
          <button
            type="button"
            disabled={saving || !canSubmit}
            onClick={() =>
              onSave({
                enabled,
                frequency,
                provider: providerId,
                anchorCurrency,
                // 留空且未勾选清除时不传字段，保持服务端现有密钥
                ...(apiKey.trim().length > 0
                  ? { apiKey: apiKey.trim() }
                  : clearKey
                    ? { apiKey: '' }
                    : {}),
                customUrl: customUrl.trim(),
                ratesPath: ratesPath.trim(),
                datePath: datePath.trim(),
              })
            }
            className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? t('exchangeRates.syncDrawer.saving') : t('exchangeRates.syncDrawer.save')}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {/* 说明条：先说清自动同步的边界，避免管理员以为它会覆盖自己刚补录的值 */}
        <div className="flex items-start gap-2 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-3 py-2.5">
          <Info className="mt-0.5 size-4 shrink-0 text-[var(--color-accent)]" aria-hidden />
          <p className="text-xs text-[var(--color-content)]">
            {t('exchangeRates.syncDrawer.scope_hint')}
          </p>
        </div>

        {!canEdit && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2.5">
            <Info className="mt-0.5 size-4 shrink-0 text-[var(--color-content-muted)]" aria-hidden />
            <p className="text-xs text-[var(--color-content-muted)]">
              {t(
                needsInitialSetup
                  ? 'exchangeRates.syncDrawer.super_admin_setup_only'
                  : 'exchangeRates.syncDrawer.super_admin_only',
              )}
            </p>
          </div>
        )}

        {/* 没有可用数据源时开关一定是灰的，这里必须给出原因，否则看起来像故障 */}
        {!provider?.configured && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t('exchangeRates.syncDrawer.not_configured')}
            </p>
          </div>
        )}

        {config?.source === 'environment' && provider?.configured && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t('exchangeRates.syncDrawer.source_environment')}
            </p>
          </div>
        )}

        {/* 启用开关：草稿态，改动随底部保存一起提交 */}
        <SwitchRow
          title={t('exchangeRates.syncDrawer.enable')}
          hint={t('exchangeRates.syncDrawer.enable_hint')}
          checked={enabled}
          // 没有可用数据源时开启等于承诺一件做不到的事；未配置时由本次保存一并建好
          disabled={!canToggle}
          onCheckedChange={setEnabled}
          className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-3"
        />

        {/* 频率三选一 */}
        <div>
          <p className="text-sm font-medium">{t('exchangeRates.syncDrawer.frequency')}</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {FREQUENCY_ORDER.map((value) => (
              <button
                key={value}
                type="button"
                disabled={!enabled}
                onClick={() => setFrequency(value)}
                aria-pressed={frequency === value}
                className={`rounded-lg border px-2 py-2 text-xs transition-colors disabled:opacity-40 ${
                  frequency === value
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 font-medium text-[var(--color-accent)]'
                    : 'border-[var(--color-border-subtle)] hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                {frequencyLabel(value)}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-[var(--color-content-muted)]">
            {frequencyHint(frequency)}
          </p>
        </div>

        {/* ===== 数据源 ===== */}
        <div className="space-y-3 border-t border-[var(--color-border-subtle)] pt-4">
          <p className="text-sm font-medium">{t('exchangeRates.syncDrawer.provider_section')}</p>

          <label className="block">
            <span className="mb-1 block text-xs text-[var(--color-content-muted)]">
              {t('exchangeRates.syncDrawer.provider_label')}
            </span>
            <select
              className="input"
              value={providerId}
              disabled={!canEdit}
              onChange={(event) => setProviderId(event.target.value as RateProviderId)}
            >
              {PROVIDER_ORDER.map((value) => (
                <option key={value} value={value}>
                  {t(`exchangeRates.syncDrawer.providers.${value}`)}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-[var(--color-content-muted)]">
              {t(`exchangeRates.syncDrawer.providers.${providerId}_hint`)}
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-[var(--color-content-muted)]">
              {t('exchangeRates.syncDrawer.anchor_label')}
            </span>
            <input
              className="input"
              maxLength={3}
              value={anchorCurrency}
              disabled={!canEdit}
              onChange={(event) => setAnchorCurrency(event.target.value.toUpperCase())}
            />
            <span className="mt-1 block text-xs text-[var(--color-content-muted)]">
              {t('exchangeRates.syncDrawer.anchor_hint')}
            </span>
          </label>

          {providerId === 'custom' && (
            <>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--color-content-muted)]">
                  {t('exchangeRates.syncDrawer.custom_url_label')}
                </span>
                <input
                  className="input"
                  type="url"
                  autoComplete="off"
                  placeholder="https://example.com/api/rates"
                  value={customUrl}
                  disabled={!canEdit}
                  onChange={(event) => setCustomUrl(event.target.value)}
                />
                {!customUrlOk && (
                  <span className="mt-1 block text-xs text-[var(--color-negative)]">
                    {t('exchangeRates.syncDrawer.custom_url_invalid')}
                  </span>
                )}
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--color-content-muted)]">
                    {t('exchangeRates.syncDrawer.rates_path_label')}
                  </span>
                  <input
                    className="input font-mono"
                    value={ratesPath}
                    disabled={!canEdit}
                    onChange={(event) => setRatesPath(event.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--color-content-muted)]">
                    {t('exchangeRates.syncDrawer.date_path_label')}
                  </span>
                  <input
                    className="input font-mono"
                    placeholder={t('exchangeRates.syncDrawer.date_path_placeholder')}
                    value={datePath}
                    disabled={!canEdit}
                    onChange={(event) => setDatePath(event.target.value)}
                  />
                </label>
              </div>
            </>
          )}

          <label className="block">
            <span className="mb-1 block text-xs text-[var(--color-content-muted)]">
              {t('exchangeRates.syncDrawer.key_label')}
              {needsKey && <span className="ml-1 text-[var(--color-negative)]">*</span>}
            </span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder={keyPlaceholder}
              value={apiKey}
              disabled={!canEdit || clearKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <span className="mt-1 block text-xs text-[var(--color-content-muted)]">
              {apiKey.trim().length === 0 &&
              (config?.keyConfigured ?? false) &&
              !clearKey &&
              config?.keyHint
                ? t('exchangeRates.syncDrawer.key_configured', { hint: config.keyHint })
                : t('exchangeRates.syncDrawer.key_hint')}
            </span>
            {(config?.keyConfigured ?? false) && (
              <label className="mt-2 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={clearKey}
                  disabled={!canEdit || apiKey.trim().length > 0}
                  onChange={(event) => setClearKey(event.target.checked)}
                />
                {t('exchangeRates.syncDrawer.key_clear')}
              </label>
            )}
            {!keyOk && (
              <span className="mt-1 block text-xs text-[var(--color-negative)]">
                {t('exchangeRates.syncDrawer.key_required')}
              </span>
            )}
          </label>
        </div>

        {/* 上次与下次同步 */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2.5">
            <p className="text-xs text-[var(--color-content-muted)]">
              {t('exchangeRates.syncDrawer.last_sync')}
            </p>
            <p className="mt-1 text-xs font-medium">
              {lastRun?.finishedAt
                ? formatDateTime(lastRun.finishedAt)
                : t('exchangeRates.syncDrawer.never')}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2.5">
            <p className="text-xs text-[var(--color-content-muted)]">
              {t('exchangeRates.syncDrawer.next_sync')}
            </p>
            <p className="mt-1 text-xs font-medium">
              {enabled && provider?.nextRunAt
                ? formatDateTime(provider.nextRunAt)
                : t('exchangeRates.syncDrawer.not_scheduled')}
            </p>
          </div>
        </div>

        {/* 运行结果三态：成功 / 失败 / 停用原因 */}
        {autoDisabled && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t('exchangeRates.syncDrawer.auto_disabled')}
            </p>
          </div>
        )}

        {lastRun?.errorMessage && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--color-negative)]/40 bg-[var(--color-negative)]/10 px-3 py-2.5">
            <XCircle className="mt-0.5 size-4 shrink-0 text-[var(--color-negative)]" aria-hidden />
            <p className="text-xs text-[var(--color-negative)]">{lastRun.errorMessage}</p>
          </div>
        )}

        {lastRun && !lastRun.errorMessage && lastRun.status !== 'running' && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
            <p className="text-xs text-emerald-700 dark:text-emerald-400">
              {t('exchangeRates.syncDrawer.last_result', {
                written: lastRun.writtenRows,
                skipped: lastRun.skippedManual,
              })}
            </p>
          </div>
        )}

        {lastRun?.status === 'running' && (
          <div className="flex items-center gap-2 text-xs text-[var(--color-accent)]">
            <RefreshCw className="size-3.5 animate-spin" aria-hidden />
            {t('exchangeRates.syncDrawer.running')}
          </div>
        )}
      </div>
    </Modal>
  );
}
