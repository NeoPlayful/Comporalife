import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';

const MAX_MB = 10;
const ALLOWED = ['.csv', '.xlsx'];

export default function UploadDropzone({
  onFile,
  disabled,
}: {
  onFile: (file: File, encoding?: 'utf-8' | 'gb18030') => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [encoding, setEncoding] = useState<'auto' | 'utf-8' | 'gb18030'>('auto');

  function accept(file: File) {
    setLocalError(null);

    const lower = file.name.toLowerCase();
    if (!ALLOWED.some((ext) => lower.endsWith(ext))) {
      setLocalError('仅支持 .csv 与 .xlsx 文件');
      return;
    }

    if (file.size > MAX_MB * 1024 * 1024) {
      setLocalError(`文件超过 ${MAX_MB} MB 上限`);
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
        <p className="text-sm font-medium">拖拽账单文件到此处，或</p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          选择文件
        </button>
        <p className="text-xs text-[var(--color-content-muted)]">
          支持 CSV 与 XLSX，单个文件不超过 {MAX_MB} MB、{20000} 行
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
          文件编码
        </label>
        <select
          id="encoding"
          value={encoding}
          onChange={(event) => setEncoding(event.target.value as typeof encoding)}
          className="rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1"
        >
          <option value="auto">自动识别</option>
          <option value="utf-8">UTF-8</option>
          <option value="gb18030">GBK / GB18030</option>
        </select>
        <span className="text-xs text-[var(--color-content-muted)]">仅对 CSV 生效</span>
      </div>

      {localError && (
        <p role="alert" className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
          {localError}
        </p>
      )}
    </div>
  );
}
