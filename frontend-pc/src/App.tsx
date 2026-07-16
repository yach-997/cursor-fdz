import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from './router';
import { useAuthStore } from './stores/auth';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function AppBootstrap() {
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return <RouterProvider router={router} />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          token: {
            colorPrimary: '#0f7a58',
            colorInfo: '#0f7a58',
            colorSuccess: '#1a9a6e',
            colorWarning: '#e7a23b',
            colorText: '#132820',
            colorTextSecondary: '#61756b',
            colorBgLayout: '#e8f0eb',
            borderRadius: 12,
            borderRadiusLG: 16,
            controlHeight: 40,
            fontFamily:
              "'Noto Sans SC', 'Outfit', 'PingFang SC', 'Microsoft YaHei', sans-serif",
            boxShadowSecondary: '0 18px 48px rgba(14, 52, 38, 0.12)',
          },
          components: {
            Button: { primaryShadow: '0 8px 20px rgba(15, 122, 88, 0.22)' },
            Card: { headerBg: 'transparent' },
            Table: { headerBg: '#f0f6f3', headerColor: '#49635a' },
            Menu: { darkItemBg: 'transparent', darkSubMenuItemBg: 'transparent' },
          },
        }}
      >
        <AntApp>
          <ErrorBoundary>
            <AppBootstrap />
          </ErrorBoundary>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
