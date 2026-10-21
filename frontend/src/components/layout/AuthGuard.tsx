import { authApi } from '@/lib/auth';
import LoadingState from '@/components/ui/LoadingState';
import { useAuthStore } from '@/stores/auth-store';
import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

export default function AuthGuard() {
  const { user, initialized, setAuth, setInitialized, clear } = useAuthStore();
  const [checking, setChecking] = useState(!initialized);
  const location = useLocation();

  useEffect(() => {
    if (initialized) {
      setChecking(false);
      return;
    }

    let cancelled = false;

    // 页面刷新后内存中的 access token 丢失，依赖 refresh cookie 恢复会话
    (async () => {
      try {
        const refresh = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        if (!refresh.ok) throw new Error('no session');

        const payload = (await refresh.json()) as { data?: { accessToken?: string } };
        const accessToken = payload.data?.accessToken;
        if (!accessToken) throw new Error('no token');

        const { user: fetched } = await authApi.me();
        if (!cancelled) setAuth(fetched, accessToken);
      } catch {
        if (!cancelled) clear();
      } finally {
        if (!cancelled) {
          setInitialized();
          setChecking(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialized, setAuth, setInitialized, clear]);

  if (checking || !initialized) {
    return <LoadingState label="正在恢复会话…" />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
