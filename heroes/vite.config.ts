import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
// Đường dẫn gốc đọc từ MỘT nơi duy nhất (shared/heroes/config.ts) để server và client luôn khớp.
import { HEROES_BASE } from '../shared/heroes/config';
import { VitePWA } from 'vite-plugin-pwa';

const SERVER = `http://localhost:${process.env.SERVER_PORT ?? 8787}`;

export default defineConfig({
  base: HEROES_BASE,
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  plugins: [
    // PWA: manifest + service worker (generateSW). Chỉ chạy khi build; dev server không đăng ký SW (devOptions tắt).
    VitePWA({
      registerType: 'prompt', // có bản mới thì hỏi người chơi (toast "Cập nhật") thay vì tự tải lại giữa trận
      injectRegister: false, // đăng ký thủ công trong src/pwa.ts qua virtual:pwa-register
      manifestFilename: 'manifest.webmanifest',
      devOptions: { enabled: false },
      includeAssets: ['icons/apple-touch-icon.png', 'icons/icon.svg'],
      manifest: {
        name: 'Thẻ Tướng 3D',
        short_name: 'Thẻ Tướng',
        description: 'Sưu tầm tướng, dựng đội hình, vượt ải theo lượt.',
        lang: 'vi',
        start_url: HEROES_BASE,
        scope: HEROES_BASE,
        id: HEROES_BASE,
        display: 'standalone',
        orientation: 'any',
        theme_color: '#5ec0ff',
        background_color: '#bfeaff',
        categories: ['games'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // precache vỏ ứng dụng (html/js/css/icon); model 3D (glb) tải theo nhu cầu, không precache
        globPatterns: ['**/*.{html,js,css,png,svg,ico,webmanifest}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: `${HEROES_BASE}index.html`,
        navigateFallbackDenylist: [new RegExp(`^${HEROES_BASE}api/`)], // REST không bao giờ bị SW chặn / trả index.html
        runtimeCaching: [
          // REST: luôn đi mạng, không lưu cache
          { urlPattern: ({ url }) => url.pathname.startsWith(`${HEROES_BASE}api/`), handler: 'NetworkOnly' },
          // CSS của Google Fonts: dùng bản cache trước, cập nhật ngầm
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'gfonts-css' },
          },
          // file font thật: ít đổi nên giữ lâu
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'gfonts-files', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } },
          },
          // model glTF (nếu có) tải một lần
          {
            urlPattern: ({ url }) => url.pathname.startsWith(`${HEROES_BASE}models/`),
            handler: 'CacheFirst',
            options: { cacheName: 'heroes-models', expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
    }),
  ],
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
