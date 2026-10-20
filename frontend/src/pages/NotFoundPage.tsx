import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <p className="text-5xl font-bold text-[var(--color-content-muted)]">404</p>
      <p className="text-sm text-[var(--color-content-muted)]">页面不存在</p>
      <Link
        to="/dashboard"
        className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
      >
        返回财务总览
      </Link>
    </div>
  );
}
