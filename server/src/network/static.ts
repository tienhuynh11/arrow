import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

/** Thư mục giao diện đã build (client/dist). Trên Fly: /app/client/dist. Không có thì server chỉ làm WebSocket. */
const ROOT = resolve(process.env.STATIC_DIR ?? join(process.cwd(), '..', 'client', 'dist'));
const BASE = '/arrow/';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export const hasStatic = existsSync(join(ROOT, 'index.html'));

/** Trả file tĩnh của client; trả false nếu không phải việc của nó. */
export function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
  if (!hasStatic || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (path === '/') {
    res.writeHead(302, { location: BASE });
    res.end();
    return true;
  }
  if (!path.startsWith(BASE)) return false;
  const rel = normalize(path.slice(BASE.length));
  let file = join(ROOT, rel);
  if (!(file + sep).startsWith(ROOT + sep)) return false;
  let ok = existsSync(file) && statSync(file).isFile();
  // đường dẫn không phải file (hoặc thư mục) → trang chính
  if (!ok) {
    if (extname(rel)) return false;
    file = join(ROOT, 'index.html');
    ok = true;
  }
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  // file trong assets/ có hash trong tên → cache lâu; còn lại luôn hỏi lại
  const cache = file.includes(`${join(ROOT, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': type, 'cache-control': cache, 'content-length': statSync(file).size });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
  return true;
}
