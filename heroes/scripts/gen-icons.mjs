// Sinh icon PWA (PNG) từ một emblem SVG vẽ bằng code: mặt chibi đội vương miện trên nền trời xanh.
// Chạy: `node scripts/gen-icons.mjs` (cần devDependency `sharp`). PNG sinh ra nằm ở public/icons và được commit.
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

const INK = '#1e2a4a';

/** emblem vẽ trong hệ toạ độ 512x512, tâm (256,256); `k` co nhỏ quanh tâm (maskable cần vùng an toàn ~80%) */
function emblem(k) {
  return `
  <g transform="translate(256 262) scale(${k}) translate(-256 -262)" stroke="${INK}" stroke-width="14" stroke-linejoin="round" stroke-linecap="round">
    <!-- mặt chibi -->
    <ellipse cx="256" cy="316" rx="136" ry="124" fill="#ffe0bd"/>
    <!-- tóc mái -->
    <path d="M122 292c6-52 56-78 134-78s128 26 134 78c-34-26-70-34-134-34s-100 8-134 34z" fill="#7a4a2a"/>
    <!-- má hồng -->
    <ellipse cx="176" cy="344" rx="22" ry="14" fill="#ff9aa8" stroke="none" opacity=".85"/>
    <ellipse cx="336" cy="344" rx="22" ry="14" fill="#ff9aa8" stroke="none" opacity=".85"/>
    <!-- mắt -->
    <ellipse cx="206" cy="324" rx="16" ry="24" fill="${INK}" stroke="none"/>
    <ellipse cx="306" cy="324" rx="16" ry="24" fill="${INK}" stroke="none"/>
    <circle cx="211" cy="314" r="6" fill="#fff" stroke="none"/>
    <circle cx="311" cy="314" r="6" fill="#fff" stroke="none"/>
    <!-- miệng -->
    <path d="M238 366q18 18 36 0" fill="none"/>
    <!-- vương miện -->
    <path d="M160 214l-14-86 66 52 44-72 44 72 66-52-14 86z" fill="#ffd23f"/>
    <path d="M164 214h184" fill="none"/>
    <circle cx="256" cy="150" r="13" fill="#ff5c6c" stroke-width="9"/>
    <circle cx="176" cy="152" r="9" fill="#3fa7ff" stroke-width="7"/>
    <circle cx="336" cy="152" r="9" fill="#3fa7ff" stroke-width="7"/>
  </g>`;
}

/** nền: trời xanh chuyển sắc + vài ngôi sao; `round` = bo góc (any), không bo = tràn viền (maskable) */
function svg(size, { round, k }) {
  const rx = round ? 104 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd6ff"/><stop offset="1" stop-color="#3fa7ff"/></linearGradient>
    <radialGradient id="r" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="512" height="512" rx="${rx}" fill="url(#g)"/>
  <rect width="512" height="512" rx="${rx}" fill="url(#r)"/>
  <g fill="#fff" opacity=".9" transform="translate(256 256) scale(${k}) translate(-256 -256)">
    <path d="M70 120l7 17 18 1-14 11 5 18-16-10-16 10 5-18-14-11 18-1z"/>
    <path d="M440 96l5 12 13 1-10 8 3 13-11-7-11 7 3-13-10-8 13-1z"/>
    <path d="M430 410l6 14 15 1-12 9 4 15-13-8-13 8 4-15-12-9 15-1z"/>
  </g>
  ${emblem(k)}
</svg>`;
}

async function png(name, size, opt) {
  await sharp(Buffer.from(svg(size, opt))).png({ compressionLevel: 9 }).toFile(join(OUT, name));
  console.log('ok', name);
}

await png('icon-192.png', 192, { round: true, k: 1 });
await png('icon-512.png', 512, { round: true, k: 1 });
await png('icon-maskable-512.png', 512, { round: false, k: 0.74 }); // emblem nằm gọn trong vùng an toàn 80%
await png('apple-touch-icon.png', 180, { round: false, k: 0.9 }); // iOS tự bo góc, nên tràn viền
writeFileSync(join(OUT, 'icon.svg'), svg(512, { round: true, k: 1 }));
