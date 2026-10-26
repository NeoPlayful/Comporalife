import EmptyState from '@/components/ui/EmptyState';
import LoadingState from '@/components/ui/LoadingState';
import Modal from '@/components/ui/Modal';
import { accountsApi, type Account } from '@/lib/accounts';
import { translateError } from '@/lib/error-message';
import { formatDate, formatNumber } from '@/lib/format';
import { portfoliosApi } from '@/lib/portfolios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export default function PortfoliosPage() {
  const { t } = useTranslation('portfolios');
  const queryClient = useQueryClient();

  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['portfolios', showArchived ? 'all' : 'active'],
    queryFn: () => portfoliosApi.list(showArchived ? 'all' : 'active'),
  });

  const accountsQuery = useQuery({
    queryKey: ['accounts', 'brokerage'],
    queryFn: () => accountsApi.list(),
    enabled: creating,
  });

  const brokerageAccounts: Account[] =
    accountsQuery.data?.accounts.filter(
      (account) => account.type === 'brokerage' && account.status === 'active',
    ) ?? [];

  // 已被组合占用的账户不能再选，后端也会拦，这里提前过滤掉
  const usedAccountIds = new Set(
    (listQuery.data?.items ?? []).map((item) => item.accountId),
  );
  const availableAccounts = brokerageAccounts.filter(
    (account) => !usedAccountIds.has(account.id),
  );

  const createMutation = useMutation({
    mutationFn: () => portfoliosApi.create({ accountId, name: name.trim() }),
    onSuccess: () => {
      setCreating(false);
      setName('');
      setAccountId('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['portfolios'] });
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const items = listQuery.data?.items ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('description')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-[var(--color-content-muted)]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            {t('list.show_archived')}
          </label>
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setError(null);
            }}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
          >
            <Plus className="size-4" aria-hidden />
            {t('list.create')}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
          {error}
        </p>
      )}

      {creating && (
        <Modal
          open
          title={t('create.title')}
          size="lg"
          dirty={name.trim() !== '' || accountId !== ''}
          busy={createMutation.isPending}
          onClose={() => {
            setCreating(false);
            setError(null);
            setName('');
            setAccountId('');
          }}
          footer={
            <>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setError(null);
                  setName('');
                  setAccountId('');
                }}
                className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
              >
                {t('create.cancel')}
              </button>
              <button
                type="button"
                disabled={!accountId || !name.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate()}
                className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {createMutation.isPending ? t('create.saving') : t('create.submit')}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            {error && <p className="text-sm text-[var(--color-negative)]">{error}</p>}

            {availableAccounts.length === 0 ? (
              <p className="text-sm text-[var(--color-content-muted)]">
                {t('create.account_empty')}{' '}
                <Link to="/accounts" className="underline">
                  {t('create.account')}
                </Link>
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="text-[var(--color-content-muted)]">{t('create.account')}</span>
                  <select
                    data-autofocus
                    value={accountId}
                    onChange={(event) => setAccountId(event.target.value)}
                    className="input"
                  >
                    <option value="">—</option>
                    {availableAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} ({account.currency})
                      </option>
                    ))}
                  </select>
                  <span className="block text-xs text-[var(--color-content-muted)]">
                    {t('create.account_hint')}
                  </span>
                </label>

                <label className="space-y-1 text-sm">
                  <span className="text-[var(--color-content-muted)]">{t('create.name')}</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={60}
                    className="input"
                  />
                </label>
              </div>
            )}
          </div>
        </Modal>
      )}

      {listQuery.isLoading ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState
            title={t('list.empty_title')}
            description={t('list.empty_description')}
            action={
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
              >
                {t('list.empty_action')}
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Link
              key={item.id}
              to={`/portfolios/${item.id}`}
              className="card space-y-2 transition hover:border-[var(--color-accent)]/50"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-[var(--color-content-muted)]">{item.accountName}</p>
                </div>
                {item.status === 'archived' && (
                  <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">
                    {t('list.archived')}
                  </span>
                )}
              </div>

              {item.marketValue === null ? (
                <p className="text-sm text-[var(--color-content-muted)]">—</p>
              ) : (
                <>
                  <div>
                    <p className="text-xs text-[var(--color-content-muted)]">
                      {t('list.total_value')}
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatNumber(item.portfolioValue)} {item.currency}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-content-muted)]">
                    <span>
                      {t('list.market_value')} {formatNumber(item.marketValue)}
                    </span>
                    <span>
                      {t('list.cash')} {formatNumber(item.cash)}
                    </span>
                    <span
                      className={
                        Number(item.totalPnl) >= 0
                          ? 'text-[var(--color-positive,#4ea87c)]'
                          : 'text-[var(--color-negative)]'
                      }
                    >
                      {t('list.total_pnl')} {formatNumber(item.totalPnl)}
                    </span>
                  </div>
                  {item.priceDate && (
                    <p className="text-xs text-[var(--color-content-muted)]">
                      {t('summary.price_date')} {formatDate(item.priceDate)}
                    </p>
                  )}
                  {(item.stale || !item.isComplete) && (
                    <p className="flex items-center gap-1 text-xs text-[var(--color-warning,#d3a35a)]">
                      <AlertTriangle className="size-3.5" aria-hidden />
                      {item.stale ? t('list.stale') : t('list.incomplete')}
                    </p>
                  )}
                </>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
