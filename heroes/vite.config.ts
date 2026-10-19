import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
// Đường dẫn gốc đọc từ MỘT nơi duy nhất (shared/heroes/config.ts) để server và client luôn khớp.
import { HEROES_BASE } from '../shared/heroes/config';

const SERVER = `http://localhost:${process.env.SERVER_PORT ?? 8787}`;

export default defineConfig({
  base: HEROES_BASE,
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  optimizeDeps: { include: ['three', 'preact', '@preact/signals'] },
  server: {
    port: 5175,
    host: true,
    // cho phép mở qua đường hầm thử nghiệm (Cloudflare quick tunnel)
    allowedHosts: ['.trycloudflare.com'],
    fs: { allow: ['..'] },
    proxy: {
      // REST (đăng nhập, tướng, triệu hồi, trận đánh...)
      [`${HEROES_BASE}api`]: { target: SERVER, changeOrigin: true },
    },
  },
  build: {
    target: 'es2020',
    reportCompressedSize: false,
    chunkSizeWarningLimit: 900,
  },
});
