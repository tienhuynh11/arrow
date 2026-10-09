import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import {
  COLLAPSE_DELAY,
  COLLAPSE_GONE,
  F_FIN,
  F_GROUND,
  F_OUT,
  F_STUN,
  SPEED,
  lavaZ,
  newBody,
  stepLava,
  type LvBody,
  type LvConfig,
  type LvPlat,
} from '../../../shared/lavaRun.js';

/**
 * SÀN LÀ DUNG NHAM: khóa học bục do server sinh cho cả phòng, dung nham dâng dần theo thời gian.
 * Rơi/chạm dung nham → hồi sinh ở điểm kiểm tra gần nhất (mất ~1.3s); nếu dung nham đã ngập qua điểm đó thì bị loại.
 * Ai chạm bục đích trước thắng; người chưa tới đích xếp theo độ cao đạt được.
 */
interface PState {
  body: LvBody;
  dx: number;
  dy: number;
  moveAt: number;
  jumpUntil: number;
  cp: number;
  bestZ: number;
  stunUntil: number;
  out: boolean;
  outAt: number;
  finishedAt: number;
  burns: number;
}

interface State {
  players: Record<string, PState>;
  trig: number[];
  firstFinish: number;
  lastTick: number;
}

const DURATION = 90_000;
const LAST_CALL_MS = 18_000;
const HOLD_TIMEOUT = 900;
const JUMP_BUFFER_MS = 160;
const STUN_MS = 1300;
const N_PLATS = 30;
const CP_EVERY = 7;
const PUSH_R = 0.55;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

function makeCourse(): LvPlat[] {
  const plats: LvPlat[] = [{ x: 0, y: 0, z: 0, w: 26, d: 12, k: 0, cp: true }];
  let front = 6; // mép trước của bục vừa đặt
  let z = 0;
  let x = 0;
  let prevKind = 0;
  for (let i = 1; i <= N_PLATS; i++) {
    const goal = i === N_PLATS;
    const cp = !goal && i % CP_EVERY === 0;
    let k: LvPlat['k'] = 0;
    if (!goal && !cp && i > 2) {
      const r = Math.random();
      k = r < 0.34 ? 0 : r < 0.54 ? 1 : r < 0.69 ? 2 : r < 0.84 ? 3 : 4;
      // tránh nhiều bục "độc" cùng loại liền nhau
      if (k !== 0 && k === prevKind && Math.random() < 0.6) k = 0;
    }
    prevKind = k;
    const w = goal ? 20 : cp ? 12 : k === 2 ? 7.5 : k === 4 ? 5.5 : rnd(4.6, 7);
    const d = goal ? 10 : cp ? 7 : k === 2 ? 7 : rnd(4.2, 6);
    const gap = goal || cp ? rnd(2.4, 3.4) : rnd(2.4, 3.8);
    const rise = goal ? 1.0 : rnd(0.5, 1.1);
    x = Math.max(-11, Math.min(11, x + rnd(-4.5, 4.5)));
    z += rise;
    const y = front + gap + d / 2;
    const p: LvPlat = { x: r1(goal || cp ? x * 0.4 : x), y: r1(y), z: r2(z), w: r1(w), d: r1(d), k };
    if (cp) p.cp = true;
    if (goal) p.goal = true;
    if (k === 3) {
      p.per = 4.2;
      p.on = r1(rnd(2.5, 3));
      p.ph = r1(rnd(0, 4.2));
    }
    if (k === 4) {
      p.ax = Math.random() < 0.75 ? 0 : 1;
      p.amp = r1(rnd(2.5, 4));
      p.f = r2(rnd(0.9, 1.5));
      p.ph = r2(rnd(0, Math.PI * 2));
    }
    plats.push(p);
    front = y + d / 2 + (k === 4 && p.ax === 1 ? p.amp! * 0.6 : 0);
  }
  return plats;
}

