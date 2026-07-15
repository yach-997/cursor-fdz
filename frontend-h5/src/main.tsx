import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'react-vant/lib/index.css';
import App from './App';
import { recoverLatestVersion } from './utils/assetRecovery';

// Vite 在旧页面请求不到新部署的分包时会触发此事件，自动更新而不是显示英文错误页。
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  void recoverLatestVersion();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
