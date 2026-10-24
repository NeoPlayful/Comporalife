import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth-store';

/**
 * 管理后台入口守卫。
 *
 * 前端守卫只负责「不把入口显示给普通用户」，真正的权限判断在服务端：
 * 即使用户手输 URL，所有 /api/admin/* 仍会返回 403。
 */
export default function AdminGuard() {
  const user = useAuthStore((state) => state.user);

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
