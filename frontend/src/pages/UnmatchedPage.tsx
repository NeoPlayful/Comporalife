import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { translateError } from '@/lib/error-message';
import { toastError, toastSuccess } from '@/lib/toast';
import { formatDate, formatNumber } from '@/lib/format';
import { transferMatchApi, type TransferCandidate } from '@/lib/imports';

export default function UnmatchedPage() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('imports');

  const query = useQuery({ queryKey: ['unmatched'], queryFn: () => transferMatchApi.unmatched({ limit: 200 }) });

  const match = useMutation({
    mutationFn: (candidate: TransferCandidate) =>
      transferMatchApi.match(candidate.outgoing.id, candidate.incoming.id),
    onSuccess: async () => {
      toastSuccess(t('unmatched.matched'));
      await queryClient.invalidateQueries({ queryKey: ['unmatched'] });
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => toastError(translateError(err, t)),
  });

  if (query.isPending) return <LoadingState label={t('unmatched.loading')} />;
  if (query.error) {
    return <ErrorState message={t('unmatched.load_failed')} onRetry={() => void query.refetch()} />;
  }

  const { candidates, transactions } = query.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('unmatched.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('unmatched.subtitle')}</p>
        </div>
        <Link to="/imports" className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm">
          {t('unmatched.back')}
        </Link>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          {t('unmatched.candidates', { count: candidates.length })}
        </h2>
        {candidates.length === 0 ? (
          <p className="text-sm text-[var(--color-content-muted)]">{t('unmatched.no_candidates')}</p>
        ) : (
          candidates.map((candidate) => (
            <div key={`${candidate.outgoing.id}-${candidate.incoming.id}`} className="card space-y-2 p-3">
              <div className="flex items-center justify-between text-xs text-[var(--color-content-muted)]">
                <span>{t('unmatched.score', { score: candidate.score })}</span>
                <span>
                  {candidate.reasons.join(' · ') || t('unmatched.default_reason')}
                </span>
              </div>

              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <Side label={t('unmatched.side_out')} tx={candidate.outgoing} />
                <Side label={t('unmatched.side_in')} tx={candidate.incoming} />
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={match.isPending}
                  onClick={() => match.mutate(candidate)}
                  className="rounded-lg btn-action px-3 py-1.5 text-sm font-medium"
                >
                  {t('unmatched.merge')}
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          {t('unmatched.unmatched_title', { count: transactions.length })}
        </h2>
        {transactions.length === 0 ? (
          <EmptyState title={t('unmatched.empty_title')} description={t('unmatched.empty_description')} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)]">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-[var(--color-border-subtle)] text-left text-xs text-[var(--color-content-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('unmatched.columns.date')}</th>
                  <th className="px-3 py-2 font-medium">{t('unmatched.columns.account')}</th>
                  <th className="px-3 py-2 font-medium">{t('unmatched.columns.description')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('unmatched.columns.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-[var(--color-border-subtle)]/50 last:border-0">
                    <td className="px-3 py-2">{formatDate(tx.occurredAt)}</td>
                    <td className="px-3 py-2">{tx.accountName}</td>
                    <td className="max-w-[240px] truncate px-3 py-2">{tx.description}</td>
                    <td
                      className={`px-3 py-2 text-right ${
                        Number(tx.amount) < 0 ? 'text-[var(--color-negative)]' : 'text-emerald-500'
                      }`}
                    >
                      {formatNumber(tx.amount, { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Side({ label, tx }: { label: string; tx: TransferCandidate['outgoing'] }) {
  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] p-2">
      <p className="text-xs text-[var(--color-content-muted)]">
        {label} · {tx.accountName}
      </p>
      <p className="mt-1 font-medium">
        {formatNumber(tx.amount, { minimumFractionDigits: 2 })} {tx.currency}
      </p>
      <p className="truncate text-xs">{tx.description}</p>
      <p className="text-xs text-[var(--color-content-muted)]">{formatDate(tx.occurredAt)}</p>
    </div>
  );
}
