import type { Preferences } from '@/api/auth';
import { ApiError, api } from '@/api/client';
import { exchangeRatesApi } from '@/api/dashboard';
import LoadingState from '@/components/ui/LoadingState';
import { useUiStore } from '@/stores/ui-store';
import { CURRENCY_DECIMALS } from '@/utils/constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

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

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const setTheme = useUiStore((state) => state.setTheme);

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
      setMessage('设置已保存');
      setError(null);
      setTheme(data.settings.theme);
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => {
      setMessage(null);
      setError(err instanceof ApiError ? err.message : '保存失败');
    },
  });

  if (settingsQuery.isLoading || !form) {
    return <LoadingState label="加载设置…" />;
  }

  if (settingsQuery.isError) {
    return <p className="text-sm text-[var(--color-negative)]">设置加载失败，请刷新重试。</p>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">设置</h1>

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
        <h2 className="text-sm font-medium">基础设置</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--color-content-muted)]">基准币种</span>
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
              所有多币种统计都会折算到该币种
            </span>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--color-content-muted)]">时区</span>
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
              月度统计按此时区划分自然月
            </span>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--color-content-muted)]">日期格式</span>
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
            <span className="mb-1 block text-[var(--color-content-muted)]">主题</span>
            <select
              value={form.theme}
              onChange={(e) => setForm({ ...form, theme: e.target.value as Preferences['theme'] })}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            >
              <option value="dark" className="bg-[var(--color-surface-raised)]">
                深色
              </option>
              <option value="light" className="bg-[var(--color-surface-raised)]">
                浅色
              </option>
              <option value="system" className="bg-[var(--color-surface-raised)]">
                跟随系统
              </option>
            </select>
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
            })
          }
          disabled={saveSettings.isPending}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {saveSettings.isPending ? '保存中…' : '保存设置'}
        </button>
      </section>

      <ExchangeRateSection />

      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-medium">账户安全</h2>
        <p className="text-sm text-[var(--color-content-muted)]">
          查看登录设备、修改密码请前往
          <a href="/profile" className="ml-1 text-[var(--color-accent)] hover:underline">
            个人资料
          </a>
          。
        </p>
        <SessionCount />
      </section>
    </div>
  );
}

function ExchangeRateSection() {
  const queryClient = useQueryClient();
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [quoteCurrency, setQuoteCurrency] = useState('CNY');
  const [rate, setRate] = useState('');
  const [rateDate, setRateDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const ratesQuery = useQuery({
    queryKey: ['exchange-rates'],
    queryFn: exchangeRatesApi.list,
  });

  const createRate = useMutation({
    mutationFn: () => exchangeRatesApi.create({ baseCurrency, quoteCurrency, rate, rateDate }),
    onSuccess: () => {
      setRate('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '保存失败'),
  });

  const deleteRate = useMutation({
    mutationFn: (id: string) => exchangeRatesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const codes = Object.keys(CURRENCY_DECIMALS);

  return (
    <section className="card space-y-3 p-5">
      <h2 className="text-sm font-medium">手工汇率</h2>
      <p className="text-xs text-[var(--color-content-muted)]">
        多币种账户折算到基准币种时需要汇率。缺失汇率时相关账户会从净资产中排除，而不是按 1:1 计算。
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (rate.trim()) createRate.mutate();
        }}
        className="grid gap-2 sm:grid-cols-5"
      >
        <select value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)} className="input" aria-label="基准币种">
          {codes.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <select value={quoteCurrency} onChange={(e) => setQuoteCurrency(e.target.value)} className="input" aria-label="计价币种">
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
          placeholder="汇率"
          className="input"
          aria-label="汇率"
        />
        <input
          required
          type="date"
          value={rateDate}
          onChange={(e) => setRateDate(e.target.value)}
          className="input"
          aria-label="生效日期"
        />
        <button
          type="submit"
          disabled={!rate.trim() || createRate.isPending}
          className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          添加
        </button>
      </form>

      {error && <p className="text-sm text-[var(--color-negative)]">{error}</p>}

      {ratesQuery.data && ratesQuery.data.exchangeRates.length === 0 && (
        <p className="text-sm text-[var(--color-content-muted)]">暂无手工汇率记录</p>
      )}

      {ratesQuery.data && ratesQuery.data.exchangeRates.length > 0 && (
        <ul className="divide-y divide-[var(--color-border-subtle)]">
          {ratesQuery.data.exchangeRates.map((record) => (
            <li key={record.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                1 {record.baseCurrency} = {Number(record.rate).toFixed(6)} {record.quoteCurrency}
              </span>
              <span className="flex items-center gap-3 text-xs text-[var(--color-content-muted)]">
                {record.rateDate.slice(0, 10)}
                <button
                  type="button"
                  onClick={() => deleteRate.mutate(record.id)}
                  className="hover:text-[var(--color-negative)]"
                >
                  删除
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SessionCount() {
  const query = useQuery({
    queryKey: ['settings', 'security'],
    queryFn: () =>
      api.get<{ activeSessionCount: number; lastLoginAt: string | null }>('/api/settings/security'),
  });

  if (query.isLoading) return <p className="text-xs text-[var(--color-content-muted)]">加载中…</p>;
  if (!query.data) return null;

  return (
    <p className="text-xs text-[var(--color-content-muted)]">
      当前有 {query.data.activeSessionCount} 个活跃会话
      {query.data.lastLoginAt &&
        ` · 最近登录 ${new Date(query.data.lastLoginAt).toLocaleString('zh-CN')}`}
    </p>
  );
}
