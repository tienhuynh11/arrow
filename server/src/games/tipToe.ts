import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';

/**
 * Con đường ẩn: sàn gồm nhiều hàng ô, mỗi hàng chỉ một vài ô THẬT nối thành một đường liền tới đích — còn lại là ô giả.
 * Bước nhầm ô giả: ô vỡ (ai cũng thấy nó vỡ và nhớ lấy), người đó rơi rồi quay lại vạch xuất phát.
 * Đường đi do server sinh ngẫu nhiên và không bao giờ gửi cho client; client chỉ nhận danh sách ô ĐÃ vỡ.
 * Ai về đích trước thắng; người đầu tiên về đích mở đồng hồ đóng ván cho những người còn lại.
 */
interface Config {
  cols: number;
  rows: number;
  size: number;
  speed: number;
  radius: number;
  /** độ sâu bệ xuất phát (phía +y) và bệ đích (phía -y) */
  startDepth: number;
  finishDepth: number;
  endsAt: number;
  spawns: Record<string, [number, number]>;
}

interface PState {
  x: number;
  y: number;
  dx: number;
  dy: number;
  moveAt: number;
  /** đang rơi tới lúc này rồi mới quay về xuất phát; 0 = không rơi */
  fallUntil: number;
  falls: number;
  /** số hàng xa nhất đã bước qua */
  reach: number;
  finishAt: number | null;
  /** hướng nhìn gần nhất (đơn vị) — hướng đá */
  fx: number;
  fy: number;
  /** vận tốc bị hất */
  kx: number;
  ky: number;
  stunUntil: number;
  kickAt: number;
  lastHitBy: string | null;
  lastHitAt: number;
  /** số người đã hất rơi */
  kos: number;
}

interface State {
  /** 1 = ô thật (bí mật của server) */
  safe: Uint8Array;
  /** 1 = ô giả đã vỡ (công khai) */
  broken: Uint8Array;
  players: Record<string, PState>;
  finished: string[];
  closeAt: number | null;
  dirty: boolean;
  lastTick: number;
  lastBroadcast: number;
  lastSnap: number;
}

const ROWS = 24;
const SIZE = 14;
const SPEED = 40;
const PLAYER_R = 2.6;
const START_DEPTH = 18;
const FINISH_DEPTH = 18;
const RESPAWN_MS = 1500;
const CLOSE_MS = 15_000;
const HOLD_TIMEOUT = 900;
const DURATION = 105_000;
const KICK_CD = 1000;
const KICK_RANGE = 8.5;
const KICK_CONE = 0.3;
const KICK_V = 95;
const KNOCK_DECAY = 5;
const STUN_MS = 650;
const KO_WINDOW = 3000;
const BODY_R = 2.4;
const BROADCAST_MS = 70;

const colsFor = (players: number) => (players <= 6 ? 6 : 8);

/** đường thật: mỗi hàng là một đoạn ngang liền nhau, hàng sau bắt đầu đúng cột mà hàng trước kết thúc */
function makePath(cols: number, rows: number): Uint8Array {
  const safe = new Uint8Array(cols * rows);
  let enter = Math.floor(Math.random() * cols);
  for (let r = 0; r < rows; r++) {
    let exit = enter;
    if (Math.random() < 0.5) {
      const step = Math.random() < 0.7 ? 1 : 2;
      exit = Math.max(0, Math.min(cols - 1, enter + (Math.random() < 0.5 ? -step : step)));
    }
    for (let c = Math.min(enter, exit); c <= Math.max(enter, exit); c++) safe[r * cols + c] = 1;
    enter = exit;
  }
  // nhánh cụt: vài ô thật dẫn vào ngõ cụt để đánh lừa
  for (let r = 1; r < rows - 1; r++) {
    if (Math.random() > 0.2) continue;
    let lo = cols;
    let hi = -1;
    for (let c = 0; c < cols; c++) if (safe[r * cols + c]) { lo = Math.min(lo, c); hi = Math.max(hi, c); }
    const c = Math.random() < 0.5 ? lo - 1 : hi + 1;
    if (c < 0 || c >= cols) continue;
    safe[r * cols + c] = 1;
    if (Math.random() < 0.5) safe[(r + 1) * cols + c] = 1;
  }
  return safe;
}

