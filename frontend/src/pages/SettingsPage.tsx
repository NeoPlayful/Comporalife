import type { Preferences } from '@/lib/auth';
import { api } from '@/lib/client';
import { exchangeRatesApi, type ExchangeRateRecord } from '@/lib/dashboard';
import { formatDateTime } from '@/lib/format';
import { translateError } from '@/lib/error-message';
import LoadingState from '@/components/ui/LoadingState';
import Pagination from '@/components/ui/Pagination';
import { useUiStore } from '@/stores/ui-store';
import { CURRENCY_DECIMALS } from '@/utils/constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface SettingsResponse {
  settings: Preferences;
}

const TIMEZONES = [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC',
];

const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'];

const LANGUAGE_OPTIONS = [
  { value: 'zh-CN', key: 'language.zh_CN' },
  { value: 'en-US', key: 'language.en_US' },
] as const;

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const setTheme = useUiStore((state) => state.setTheme);
  const setLanguage = useUiStore((state) => state.setLanguage);
  const { t } = useTranslation();

  const [form, setForm] = useState<Preferences | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsResponse>('/api/settings'),
  });

  useEffect(() => {
    if (settingsQuery.data && !form) {
      setForm(settingsQuery.data.settings);
    }
  }, [settingsQuery.data, form]);

  const saveSettings = useMutation({
    mutationFn: (body: Partial<Preferences>) =>
      api.patch<SettingsResponse>('/api/settings', body),
    onSuccess: (data) => {
      setForm(data.settings);
      setMessage(t('settings:saved'));
      setError(null);
      setTheme(data.settings.theme);
      setLanguage(data.settings.language);
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => {
      setMessage(null);
      setError(translateError(err, t));
    },
  });

  if (settingsQuery.isLoading || !form) {
    return <LoadingState label={t('settings:loading')} />;
  }

  if (settingsQuery.isError) {
    return <p className="text-sm text-[var(--color-negative)]">{t('settings:load_failed')}</p>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">{t('settings:title')}</h1>

      {(message || error) && (
        <p
          role="status"
          className={`rounded-lg px-3 py-2 text-sm ${
            error
              ? 'bg-[var(--color-negative)]/10 text-[var(--color-negative)]'
              : 'bg-[var(--color-positive)]/10 text-[var(--color-positive)]'
          }`}
        >
          {error ?? message}
        </p>
      )}

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-medium">{t('settings:basic')}</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--color-content-muted)]">
              {t('settings:base_currency')}
            </span>
            <select
              value={form.baseCurrency}
              onChange={(e) => setForm({ ...form, baseCurrency: e.target.value })}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            >
              {Object.keys(CURRENCY_DECIMALS).map((code) => (
                <option key={code} value={code} className="bg-[var(--color-surface-raised)]">
                  {code}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-[var(--color-content-muted)]">
              {t('settings:base_currency_hint')}
            </span>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--color-content-muted)]">
              {t('settings:timezone')}
            </span>
            <select
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz} className="bg-[var(--color-surface-raised)]">
                  {tz}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-[var(--color-content-muted)]">
              {t('settings:timezone_hint')}
            </span>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--color-content-muted)]">
              {t('settings:date_format')}
            </span>
            <select
              value={form.dateFormat}
              onChange={(e) => setForm({ ...form, dateFormat: e.target.value })}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            >
              {DATE_FORMATS.map((format) => (
                <option key={format} value={format} className="bg-[var(--color-surface-raised)]">
                  {format}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--color-content-muted)]">
              {t('settings:theme')}
            </span>
            <select
              value={form.theme}
              onChange={(e) => setForm({ ...form, theme: e.target.value as Preferences['theme'] })}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            >
              <option value="dark" className="bg-[var(--color-surface-raised)]">
                {t('enums:theme.dark')}
              </option>
              <option value="light" className="bg-[var(--color-surface-raised)]">
                {t('enums:theme.light')}
              </option>
              <option value="system" className="bg-[var(--color-surface-raised)]">
                {t('enums:theme.system')}
              </option>
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--color-content-muted)]">
              {t('settings:language')}
            </span>
            <select
              value={form.language}
              onChange={(e) =>
                setForm({ ...form, language: e.target.value as Preferences['language'] })
              }
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  className="bg-[var(--color-surface-raised)]"
                >
                  {t(`common:${option.key}`)}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-[var(--color-content-muted)]">
              {t('settings:language_hint')}
            </span>
          </label>
        </div>

        <button
          type="button"
          onClick={() =>
            saveSettings.mutate({
              baseCurrency: form.baseCurrency,
              timezone: form.timezone,
              dateFormat: form.dateFormat,
              theme: form.theme,
              language: form.language,
            })
          }
          disabled={saveSettings.isPending}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {saveSettings.isPending ? t('settings:saving') : t('settings:save')}
        </button>
      </section>

      <ExchangeRateSection />

      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-medium">{t('settings:security.title')}</h2>
        <p className="text-sm text-[var(--color-content-muted)]">
          {t('settings:security.hint')}
          <a href="/profile" className="mx-1 text-[var(--color-accent)] hover:underline">
            {t('settings:security.profile_link')}
          </a>
        </p>
        <SessionCount />
      </section>
    </div>
  );
}

