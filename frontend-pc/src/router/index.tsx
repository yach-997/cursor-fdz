import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import AuthGuard from './AuthGuard';
import BasicLayout from '../layouts/BasicLayout';
import { useAuthStore } from '../stores/auth';

/** 费用结算首页：管理员进经营看板，网格长进案例管理 */
function FinanceHomeRedirect() {
  const role = useAuthStore((s) => s.user?.role);
  return <Navigate to={role === 'super_admin' ? 'dashboard' : 'cases'} replace />;
}

const PortalPage = lazy(() => import('../pages/portal'));
const LoginPage = lazy(() => import('../pages/login'));
const SitesPage = lazy(() => import('../pages/sites'));
const UsersPage = lazy(() => import('../pages/users'));
const TemplatesPage = lazy(() => import('../pages/templates'));
const HardRulesPage = lazy(() => import('../pages/hard-rules'));
const DashboardPage = lazy(() => import('../pages/dashboard'));
const AnalysisPage = lazy(() => import('../pages/analysis'));
const RecordsPage = lazy(() => import('../pages/records'));
const AuditPage = lazy(() => import('../pages/audit'));
const SettingsPage = lazy(() => import('../pages/settings'));
const ForbiddenPage = lazy(() => import('../pages/forbidden'));
const FinanceLayout = lazy(() => import('../pages/finance/FinanceLayout'));
const FinanceDashboardPage = lazy(() => import('../pages/finance/dashboard'));
const FinanceCasesPage = lazy(() => import('../pages/finance/cases'));
const FinancePoOrdersPage = lazy(() => import('../pages/finance/po-orders'));
const FinancePricesPage = lazy(() => import('../pages/finance/prices'));
const FinanceReviewPage = lazy(() => import('../pages/finance/review'));
const FinanceAssessmentPage = lazy(() => import('../pages/finance/assessment'));
const FinanceMonthlyPage = lazy(() => import('../pages/finance/monthly'));

/** 页面加载中占位 */
function PageLoading() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}>
      <Spin size="large" tip="加载中..." />
    </div>
  );
}

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>;
}

/** 路由表：入口页 + 登录 + Layout + 按角色守卫 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <Lazy>
        <PortalPage />
      </Lazy>
    ),
  },
  {
    path: '/login',
    element: (
      <Lazy>
        <LoginPage />
      </Lazy>
    ),
  },
  {
    path: '/403',
    element: (
      <Lazy>
        <ForbiddenPage />
      </Lazy>
    ),
  },
  {
    element: (
      <AuthGuard>
        <BasicLayout />
      </AuthGuard>
    ),
    children: [
      {
        path: 'dashboard',
        element: (
          <AuthGuard roles={['super_admin', 'site_manager']}>
            <Lazy>
              <DashboardPage />
            </Lazy>
          </AuthGuard>
        ),
      },
      {
        path: 'sites',
        element: (
          <AuthGuard roles={['super_admin', 'site_manager']}>
            <Lazy>
              <SitesPage />
            </Lazy>
          </AuthGuard>
        ),
      },
      {
        path: 'users',
        element: (
          <AuthGuard roles={['super_admin', 'site_manager']}>
            <Lazy>
              <UsersPage />
            </Lazy>
          </AuthGuard>
        ),
      },
      {
        // 设备台账页已下线：主流程为案例导入派单；底层 /devices API 仍供巡检任务选用
        path: 'devices',
        element: <Navigate to="/finance/cases" replace />,
      },
      {
        path: 'templates',
        element: (
          <AuthGuard roles={['super_admin', 'site_manager']}>
            <Lazy>
              <TemplatesPage />
            </Lazy>
          </AuthGuard>
        ),
      },
      {
        path: 'hard-rules',
        element: (
          <AuthGuard roles={['super_admin']}>
            <Lazy>
              <HardRulesPage />
            </Lazy>
          </AuthGuard>
        ),
      },
      {
        // 旧「按设备建任务」与案例派单双轨，统一进案例管理
        path: 'tasks',
        element: <Navigate to="/finance/cases" replace />,
      },
      {
        path: 'records',
        element: (
          <AuthGuard roles={['super_admin', 'site_manager']}>
            <Lazy>
              <RecordsPage />
            </Lazy>
          </AuthGuard>
        ),
      },
      {
        path: 'audit',
        element: (
          <AuthGuard roles={['super_admin', 'site_manager']}>
            <Lazy>
              <AuditPage />
            </Lazy>
          </AuthGuard>
        ),
      },
      {
        path: 'analysis',
        element: (
          <AuthGuard roles={['super_admin', 'site_manager']}>
            <Lazy>
              <AnalysisPage />
            </Lazy>
          </AuthGuard>
        ),
      },
      {
        // 预警中心已从侧栏下线，旧书签落到仪表盘
        path: 'alerts',
        element: <Navigate to="/dashboard" replace />,
      },
      {
        // 运维监控已从侧栏下线，旧书签落到系统设置
        path: 'monitoring',
        element: <Navigate to="/settings" replace />,
      },
      {
        path: 'settings',
        element: (
          <AuthGuard roles={['super_admin', 'site_manager', 'inspector']}>
            <Lazy>
              <SettingsPage />
            </Lazy>
          </AuthGuard>
        ),
      },
      {
        path: 'finance',
        element: (
          <AuthGuard roles={['super_admin', 'site_manager']}>
            <Lazy>
              <FinanceLayout />
            </Lazy>
          </AuthGuard>
        ),
        children: [
          { index: true, element: <FinanceHomeRedirect /> },
          {
            path: 'dashboard',
            element: (
              <AuthGuard roles={['super_admin']}>
                <Lazy>
                  <FinanceDashboardPage />
                </Lazy>
              </AuthGuard>
            ),
          },
          {
            path: 'cases',
            element: (
              <Lazy>
                <FinanceCasesPage />
              </Lazy>
            ),
          },
          {
            path: 'po-orders',
            element: (
              <AuthGuard roles={['super_admin']}>
                <Lazy>
                  <FinancePoOrdersPage />
                </Lazy>
              </AuthGuard>
            ),
          },
          {
            path: 'prices',
            element: (
              <AuthGuard roles={['super_admin']}>
                <Lazy>
                  <FinancePricesPage />
                </Lazy>
              </AuthGuard>
            ),
          },
          {
            path: 'review',
            element: (
              <AuthGuard roles={['super_admin']}>
                <Lazy>
                  <FinanceReviewPage />
                </Lazy>
              </AuthGuard>
            ),
          },
          {
            path: 'expenses',
            element: (
              <AuthGuard roles={['super_admin']}>
                <Navigate to="/finance/review?scope=expense" replace />
              </AuthGuard>
            ),
          },
          {
            path: 'assessment',
            element: (
              <Lazy>
                <FinanceAssessmentPage />
              </Lazy>
            ),
          },
          {
            path: 'monthly',
            element: (
              <AuthGuard roles={['super_admin', 'site_manager']}>
                <Lazy>
                  <FinanceMonthlyPage />
                </Lazy>
              </AuthGuard>
            ),
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
