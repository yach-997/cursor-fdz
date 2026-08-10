import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Loading } from 'react-vant';
import AuthGuard from './AuthGuard';
import TabLayout from '../layouts/TabLayout';
import RouteErrorPage from '../components/RouteErrorPage';

const LoginPage = lazy(() => import('../pages/login'));
const SitesPage = lazy(() => import('../pages/sites'));
const StartWizardPage = lazy(() => import('../pages/start'));
const HomePage = lazy(() => import('../pages/home'));
const TasksPage = lazy(() => import('../pages/tasks'));
const TaskDetailPage = lazy(() => import('../pages/tasks/detail'));
const InspectionPage = lazy(() => import('../pages/inspection'));
const SuccessPage = lazy(() => import('../pages/success'));
const ReportPage = lazy(() => import('../pages/report'));
const MyPage = lazy(() => import('../pages/my'));
const SettingsPage = lazy(() => import('../pages/settings'));
const PhotoPreviewPage = lazy(() => import('../pages/photo'));
const FinanceCaseDetailPage = lazy(() => import('../pages/finance/case-detail'));
const FinanceExpensePage = lazy(() => import('../pages/finance/expense'));
const MyIncomePage = lazy(() => import('../pages/finance/income'));

function Lazy({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div style={{ paddingTop: 120, textAlign: 'center' }}>
          <Loading type="spinner" vertical>
            加载中...
          </Loading>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

/** H5 路由：登录 + 网格选择 + 底部 Tab */
export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorPage />,
    children: [
  {
    // 列表已与「作业」Tab 合并，保留详情路由
    path: '/m/finance-cases',
    element: (
      <AuthGuard>
        <Navigate to="/m/tasks" replace />
      </AuthGuard>
    ),
  },
  {
    path: '/m/finance-cases/:id',
    element: <AuthGuard><Lazy><FinanceCaseDetailPage /></Lazy></AuthGuard>,
  },
  {
    path: '/m/finance-cases/:id/expense',
    element: <AuthGuard><Lazy><FinanceExpensePage /></Lazy></AuthGuard>,
  },
  {
    path: '/m/income',
    element: <AuthGuard><Lazy><MyIncomePage /></Lazy></AuthGuard>,
  },
  {
    path: '/m/login',
    element: (
      <Lazy>
        <LoginPage />
      </Lazy>
    ),
  },
  {
    path: '/m/sites',
    element: (
      <AuthGuard>
        <Lazy>
          <SitesPage />
        </Lazy>
      </AuthGuard>
    ),
  },
  {
    path: '/m/start',
    element: (
      <AuthGuard>
        <Lazy>
          <StartWizardPage />
        </Lazy>
      </AuthGuard>
    ),
  },
  {
    path: '/m/tasks/create',
    element: (
      <AuthGuard>
        <Navigate to="/m/tasks" replace />
      </AuthGuard>
    ),
  },
  {
    path: '/m/inspection/:taskId',
    element: (
      <AuthGuard>
        <Lazy>
          <InspectionPage />
        </Lazy>
      </AuthGuard>
    ),
  },
  {
    path: '/m/success',
    element: (
      <AuthGuard>
        <Lazy>
          <SuccessPage />
        </Lazy>
      </AuthGuard>
    ),
  },
  {
    path: '/m/report/:recordId',
    element: (
      <AuthGuard>
        <Lazy>
          <ReportPage />
        </Lazy>
      </AuthGuard>
    ),
  },
  {
    path: '/m/photo',
    element: (
      <AuthGuard>
        <Lazy>
          <PhotoPreviewPage />
        </Lazy>
      </AuthGuard>
    ),
  },
  {
    // 历史已并入「作业 → 已完成」
    path: '/m/history',
    element: (
      <AuthGuard>
        <Navigate to="/m/tasks" replace />
      </AuthGuard>
    ),
  },
  {
    path: '/m/settings',
    element: (
      <AuthGuard>
        <Lazy>
          <SettingsPage />
        </Lazy>
      </AuthGuard>
    ),
  },
  {
    path: '/m',
    element: (
      <AuthGuard>
        <TabLayout />
      </AuthGuard>
    ),
    children: [
      {
        index: true,
        element: (
          <Lazy>
            <HomePage />
          </Lazy>
        ),
      },
      {
        path: 'tasks',
        element: (
          <Lazy>
            <TasksPage />
          </Lazy>
        ),
      },
      {
        path: 'tasks/:id',
        element: (
          <Lazy>
            <TaskDetailPage />
          </Lazy>
        ),
      },
      {
        path: 'my',
        element: (
          <Lazy>
            <MyPage />
          </Lazy>
        ),
      },
    ],
  },
      { path: '/', element: <Navigate to="/m" replace /> },
      { path: '*', element: <Navigate to="/m" replace /> },
    ],
  },
]);
