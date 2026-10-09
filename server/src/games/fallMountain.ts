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

export interface Pickup {
  id: number;
  /** 0 = tăng tốc ngắn, 1 = khiên chặn 1 cú */
  k: 0 | 1;
  x: number;
  y: number;
}

interface Rock {
  id: number;
  x: number;
  y: number;
  /** giờ server (ms) lúc đá rơi trúng đất */
  land: number;
  done: boolean;
}

interface Config {
  pickups: Pickup[];
  /** các mốc checkpoint: bị văng sẽ không tụt dưới mốc đã qua */
  checkpoints: number[];
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
  boostUntil: number;
  shield: boolean;
  cp: number;
  taken: Set<number>;
}

interface State {
  players: Record<string, PState>;
  firstFinish: number;
  lastTick: number;
  lastBroadcast: number;
  nextEvent: number;
  eventId: number;
  rocks: Rock[];
  gusts: { dir: number; from: number; to: number }[];
  lastCall: boolean;
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
const BOOST_MS = 2500;
const BOOST_MUL = 1.55;
const PICK_R = 4;
const ROCK_R = 5.2;
const ROCK_WARN_MS = 2200;
const GUST_WARN_MS = 2000;
const GUST_MS = 2800;
const GUST_FORCE = 9;
const CHECKPOINTS = [200, 400];

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

function makePickups(): Pickup[] {
  const out: Pickup[] = [];
  let id = 0;
  for (let y = 45; y < LEN - 30; y += rnd(26, 40)) {
    out.push({ id: id++, k: Math.random() < 0.6 ? 0 : 1, x: Math.round(rnd(-W / 2 + 7, W / 2 - 7)), y: Math.round(y) });
  }
  return out;
}

export const fallMountainGame: GameDefinition<Config, State> = {
  id: 'mountain',
  name: 'LEO NÚI',
  instructions:
    'Leo lên ĐỈNH NÚI, né bóng, gỗ lăn, búa quét và ĐÁ RƠI (có vòng đỏ báo trước). Nhặt tăng tốc, khiên chặn 1 cú; coi chừng gió thổi ngang. Lên đỉnh nhanh nhất thắng.',
  controls: [{ keys: ['←', '↑', '→', '↓'], desc: 'Giữ để chạy lên đỉnh · né bóng, gỗ, búa, tránh vòng đỏ đá rơi · nhặt tia chớp và khiên' }],
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
      pickups: makePickups(),
      checkpoints: CHECKPOINTS,
      endsAt: DURATION,
      spawns,
    };
  },

  createState(ctx, config) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      const [x, y] = config.spawns[id];
      players[id] = { x, y, dx: 0, dy: 0, moveAt: 0, stunUntil: 0, safeUntil: 0, finishedAt: 0, hits: 0, boostUntil: 0, shield: false, cp: 0, taken: new Set() };
    }
    return {
      players,
      firstFinish: 0,
      lastTick: ctx.startAt,
      lastBroadcast: 0,
      nextEvent: ctx.startAt + 6000,
      eventId: 0,
      rocks: [],
      gusts: [],
      lastCall: false,
    };
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

    const applyHit = (id: string, p: PState, kind: 'ball' | 'log' | 'spin' | 'rock', ox: number, oy: number) => {
      p.safeUntil = now + (p.shield ? 1000 : SAFE_MS);
      if (p.shield) {
        p.shield = false;
        ctx.broadcast({ type: 'hit', playerId: id, kind, ox, oy, blocked: true });
        return;
      }
      p.hits++;
      const floorY = p.cp > 0 ? config.checkpoints[p.cp - 1] : 0;
      p.y = Math.max(floorY, p.y - config.knock);
      p.stunUntil = now + config.stun;
      p.dx = p.dy = 0;
      ctx.broadcast({ type: 'hit', playerId: id, kind, ox, oy });
    };

    // sự kiện bất ngờ: server chọn ngẫu nhiên, báo trước cho mọi người
    if (now >= state.nextEvent && now > ctx.startAt && rel < config.endsAt - 4000) {
      const racing = ctx.playerIds.filter((id) => !state.players[id].finishedAt);
      if (racing.length) {
        const late = rel > config.endsAt * 0.5;
        state.nextEvent = now + rnd(late ? 4500 : 6500, late ? 7000 : 9500);
        if (Math.random() < 0.68) {
          const leader = racing.reduce((a, b) => (state.players[b].y > state.players[a].y ? b : a));
          const lp = state.players[leader];
          const n = 4 + Math.min(4, Math.floor(ctx.playerIds.length / 4));
          const rocks: Rock[] = [];
          for (let i = 0; i < n; i++) {
            // người dẫn đầu bị nhắm nhiều hơn; vài viên rơi quanh người khác
            const tp = i < n - 2 ? lp : state.players[racing[Math.floor(Math.random() * racing.length)]];
            rocks.push({
              id: ++state.eventId,
              x: Math.round(Math.max(-W / 2 + 5, Math.min(W / 2 - 5, tp.x + rnd(-13, 13)))),
              y: Math.round(Math.min(LEN - 8, tp.y + rnd(8, 24))),
              land: now + ROCK_WARN_MS + i * 230,
              done: false,
            });
          }
          state.rocks.push(...rocks);
          ctx.broadcast({ type: 'warn', kind: 'rock', rocks: rocks.map((r) => ({ id: r.id, x: r.x, y: r.y, land: r.land })) });
        } else {
          const g = { dir: Math.random() < 0.5 ? -1 : 1, from: now + GUST_WARN_MS, to: now + GUST_WARN_MS + GUST_MS };
          state.gusts.push(g);
          ctx.broadcast({ type: 'warn', kind: 'gust', dir: g.dir, from: g.from, to: g.to });
        }
      }
    }
    state.gusts = state.gusts.filter((g) => g.to > now - 500);

    // đá chạm đất
    for (const r of state.rocks) {
      if (r.done || now < r.land) continue;
      r.done = true;
      ctx.broadcast({ type: 'impact', id: r.id });
      for (const id of ctx.playerIds) {
        const p = state.players[id];
        if (p.finishedAt || now < p.safeUntil) continue;
        if ((p.x - r.x) ** 2 + (p.y - r.y) ** 2 < ROCK_R * ROCK_R) applyHit(id, p, 'rock', r.x, r.y);
      }
    }
    state.rocks = state.rocks.filter((r) => !r.done);

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
          const sp = config.speed * (now < p.boostUntil ? BOOST_MUL : 1);
          p.x = Math.max(-maxX, Math.min(maxX, p.x + (p.dx / len) * sp * dt));
          p.y = Math.max(0, p.y + (p.dy / len) * sp * dt);
        }
        for (const g of state.gusts) {
          if (now >= g.from && now < g.to) p.x = Math.max(-maxX, Math.min(maxX, p.x + g.dir * GUST_FORCE * dt));
        }
      }

      if (now >= p.safeUntil) {
        const h = hitBy(p.x, p.y);
        if (h) applyHit(id, p, h.kind, h.x, h.y);
      }

      // nhặt vật phẩm (mỗi người nhặt riêng, không tranh nhau)
      for (const it of config.pickups) {
        if (p.taken.has(it.id) || Math.abs(it.y - p.y) > PICK_R) continue;
        if ((it.x - p.x) ** 2 + (it.y - p.y) ** 2 > PICK_R * PICK_R) continue;
        p.taken.add(it.id);
        if (it.k === 0) p.boostUntil = now + BOOST_MS;
        else p.shield = true;
        ctx.broadcast({ type: 'pick', playerId: id, item: it.id, k: it.k });
      }

      while (p.cp < config.checkpoints.length && p.y >= config.checkpoints[p.cp]) {
        p.cp++;
        ctx.broadcast({ type: 'cp', playerId: id, i: p.cp });
      }

      if (p.y >= config.len) {
        p.y = config.len;
        p.finishedAt = Math.max(1, rel);
        p.dx = p.dy = 0;
        if (!state.firstFinish) state.firstFinish = now;
        if (!state.lastCall) {
          state.lastCall = true;
          ctx.broadcast({ type: 'lastcall', until: now + LAST_CALL_MS });
        }
        ctx.broadcast({ type: 'finish', playerId: id, at: p.finishedAt });
      }
    }

    if (now - state.lastBroadcast < BROADCAST_MS) return;
    state.lastBroadcast = now;
    const positions: Record<string, { x: number; y: number; s: boolean; g: boolean; f: number; b: boolean; h: boolean }> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      positions[id] = {
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        s: now < p.stunUntil,
        g: now < p.safeUntil,
        f: p.finishedAt,
        b: now < p.boostUntil,
        h: p.shield,
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
