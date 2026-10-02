import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';

/**
 * Thanh xà quay quanh cột giữa sàn tròn; góc của nó là một HÀM CỦA THỜI GIAN:
 *   θ(τ) = w0·τ + ½·a·τ²   (τ = giây kể từ lúc xà bắt đầu quay)
 * nên client tự vẽ đúng theo đồng hồ server, không cần gửi góc qua mạng.
 */
interface Config {
  /** bán kính sàn */
  r: number;
  /** bán kính cột giữa (không đứng vào được) */
  hub: number;
  /** xà dài từ tâm ra mỗi bên (hai đầu đối xứng) */
  arm: number;
  /** giây (từ lúc bắt đầu) xà mới bắt đầu quay */
  t0: number;
  w0: number;
  a: number;
  speed: number;
  radius: number;
  jumpMs: number;
  endsAt: number;
  spawns: Record<string, [number, number]>;
}

interface PState {
  x: number;
  y: number;
  dx: number;
  dy: number;
  moveAt: number;
  jumpUntil: number;
  stunUntil: number;
  safeUntil: number;
  /** vận tốc bị hất văng (đơn vị/giây), giảm dần */
  kx: number;
  ky: number;
  outAt: number | null;
}

interface State {
  players: Record<string, PState>;
  lastTick: number;
  lastBroadcast: number;
}

const R = 80;
const HUB = 7;
const ARM = R + 5;
const BAR_HALF = 1.7;
const T0 = 3;
const W0 = 1.1;
const ACCEL = 0.06;
const SPEED = 30;
const PLAYER_R = 3;
const JUMP_MS = 520;
/** sau khi đáp phải chờ một nhịp mới nhảy tiếp được — không thì nhảy liên tục là bất tử */
const JUMP_CD = 300;
const JUMP_SLACK = 90;
const STUN_MS = 600;
const SAFE_MS = 900;
const KNOCK_SPEED = 120;
const KNOCK_DECAY = 3.4;
/** sau lần rơi cuối, chờ nhân vật rơi hẳn khỏi sàn rồi mới kết thúc ván */
const FALL_GRACE_MS = 1600;
const HOLD_TIMEOUT = 900;
const DURATION = 80_000;
const BROADCAST_MS = 60;

/** góc của xà tại giây t (so với lúc bắt đầu ván) */
export const barAngle = (c: { t0: number; w0: number; a: number }, t: number) => {
  const tau = Math.max(0, t - c.t0);
  return c.w0 * tau + 0.5 * c.a * tau * tau;
};

const shuffle = <T,>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const wrapPi = (x: number) => {
  const m = ((x % Math.PI) + Math.PI) % Math.PI;
  return m;
};

