import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { extname, join } from 'node:path';
import {
  MEDIA_DIR,
  MEDIA_PREFIX,
  atomicWrite,
  ensureDirs,
  gcMedia,
  loadQuestions,
  mediaUsage,
  referencedMedia,
  saveQuestions,
  validateQuestions,
} from './store.js';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

const MAX_QUESTIONS_BODY = 2 * 1024 * 1024;
const MAX_UPLOAD = 25 * 1024 * 1024;
const MAX_IMPORT = 120 * 1024 * 1024;
const MAX_MEDIA_TOTAL = 500 * 1024 * 1024;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---- xác thực admin ----
const FAILS = new Map<string, { n: number; reset: number }>();
const FAIL_LIMIT = 10;
const FAIL_WINDOW = 60_000;

function clientIp(req: IncomingMessage): string {
  const xf = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xf) ? xf[0] : xf)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || '?';
}

function sameKey(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function checkAdmin(req: IncomingMessage): { status: number; message: string } | null {
  let expected = process.env.QUIZ_ADMIN_KEY;
  if (!expected) {
    if (process.env.NODE_ENV === 'production') return { status: 403, message: 'Admin đã tắt' };
    expected = 'dev';
  }
  const ip = clientIp(req);
  const now = Date.now();
  const rec = FAILS.get(ip);
  if (rec && now < rec.reset && rec.n >= FAIL_LIMIT) return { status: 429, message: 'Sai khoá quá nhiều lần, thử lại sau' };
  const h = req.headers['x-admin-key'];
  const given = Array.isArray(h) ? h[0] : h;
  if (typeof given === 'string' && sameKey(given, expected)) return null;
  if (!rec || now >= rec.reset) FAILS.set(ip, { n: 1, reset: now + FAIL_WINDOW });
  else rec.n += 1;
  if (FAILS.size > 5000) for (const [k, v] of FAILS) if (now >= v.reset) FAILS.delete(k);
  return { status: 403, message: 'Sai khoá admin' };
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length'] ?? 0);
    if (len > limit) return reject(new HttpError(413, 'Dữ liệu quá lớn'));
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Dữ liệu quá lớn'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseJson(buf: Buffer): any {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON không hợp lệ');
  }
}

