import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { normalizeLook, type ClientMessage, type PlayerLook, type ServerMessage } from '../../../shared/protocol.js';
import { gameCatalog } from '../games/index.js';
import { RoomManager } from '../rooms/RoomManager.js';
import type { Room } from '../rooms/Room.js';
import type { Connection } from './connection.js';
import { serveStatic } from './static.js';
import { handleMonkeyUpgrade, serveMonkey } from '../monkey/index.js';
import { handleMonkeyApi } from '../monkey/api.js';
import { handleHeroesApi } from '../heroes/api.js';
import { serveHeroes } from '../heroes/index.js';
import { handleQuizHttp } from '../quiz/http.js';
import { RateLimiter, sanitizeCode, sanitizeName } from '../validation/input.js';

const PORT = Number(process.env.PORT ?? 8787);
/** generous enough for SPACE spamming, low enough to stop a flood */
const MSG_LIMIT = 80;
const MSG_WINDOW = 1000;

interface Session {
  conn: Connection;
  ws: WebSocket;
  limiter: RateLimiter;
  room: Room | null;
  playerId: string | null;
}

export function startServer() {
  const rooms = new RoomManager();

  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, serverTime: Date.now() }));
      return;
    }
    if (handleQuizHttp(req, res)) return;
    // game THẺ TƯỚNG (/heroes/): REST trước, rồi file tĩnh (chỉ nhận GET/HEAD dưới /heroes/)
    if (handleHeroesApi(req, res)) return;
    if (serveHeroes(req, res)) return;
    // Bầy Khỉ REST (/monkey/api/*) — phải đứng trước serveMonkey (serveMonkey chỉ nhận GET)
    if (handleMonkeyApi(req, res)) return;
    // game SINH TỒN BẦY KHỈ (/monkey/) — bundle + health riêng, tách khỏi minigame
    if (serveMonkey(req, res)) return;
    if (serveStatic(req, res)) return;
    res.writeHead(404);
    res.end();
  });

  // Định tuyến WebSocket theo đường dẫn upgrade: `/monkey/ws` sang game Bầy Khỉ,
  // mọi đường còn lại (`/arrow/ws`, hoặc `/` khi build với VITE_WS_URL cũ) vẫn là minigame như trước.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  http.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    if (handleMonkeyUpgrade(req, socket, head)) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    const conn: Connection = {
      id: randomUUID(),
      ping: 0,
      send: (msg: ServerMessage) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      },
      close: () => ws.close(),
    };
    const session: Session = { conn, ws, limiter: new RateLimiter(MSG_LIMIT, MSG_WINDOW), room: null, playerId: null };

    const fail = (message: string) => conn.send({ t: 'error', message });

    // client cần danh mục game để dựng màn tạo phòng
    conn.send({ t: 'games:catalog', games: gameCatalog() });

    ws.on('message', (data) => {
      if (!session.limiter.allow()) return; // silently drop floods
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;
      handle(session, msg, rooms, fail);
    });

    ws.on('close', () => {
      if (session.room && session.playerId) session.room.markDisconnected(session.playerId);
    });
    ws.on('error', () => ws.close());
  });

  http.listen(PORT, () => {
    console.log(`[arrow-party] websocket server listening on http://localhost:${PORT}`);
  });
}

function handle(session: Session, msg: ClientMessage, rooms: RoomManager, fail: (m: string) => void) {
  const { conn } = session;

  switch (msg.t) {
    case 'time:ping':
      // rtt is cosmetic (shown in the lobby) so trusting the client is fine
      if (typeof msg.rtt === 'number' && msg.rtt >= 0) conn.ping = Math.min(Math.round(msg.rtt), 9999);
      conn.send({ t: 'time:pong', clientSent: Number(msg.clientSent) || 0, serverTime: Date.now() });
      return;

    case 'room:create': {
      if (session.room) return fail('Bạn đang ở trong một phòng');
      const room = rooms.create();
      const playerId = joinRoom(session, room, sanitizeName(msg.name), normalizeLook(msg.look));
      // người tạo phòng là host nên áp được cài đặt ngay
      room.setSettings(playerId, msg.maxPlayers, msg.gameIds, msg.mode);
      return;
    }

    case 'room:join': {
      if (session.room) return fail('Bạn đang ở trong một phòng');
      const room = rooms.get(sanitizeCode(msg.code));
      if (!room) return fail('Không tìm thấy phòng');
      const reason = room.canJoin();
      if (reason) return fail(reason);
      joinRoom(session, room, sanitizeName(msg.name), normalizeLook(msg.look));
      return;
    }

    case 'room:rejoin': {
      const room = rooms.get(sanitizeCode(msg.code));
      if (!room) return fail('Phòng không còn tồn tại');
      const player = room.rejoin(conn, String(msg.playerId), String(msg.token));
      if (!player) return fail('Không khôi phục được phiên chơi');
      session.room = room;
      session.playerId = player.id;
      conn.send({ t: 'room:joined', code: room.code, playerId: player.id, token: player.token, serverTime: Date.now() });
      // vào lại giữa ván: gửi lại ván đang chơi / bảng điểm / kết quả để màn hình không bị trống
      room.resendCurrent(player.id);
      room.broadcastState();
      return;
    }

    case 'room:leave': {
      if (session.room && session.playerId) session.room.leave(session.playerId);
      session.room = null;
      session.playerId = null;
      return;
    }

    case 'room:ready':
      session.room?.setReady(session.playerId ?? '', Boolean(msg.ready));
      return;

    case 'room:settings': {
      if (!session.room || !session.playerId) return;
      const err = session.room.setSettings(session.playerId, msg.maxPlayers, msg.gameIds, msg.mode);
      if (err) fail(err);
      return;
    }

    case 'board:roll': {
      if (!session.room || !session.playerId) return;
      const err = session.room.rollDice(session.playerId);
      if (err) fail(err);
      return;
    }

    case 'game:start': {
      if (!session.room || !session.playerId) return;
      const err = session.room.startMatch(session.playerId);
      if (err) fail(err);
      return;
    }

    case 'lobby:emote': {
      if (!session.room || !session.playerId) return;
      session.room.emote(session.playerId, msg.emote);
      return;
    }

    case 'player:look': {
      if (!session.room || !session.playerId) return;
      session.room.setLook(session.playerId, normalizeLook(msg.look));
      return;
    }

    case 'match:again': {
      if (!session.room || !session.playerId) return;
      session.room.backToLobby(session.playerId);
      return;
    }

    case 'game:input': {
      if (!session.room || !session.playerId) return;
      if (typeof msg.gameId !== 'string' || !msg.input || typeof msg.input.type !== 'string') return;
      session.room.handleGameInput(session.playerId, msg.gameId, msg.input);
      return;
    }
  }
}

function joinRoom(session: Session, room: Room, name: string, look: PlayerLook): string {
  const playerId = randomUUID();
  const token = randomUUID();
  room.addPlayer(session.conn, name, playerId, token, look);
  session.room = room;
  session.playerId = playerId;
  session.conn.send({ t: 'room:joined', code: room.code, playerId, token, serverTime: Date.now() });
  room.broadcastState();
  return playerId;
}