export const jumpShowdownGame: GameDefinition<Config, State> = {
  id: 'showdown',
  name: 'CON QUAY HỒI CHUYỂN',
  instructions:
    'Thanh xà quay ngày càng nhanh: nhấn SPACE để nhảy qua khi nó quét tới. Trúng xà là bị hất khỏi sàn. Người trụ lại cuối cùng thắng.',
  controls: [
    { keys: ['←', '↑', '→', '↓'], desc: 'Giữ để chạy mọi hướng' },
    { keys: ['SPACE'], desc: 'Nhảy qua xà (nhảy xong phải chờ một chút mới nhảy tiếp)' },
  ],
  duration: DURATION + 1500,
  minPlayers: 1,
  maxPlayers: 16,

  createConfig(ctx) {
    const n = ctx.playerIds.length;
    // rải theo vòng, tránh hai nửa trục xà lúc đầu (xà đứng yên ở góc 0 trong vài giây đầu)
    const ids = shuffle([...ctx.playerIds]);
    const spawns: Record<string, [number, number]> = {};
    ids.forEach((id, i) => {
      const half = i % 2;
      const idx = Math.floor(i / 2);
      const per = Math.ceil(n / 2);
      const ang = 0.45 + ((idx + 0.5) / per) * (Math.PI - 0.9) + half * Math.PI;
      const rad = 24 + (idx % 3) * 11 + (half ? 4 : 0);
      spawns[id] = [Math.round(Math.cos(ang) * rad * 10) / 10, Math.round(Math.sin(ang) * rad * 10) / 10];
    });
    return {
      r: R,
      hub: HUB,
      arm: ARM,
      t0: T0,
      w0: W0,
      a: ACCEL,
      speed: SPEED,
      radius: PLAYER_R,
      jumpMs: JUMP_MS,
      endsAt: DURATION,
      spawns,
    };
  },

  createState(ctx, config) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      const [x, y] = config.spawns[id];
      players[id] = {
        x,
        y,
        dx: 0,
        dy: 0,
        moveAt: 0,
        jumpUntil: 0,
        stunUntil: 0,
        safeUntil: 0,
        kx: 0,
        ky: 0,
        outAt: null,
      };
    }
    return { players, lastTick: ctx.startAt, lastBroadcast: 0 };
  },

  handleInput(ctx, state, _config, playerId, input: GameInput) {
    const p = state.players[playerId];
    if (!p || p.outAt !== null) return;
    const now = ctx.now();
    if (input.type === 'jump') {
      if (now >= ctx.startAt && now >= p.stunUntil && now >= p.jumpUntil + JUMP_CD - JUMP_SLACK) p.jumpUntil = now + JUMP_MS;
      return;
    }
    if (input.type !== 'moveXY') return;
    p.dx = Math.max(-1, Math.min(1, Math.round(Number(input.dx) || 0)));
    p.dy = Math.max(-1, Math.min(1, Math.round(Number(input.dy) || 0)));
    p.moveAt = now;
  },

  update(ctx, state, config) {
    const now = ctx.now();
    const rel = now - ctx.startAt;
    const dt = Math.min(now - state.lastTick, 200) / 1000;
    state.lastTick = now;
    const tNow = Math.max(0, rel) / 1000;
    const tPrev = Math.max(0, tNow - dt);
    const th0 = barAngle(config, tPrev);
    const th1 = barAngle(config, tNow);
    const dir = config.w0 + config.a * Math.max(0, tNow - config.t0) >= 0 ? 1 : -1;

    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (p.outAt !== null || now < ctx.startAt) continue;

      // di chuyển + bị hất văng
      if (now >= p.stunUntil) {
        if (now - p.moveAt > HOLD_TIMEOUT) {
          p.dx = 0;
          p.dy = 0;
        }
        if (dt > 0 && (p.dx !== 0 || p.dy !== 0)) {
          const len = Math.hypot(p.dx, p.dy) || 1;
          p.x += (p.dx / len) * config.speed * dt;
          p.y += (p.dy / len) * config.speed * dt;
        }
      }
      if (p.kx !== 0 || p.ky !== 0) {
        p.x += p.kx * dt;
        p.y += p.ky * dt;
        const f = Math.exp(-KNOCK_DECAY * dt);
        p.kx *= f;
        p.ky *= f;
        if (Math.hypot(p.kx, p.ky) < 1) p.kx = p.ky = 0;
      }

      // không đứng vào cột giữa
      const r0 = Math.hypot(p.x, p.y);
      const minR = config.hub + config.radius;
      if (r0 < minR) {
        const s = r0 > 1e-6 ? minR / r0 : 0;
        p.x = r0 > 1e-6 ? p.x * s : minR;
        p.y = r0 > 1e-6 ? p.y * s : 0;
      }

      // rơi khỏi sàn
      const r = Math.hypot(p.x, p.y);
      if (r > config.r + 1) {
        p.outAt = now;
        p.dx = p.dy = 0;
        ctx.broadcast({ type: 'out', playerId: id, at: rel });
        continue;
      }

      // xà quét: kiểm tra cả cung xà đi qua trong tick này (xà nhanh thì một tick đi xa hơn bề dày xà)
      const airborne = now < p.jumpUntil;
      if (!airborne && now >= p.safeUntil && tNow >= config.t0 && th1 > th0) {
        const delta = Math.max(0.0001, (config.radius * 0.86 + BAR_HALF) / r);
        // hai đầu xà đối xứng → chỉ cần xét theo mod π
        const phi = Math.atan2(p.y, p.x);
        const d = wrapPi(phi - (th0 - delta));
        if (d <= th1 - th0 + 2 * delta) {
          const nx = p.x / r;
          const ny = p.y / r;
          // hất theo hướng xà đang quét (tiếp tuyến) pha thêm ra ngoài
          const tx = -ny * dir;
          const ty = nx * dir;
          const kx = 0.5 * nx + 0.5 * tx;
          const ky = 0.5 * ny + 0.5 * ty;
          const kl = Math.hypot(kx, ky) || 1;
          p.kx = (kx / kl) * KNOCK_SPEED;
          p.ky = (ky / kl) * KNOCK_SPEED;
          p.stunUntil = now + STUN_MS;
          p.safeUntil = now + SAFE_MS;
          p.dx = p.dy = 0;
          ctx.broadcast({ type: 'hit', playerId: id });
        }
      }
    }

    if (now - state.lastBroadcast < BROADCAST_MS) return;
    state.lastBroadcast = now;
    const positions: Record<string, { x: number; y: number; j: boolean; s: boolean; out: boolean }> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      positions[id] = {
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        j: now < p.jumpUntil,
        s: now < p.stunUntil,
        out: p.outAt !== null,
      };
    }
    ctx.broadcast({ type: 'pos', positions });
  },

  isFinished(ctx, state, config) {
    if (ctx.now() - ctx.startAt >= config.endsAt) return true;
    const total = ctx.playerIds.length;
    const alive = ctx.playerIds.filter((id) => state.players[id].outAt === null).length;
    if (!(total > 1 ? alive <= 1 : alive === 0)) return false;
    // chờ người rơi cuối cùng rơi xong rồi mới chốt kết quả
    const last = ctx.playerIds.reduce((m, id) => Math.max(m, state.players[id].outAt ?? 0), 0);
    return ctx.now() - last >= FALL_GRACE_MS;
  },

  calculateScore(ctx, state) {
    const total = ctx.playerIds.length;
    const alive = ctx.playerIds.filter((id) => state.players[id].outAt === null).length;
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (p.outAt !== null) {
        const t = p.outAt - ctx.startAt;
        out[id] = { raw: Math.max(0, t), detail: `bị hất văng sau ${(t / 1000).toFixed(1)}s` };
      } else {
        out[id] = {
          raw: 1_000_000,
          detail: total > 1 && alive === 1 ? '🏆 trụ lại cuối cùng' : 'trụ được đến hết giờ',
        };
      }
    }
    return out;
  },
};

