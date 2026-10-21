const FORMATS = [
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD', example: '2026-03-01' },
  { value: 'YYYY/MM/DD', label: 'YYYY/MM/DD', example: '2026/03/01' },
  { value: 'YYYYMMDD', label: 'YYYYMMDD', example: '20260301' },
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY（日在前）', example: '01/03/2026' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY（月在前）', example: '03/01/2026' },
  { value: 'YYYY-MM-DD HH:mm', label: 'YYYY-MM-DD HH:mm', example: '2026-03-01 09:30' },
  { value: 'YYYY-MM-DD HH:mm:ss', label: 'YYYY-MM-DD HH:mm:ss', example: '2026-03-01 09:30:00' },
  { value: 'auto', label: '自动识别（存在歧义时报错）', example: '2026-03-01' },
];

export default function DateFormatPicker({
  value,
  sample,
  onChange,
}: {
  value: string;
  /** 原始文件中的首个日期样例，用于提示用户核对 */
  sample?: string | null;
  onChange: (value: string) => void;
}) {
  const selected = FORMATS.find((item) => item.value === value);
  const ambiguous = value === 'auto' && sample ? isAmbiguous(sample) : false;

  return (
    <div className="space-y-1">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
      >
        {FORMATS.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>

      <p className="text-xs text-[var(--color-content-muted)]">
        示例：{selected?.example}
        {sample ? ` · 文件中首个值：${sample}` : ''}
      </p>

      {ambiguous && (
        <p className="text-xs text-[var(--color-negative)]">
          该日期存在「日/月」歧义，请显式选择格式
        </p>
      )}
    </div>
  );
}

function isAmbiguous(sample: string): boolean {
  const match = /^(\d{1,2})[-/](\d{1,2})[-/]\d{4}$/.exec(sample.trim());
  if (!match) return false;
  const first = Number(match[1]);
  const second = Number(match[2]);
  return first <= 12 && second <= 12;
}
