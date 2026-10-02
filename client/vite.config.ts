import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const BASE = '/arrow/';

export default defineConfig({
  base: BASE,
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  // three chỉ được import lười (lúc vào game 3D). Nếu không khai trước, dev server phát hiện
  // nó giữa ván, tối ưu lại dependency và làm rớt kết nối WebSocket của người chơi.
  optimizeDeps: { include: ['three'] },
  server: {
    port: 5173,
    host: true, // lets other devices on the LAN join the room
    allowedHosts: [
      'sharell-wrinklier-clearheadedly.ngrok-free.dev',
    ],
    fs: { allow: ['..'] },
    // Đẩy WebSocket qua cùng origin với trang web, nhờ vậy chỉ cần mở MỘT port
    // (5173) là chơi được qua ngrok/LAN - không phải tunnel riêng cho 8787.
    // Client nối vào `${base}ws` (xem net.ts), nên khoá proxy phải kèm base, không thì dev bị 404.
    proxy: {
      [`${BASE}ws`]: {
        target: `http://localhost:${process.env.SERVER_PORT ?? 8787}`,
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          // người chơi đóng tab giữa chừng làm socket ECONNRESET; không bắt thì cả dev server sập
          proxy.on('error', () => {});
          proxy.on('proxyReqWs', (_req, _socket, clientSocket) => clientSocket.on('error', () => {}));
        },
      },
    },
  },
  build: {
    target: 'es2020',
    reportCompressedSize: false,
    // chunk 3D (Three.js) ~500 KB chưa nén / ~128 KB gzip, chỉ tải khi vào game 3D
    chunkSizeWarningLimit: 600,
  },
});