function ExchangeRateSection() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [quoteCurrency, setQuoteCurrency] = useState('CNY');
  const [rate, setRate] = useState('');
  const [rateDate, setRateDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  // 就地编辑：只允许改数值，币种对与生效日期作为行的唯一键
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRate, setEditingRate] = useState('');

  const ratesQuery = useQuery({
    queryKey: ['exchange-rates', page, pageSize],
    queryFn: () => exchangeRatesApi.list({ page, pageSize }),
  });

  function invalidateRates() {
    queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
    // 汇率变动会影响净资产、现金流与数据质量的全部统计
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['analytics'] });
    queryClient.invalidateQueries({ queryKey: ['quality'] });
    queryClient.invalidateQueries({ queryKey: ['assets'] });
    queryClient.invalidateQueries({ queryKey: ['liabilities'] });
  }

  const createRate = useMutation({
    mutationFn: () => exchangeRatesApi.create({ baseCurrency, quoteCurrency, rate, rateDate }),
    onSuccess: () => {
      setRate('');
      setError(null);
      invalidateRates();
    },
    onError: (err) => setError(translateError(err, t)),
  });

  // 同键 upsert，编辑汇率直接复用新增接口
  const updateRate = useMutation({
    mutationFn: (record: ExchangeRateRecord) =>
      exchangeRatesApi.create({
        baseCurrency: record.baseCurrency,
        quoteCurrency: record.quoteCurrency,
        rate: editingRate,
        rateDate: record.rateDate.slice(0, 10),
      }),
    onSuccess: () => {
      setEditingId(null);
      setEditingRate('');
      setError(null);
      invalidateRates();
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const deleteRate = useMutation({
    mutationFn: (id: string) => exchangeRatesApi.remove(id),
    onSuccess: () => {
      // 删掉当页最后一条时回退一页，避免停在空页
      if ((ratesQuery.data?.exchangeRates.length ?? 0) === 1 && page > 1) {
        setPage(page - 1);
      }
      invalidateRates();
    },
  });

  const codes = Object.keys(CURRENCY_DECIMALS);
  const rates = ratesQuery.data?.exchangeRates ?? [];
  const pagination = ratesQuery.data?.pagination ?? null;

  return (
    <section className="card space-y-3 p-5">
      <h2 className="text-sm font-medium">{t('settings:exchange_rates.title')}</h2>
      <p className="text-xs text-[var(--color-content-muted)]">
        {t('settings:exchange_rates.description')}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (rate.trim()) createRate.mutate();
        }}
        className="grid gap-2 sm:grid-cols-5"
      >
        <select
          value={baseCurrency}
          onChange={(e) => setBaseCurrency(e.target.value)}
          className="input"
          aria-label={t('settings:exchange_rates.base_currency')}
        >
          {codes.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <select
          value={quoteCurrency}
          onChange={(e) => setQuoteCurrency(e.target.value)}
          className="input"
          aria-label={t('settings:exchange_rates.quote_currency')}
        >
          {codes.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <input
          required
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          placeholder={t('settings:exchange_rates.rate')}
          className="input"
          aria-label={t('settings:exchange_rates.rate')}
        />
        <input
          required
          type="date"
          value={rateDate}
          onChange={(e) => setRateDate(e.target.value)}
          className="input"
          aria-label={t('settings:exchange_rates.effective_date')}
        />
        <button
          type="submit"
          disabled={!rate.trim() || createRate.isPending}
          className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {t('settings:exchange_rates.add')}
        </button>
      </form>

      {error && <p className="text-sm text-[var(--color-negative)]">{error}</p>}

      {ratesQuery.data && rates.length === 0 && (
        <p className="text-sm text-[var(--color-content-muted)]">
          {t('settings:exchange_rates.empty')}
        </p>
      )}

      {rates.length > 0 && (
        <ul className="divide-y divide-[var(--color-border-subtle)]">
          {rates.map((record) => {
            const editing = editingId === record.id;
            return (
              <li key={record.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className="whitespace-nowrap">
                    1 {record.baseCurrency} =
                  </span>
                  {editing ? (
                    <input
                      autoFocus
                      inputMode="decimal"
                      value={editingRate}
                      onChange={(event) => setEditingRate(event.target.value)}
                      className="input w-32 py-1 font-mono text-sm"
                      aria-label={t('settings:exchange_rates.rate')}
                    />
                  ) : (
                    <span className="font-mono">{Number(record.rate).toFixed(6)}</span>
                  )}
                  <span className="whitespace-nowrap">{record.quoteCurrency}</span>
                </span>

                <span className="flex items-center gap-3 text-xs text-[var(--color-content-muted)]">
                  {record.rateDate.slice(0, 10)}
                  {editing ? (
                    <>
                      <button
                        type="button"
                        disabled={!editingRate.trim() || updateRate.isPending}
                        onClick={() => updateRate.mutate(record)}
                        className="text-[var(--color-accent)] disabled:opacity-50"
                      >
                        {t('settings:exchange_rates.save')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null);
                          setEditingRate('');
                        }}
                      >
                        {t('settings:exchange_rates.cancel')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(record.id);
                          setEditingRate(Number(record.rate).toString());
                        }}
                        className="hover:text-[var(--color-accent)]"
                      >
                        {t('settings:exchange_rates.edit')}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRate.mutate(record.id)}
                        className="hover:text-[var(--color-negative)]"
                      >
                        {t('settings:exchange_rates.delete')}
                      </button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {pagination && (
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          pageSizeOptions={[10, 20, 50]}
        />
      )}
    </section>
  );
}

function SessionCount() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['settings', 'security'],
    queryFn: () =>
      api.get<{ activeSessionCount: number; lastLoginAt: string | null }>('/api/settings/security'),
  });

  if (query.isLoading) return <p className="text-xs text-[var(--color-content-muted)]">{t('common:actions.loading')}</p>;
  if (!query.data) return null;

  return (
    <p className="text-xs text-[var(--color-content-muted)]">
      {t('settings:security.session_count', { count: query.data.activeSessionCount })}
      {query.data.lastLoginAt &&
        ` · ${t('settings:security.last_login', { time: formatDateTime(query.data.lastLoginAt) })}`}
    </p>
  );
}
