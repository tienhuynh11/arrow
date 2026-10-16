import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
// Đường dẫn gốc đọc từ MỘT nơi duy nhất (shared/monkey/config.ts) để server và client luôn khớp.
import { MONKEY_BASE } from '../shared/monkey/config';

const BASE = MONKEY_BASE;
const SERVER = `http://localhost:${process.env.SERVER_PORT ?? 8787}`;

export default defineConfig({
  base: BASE,
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  optimizeDeps: { include: ['three'] },
  server: {
    port: 5174,
    host: true,
    fs: { allow: ['..'] },
    // WebSocket đi chung origin với trang (chỉ cần mở một cổng khi chơi qua LAN/ngrok)
    proxy: {
      [`${BASE}ws`]: {
        target: SERVER,
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', () => {});
          proxy.on('proxyReqWs', (_req, _socket, clientSocket) => clientSocket.on('error', () => {}));
        },
      },
      [`${BASE}health`]: { target: SERVER, changeOrigin: true },
    },
  },
  build: {
    target: 'es2020',
    reportCompressedSize: false,
    chunkSizeWarningLimit: 700,
  },
});
