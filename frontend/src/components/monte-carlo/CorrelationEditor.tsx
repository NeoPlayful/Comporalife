import { useTranslation } from 'react-i18next';
import type { ScenarioAssetInput } from '@/lib/monte-carlo';

interface Props {
  assets: ScenarioAssetInput[];
  correlation: number[][];
  onChange: (correlation: number[][]) => void;
}

/**
 * 相关矩阵编辑。
 * 后端不做静默修正：非正定矩阵会被 422 拒绝，所以这里给出即时提示，
 * 让用户在提交前就知道自己的相关性假设在数学上不成立。
 */
export default function CorrelationEditor({ assets, correlation, onChange }: Props) {
  const { t } = useTranslation('monte-carlo');

  const size = assets.length;
  const matrix = normalizeMatrix(correlation, size);

  const setCell = (row: number, col: number, value: number) => {
    const next = matrix.map((line) => [...line]);
    // 矩阵必须对称：改一侧同时改另一侧，避免用户漏改
    next[row]![col] = value;
    next[col]![row] = value;
    onChange(next);
  };

  const resetToIdentity = () => {
    onChange(Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => (i === j ? 1 : 0))));
  };

  const issue = checkMatrix(matrix, size);

  if (size < 2) {
    return <p className="text-sm text-[var(--color-content-muted)]">{t('correlation.single_asset')}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--color-content-muted)]">{t('correlation.hint')}</p>
        <button
          type="button"
          onClick={resetToIdentity}
          className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs"
        >
          {t('correlation.reset')}
        </button>
      </div>

      {/* 窄屏把矩阵限制在自身容器内滚动，不撑破整页 */}
      <div className="overflow-x-auto">
        <table className="min-w-max border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-[var(--color-surface)] p-1" />
              {assets.map((asset) => (
                <th key={asset.key} className="max-w-24 truncate p-1 font-normal text-[var(--color-content-muted)]">
                  {asset.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {assets.map((rowAsset, row) => (
              <tr key={rowAsset.key}>
                <th className="sticky left-0 max-w-24 truncate bg-[var(--color-surface)] p-1 text-left font-normal text-[var(--color-content-muted)]">
                  {rowAsset.label}
                </th>
                {assets.map((colAsset, col) => (
                  <td key={colAsset.key} className="p-0.5">
                    {row === col ? (
                      <div className="grid size-14 place-items-center rounded border border-[var(--color-border-subtle)] font-mono text-[var(--color-content-muted)]">
                        1
                      </div>
                    ) : (
                      <input
                        type="number"
                        step="0.05"
                        min={-1}
                        max={1}
                        className="input size-14 px-1 py-1 text-center font-mono"
                        value={matrix[row]?.[col] ?? 0}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setCell(row, col, Number.isFinite(value) ? value : 0);
                        }}
                        aria-label={`${rowAsset.label} × ${colAsset.label}`}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {issue && (
        <p className="text-xs text-amber-400" role="alert">
          {t(`correlation.issue.${issue}`)}
        </p>
      )}

      <div className="sm:hidden">
        {/* 窄屏下表格难以核对，追加一份可读的摘要 */}
        <p className="text-[11px] text-[var(--color-content-muted)]">{t('correlation.summary_hint')}</p>
        <ul className="mt-1 space-y-1 text-[11px] font-mono">
          {assets.flatMap((rowAsset, row) =>
            assets
              .map((colAsset, col) =>
                row < col ? (
                  <li key={`${rowAsset.key}-${colAsset.key}`}>
                    {rowAsset.label} ↔ {colAsset.label}: {(matrix[row]?.[col] ?? 0).toFixed(2)}
                  </li>
                ) : null,
              )
              .filter(Boolean),
          )}
        </ul>
      </div>
    </div>
  );
}

function normalizeMatrix(matrix: number[][], size: number): number[][] {
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => {
      if (row === col) return 1;
      const value = matrix[row]?.[col];
      return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    }),
  );
}

type MatrixIssue = 'out_of_range' | 'not_positive_definite' | null;

function checkMatrix(matrix: number[][], size: number): MatrixIssue {
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const value = matrix[row]?.[col] ?? 0;
      if (value < -1 || value > 1) return 'out_of_range';
    }
  }

  // 快速判断半正定：对角占优不足以证明正定，这里用 Cholesky 试探
  return isPositiveDefinite(matrix) ? null : 'not_positive_definite';
}

function isPositiveDefinite(matrix: number[][]): boolean {
  const n = matrix.length;
  const lower: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = matrix[i]![j]!;
      for (let k = 0; k < j; k += 1) sum -= lower[i]![k]! * lower[j]![k]!;

      if (i === j) {
        if (sum <= 1e-12) return false;
        lower[i]![i] = Math.sqrt(sum);
      } else {
        lower[i]![j] = sum / lower[j]![j]!;
      }
    }
  }

  return true;
}
