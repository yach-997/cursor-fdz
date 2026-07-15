import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import type { UserRole } from '../types';

interface AuthGuardProps {
  children: React.ReactNode;
  roles?: UserRole[];
}

/** 路由守卫：未登录跳转登录页；角色不符跳转 403 */
export default function AuthGuard({ children, roles }: AuthGuardProps) {
  const location = useLocation();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);

  // 刷新页面时先等待 localStorage 会话恢复，避免误判未登录并跳转。
  if (!hydrated) return null;

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to="/403" replace />;
  }

  return <>{children}</>;
}
