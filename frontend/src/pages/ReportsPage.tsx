import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { ApiError } from '@/lib/client';
import { translateError } from '@/lib/error-message';
import { formatDateTime, formatNumber } from '@/lib/format';
import { reportsApi, type ReportDetail, type ReportType } from '@/lib/goals';
import { useAuthStore } from '@/stores/auth-store';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const REPORT_TYPES: ReportType[] = ['net_worth', 'cashflow', 'analytics', 'investment', 'goals', 'simulation'];

function firstDayOfYear(): string {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 通过原生 fetch 拿 Blob，才能携带 Authorization 头；<a download> 不会带自定义头 */
async function downloadBlob(id: string, format: 'csv' | 'xlsx', accessToken: string | null) {
  const response = await fetch(reportsApi.downloadUrl(id, format), {
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });

  if (!response.ok) {
    let message = '下载失败';
    try {
      const payload = (await response.json()) as { error?: { code?: string; message?: string } };
      message = payload.error?.message ?? message;
    } catch {
      // 非 JSON 响应时保留默认文案
    }
    throw new Error(message);
  }

  const disposition = response.headers.get('content-disposition') ?? '';
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const asciiMatch = disposition.match(/filename="([^"]+)"/i);

  // 优先使用 RFC 5987 的中文名；解码失败退回 ASCII 名
  let filename = asciiMatch?.[1] ?? `report.${format}`;
  if (utf8Match?.[1]) {
    try {
      filename = decodeURIComponent(utf8Match[1]);
    } catch {
      // 保留 ASCII 回退名
    }
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  return blob.size;
}

export default function ReportsPage() {
  const { t } = useTranslation('reports');
  const queryClient = useQueryClient();

  const [type, setType] = useState<ReportType>('cashflow');
  const [from, setFrom] = useState(firstDayOfYear);
  const [to, setTo] = useState(today);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const listQuery = useQuery({ queryKey: ['reports'], queryFn: () => reportsApi.list(), retry: false });

  useEffect(() => {
    if (selectedId || !listQuery.data) return;
    const first = listQuery.data.reports[0];
    if (first) setSelectedId(first.id);
  }, [listQuery.data, selectedId]);

  const detailQuery = useQuery({
    queryKey: ['reports', 'detail', selectedId],
    queryFn: () => reportsApi.detail(selectedId!),
    enabled: Boolean(selectedId),
    retry: false,
    // 接口把详情包在 report 字段里，统一在这里摊平，页面只消费一份结构
    select: (payload) => payload.report,
  });

  const dataQuery = useQuery({
    queryKey: ['reports', 'data', selectedId],
    queryFn: () => reportsApi.data(selectedId!),
    enabled: Boolean(selectedId),
    retry: false,
  });

  const generateMutation = useMutation({
    mutationFn: () => reportsApi.create({ type, from, to }),
    onSuccess: (result) => {
      setSelectedId(result.report.id);
      setError(null);
      setNotice(t('notice.generated', { rows: result.report.rowCount }));
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: (err) => {
      setNotice(null);
      setError(translateError(err, t));
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: () => reportsApi.regenerate(selectedId!),
    onSuccess: (result) => {
      setError(null);
      setNotice(t('notice.regenerated', { rows: result.report.rowCount }));
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => reportsApi.remove(selectedId!),
    onSuccess: () => {
      setSelectedId(null);
      setNotice(null);
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const handleDownload = async (format: 'csv' | 'xlsx') => {
    if (!selectedId) return;
    setDownloading(true);
    setError(null);
    setNotice(null);

    try {
      // 令牌保存在内存中的认证 store，不落盘
      const bytes = await downloadBlob(selectedId, format, useAuthStore.getState().accessToken);
      setNotice(
        t('notice.downloaded', {
          format: format.toUpperCase(),
          rows: detailQuery.data?.rowCount ?? 0,
          size: formatNumber(Math.max(1, Math.round(bytes / 1024)), { maximumFractionDigits: 0 }),
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? translateError(err, t) : t('notice.download_failed'));
    } finally {
      setDownloading(false);
    }
  };

  const basis = detailQuery.data?.basis;
  const data = dataQuery.data?.data;
  const preview = useMemo(() => buildPreview(detailQuery.data?.type ?? type, data), [data, detailQuery.data?.type, type]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <header>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-[var(--color-content-muted)]">{t('subtitle')}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <aside className="space-y-3">
          <div className="card space-y-2 p-3">
            <label className="block text-xs text-[var(--color-content-muted)]">
              {t('builder.type')}
              <select value={type} onChange={(event) => setType(event.target.value as ReportType)} className="input mt-1">
                {REPORT_TYPES.map((item) => (
                  <option key={item} value={item}>
                    {t(`types.${item}`)}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-[var(--color-content-muted)]">
                {t('builder.from')}
                <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="input mt-1" />
              </label>
              <label className="block text-xs text-[var(--color-content-muted)]">
                {t('builder.to')}
                <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="input mt-1" />
              </label>
            </div>

            <button
              type="button"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="w-full rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {generateMutation.isPending ? t('builder.generating') : t('builder.generate')}
            </button>

            <p className="text-[11px] text-[var(--color-content-muted)]">{t('builder.snapshot_hint')}</p>
          </div>

          {listQuery.isLoading && <LoadingState />}
          {listQuery.data?.reports.length === 0 && (
            <EmptyState title={t('empty.title')} description={t('empty.description')} />
          )}

          <ul className="space-y-2">
            {(listQuery.data?.reports ?? []).map((report) => (
              <li key={report.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(report.id);
                    setNotice(null);
                    setError(null);
                  }}
                  className={`flex w-full items-start gap-2 rounded-xl border p-3 text-left transition-colors ${
                    report.id === selectedId
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
                      : 'border-[var(--color-border-subtle)] hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  <FileText className="mt-0.5 size-4 shrink-0 text-[var(--color-content-muted)]" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{report.title}</p>
                    <p className="truncate text-xs text-[var(--color-content-muted)]">
                      {report.rangeFrom} ~ {report.rangeTo}
                    </p>
                    <p className="truncate text-[11px] text-[var(--color-content-muted)]">
                      {t('list.rows', { rows: report.rowCount })} · {formatDateTime(report.generatedAt)}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="space-y-4">
          {(error || notice) && (
            <div
              role="status"
              className={`rounded-lg px-3 py-2 text-sm ${
                error ? 'bg-[var(--color-negative)]/10 text-[var(--color-negative)]' : 'bg-[var(--color-positive)]/10 text-[var(--color-positive)]'
              }`}
            >
              {error ?? notice}
            </div>
          )}

          {!selectedId && <EmptyState title={t('preview.empty')} description={t('preview.empty_hint')} />}

          {selectedId && detailQuery.isLoading && <LoadingState />}
          {selectedId && detailQuery.isError && (
            <ErrorState message={translateError(detailQuery.error, t)} onRetry={() => void detailQuery.refetch()} />
          )}

          {detailQuery.data && (
            <>
              <div className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{detailQuery.data.title}</h2>
                    <p className="text-xs text-[var(--color-content-muted)]">
                      {t(`types.${detailQuery.data.type}`)} · {detailQuery.data.rangeFrom} ~ {detailQuery.data.rangeTo} ·{' '}
                      {detailQuery.data.currency}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleDownload('csv')}
                      disabled={downloading}
                      className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-xs disabled:opacity-50"
                    >
                      <Download className="size-3.5" aria-hidden />
                      CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownload('xlsx')}
                      disabled={downloading}
                      className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-xs disabled:opacity-50"
                    >
                      <Download className="size-3.5" aria-hidden />
                      XLSX
                    </button>
                    <button
                      type="button"
                      onClick={() => regenerateMutation.mutate()}
                      disabled={regenerateMutation.isPending}
                      className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-xs disabled:opacity-50"
                    >
                      <RefreshCw className={`size-3.5 ${regenerateMutation.isPending ? 'animate-spin' : ''}`} aria-hidden />
                      {t('actions.regenerate')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(t('actions.delete_confirm'))) deleteMutation.mutate();
                      }}
                      className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-xs text-[var(--color-negative)]"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                      {t('actions.delete')}
                    </button>
                  </div>
                </div>

                {basis && <BasisNotice basis={basis} />}
              </div>

              <div className="card overflow-hidden">
                <div className="border-b border-[var(--color-border-subtle)] px-4 py-2 text-sm font-medium">
                  {t('preview.title')}
                </div>

                {dataQuery.isLoading && <LoadingState />}

                {preview.length === 0 && <EmptyState title={t('preview.no_rows')} />}

                {preview.map((section) => (
                  <div key={section.title} className="border-b border-[var(--color-border-subtle)] last:border-0">
                    <p className="px-4 pt-3 text-xs font-medium text-[var(--color-content-muted)]">{section.title}</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-[var(--color-content-muted)]">
                            {section.header.map((cell) => (
                              <th key={cell} className="px-4 py-2 text-left font-normal">
                                {cell}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.slice(0, 20).map((row, rowIndex) => (
                            <tr key={rowIndex} className="border-t border-[var(--color-border-subtle)]">
                              {row.map((cell, cellIndex) => (
                                <td key={cellIndex} className="whitespace-nowrap px-4 py-1.5 tabular-nums">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {section.rows.length > 20 && (
                      <p className="px-4 py-2 text-[11px] text-[var(--color-content-muted)]">
                        {t('preview.truncated', { shown: 20, total: section.rows.length })}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function BasisNotice({ basis }: { basis: ReportDetail['basis'] }) {
  const { t } = useTranslation('reports');
  const completeness = basis.completeness;

  return (
    <div className="mt-3 space-y-1 rounded-lg border border-[var(--color-border-subtle)] p-3 text-xs">
      <p className="font-medium">{t('basis.title')}</p>
      <p className="text-[var(--color-content-muted)]">
        {t('basis.summary', {
          from: basis.range.from,
          to: basis.range.to,
          currency: basis.currency,
          accounts: basis.accountScope.accounts,
        })}
      </p>

      {!completeness.isComplete && (
        <ul className="space-y-0.5 text-[var(--color-negative)]">
          {completeness.missingMonths.length > 0 && (
            <li>{t('basis.missing_months', { months: completeness.missingMonths.join(', ') })}</li>
          )}
          {completeness.missingRates.length > 0 && (
            <li>{t('basis.missing_rates', { pairs: completeness.missingRates.join(', ') })}</li>
          )}
          {completeness.staleValuations.length > 0 && (
            <li>{t('basis.stale_valuations', { count: completeness.staleValuations.length })}</li>
          )}
          {completeness.unpricedSymbols.length > 0 && (
            <li>{t('basis.unpriced', { symbols: completeness.unpricedSymbols.join(', ') })}</li>
          )}
        </ul>
      )}

      <p className="text-[var(--color-content-muted)]">
        {t('basis.models', {
          compound: basis.modelVersions.compound ?? '—',
          monteCarlo: basis.modelVersions.monteCarlo ?? '—',
        })}
      </p>
      <p className="text-[var(--color-content-muted)]">{t('basis.generated', { at: formatDateTime(basis.generatedAt) })}</p>
    </div>
  );
}

interface PreviewSection {
  title: string;
  header: string[];
  rows: string[][];
}

function rowsOf(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

/**
 * 预览单元格：数值按 2 位小数展示，比率类（|值| ≤ 1 且带小数）保留 4 位。
 * 接口给 6 位原值，展示层再舍入，避免表格里出现 999,090.375958 这种噪声。
 */
function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return formatNumber(value, { maximumFractionDigits: 2 });

  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) {
    const numeric = Number(value);
    const isRatio = Math.abs(numeric) <= 1 && value.includes('.');
    return formatNumber(numeric, { maximumFractionDigits: isRatio ? 4 : 2 });
  }

  return String(value);
}

/** 各类型报表的预览表：字段顺序与导出保持一致，便于用户对照 */
function buildPreview(type: ReportType, data: Record<string, unknown> | undefined): PreviewSection[] {
  if (!data) return [];

  if (type === 'cashflow') {
    return [
      {
        title: '月度现金流',
        header: ['期间', '收入', '支出', '净额', '完整'],
        rows: rowsOf(data.points).map((row) => [
          text(row.period),
          text(row.income),
          text(row.expense),
          text(row.net),
          row.isComplete ? '✓' : '—',
        ]),
      },
    ];
  }

  if (type === 'net_worth') {
    return [
      {
        title: '账户余额',
        header: ['账户', '类型', '币种', '余额'],
        rows: rowsOf(data.accounts).map((row) => [
          text(row.name),
          text(row.type),
          text(row.currency),
          text(row.balance),
        ]),
      },
      {
        title: '证券市值',
        header: ['组合', '市值', '价格日期'],
        rows: rowsOf(data.securities).map((row) => [text(row.name), text(row.marketValue), text(row.priceDate)]),
      },
    ];
  }

  if (type === 'analytics') {
    const byCategory = (data.byCategory ?? {}) as Record<string, unknown>;
    return [
      {
        title: '支出分类',
        header: ['分类', '金额', '占比', '笔数'],
        rows: rowsOf(byCategory.expense).map((row) => [text(row.name), text(row.amount), text(row.share), text(row.count)]),
      },
      {
        title: '商户排行',
        header: ['商户', '金额', '笔数'],
        rows: rowsOf(data.byMerchant).map((row) => [text(row.merchant), text(row.amount), text(row.count)]),
      },
    ];
  }

  if (type === 'investment') {
    return [
      {
        title: '组合绩效',
        header: ['组合', '市值', 'TWR', 'XIRR', '估值日期'],
        rows: rowsOf(data.portfolios).map((row) => [
          text(row.name),
          text(row.marketValue),
          row.twr === null ? '—' : text(row.twr),
          row.xirr === null ? '—' : text(row.xirr),
          text(row.valuationDate),
        ]),
      },
      {
        title: '资产配置',
        header: ['类别', '市值', '权重'],
        rows: rowsOf(data.allocation).map((row) => [text(row.key), text(row.marketValue), text(row.weight)]),
      },
    ];
  }

  if (type === 'goals') {
    return [
      {
        title: '目标进度',
        header: ['目标', '目标金额', '当前金额', '进度', '缺口'],
        rows: rowsOf(data.goals).map((row) => [
          text(row.name),
          text(row.targetAmount),
          text(row.currentAmount),
          text(row.progress),
          text(row.gap),
        ]),
      },
    ];
  }

  return [
    {
      title: '复利方案',
      header: ['方案', '年限', '年化收益', '模型版本'],
      rows: rowsOf(data.compound).map((row) => [
        text(row.name),
        text(row.years),
        text(row.annualReturnRate),
        text(row.modelVersion),
      ]),
    },
    {
      title: '蒙特卡罗运行（随机模拟）',
      header: ['方案', '种子', '路径数', 'P10', 'P50', 'P90', '模型版本'],
      rows: rowsOf(data.monteCarlo).map((row) => {
        const terminal = (row.terminal ?? {}) as Record<string, unknown>;
        return [
          text(row.scenarioName),
          text(row.seed),
          text(row.pathCount),
          text(terminal.p10),
          text(terminal.p50),
          text(terminal.p90),
          text(row.modelVersion),
        ];
      }),
    },
  ];
}
