import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 相对 base：构建产物放到任意子目录/静态托管都能直接跑
  base: './',
  server: {
    port: 5173,
    host: '127.0.0.1',
    open: false,
  },
  build: {
    target: 'es2022',
    // three 体积大，单独切一个 chunk，便于排查
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
