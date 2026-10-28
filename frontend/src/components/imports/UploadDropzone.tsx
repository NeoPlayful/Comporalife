import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const MAX_MB = 10;
const MAX_ROWS = 20_000;
const ALLOWED = ['.csv', '.xlsx'];

export default function UploadDropzone({
  onFile,
  disabled,
}: {
  onFile: (file: File, encoding?: 'utf-8' | 'gb18030') => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('imports');
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [encoding, setEncoding] = useState<'auto' | 'utf-8' | 'gb18030'>('auto');

  function accept(file: File) {
    setLocalError(null);

    const lower = file.name.toLowerCase();
    if (!ALLOWED.some((ext) => lower.endsWith(ext))) {
      setLocalError(t('dropzone.only_csv_xlsx'));
      return;
    }

    if (file.size > MAX_MB * 1024 * 1024) {
      setLocalError(t('dropzone.too_large', { maxMb: MAX_MB }));
      return;
    }

    onFile(file, encoding === 'auto' ? undefined : encoding);
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (disabled) return;
          const file = event.dataTransfer.files[0];
          if (file) accept(file);
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-12 text-center transition-colors ${
          dragging
            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
            : 'border-[var(--color-border-subtle)]'
        } ${disabled ? 'opacity-60' : ''}`}
      >
        <Upload className="size-8 text-[var(--color-content-muted)]" aria-hidden />
        <p className="text-sm font-medium">{t('dropzone.prompt')}</p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg btn-action px-4 py-2 text-sm font-medium"
        >
          {t('dropzone.choose')}
        </button>
        <p className="text-xs text-[var(--color-content-muted)]">
          {t('dropzone.hint', { maxMb: MAX_MB, maxRows: MAX_ROWS.toLocaleString() })}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) accept(file);
            event.target.value = '';
          }}
        />
      </div>

      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="encoding" className="text-[var(--color-content-muted)]">
          {t('dropzone.encoding')}
        </label>
        <select
          id="encoding"
          value={encoding}
          onChange={(event) => setEncoding(event.target.value as typeof encoding)}
          className="rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1"
        >
          <option value="auto">{t('dropzone.encoding_auto')}</option>
          <option value="utf-8">{t('dropzone.encoding_utf8')}</option>
          <option value="gb18030">{t('dropzone.encoding_gbk')}</option>
        </select>
        <span className="text-xs text-[var(--color-content-muted)]">{t('dropzone.encoding_hint')}</span>
      </div>

      {localError && (
        <p role="alert" className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
          {localError}
        </p>
      )}
    </div>
  );
}
