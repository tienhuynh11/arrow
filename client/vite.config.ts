import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
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
    proxy: {
      '/ws': {
        target: `http://localhost:${process.env.SERVER_PORT ?? 8787}`,
        ws: true,
        changeOrigin: true,
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
