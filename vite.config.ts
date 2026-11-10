import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    strictPort: true,
    proxy: {
      '/api': {
        target:
          process.env.API_PROXY_TARGET ??
          loadEnv(mode, process.cwd(), 'API_').API_PROXY_TARGET ??
          'http://127.0.0.1:3001',
        changeOrigin: false,
      },
    },
  },
  build: {
    sourcemap: false,
    // Stable library chunks stay cacheable when only the interface changes.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          validation: ['zod'],
        },
      },
    },
  },
}));
