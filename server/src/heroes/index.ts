// Phục vụ file tĩnh của game Thẻ Tướng (heroes/dist) dưới HEROES_BASE, cùng tiến trình với Bầy Khỉ.
// Đường dẫn không có đuôi file → trả index.html (SPA). REST nằm ở api.ts và phải được gắn TRƯỚC hàm này.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { HEROES_BASE } from '../../../shared/heroes/config.js';

const ROOT = resolve(process.env.HEROES_STATIC_DIR ?? join(process.cwd(), '..', 'heroes', 'dist'));
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
};

/** phục vụ HEROES_BASE; trả false nếu không phải việc của nó */
export function serveHeroes(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let path: string;
  try {
    path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  } catch {
    return false;
  }
  if (path === HEROES_BASE.slice(0, -1)) {
    res.writeHead(302, { location: HEROES_BASE });
    res.end();
    return true;
  }
  if (!path.startsWith(HEROES_BASE)) return false;
  if (!existsSync(join(ROOT, 'index.html'))) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Chưa build giao diện game: chạy `npm run build` trong thư mục heroes/');
    return true;
  }
  const rel = normalize(path.slice(HEROES_BASE.length));
  let file = join(ROOT, rel);
  if (!(file + sep).startsWith(ROOT + sep)) return false;
  let ok = existsSync(file) && statSync(file).isFile();
  if (!ok) {
    if (extname(rel)) {
      res.writeHead(404);
      res.end();
      return true;
    }
    file = join(ROOT, 'index.html'); // SPA fallback
    ok = true;
  }
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  const cache = file.includes(join(ROOT, 'assets')) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': type, 'cache-control': cache, 'content-length': statSync(file).size });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
  return true;
}
