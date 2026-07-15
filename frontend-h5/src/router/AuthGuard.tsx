import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';

/** H5 路由守卫 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const hydrated = useAuthStore((s) => s.hydrated);
  const location = useLocation();

  // 刷新页面时先等待本地会话恢复，避免短暂跳回登录页。
  if (!hydrated) return null;

  if (!token) {
    return <Navigate to="/m/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
