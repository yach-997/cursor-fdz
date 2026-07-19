import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import AuthGuard from './AuthGuard';
import BasicLayout from '../layouts/BasicLayout';

const PortalPage = lazy(() => import('../pages/portal'));
const LoginPage = lazy(() => import('../pages/login'));
const DashboardPage = lazy(() => import('../pages/dashboard'));
const SitesPage = lazy(() => import('../pages/sites'));
const UsersPage = lazy(() => import('../pages/users'));
const DevicesPage = lazy(() => import('../pages/devices'));
const TemplatesPage = lazy(() => import('../pages/templates'));
const TasksPage = lazy(() => import('../pages/tasks'));
const RecordsPage = lazy(() => import('../pages/records'));
const AuditPage = lazy(() => import('../pages/audit'));
const AnalysisPage = lazy(() => import('../pages/analysis'));
const AlertsPage = lazy(() => import('../pages/alerts'));
const MonitoringPage = lazy(() => import('../pages/monitoring'));
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
        path: 'devices',
        element: (
          <AuthGuard roles={['super_admin', 'site_manager']}>
            <Lazy>
              <DevicesPage />
            </Lazy>
          </AuthGuard>
        ),
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
        path: 'tasks',
        element: (
          <AuthGuard roles={['super_admin', 'site_manager']}>
            <Lazy>
              <TasksPage />
            </Lazy>
          </AuthGuard>
        ),
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
        path: 'alerts',
        element: (
          <AuthGuard roles={['super_admin', 'site_manager']}>
            <Lazy>
              <AlertsPage />
            </Lazy>
          </AuthGuard>
        ),
      },
      {
        path: 'monitoring',
        element: (
          <AuthGuard roles={['super_admin', 'site_manager']}>
            <Lazy>
              <MonitoringPage />
            </Lazy>
          </AuthGuard>
        ),
      },
      {
        path: 'settings',
        element: (
          <Lazy>
            <SettingsPage />
          </Lazy>
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
          { index: true, element: <Navigate to="dashboard" replace /> },
          {
            path: 'dashboard',
            element: (
              <Lazy>
                <FinanceDashboardPage />
              </Lazy>
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
              <Lazy>
                <FinancePoOrdersPage />
              </Lazy>
            ),
          },
          {
            path: 'prices',
            element: (
              <Lazy>
                <FinancePricesPage />
              </Lazy>
            ),
          },
          {
            path: 'review',
            element: (
              <Lazy>
                <FinanceReviewPage />
              </Lazy>
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
              <Lazy>
                <FinanceMonthlyPage />
              </Lazy>
            ),
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