export const tipToeGame: GameDefinition<Config, State> = {
  id: 'tiptoe',
  name: 'CON ĐƯỜNG ẨN',
  instructions:
    'Sàn kính dài có MỘT đường thật; bước nhầm ô giả là ô vỡ và bạn quay lại vạch xuất phát. Nhìn người khác thử sai để tìm đường, nhưng họ có thể chen và đá bạn rơi. Về đích đầu tiên thắng; hất rơi người khác được thêm điểm.',
  controls: [
    { keys: ['←', '↑', '→', '↓'], desc: 'Giữ để chạy mọi hướng · đứng trên ô nào là thử ô đó' },
    { keys: ['SPACE'], desc: 'Đá/hất người phía trước ra xa (hồi 1 giây) — hất họ vào ô giả hoặc ra mép để họ rơi' },
  ],
  duration: DURATION + 1500,
  minPlayers: 1,
  maxPlayers: 16,

  createConfig(ctx) {
    const n = ctx.playerIds.length;
    const cols = colsFor(n);
    const half = (cols * SIZE) / 2;
    const spawns: Record<string, [number, number]> = {};
    const ids = [...ctx.playerIds];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const per = Math.min(n, cols);
    const stepX = (half * 2 - 12) / Math.max(1, per);
    ids.forEach((id, i) => {
      const cx = (i % per) - (per - 1) / 2;
      const row = Math.floor(i / per);
      spawns[id] = [Math.round(cx * stepX * 10) / 10, 3.5 + row * 3.8];
    });
    return {
      cols,
      rows: ROWS,
      size: SIZE,
      speed: SPEED,
      radius: PLAYER_R,
      startDepth: START_DEPTH,
      finishDepth: FINISH_DEPTH,
      endsAt: DURATION,
      spawns,
    };
  },

  createState(ctx, config) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      const [x, y] = config.spawns[id];
      players[id] = {
        x, y, dx: 0, dy: 0, moveAt: 0, fallUntil: 0, falls: 0, reach: 0, finishAt: null,
        fx: 0, fy: -1, kx: 0, ky: 0, stunUntil: 0, kickAt: 0, lastHitBy: null, lastHitAt: 0, kos: 0,
      };
    }
    return {
      safe: makePath(config.cols, config.rows),
      broken: new Uint8Array(config.cols * config.rows),
      players,
      finished: [],
      closeAt: null,
      dirty: true,
      lastTick: ctx.startAt,
      lastBroadcast: 0,
      lastSnap: 0,
    };
  },

  handleInput(ctx, state, _config, playerId, input: GameInput) {
    const p = state.players[playerId];
    if (!p || p.fallUntil) return;
    if (input.type === 'kick') {
      const now = ctx.now();
      if (now < ctx.startAt || now < p.stunUntil || now - p.kickAt < KICK_CD) return;
      p.kickAt = now;
      const hits: string[] = [];
      for (const id of ctx.playerIds) {
        const q = state.players[id];
        if (id === playerId || q.fallUntil || q.finishAt !== null) continue;
        const ox = q.x - p.x;
        const oy = q.y - p.y;
        const d = Math.hypot(ox, oy);
        if (d > KICK_RANGE) continue;
        const ux = d > 0.01 ? ox / d : p.fx;
        const uy = d > 0.01 ? oy / d : p.fy;
        if (d > 3 && ux * p.fx + uy * p.fy < KICK_CONE) continue;
        q.kx = ux * KICK_V;
        q.ky = uy * KICK_V;
        q.dx = q.dy = 0;
        q.stunUntil = now + STUN_MS;
        q.lastHitBy = playerId;
        q.lastHitAt = now;
        hits.push(id);
      }
      ctx.broadcast({ type: 'kick', by: playerId, hits, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
      return;
    }
    if (input.type !== 'moveXY') return;
    p.dx = Math.max(-1, Math.min(1, Math.round(Number(input.dx) || 0)));
    p.dy = Math.max(-1, Math.min(1, Math.round(Number(input.dy) || 0)));
    p.moveAt = ctx.now();
    if (p.dx || p.dy) {
      const l = Math.hypot(p.dx, p.dy);
      p.fx = p.dx / l;
      p.fy = p.dy / l;
    }
  },

  update(ctx, state, config) {
    const now = ctx.now();
    const rel = now - ctx.startAt;
    const dt = Math.min(now - state.lastTick, 200) / 1000;
    state.lastTick = now;
    const { cols, rows, size } = config;
    const halfX = (cols * size) / 2;
    const limX = halfX - 1;
    const maxY = config.startDepth - 1;
    const minY = -(rows * size + config.finishDepth - 1);

    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (now < ctx.startAt) continue;

      if (p.fallUntil) {
        if (now < p.fallUntil) continue;
        // rơi xong → quay về xuất phát
        const [sx, sy] = config.spawns[id];
        p.x = sx;
        p.y = sy;
        p.dx = p.dy = 0;
        p.kx = p.ky = 0;
        p.stunUntil = 0;
        p.lastHitBy = null;
        p.fallUntil = 0;
        continue;
      }

      if (now - p.moveAt > HOLD_TIMEOUT) {
        p.dx = 0;
        p.dy = 0;
      }
      const stunned = now < p.stunUntil;
      let nx = p.x;
      let ny = p.y;
      if (dt > 0 && !stunned && (p.dx !== 0 || p.dy !== 0)) {
        const len = Math.hypot(p.dx, p.dy) || 1;
        nx += (p.dx / len) * config.speed * dt;
        ny += (p.dy / len) * config.speed * dt;
      }
      if (dt > 0 && (p.kx || p.ky)) {
        nx += p.kx * dt;
        ny += p.ky * dt;
        const decay = Math.exp(-KNOCK_DECAY * dt);
        p.kx *= decay;
        p.ky *= decay;
        if (Math.hypot(p.kx, p.ky) < 4) p.kx = p.ky = 0;
      }
      const inRows = ny < 0 && ny > -rows * size;
      const lx = stunned && inRows ? halfX + 2.2 : limX;
      p.x = Math.max(-lx, Math.min(lx, nx));
      p.y = Math.max(minY, Math.min(maxY, ny));
      if (inRows && Math.abs(p.x) > halfX) {
        // bị hất ra ngoài mép sàn
        p.fallUntil = now + RESPAWN_MS;
        p.falls++;
        p.dx = p.dy = 0;
        p.kx = p.ky = 0;
        const by0 = p.lastHitBy && now - p.lastHitAt < KO_WINDOW ? p.lastHitBy : undefined;
        if (by0) state.players[by0].kos++;
        ctx.broadcast({ type: 'fall', playerId: id, idx: -1, by: by0 });
        continue;
      }

      if (p.y < 0) {
        const r = Math.floor(-p.y / size);
        if (r < rows) {
          const c = Math.min(cols - 1, Math.max(0, Math.floor((p.x + halfX) / size)));
          const idx = r * cols + c;
          if (!state.safe[idx]) {
            // ô giả: vỡ ngay dưới chân, mọi người đều thấy
            state.broken[idx] = 1;
            state.dirty = true;
            p.fallUntil = now + RESPAWN_MS;
            p.falls++;
            p.dx = p.dy = 0;
            p.kx = p.ky = 0;
            const by = p.lastHitBy && now - p.lastHitAt < KO_WINDOW ? p.lastHitBy : undefined;
            if (by) state.players[by].kos++;
            ctx.broadcast({ type: 'fall', playerId: id, idx, by });
            continue;
          }
          if (r + 1 > p.reach) p.reach = r + 1;
        } else if (p.finishAt === null) {
          p.reach = rows;
          p.finishAt = now;
          state.finished.push(id);
          if (state.closeAt === null) state.closeAt = now + CLOSE_MS;
          state.dirty = true;
          ctx.broadcast({ type: 'finish', playerId: id, at: rel, place: state.finished.length, closeAt: state.closeAt - ctx.startAt });
        }
      }
    }

    // va chạm thân thể: đẩy nhẹ nhau ra
    if (now >= ctx.startAt) {
      const ids = ctx.playerIds;
      for (let i = 0; i < ids.length; i++) {
        const a = state.players[ids[i]];
        if (a.fallUntil) continue;
        for (let j = i + 1; j < ids.length; j++) {
          const b = state.players[ids[j]];
          if (b.fallUntil) continue;
          let ox = b.x - a.x;
          let oy = b.y - a.y;
          const d = Math.hypot(ox, oy);
          if (d >= BODY_R * 2) continue;
          if (d < 0.01) {
            ox = Math.random() - 0.5;
            oy = Math.random() - 0.5;
          }
          const dd = Math.hypot(ox, oy) || 1;
          const push = (BODY_R * 2 - d) / 2;
          const px = (ox / dd) * push;
          const py = (oy / dd) * push;
          a.x = Math.max(-limX, Math.min(limX, a.x - px));
          a.y = Math.max(minY, Math.min(maxY, a.y - py));
          b.x = Math.max(-limX, Math.min(limX, b.x + px));
          b.y = Math.max(minY, Math.min(maxY, b.y + py));
        }
      }
    }

    if (now - state.lastBroadcast < BROADCAST_MS) return;
    state.lastBroadcast = now;
    const positions: Record<string, { x: number; y: number; out: boolean; st?: 1 }> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      positions[id] = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, out: p.fallUntil > 0 };
      if (now < p.stunUntil || p.kx || p.ky) positions[id].st = 1;
    }
    const payload: Record<string, unknown> = { type: 'pos', positions };
    // ô đã vỡ chỉ gửi khi đổi (và nhắc lại mỗi giây cho ai vào lại giữa ván)
    if ((state.dirty && now - state.lastSnap > 100) || now - state.lastSnap > 1000) {
      let s = '';
      for (let i = 0; i < state.broken.length; i++) s += state.broken[i];
      payload.broken = s;
      const fin: Record<string, number> = {};
      state.finished.forEach((id, i) => (fin[id] = i + 1));
      payload.fin = fin;
      if (state.closeAt !== null) payload.closeAt = state.closeAt - ctx.startAt;
      const ko: Record<string, number> = {};
      for (const id of ctx.playerIds) if (state.players[id].kos) ko[id] = state.players[id].kos;
      payload.ko = ko;
      state.dirty = false;
      state.lastSnap = now;
    }
    ctx.broadcast(payload);
  },

  isFinished(ctx, state, config) {
    const now = ctx.now();
    if (now - ctx.startAt >= config.endsAt) return true;
    if (state.finished.length >= ctx.playerIds.length) return true;
    return state.closeAt !== null && now >= state.closeAt;
  },

  calculateScore(ctx, state, config) {
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      const falls = (p.falls ? ` · ngã ${p.falls} lần` : '') + (p.kos ? ` · hất rơi ${p.kos}` : '');
      if (p.finishAt !== null) {
        const t = p.finishAt - ctx.startAt;
        out[id] = {
          raw: 1_000_000 + Math.max(0, config.endsAt - t) + p.kos * 1500,
          detail: `hạng ${state.finished.indexOf(id) + 1} về đích · ${(t / 1000).toFixed(1)}s${falls}`,
        };
      } else {
        out[id] = { raw: p.reach * 1000 - p.falls + p.kos * 400, detail: `tới hàng ${p.reach}/${config.rows}${falls}` };
      }
    }
    return out;
  },
};
