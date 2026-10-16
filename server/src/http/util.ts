// Tiện ích HTTP dùng chung (quiz admin, Bầy Khỉ REST): trả JSON, đọc body có giới hạn, lỗi HTTP,
// IP người gọi, so khoá an toàn thời gian + chặn thử sai theo IP.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function clientIp(req: IncomingMessage): string {
  const xf = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xf) ? xf[0] : xf)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || '?';
}

/** so sánh hai chuỗi bí mật không lộ thời gian (băm trước nên độ dài khác nhau vẫn an toàn) */
export function sameKey(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
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

export function parseJson(buf: Buffer): any {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON không hợp lệ');
  }
}

/** đếm số lần thất bại theo IP trong một cửa sổ thời gian */
export class FailLimiter {
  private map = new Map<string, { n: number; reset: number }>();
  constructor(readonly limit: number, readonly windowMs: number) {}
  blocked(ip: string, now = Date.now()) {
    const rec = this.map.get(ip);
    return !!rec && now < rec.reset && rec.n >= this.limit;
  }
  reset() {
    this.map.clear();
  }
  fail(ip: string, now = Date.now()) {
    const rec = this.map.get(ip);
    if (!rec || now >= rec.reset) this.map.set(ip, { n: 1, reset: now + this.windowMs });
    else rec.n += 1;
    if (this.map.size > 5000) for (const [k, v] of this.map) if (now >= v.reset) this.map.delete(k);
  }
}

/**
 * Tạo hàm kiểm tra header x-admin-key. `getKey` trả null/'' = admin tắt (403).
 * Trả null nếu hợp lệ, ngược lại {status, message}.
 */
export function createAdminCheck(getKey: () => string | null | undefined, limit = 10, windowMs = 60_000) {
  const fails = new FailLimiter(limit, windowMs);
  return (req: IncomingMessage): { status: number; message: string } | null => {
    const expected = getKey();
    if (!expected) return { status: 403, message: 'Admin đã tắt' };
    const ip = clientIp(req);
    if (fails.blocked(ip)) return { status: 429, message: 'Sai khoá quá nhiều lần, thử lại sau' };
    const h = req.headers['x-admin-key'];
    const given = Array.isArray(h) ? h[0] : h;
    if (typeof given === 'string' && sameKey(given, expected)) return null;
    fails.fail(ip);
    return { status: 403, message: 'Sai khoá admin' };
  };
}
