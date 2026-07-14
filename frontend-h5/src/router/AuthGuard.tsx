import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';

/** H5 路由守卫 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();

  if (!token) {
    return <Navigate to="/m/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
