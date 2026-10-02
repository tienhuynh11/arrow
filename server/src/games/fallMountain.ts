import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';

/**
 * Chướng ngại theo LỊCH: toàn bộ lịch bóng/khúc gỗ/búa quét được tạo một lần, gửi trong config,
 * rồi cả server lẫn client tự tính vị trí theo đồng hồ chung → không tốn băng thông cho chướng ngại
 * và không bị giật khi mạng chậm. Server vẫn là bên duy nhất quyết định ai bị trúng.
 */
export interface Obstacle {
  /** 0 = bóng, 1 = khúc gỗ lăn */
  k: 0 | 1;
  x: number;
  /** giây (so với lúc bắt đầu) lúc nó ở đỉnh núi; có thể âm = đã lăn sẵn khi bắt đầu */
  t0: number;
  /** tốc độ lăn xuống (đơn vị/giây) */
  v: number;
  /** bán kính bóng, hoặc nửa chiều ngang khúc gỗ */
  s: number;
}

export interface Spinner {
  x: number;
  y: number;
  /** nửa chiều dài thanh quét */
  half: number;
  /** rad/giây */
  w: number;
  ph: number;
}

interface Config {
  w: number;
  len: number;
  speed: number;
  radius: number;
  knock: number;
  stun: number;
  /** y của chướng ngại lúc ở đỉnh */
  topY: number;
  logDepth: number;
  obstacles: Obstacle[];
  spinners: Spinner[];
  endsAt: number;
  spawns: Record<string, [number, number]>;
}

interface PState {
  x: number;
  y: number;
  dx: number;
  dy: number;
  moveAt: number;
  stunUntil: number;
  safeUntil: number;
  finishedAt: number;
  hits: number;
}

interface State {
  players: Record<string, PState>;
  firstFinish: number;
  lastTick: number;
  lastBroadcast: number;
}

const W = 60;
const LEN = 600;
const SPEED = 25;
const RADIUS = 3;
/** đã chừa một chút khoan dung: tránh cảm giác "né rồi mà vẫn trúng" khi mạng trễ */
const HIT_FORGIVE = 0.86;
const KNOCK = 16;
const STUN_MS = 600;
const SAFE_MS = 1800;
const HOLD_TIMEOUT = 900;
const DURATION = 80_000;
const LAST_CALL_MS = 25_000;
const TOP_Y = LEN + 25;
const LOG_DEPTH = 2.5;
/** 20 tick/giây ≈ gói vị trí mỗi 80ms: đủ mượt nhờ nội suy ở client, nhẹ cho đường truyền */
const BROADCAST_MS = 80;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** vị trí (y) của một chướng ngại lăn tại thời điểm t (giây) */
export const obstacleY = (o: Obstacle, t: number) => TOP_Y - o.v * (t - o.t0);

export const spinnerAngle = (s: Spinner, t: number) => s.ph + s.w * t;

function makeSchedule() {
  const obstacles: Obstacle[] = [];
  // bắt đầu từ âm: lúc vào ván đã có chướng ngại đang lăn dở trên núi
  let t = -22;
  while (t < DURATION / 1000) {
    const log = Math.random() < 0.3;
    const o: Obstacle = log
      ? { k: 1, x: rnd(-W / 2 + 10, W / 2 - 10), t0: t, v: rnd(14, 19), s: 9 }
      : { k: 0, x: rnd(-W / 2 + 6, W / 2 - 6), t0: t, v: rnd(17, 24), s: rnd(5, 6.5) };
    // vùng xuất phát phải sạch trong vài giây đầu
    const reachStart = o.t0 + (TOP_Y - 45) / o.v;
    if (reachStart > 3.5) {
      o.x = Math.round(o.x * 10) / 10;
      o.t0 = Math.round(o.t0 * 100) / 100;
      o.v = Math.round(o.v * 10) / 10;
      o.s = Math.round(o.s * 10) / 10;
      obstacles.push(o);
    }
    t += rnd(0.5, 0.9);
  }
  const spinners: Spinner[] = [150, 290, 430, 540].map((y, i) => ({
    x: Math.round(rnd(-12, 12)),
    y,
    half: 15,
    w: (i % 2 ? -1 : 1) * rnd(1.3, 1.8),
    ph: Math.round(rnd(0, Math.PI) * 100) / 100,
  }));
  return { obstacles, spinners };
}