export const lavaRunGame: GameDefinition<LvConfig, State> = {
  id: 'lava',
  name: 'SÀN LÀ DUNG NHAM',
  instructions:
    'Dung nham dâng dần: nhảy qua các bục để chạy lên đích trước. Coi chừng bục sụp, bục trơn và bục biến mất. Rơi xuống dung nham là quay lại điểm kiểm tra, nhưng nếu dung nham đã nuốt điểm đó thì bị loại.',
  controls: [
    { keys: ['←', '↑', '→', '↓'], desc: 'Chạy (↑ là tiến về phía đích)' },
    { keys: ['SPACE'], desc: 'Nhảy' },
  ],
  duration: DURATION + 1500,
  minPlayers: 1,
  maxPlayers: 16,

  createConfig(ctx) {
    const plats = makeCourse();
    const top = plats[plats.length - 1].z;
    const spawns: Record<string, [number, number]> = {};
    const n = ctx.playerIds.length;
    const ids = [...ctx.playerIds];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const perRow = Math.min(8, n);
    ids.forEach((id, i) => {
      const row = Math.floor(i / 8);
      const inRow = Math.min(8, n - row * 8);
      spawns[id] = [r1(((i % 8) - (inRow - 1) / 2) * Math.min(2.6, 22 / Math.max(1, perRow))), r1(-3.5 + row * 2.2)];
    });
    return {
      plats,
      lava: { z0: -3, span: top + 3.5, dur: DURATION / 1000 - 2, pow: 2 },
      top,
      endsAt: DURATION,
      speed: SPEED,
      spawns,
    };
  },

  createState(ctx, config) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      const [x, y] = config.spawns[id];
      players[id] = {
        body: { ...newBody(x, y, 0), on: 0 },
        dx: 0,
        dy: 0,
        moveAt: 0,
        jumpUntil: 0,
        cp: 0,
        bestZ: 0,
        stunUntil: 0,
        out: false,
        outAt: 0,
        finishedAt: 0,
        burns: 0,
      };
    }
    return { players, trig: config.plats.map(() => Infinity), firstFinish: 0, lastTick: ctx.startAt };
  },

  handleInput(ctx, state, _config, playerId, input: GameInput) {
    const p = state.players[playerId];
    if (!p || p.out || p.finishedAt) return;
    if (input.type === 'moveXY') {
      p.dx = Math.max(-1, Math.min(1, Math.round(Number(input.dx) || 0)));
      p.dy = Math.max(-1, Math.min(1, Math.round(Number(input.dy) || 0)));
      p.moveAt = ctx.now();
    } else if (input.type === 'jump') {
      p.jumpUntil = ctx.now() + JUMP_BUFFER_MS;
    }
  },

  update(ctx, state, config) {
    const now = ctx.now();
    const rel = now - ctx.startAt;
    if (rel < 0) {
      state.lastTick = now;
      return;
    }
    const t = rel / 1000;
    const dt = Math.min(now - state.lastTick, 250) / 1000;
    state.lastTick = now;
    const lz = lavaZ(config.lava, t);
    const plats = config.plats;

    // chia bước nhỏ nếu một tick bị trễ
    const steps = Math.max(1, Math.ceil(dt / 0.034));
    const sdt = dt / steps;

    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (p.out || p.finishedAt) continue;
      const b = p.body;
      if (now < p.stunUntil) continue;
      if (now - p.moveAt > HOLD_TIMEOUT) {
        p.dx = 0;
        p.dy = 0;
      }
      for (let s = 0; s < steps; s++) {
        const ts = t - dt + sdt * (s + 1);
        const jumped = stepLava(plats, state.trig, b, p.dx, p.dy, now <= p.jumpUntil, ts, sdt, config.speed);
        if (jumped) p.jumpUntil = 0;
        if (b.on >= 0 && plats[b.on].k === 1) {
          const tr = state.trig[b.on];
          if (tr === Infinity || ts >= tr + COLLAPSE_DELAY + COLLAPSE_GONE) {
            state.trig[b.on] = ts;
            ctx.broadcast({ type: 'col', i: b.on, at: Math.round(ts * 1000) });
          }
        }
      }
      if (b.on >= 0) {
        const pl = plats[b.on];
        if (pl.z > p.bestZ) p.bestZ = pl.z;
        if (pl.cp && b.on > p.cp) p.cp = b.on;
        if (pl.goal) {
          p.finishedAt = Math.max(1, rel);
          p.dx = p.dy = 0;
          b.vx = b.vy = 0;
          if (!state.firstFinish) state.firstFinish = now;
          ctx.broadcast({ type: 'finish', playerId: id, at: p.finishedAt });
          continue;
        }
      }
      // chạm dung nham (rơi xuống hoặc bục bị nhấn chìm)
      if (b.z < lz) {
        p.burns++;
        const cp = plats[p.cp];
        if (cp.z > lz + 0.8) {
          b.x = cp.x + (Math.random() - 0.5) * (cp.w - 3);
          b.y = cp.y + (Math.random() - 0.5) * (cp.d - 2);
          b.z = cp.z;
          b.vx = b.vy = b.vz = 0;
          b.on = p.cp;
          b.air = 0;
          p.dx = p.dy = 0;
          p.jumpUntil = 0;
          p.stunUntil = now + STUN_MS;
          ctx.broadcast({ type: 'burn', playerId: id, out: false, x: r1(b.x), y: r1(b.y), z: r2(lz) });
        } else {
          p.out = true;
          p.outAt = rel;
          ctx.broadcast({ type: 'burn', playerId: id, out: true, x: r1(b.x), y: r1(b.y), z: r2(lz) });
        }
      }
    }

    // đẩy nhẹ nhau khi chen chúc
    const act = ctx.playerIds.filter((id) => {
      const p = state.players[id];
      return !p.out && !p.finishedAt && now >= p.stunUntil;
    });
    for (let i = 0; i < act.length; i++) {
      const a = state.players[act[i]].body;
      for (let j = i + 1; j < act.length; j++) {
        const c = state.players[act[j]].body;
        if (Math.abs(a.z - c.z) > 1.2) continue;
        const ddx = c.x - a.x;
        const ddy = c.y - a.y;
        const dist = Math.hypot(ddx, ddy);
        if (dist >= PUSH_R * 2) continue;
        const nx = dist > 1e-3 ? ddx / dist : 1;
        const ny = dist > 1e-3 ? ddy / dist : 0;
        const push = (PUSH_R * 2 - dist) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        c.x += nx * push;
        c.y += ny * push;
      }
    }

    const pos: Record<string, [number, number, number, number]> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      const b = p.body;
      const flags =
        (now < p.stunUntil ? F_STUN : 0) | (p.out ? F_OUT : 0) | (p.finishedAt ? F_FIN : 0) | (b.on >= 0 ? F_GROUND : 0);
      pos[id] = [r2(b.x), r2(b.y), r2(b.z), flags];
    }
    ctx.broadcast({ type: 'pos', pos });
  },

  isFinished(ctx, state, config) {
    const now = ctx.now();
    if (now - ctx.startAt >= config.endsAt) return true;
    if (state.firstFinish && now - state.firstFinish >= LAST_CALL_MS) return true;
    return ctx.playerIds.every((id) => state.players[id].finishedAt > 0 || state.players[id].out);
  },

  calculateScore(ctx, state, config) {
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      const pct = Math.floor((p.bestZ / config.top) * 100);
      if (p.finishedAt) {
        out[id] = { raw: 1_000_000 - p.finishedAt, detail: `về đích sau ${(p.finishedAt / 1000).toFixed(1)}s` };
      } else if (p.out) {
        // bị loại cùng độ cao: ai trụ lâu hơn xếp trên
        out[id] = { raw: Math.floor(p.bestZ * 100) + Math.min(99, p.outAt / 1000), detail: `bị dung nham nuốt ở ${pct}% khóa học` };
      } else {
        out[id] = { raw: Math.floor(p.bestZ * 100) + 99, detail: `leo tới ${pct}% khóa học` };
      }
    }
    return out;
  },
};
