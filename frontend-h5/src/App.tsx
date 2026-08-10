import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { useAuthStore } from './stores/auth';
import { useBrandingStore } from './stores/branding';
import ErrorBoundary from './components/ErrorBoundary';
import NetworkBanner from './components/NetworkBanner';
import './index.css';

function AppBootstrap() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const hydrateBranding = useBrandingStore((s) => s.hydrate);
  const refreshBranding = useBrandingStore((s) => s.refresh);
  useEffect(() => {
    hydrate();
    hydrateBranding();
    void refreshBranding();
    if ('caches' in window) {
      void window.caches.delete('api-cache');
    }
  }, [hydrate, hydrateBranding, refreshBranding]);
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