export const fallMountainGame: GameDefinition<Config, State> = {
  id: 'mountain',
  name: 'LEO NÚI',
  instructions:
    'Leo lên ĐỈNH NÚI, né bóng và gỗ lăn xuống, né búa quét. Trúng là bị văng xuống dốc. Lên đỉnh nhanh nhất thắng.',
  controls: [{ keys: ['←', '↑', '→', '↓'], desc: 'Giữ để chạy lên đỉnh · lách sang hai bên để né bóng, gỗ và búa' }],
  duration: DURATION + 1500,
  minPlayers: 1,
  maxPlayers: 16,

  createConfig(ctx) {
    const n = ctx.playerIds.length;
    const ids = [...ctx.playerIds];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const spacing = Math.min(9, (W - 14) / Math.max(1, Math.min(8, n) - 1 || 1));
    const spawns: Record<string, [number, number]> = {};
    ids.forEach((id, i) => {
      const r = Math.floor(i / 8);
      const inRow = Math.min(8, n - r * 8);
      spawns[id] = [((i % 8) - (inRow - 1) / 2) * spacing, 6 + r * 7];
    });
    const { obstacles, spinners } = makeSchedule();
    return {
      w: W,
      len: LEN,
      speed: SPEED,
      radius: RADIUS,
      knock: KNOCK,
      stun: STUN_MS,
      topY: TOP_Y,
      logDepth: LOG_DEPTH,
      obstacles,
      spinners,
      endsAt: DURATION,
      spawns,
    };
  },

  createState(ctx, config) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      const [x, y] = config.spawns[id];
      players[id] = { x, y, dx: 0, dy: 0, moveAt: 0, stunUntil: 0, safeUntil: 0, finishedAt: 0, hits: 0 };
    }
    return { players, firstFinish: 0, lastTick: ctx.startAt, lastBroadcast: 0 };
  },

  handleInput(ctx, state, _config, playerId, input: GameInput) {
    if (input.type !== 'moveXY') return;
    const p = state.players[playerId];
    if (!p || p.finishedAt) return;
    p.dx = Math.max(-1, Math.min(1, Math.round(Number(input.dx) || 0)));
    // dy > 0 = leo lên đỉnh
    p.dy = Math.max(-1, Math.min(1, Math.round(Number(input.dy) || 0)));
    p.moveAt = ctx.now();
  },

  update(ctx, state, config) {
    const now = ctx.now();
    const rel = now - ctx.startAt;
    const t = rel / 1000;
    const dt = Math.min(now - state.lastTick, 200) / 1000;
    state.lastTick = now;
    const R = config.radius * HIT_FORGIVE;
    const maxX = config.w / 2 - config.radius;

    /** trả về loại chướng ngại đang đè lên (x, y), hoặc null */
    const hitBy = (px: number, py: number): { kind: 'ball' | 'log' | 'spin'; x: number; y: number } | null => {
      for (const o of config.obstacles) {
        const oy = obstacleY(o, t);
        if (oy < -30 || oy > config.topY + 5) continue;
        if (Math.abs(oy - py) > 14) continue;
        if (o.k === 0) {
          const rr = o.s * 0.9 + R;
          if ((o.x - px) ** 2 + (oy - py) ** 2 < rr * rr) return { kind: 'ball', x: o.x, y: oy };
        } else if (Math.abs(px - o.x) < o.s + R && Math.abs(py - oy) < config.logDepth + R) {
          return { kind: 'log', x: o.x, y: oy };
        }
      }
      for (const s of config.spinners) {
        if (Math.abs(py - s.y) > s.half + 4) continue;
        const a = spinnerAngle(s, t);
        const ex = Math.cos(a) * s.half;
        const ey = Math.sin(a) * s.half;
        // khoảng cách từ điểm tới đoạn thẳng (tâm ± (ex, ey))
        const vx = px - s.x;
        const vy = py - s.y;
        const u = Math.max(-1, Math.min(1, (vx * ex + vy * ey) / (s.half * s.half)));
        const dx = vx - u * ex;
        const dy = vy - u * ey;
        if (dx * dx + dy * dy < (1.5 + R) ** 2) return { kind: 'spin', x: s.x, y: s.y };
      }
      return null;
    };

    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (p.finishedAt || now < ctx.startAt) continue;

      if (now >= p.stunUntil) {
        if (now - p.moveAt > HOLD_TIMEOUT) {
          p.dx = 0;
          p.dy = 0;
        }
        if (dt > 0 && (p.dx !== 0 || p.dy !== 0)) {
          const len = Math.hypot(p.dx, p.dy) || 1;
          p.x = Math.max(-maxX, Math.min(maxX, p.x + (p.dx / len) * config.speed * dt));
          p.y = Math.max(0, p.y + (p.dy / len) * config.speed * dt);
        }
      }

      if (now >= p.safeUntil) {
        const h = hitBy(p.x, p.y);
        if (h) {
          p.hits++;
          p.y = Math.max(0, p.y - config.knock);
          p.stunUntil = now + config.stun;
          p.safeUntil = now + SAFE_MS;
          p.dx = p.dy = 0;
          ctx.broadcast({ type: 'hit', playerId: id, kind: h.kind, ox: h.x, oy: h.y });
        }
      }

      if (p.y >= config.len) {
        p.y = config.len;
        p.finishedAt = Math.max(1, rel);
        p.dx = p.dy = 0;
        if (!state.firstFinish) state.firstFinish = now;
        ctx.broadcast({ type: 'finish', playerId: id, at: p.finishedAt });
      }
    }

    if (now - state.lastBroadcast < BROADCAST_MS) return;
    state.lastBroadcast = now;
    const positions: Record<string, { x: number; y: number; s: boolean; g: boolean; f: number }> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      positions[id] = {
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        s: now < p.stunUntil,
        g: now < p.safeUntil,
        f: p.finishedAt,
      };
    }
    ctx.broadcast({ type: 'pos', positions });
  },

  isFinished(ctx, state, config) {
    const now = ctx.now();
    if (now - ctx.startAt >= config.endsAt) return true;
    if (state.firstFinish && now - state.firstFinish >= LAST_CALL_MS) return true;
    return ctx.playerIds.every((id) => state.players[id].finishedAt > 0);
  },

  calculateScore(ctx, state, config) {
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (p.finishedAt) {
        out[id] = { raw: 1_000_000 - p.finishedAt, detail: `lên đỉnh sau ${(p.finishedAt / 1000).toFixed(1)}s` };
      } else {
        out[id] = { raw: Math.floor(p.y), detail: `leo tới ${Math.floor((p.y / config.len) * 100)}% núi` };
      }
    }
    return out;
  },
};
