// Cổng vào của SINH TỒN BẦY KHỈ trên CÙNG tiến trình server Node với Arrow Party nhưng tách biệt:
// WebSocket riêng (noServer, chỉ nhận upgrade ở `${MONKEY_BASE}ws`), phòng riêng, giao thức riêng,
// và file tĩnh riêng (monkey/dist) dưới MONKEY_BASE.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { CLASSES } from '../../../shared/monkey/content.js';
import { CODE_ALPHABET, CODE_LEN, MONKEY_BASE, MONKEY_WS_PATH, NAME_MAX } from '../../../shared/monkey/config.js';
import { decodeCmds, type CMsg, type SMsg } from '../../../shared/monkey/proto.js';
import type { Cmd } from '../../../shared/monkey/sim.js';
import { topRuns } from './leaderboard.js';
import { MonkeyRoom, type MConn, type MPlayer } from './room.js';

const MAX_ROOMS = 40;
const rooms = new Map<string, MonkeyRoom>();

function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'KHỈ SĂN';
  const s = raw
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/[<>&"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  return s || 'KHỈ SĂN';
}
function sanitizeCode(raw: unknown) {
  return typeof raw === 'string' ? raw.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() : '';
}
function sanitizeCls(raw: unknown) {
  const n = Number(raw) | 0;
  return n >= 0 && n < CLASSES.length ? n : 0;
}

