// Sinh icon app 1024x1024 (nguồn cho @capacitor/assets) từ emblem SVG vẽ bằng code:
// mũi tên neon bắn chéo trên nền tím-xanh, khớp bảng màu --accent/--gold/--danger của game.
// Chạy: `node scripts/gen-app-icon.mjs` (cần devDependency `sharp`).
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources');
mkdirSync(OUT_DIR, { recursive: true });

const svg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg" cx="38%" cy="30%" r="80%">
      <stop offset="0%" stop-color="#1a2050"/>
      <stop offset="55%" stop-color="#0d1030"/>
      <stop offset="100%" stop-color="#080a16"/>
    </radialGradient>
    <linearGradient id="arrow" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#4cc9f0"/>
      <stop offset="55%" stop-color="#7b61ff"/>
      <stop offset="100%" stop-color="#ff5c7a"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <g stroke="#ffd166" stroke-width="10" opacity="0.5" fill="none">
    <circle cx="512" cy="512" r="430"/>
  </g>
  <g transform="rotate(-38 512 512)">
    <rect x="212" y="472" width="520" height="80" rx="40" fill="url(#arrow)"/>
    <path d="M700 392 L860 512 L700 632 Z" fill="url(#arrow)"/>
    <path d="M212 472 L212 552 L120 512 Z" fill="#ffd166"/>
  </g>
  <g fill="#ffd166">
    <circle cx="210" cy="250" r="14"/>
    <circle cx="840" cy="760" r="18"/>
    <circle cx="790" cy="230" r="10"/>
  </g>
</svg>`;

writeFileSync(join(OUT_DIR, 'icon-source.svg'), svg);

await sharp(Buffer.from(svg)).resize(1024, 1024).png().toFile(join(OUT_DIR, 'icon.png'));

// Splash: cùng nền, logo nhỏ giữa màn hình (capacitor-assets tự canh giữa + letterbox).
const splashSvg = `
<svg width="2732" height="2732" viewBox="0 0 2732 2732" xmlns="http://www.w3.org/2000/svg">
  <rect width="2732" height="2732" fill="#080a16"/>
  <g transform="translate(1366 1366)">
    <g transform="rotate(-38) translate(-600 0) scale(2.3)">
      <rect x="212" y="472" width="520" height="80" rx="40" fill="#4cc9f0"/>
      <path d="M700 392 L860 512 L700 632 Z" fill="#7b61ff"/>
      <path d="M212 472 L212 552 L120 512 Z" fill="#ffd166"/>
    </g>
  </g>
</svg>`;

await sharp(Buffer.from(splashSvg)).resize(2732, 2732).png().toFile(join(OUT_DIR, 'splash.png'));

console.log('Wrote resources/icon.png + resources/splash.png');