// ---- media ----
function serveMedia(req: IncomingMessage, res: ServerResponse, name: string) {
  if (!/^[a-z0-9._-]+$/.test(name) || name.startsWith('.')) {
    res.writeHead(404);
    res.end();
    return;
  }
  const file = join(MEDIA_DIR, name);
  const type = MIME[extname(name).toLowerCase()];
  if (!type || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  const size = statSync(file).size;
  const base = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
  };
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = 0;
    let end = size - 1;
    let valid = !!m;
    if (m) {
      if (m[1] === '' && m[2] === '') valid = false;
      else if (m[1] === '') {
        const suffix = Number(m[2]);
        start = Math.max(0, size - suffix);
      } else {
        start = Number(m[1]);
        if (m[2] !== '') end = Math.min(Number(m[2]), size - 1);
      }
      if (start > end || start >= size) valid = false;
    }
    if (!valid) {
      res.writeHead(416, { ...base, 'content-range': `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...base, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...base, 'content-length': size });
  if (req.method === 'HEAD') return void res.end();
  createReadStream(file).pipe(res);
}

// ---- admin API ----
const safeExt = (name: string) => {
  const e = extname(name).toLowerCase();
  return MIME[e] ? e : null;
};

async function adminApi(req: IncomingMessage, res: ServerResponse, route: string, url: URL) {
  const method = req.method;
  if (route === 'ping' && method === 'GET') return json(res, 200, { ok: true });

  if (route === 'questions' && method === 'GET') return json(res, 200, { questions: loadQuestions() });

  if (route === 'questions' && method === 'PUT') {
    const body = parseJson(await readBody(req, MAX_QUESTIONS_BODY));
    let qs;
    try {
      qs = validateQuestions(body?.questions);
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
    saveQuestions(qs);
    return json(res, 200, { ok: true, count: qs.length });
  }

  if (route === 'upload' && method === 'POST') {
    const ext = safeExt(url.searchParams.get('name') ?? '');
    if (!ext) throw new HttpError(400, 'Đuôi file không được hỗ trợ');
    const buf = await readBody(req, MAX_UPLOAD);
    if (!buf.length) throw new HttpError(400, 'File rỗng');
    ensureDirs();
    if (mediaUsage() + buf.length > MAX_MEDIA_TOTAL) throw new HttpError(507, 'Hết dung lượng media');
    const name = `${randomBytes(8).toString('hex')}${ext}`;
    atomicWrite(join(MEDIA_DIR, name), buf);
    return json(res, 200, { url: MEDIA_PREFIX + name });
  }

  if (route === 'export' && method === 'GET') {
    const questions = loadQuestions();
    const media: Record<string, { type: string; b64: string }> = {};
    for (const f of referencedMedia(questions)) {
      const p = join(MEDIA_DIR, f);
      if (!/^[a-z0-9._-]+$/.test(f) || !existsSync(p)) continue;
      media[f] = { type: MIME[extname(f).toLowerCase()] ?? 'application/octet-stream', b64: readFileSync(p).toString('base64') };
    }
    return json(res, 200, { version: 1, questions, media });
  }

  if (route === 'import' && method === 'POST') {
    const body = parseJson(await readBody(req, MAX_IMPORT));
    if (!body || body.version !== 1) throw new HttpError(400, 'Định dạng sao lưu không đúng (version 1)');
    const media = body.media && typeof body.media === 'object' ? body.media : {};
    // ghi media mới với tên mới, rồi đổi URL trong câu hỏi
    const rename = new Map<string, string>();
    const toWrite: Array<[string, Buffer]> = [];
    let total = 0;
    for (const [orig, v] of Object.entries<any>(media)) {
      const ext = safeExt(orig);
      if (!ext || !v || typeof v.b64 !== 'string') throw new HttpError(400, `Media không hợp lệ: ${orig.slice(0, 40)}`);
      const buf = Buffer.from(v.b64, 'base64');
      total += buf.length;
      if (total > MAX_MEDIA_TOTAL) throw new HttpError(507, 'Media vượt dung lượng cho phép');
      const name = `${randomBytes(8).toString('hex')}${ext}`;
      rename.set(orig, name);
      toWrite.push([name, buf]);
    }
    const fix = (u: unknown) => {
      if (typeof u === 'string' && u.startsWith(MEDIA_PREFIX)) {
        const n = rename.get(u.slice(MEDIA_PREFIX.length));
        return n ? MEDIA_PREFIX + n : undefined; // media thiếu trong bản sao lưu thì bỏ
      }
      return u;
    };
    const rawQs = Array.isArray(body.questions) ? body.questions : null;
    if (!rawQs) throw new HttpError(400, 'Thiếu questions');
    let qs;
    try {
      qs = validateQuestions(rawQs.map((q: any) => (q && typeof q === 'object' ? { ...q, image: fix(q.image), audio: fix(q.audio), video: fix(q.video) } : q)));
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
    ensureDirs();
    for (const [name, buf] of toWrite) atomicWrite(join(MEDIA_DIR, name), buf);
    saveQuestions(qs);
    gcMedia(); // thay thế toàn bộ: bỏ media cũ không còn dùng
    return json(res, 200, { ok: true, count: qs.length });
  }

  if (route === 'gc' && method === 'POST') return json(res, 200, { removed: gcMedia() });

  throw new HttpError(404, 'Không có API này');
}

/** trả true nếu request thuộc quiz (đã xử lý hoặc đang xử lý bất đồng bộ) */
export function handleQuizHttp(req: IncomingMessage, res: ServerResponse): boolean {
  const raw = req.url ?? '';
  const q = raw.indexOf('?');
  const path = q < 0 ? raw : raw.slice(0, q);

  if (path.startsWith(MEDIA_PREFIX)) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return true;
    }
    serveMedia(req, res, path.slice(MEDIA_PREFIX.length));
    return true;
  }

  const ADMIN = '/arrow/admin/api/';
  if (!path.startsWith(ADMIN)) return false;

  const denied = checkAdmin(req);
  if (denied) {
    json(res, denied.status, { error: denied.message });
    return true;
  }
  const url = new URL(raw, 'http://x');
  adminApi(req, res, path.slice(ADMIN.length), url).catch((e) => {
    if (res.headersSent) return void res.end();
    if (e instanceof HttpError) return json(res, e.status, { error: e.message });
    console.error('[quiz] admin error:', (e as Error).message);
    json(res, 500, { error: 'Lỗi máy chủ' });
  });
  return true;
}
