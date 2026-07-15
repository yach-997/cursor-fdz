import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { useAuthStore } from './stores/auth';
import ErrorBoundary from './components/ErrorBoundary';
import NetworkBanner from './components/NetworkBanner';
import './index.css';

function AppBootstrap() {
  const hydrate = useAuthStore((s) => s.hydrate);
  useEffect(() => {
    hydrate();
    if ('caches' in window) {
      void window.caches.delete('api-cache');
    }
  }, [hydrate]);
  return (
    <>
      <NetworkBanner />
      <RouterProvider router={router} />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppBootstrap />
    </ErrorBoundary>
  );
}
