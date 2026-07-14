import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/** PC 前端从项目根目录读取 .env，与后端共用一份配置 */
const rootDir = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  envDir: rootDir,
  envPrefix: ['VITE_'],
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