function newCode(): string {
  for (let k = 0; k < 200; k++) {
    let c = '';
    for (let i = 0; i < CODE_LEN; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function createRoom(solo: boolean): MonkeyRoom | null {
  if (rooms.size >= MAX_ROOMS) return null;
  const room = new MonkeyRoom(newCode(), solo);
  room.onEmpty = () => {
    if (room.disposed) {
      rooms.delete(room.code);
      return;
    }
    if (room.phase !== 'play') room.dispose();
  };
  rooms.set(room.code, room);
  return room;
}

interface Session {
  conn: MConn;
  room: MonkeyRoom | null;
  player: MPlayer | null;
  jsonTokens: number;
  binTokens: number;
  at: number;
}

const cmdBuf: Cmd[] = [];
for (let i = 0; i < 16; i++) cmdBuf.push({ seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, btn: 0, vt: 0 });

let bytesTotal = 0;

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false, clientTracking: false });

wss.on('connection', (ws: WebSocket) => {
  const conn: MConn = {
    sent: 0,
    send(d) {
      if (ws.readyState !== WebSocket.OPEN) return;
      // client chậm (bộ đệm phình > 256KB) → bỏ bớt snapshot thay vì ngốn RAM server
      if (typeof d !== 'string' && ws.bufferedAmount > 256 * 1024) return;
      ws.send(d);
      const n = typeof d === 'string' ? d.length : d.byteLength;
      conn.sent += n;
      bytesTotal += n;
    },
    close() {
      ws.close();
    },
  };
  const s: Session = { conn, room: null, player: null, jsonTokens: 20, binTokens: 60, at: Date.now() };
  const send = (m: SMsg) => conn.send(JSON.stringify(m));
  send({ t: 'welcome', st: Date.now() });

  ws.on('message', (data: Buffer, isBinary: boolean) => {
    const now = Date.now();
    const el = (now - s.at) / 1000;
    s.at = now;
    s.jsonTokens = Math.min(20, s.jsonTokens + el * 12);
    s.binTokens = Math.min(80, s.binTokens + el * 70);
    if (isBinary) {
      if (s.binTokens < 1) return;
      s.binTokens -= 1;
      if (!s.room || !s.player) return;
      const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const n = decodeCmds(v, cmdBuf);
      if (n > 0) {
        try {
          s.room.onCmds(s.player, cmdBuf, n);
        } catch (e) {
          console.error('[monkey] lỗi xử lý lệnh', e);
        }
      }
      return;
    }
    if (s.jsonTokens < 1) return;
    s.jsonTokens -= 1;
    let m: CMsg;
    try {
      m = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;
    try {
      handle(s, m, send);
    } catch (e) {
      console.error('[monkey] lỗi xử lý tin nhắn', m.t, e);
    }
  });
  ws.on('close', () => {
    if (s.room && s.player) s.room.disconnected(s.player);
    s.room = null;
    s.player = null;
  });
  ws.on('error', () => ws.close());
});

function handle(s: Session, m: CMsg, send: (m: SMsg) => void) {
  switch (m.t) {
    case 'ping':
      send({ t: 'pong', c: Number(m.c) || 0, st: Date.now() });
      return;
    case 'lb':
      send({ t: 'lb', solo: topRuns(true, 15), team: topRuns(false, 15) });
      return;
    case 'create': {
      if (s.room && s.player) s.room.leave(s.player);
      const room = createRoom(!!m.solo);
      if (!room) return send({ t: 'err', m: 'Máy chủ đang đầy phòng, thử lại sau' });
      s.room = room;
      s.player = room.add(sanitizeName(m.name), sanitizeCls(m.cls), s.conn);
      if (room.solo) room.begin();
      return;
    }
    case 'join': {
      const room = rooms.get(sanitizeCode(m.code));
      if (!room || room.disposed) return send({ t: 'err', m: 'Không tìm thấy phòng' });
      const why = room.canJoin();
      if (why) return send({ t: 'err', m: why });
      if (s.room && s.player) s.room.leave(s.player);
      s.room = room;
      s.player = room.add(sanitizeName(m.name), sanitizeCls(m.cls), s.conn);
      return;
    }
    case 'rejoin': {
      const room = rooms.get(sanitizeCode(m.code));
      if (!room || room.disposed) return send({ t: 'err', m: 'Phòng không còn tồn tại' });
      const p = room.rejoin(String(m.pid), String(m.token), s.conn);
      if (!p) return send({ t: 'err', m: 'Không khôi phục được phiên chơi' });
      s.room = room;
      s.player = p;
      return;
    }
    case 'leave':
      if (s.room && s.player) s.room.leave(s.player);
      s.room = null;
      s.player = null;
      send({ t: 'left' });
      return;
  }
  const room = s.room;
  const p = s.player;
  if (!room || !p) return;
  switch (m.t) {
    case 'cls':
      room.setClass(p, sanitizeCls(m.cls));
      return;
    case 'ready':
      room.setReady(p, !!m.r);
      return;
    case 'start': {
      const err = room.start(p);
      if (err) send({ t: 'err', m: err });
      return;
    }
    case 'buy':
      if (m.item === 'weapon' || m.item === 'hp') room.buy(p, m.item);
      return;
    case 'bready':
      room.setBreakReady(p, !!m.r);
      return;
    case 'again':
      room.again(p);
      return;
  }
}

/** gắn vào sự kiện 'upgrade' của http server; trả true nếu là WebSocket của game này */
export function handleMonkeyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const path = (req.url ?? '').split('?')[0];
  if (path !== MONKEY_WS_PATH && path !== MONKEY_WS_PATH + '/') return false;
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  return true;
}

/* ======================= FILE TĨNH ======================= */
const ROOT = resolve(process.env.MONKEY_STATIC_DIR ?? join(process.cwd(), '..', 'monkey', 'dist'));
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

let lastStatAt = Date.now();
let lastBytes = 0;

/** phục vụ MONKEY_BASE (trang + /health riêng); trả false nếu không phải việc của nó */
export function serveMonkey(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let path: string;
  try {
    path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  } catch {
    return false;
  }
  if (path === MONKEY_BASE.slice(0, -1)) {
    res.writeHead(302, { location: MONKEY_BASE });
    res.end();
    return true;
  }
  if (!path.startsWith(MONKEY_BASE)) return false;
  if (path === `${MONKEY_BASE}health`) {
    const now = Date.now();
    const bps = ((bytesTotal - lastBytes) * 1000) / Math.max(1, now - lastStatAt);
    lastBytes = bytesTotal;
    lastStatAt = now;
    let players = 0;
    let monkeys = 0;
    let tickMs = 0;
    for (const r of rooms.values()) {
      players += r.online;
      monkeys += r.world?.count ?? 0;
      tickMs = Math.max(tickMs, r.tickMs);
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players, monkeys, maxTickMs: +tickMs.toFixed(2), bytesPerSec: Math.round(bps), rss: process.memoryUsage().rss }));
    return true;
  }
  if (!existsSync(join(ROOT, 'index.html'))) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Chưa build giao diện game: chạy `npm run build` trong thư mục monkey/');
    return true;
  }
  const rel = normalize(path.slice(MONKEY_BASE.length));
  let file = join(ROOT, rel);
  if (!(file + sep).startsWith(ROOT + sep)) return false;
  let ok = existsSync(file) && statSync(file).isFile();
  if (!ok) {
    if (extname(rel)) {
      res.writeHead(404);
      res.end();
      return true;
    }
    file = join(ROOT, 'index.html');
    ok = true;
  }
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  const cache = file.includes(join(ROOT, 'assets')) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': type, 'cache-control': cache, 'content-length': statSync(file).size });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
  return true;
}

export function monkeyStats() {
  return { rooms: rooms.size };
}

