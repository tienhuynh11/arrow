import type { GameContext, GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import {
  BRIDGE_GAP_W,
  BRIDGE_H,
  F_ANCHOR,
  F_DOWN,
  F_FALL,
  F_GROUND,
  F_HELD,
  F_HOLD,
  F_LIFT,
  F_LIFTING,
  F_OUT,
  F_PUNCH,
  F_REACH,
  F_STUN,
  F_THROWN,
  F_WHIFF,
  HALF_W,
  KILL_Z,
  SIGN_DUR,
  TRUCK_V,
  bridgeY,
  constrain,
  newBody,
  signX,
  stepBody,
  supported,
  swayAccel,
  type RtBody,
  type RtConfig,
  type RtHazard,
  type RtRail,
  type RtWarn,
} from '../../../shared/rooftop.js';

/**
 * ĐẤU VẬT TRÊN NÓC NHÀ (kiểu Gang Beasts): mọi người đánh nhau trên nóc một chiếc xe tải đang chạy.
 * Server chốt toàn bộ vật lý "mềm": đấm hất lùi + choáng, túm / kéo / nhấc bổng / quăng, bám lan can, ngã khi mất thăng bằng.
 * Chướng ngại có báo trước: cầu thấp, biển báo quét ngang, ổ gà, phanh gấp, gió. Nửa ván sau xe xóc dần để ván luôn kết thúc.
 * Rơi khỏi xe là bị loại; người cuối cùng còn trên xe thắng (kể cả khi chỉ né / người khác tự rơi hay kéo nhầm nhau).
 */
const DURATION = 140_000;
const WARN_LEAD = 2400;
const GRACE = 3500;
const PUNCH_CD = 650;
const PUNCH_RANGE = 1.75;
const PUNCH_ARC = 1.05; // nửa góc quạt (rad)
const GRAB_RANGE = 1.6;
const GRAB_ARC = 1.3;
const CREDIT_MS = 5500;
const TICK_BUDGET = 45; // gói input / giây tối đa

type CauseKind = 'punch' | 'throw' | 'bowl' | 'drag' | 'hazard';
interface Cause {
  by: string;
  kind: CauseKind;
  hz?: RtHazard;
  at: number;
}

interface PState {
  b: RtBody;
  face: number; // hướng thân
  aim: number; // hướng camera / ngắm
  mx: number;
  my: number;
  inAt: number;
  grab: boolean;
  lift: boolean;
  jumpAt: number;
  punchAt: number;
  punchCd: number;
  punchAnim: number;
  whiffUntil: number;
  stunUntil: number;
  downUntil: number;
  wobble: number;
  grip: number;
  gripTired: boolean;
  grabCd: number;
  holding: string;
  heldBy: string;
  lifted: boolean; // mình đang giơ người bị túm lên cao
  struggle: number;
  anchored: boolean;
  falling: boolean;
  committed: boolean; // đã rơi quá điểm không cứu được
  out: boolean;
  outAt: number;
  kills: number;
  cause: Cause | null;
  thrownUntil: number;
  thrownBy: string;
  thrownHit: Set<string>;
  hazHit: Set<number>;
  ledgeAt: number;
  tokens: number;
  tokAt: number;
}

interface State {
  players: Record<string, PState>;
  warns: RtWarn[];
  nextWarn: number;
  nextId: number;
  lastTick: number;
  lastKind: RtHazard | '';
  tilted: boolean;
  endAt: number;
  alive: number;
  lastOutAt: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const angDiff = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

function makeRails(L: number): RtRail[] {
  const rails: RtRail[] = [];
  for (const s of [-1, 1] as const) {
    let y = -L / 2 + rnd(0.6, 1.8);
    while (y < L / 2 - 1.5) {
      const len = rnd(2.4, 4.6);
      const y1 = Math.min(L / 2 - 0.4, y + len);
      rails.push({ s, y0: r1(y), y1: r1(y1) });
      y = y1 + rnd(1.8, 2.9); // chỗ hở
    }
  }
  return rails;
}

export const rooftopBrawlGame: GameDefinition<RtConfig, State> = {
  id: 'rooftop',
  name: 'ĐẤU VẬT TRÊN NÓC NHÀ',
  instructions:
    'Cả bọn đánh nhau trên nóc xe tải đang chạy: đấm hất lùi, túm rồi nhấc bổng và quăng đối thủ xuống đường. Coi chừng cầu thấp, biển báo, ổ gà và phanh gấp. Rơi khỏi xe là bị loại, người cuối cùng còn trên xe thắng (tự rơi hay kéo nhầm nhau cũng tính!).',
  controls: [
    { keys: ['←', '↑', '→', '↓'], desc: 'Đi theo hướng camera · W A S D cũng được · SPACE nhảy' },
    { keys: ['CHUỘT'], desc: 'Bấm vào màn hình để khoá chuột, di chuột xoay camera · Esc nhả chuột' },
    { keys: ['CLICK TRÁI'], desc: 'ĐẤM hất lùi người phía trước (đấm hụt là loạng choạng!)' },
    { keys: ['CLICK PHẢI', 'E'], desc: 'Giữ để TÚM người trước mặt (hoặc bám mép xe cho khỏi rơi)' },
    { keys: ['SPACE', 'SHIFT'], desc: 'Đang túm: nhấc bổng · click trái hoặc thả nút = QUĂNG theo hướng camera' },
  ],
  duration: DURATION + 1500,
  minPlayers: 2,
  maxPlayers: 16,

  createConfig(ctx) {
    const n = ctx.playerIds.length;
    const L = r1(clamp(11 + n * 0.9, 13, 24));
    const ids = [...ctx.playerIds];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const cols = Math.min(5, Math.max(2, Math.ceil(n / 3)));
    const rows = Math.ceil(n / cols);
    const spawns: RtConfig['spawns'] = {};
    ids.forEach((id, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = (c - (cols - 1) / 2) * (cols > 1 ? Math.min(1.9, 5.2 / (cols - 1)) : 0) + rnd(-0.2, 0.2);
      const y = -L / 2 + 2 + (rows > 1 ? (r / (rows - 1)) * (L - 5) : (L - 5) / 2) + rnd(-0.2, 0.2);
      spawns[id] = [r2(x), r2(y), r2(Math.atan2(-x, -y))];
    });
    return { L, rails: makeRails(L), spawns, endsAt: DURATION, tiltAt: DURATION / 2 };
  },

  createState(ctx, config) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      const [x, y, yaw] = config.spawns[id];
      players[id] = {
        b: newBody(x, y),
        face: yaw,
        aim: yaw,
        mx: 0,
        my: 0,
        inAt: 0,
        grab: false,
        lift: false,
        jumpAt: -1e9,
        punchAt: -1e9,
        punchCd: 0,
        punchAnim: 0,
        whiffUntil: 0,
        stunUntil: 0,
        downUntil: 0,
        wobble: 0,
        grip: 100,
        gripTired: false,
        grabCd: 0,
        holding: '',
        heldBy: '',
        lifted: false,
        struggle: 0,
        anchored: false,
        falling: false,
        committed: false,
        out: false,
        outAt: 0,
        kills: 0,
        cause: null,
        thrownUntil: 0,
        thrownBy: '',
        thrownHit: new Set(),
        hazHit: new Set(),
        ledgeAt: 0,
        tokens: TICK_BUDGET,
        tokAt: 0,
      };
    }
    return {
      players,
      warns: [],
      nextWarn: GRACE,
      nextId: 1,
      lastTick: ctx.startAt,
      lastKind: '',
      tilted: false,
      endAt: 0,
      alive: ctx.playerIds.length,
      lastOutAt: 0,
    };
  },

  handleInput(ctx, state, _config, playerId, input: GameInput) {
    const p = state.players[playerId];
    if (!p || p.out || input.type !== 'brawl') return;
    const now = ctx.now();
    // chống spam gói: nạp lại token theo thời gian
    p.tokens = Math.min(TICK_BUDGET, p.tokens + ((now - p.tokAt) / 1000) * TICK_BUDGET);
    p.tokAt = now;
    if (p.tokens < 1) return;
    p.tokens -= 1;
    let dx = Number(input.dx) || 0;
    let dy = Number(input.dy) || 0;
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    p.mx = dx;
    p.my = dy;
    const yaw = Number(input.yaw);
    if (Number.isFinite(yaw)) p.aim = angDiff(0, yaw);
    p.grab = !!input.grab;
    p.lift = !!input.lift;
    p.inAt = now;
    if (input.jump) p.jumpAt = now;
    if (input.punch) p.punchAt = now;
  },

  update(ctx, state, config) {
    const now = ctx.now();
    const rel = now - ctx.startAt;
    if (rel < 0) {
      state.lastTick = now;
      return;
    }
    const dt = Math.min(now - state.lastTick, 150) / 1000;
    state.lastTick = now;
    const ids = ctx.playerIds;
    const P = state.players;
    const n = ids.length;

    /* ---------- lịch chướng ngại ---------- */
    if (!state.tilted && rel >= config.tiltAt) {
      state.tilted = true;
      ctx.broadcast({ type: 'tilt' });
    }
    if (state.endAt === 0 && rel >= state.nextWarn) {
      const late = rel / DURATION;
      const kinds: RtHazard[] = ['bridge', 'sign', 'sign', 'pothole', 'brake', 'gust'];
      let kind = kinds[Math.floor(Math.random() * kinds.length)];
      if (kind === state.lastKind) kind = kinds[Math.floor(Math.random() * kinds.length)];
      if (late > 0.7 && Math.random() < 0.4) kind = 'bridge';
      state.lastKind = kind;
      const w: RtWarn = { id: state.nextId++, kind, hitAt: rel + WARN_LEAD, dur: 0, a: 0, b: 0 };
      const gw = BRIDGE_GAP_W(n);
      if (kind === 'bridge') {
        w.a = r1(rnd(-HALF_W + gw / 2 + 0.2, HALF_W - gw / 2 - 0.2));
        w.b = r1(gw);
        w.dur = Math.ceil(((config.L + 14) / TRUCK_V) * 1000);
      } else if (kind === 'sign') {
        w.a = Math.random() < 0.5 ? -1 : 1;
        w.b = r1(rnd(-config.L / 2 + 2, config.L / 2 - 3));
        w.dur = SIGN_DUR;
      } else if (kind === 'brake') w.dur = 1500;
      else if (kind === 'gust') {
        w.a = Math.random() < 0.5 ? -1 : 1;
        w.dur = 2800;
      } else w.dur = 200;
      state.warns.push(w);
      ctx.broadcast({ type: 'warn', w });
      state.nextWarn = rel + lerp(7200, 3300, late) * (rel > config.tiltAt ? 0.8 : 1) + rnd(0, 1400);
    }
    state.warns = state.warns.filter((w) => rel < w.hitAt + w.dur + 600);

    /* ---------- mô phỏng (chia bước nhỏ nếu tick bị trễ) ---------- */
    const steps = Math.max(1, Math.ceil(dt / 0.034));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      const t = rel - dt * 1000 + sdt * 1000 * (s + 1);
      simulate(ctx, state, config, sdt, now, t);
    }

    /* ---------- kết thúc: còn ≤ 1 người ---------- */
    if (!state.endAt && n >= 2 && state.alive <= 1) state.endAt = now + 2400;
    if (!state.endAt && n === 1 && state.alive === 0) state.endAt = now + 1500;

    /* ---------- gói vị trí ---------- */
    const pos: Record<string, number[]> = {};
    const hold: Record<string, string> = {};
    for (const id of ids) {
      const p = P[id];
      const b = p.b;
      let f = 0;
      if (b.z <= 0.001 && supported(config, b.x, b.y) && !p.falling) f |= F_GROUND;
      if (now < p.stunUntil) f |= F_STUN;
      if (now < p.downUntil) f |= F_DOWN;
      if (p.holding) {
        f |= F_HOLD;
        hold[id] = p.holding;
        if (p.lifted) f |= F_LIFTING;
      }
      if (p.heldBy) {
        f |= F_HELD;
        if (P[p.heldBy]?.lifted) f |= F_LIFT;
      }
      if (p.anchored) f |= F_ANCHOR;
      if (now < p.punchAnim) f |= F_PUNCH;
      if (p.falling) f |= F_FALL;
      if (p.out) f |= F_OUT;
      if (now < p.thrownUntil) f |= F_THROWN;
      if (p.grab && !p.holding && !p.anchored && !p.out) f |= F_REACH;
      if (now < p.whiffUntil) f |= F_WHIFF;
      pos[id] = [r2(b.x), r2(b.y), r2(b.z), r2(p.face), f, r1(b.vx), r1(b.vy), Math.round(p.wobble * 100) / 100, Math.round(p.grip)];
    }
    ctx.broadcast({ type: 'pos', t: Math.round(rel), pos, hold });
  },

  isFinished(ctx, state) {
    const now = ctx.now();
    if (state.endAt && now >= state.endAt) return true;
    return now - ctx.startAt >= DURATION;
  },

  calculateScore(ctx, state) {
    const out: Record<string, PResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      const hat = p.kills > 0 ? ` · hất ${p.kills} người` : '';
      if (p.out) {
        out[id] = { raw: Math.floor(p.outAt / 100) + p.kills * 8, detail: `trụ được ${Math.round(p.outAt / 1000)}s${hat}` };
      } else {
        out[id] = { raw: 100000 + p.kills * 8, detail: `còn đứng trên xe tới cuối!${hat}` };
      }
    }
    return out;
  },
};

type PResult = PlayerResult;
const lerp = (a: number, b: number, k: number) => a + (b - a) * clamp(k, 0, 1);

/* ===================================================================== */

function simulate(ctx: GameContext, state: State, cfg: RtConfig, dt: number, now: number, t: number) {
  const P = state.players;
  const ids = ctx.playerIds;
  const alive = ids.filter((id) => !P[id].out);
  const sway = swayAccel(cfg, t);

  const fx = (k: string, a: string, extra: Record<string, unknown> = {}) => {
    const p = P[a];
    ctx.broadcast({ type: 'fx', k, a, x: r1(p.b.x), y: r1(p.b.y), z: r1(p.b.z), ...extra });
  };

  const addWobble = (p: PState, v: number) => {
    p.wobble += v;
    if (p.wobble >= 1 && now >= p.downUntil) {
      p.downUntil = now + 1250;
      p.wobble = 0.3;
      p.stunUntil = Math.max(p.stunUntil, p.downUntil);
      if (p.holding) release(findId(p), 'drop');
    }
  };
  const findId = (p: PState) => ids.find((i) => P[i] === p) ?? '';

  /** nhả người đang túm. mode: free = tự thoát, drop = thả rơi, throw = quăng mạnh, lob = ném nhẹ */
  function release(holderId: string, mode: 'free' | 'drop' | 'throw' | 'lob') {
    const h = P[holderId];
    if (!h || !h.holding) return;
    const vid = P[h.holding];
    const vidId = h.holding;
    const wasLifted = h.lifted;
    h.holding = '';
    h.lifted = false;
    h.grabCd = now + 450;
    if (!vid) return;
    vid.heldBy = '';
    vid.struggle = 0;
    if (mode === 'throw' || mode === 'lob') {
      const sp = mode === 'throw' ? 11.5 : 7;
      vid.b.vx = Math.sin(h.aim) * sp + h.b.vx * 0.4;
      vid.b.vy = Math.cos(h.aim) * sp + h.b.vy * 0.4;
      vid.b.vz = wasLifted ? 5.6 : 3.4;
      if (vid.b.z < 0.2) vid.b.z = 0.2;
      vid.thrownUntil = now + 1700;
      vid.thrownBy = holderId;
      vid.thrownHit = new Set([holderId]);
      vid.stunUntil = Math.max(vid.stunUntil, now + 900);
      vid.cause = { by: holderId, kind: 'throw', at: now };
      vid.wobble = Math.min(0.8, vid.wobble + 0.3);
      h.b.vx -= Math.sin(h.aim) * 1.5;
      h.b.vy -= Math.cos(h.aim) * 1.5;
      fx('throw', holderId, { b: vidId });
    } else if (mode === 'free') {
      vid.stunUntil = Math.max(vid.stunUntil, now + 350);
      vid.b.vx = h.b.vx - Math.sin(h.aim) * 2;
      vid.b.vy = h.b.vy - Math.cos(h.aim) * 2;
      h.stunUntil = Math.max(h.stunUntil, now + 350);
      fx('free', vidId, { b: holderId });
    } else {
      vid.b.vx = h.b.vx;
      vid.b.vy = h.b.vy;
      vid.stunUntil = Math.max(vid.stunUntil, now + 500);
      if (wasLifted) vid.cause = { by: holderId, kind: 'drag', at: now };
    }
  }

  /** gán người bị "đẩy ngã" để tính công */
  const credit = (victim: PState, by: string, kind: CauseKind, hz?: RtHazard) => {
    victim.cause = { by, kind, hz, at: now };
  };

  /* ---------- 1. từng người: input, hành động, vật lý ---------- */
  for (const id of alive) {
    const p = P[id];
    const b = p.b;
    if (now - p.inAt > 700) {
      p.mx = p.my = 0;
      p.grab = false;
      p.lift = false;
    }
    p.wobble = Math.max(0, p.wobble - dt * 0.45);
    const downed = now < p.downUntil;
    const stunned = now < p.stunUntil;
    const thrown = now < p.thrownUntil;

    /* đang rơi: chỉ còn có thể bám mép */
    if (p.falling) {
      if (!p.committed && supported(cfg, b.x, b.y)) {
        p.falling = false; // được kéo lại lên xe
      } else if (!p.committed) {
        const over = Math.max(Math.abs(b.x) - HALF_W, -cfg.L / 2 - b.y, 0);
        if (p.grab && p.grip >= 40 && b.z > -1 && over < 1.1 && now - p.ledgeAt > 1500) {
          // bám mép kéo mình lên!
          b.x = clamp(b.x, -HALF_W + 0.35, HALF_W - 0.35);
          b.y = Math.max(b.y, -cfg.L / 2 + 0.35);
          b.z = 0;
          b.vz = 4.2;
          b.vx *= 0.2;
          b.vy = 0;
          p.falling = false;
          p.grip -= 40;
          p.ledgeAt = now;
          p.stunUntil = now + 500;
          p.cause = null;
          fx('ledge', id);
          continue;
        }
        if (b.z < -1.0) {
          p.committed = true;
          const c = p.cause && now - p.cause.at < CREDIT_MS ? p.cause : null;
          const cby = c && c.by && c.by !== id && !P[c.by]?.out && !(P[c.by]?.committed) ? c.by : '';
          let how: string = 'self';
          let by = '';
          if (p.holding) {
            how = 'wrong';
            by = p.holding;
            fx('wrong', id, { b: p.holding });
          } else if (c && c.kind === 'hazard') {
            how = 'hazard:' + (c.hz ?? '');
          } else if (cby) {
            how = c!.kind;
            by = cby;
            P[cby].kills++;
          } else if (c && c.by && c.by !== id) {
            how = 'wrong'; // người hất mình cũng đã rơi
            by = c.by;
          }
          // nhả hết dây dưa: nếu mình đang túm người, người đó rơi tiếp theo đà
          if (p.holding) release(id, 'drop');
          if (p.heldBy) release(p.heldBy, 'drop');
          p.anchored = false;
          ctx.broadcast({ type: 'fall', playerId: id, by, how });
        }
      }
      stepBody(cfg, b, 0, 0, dt, { noControl: true });
      if (b.z < KILL_Z) {
        p.out = true;
        p.outAt = Math.round(t);
        state.alive--;
        state.lastOutAt = now;
        ctx.broadcast({ type: 'out', playerId: id, left: state.alive });
      }
      continue;
    }

    /* tin nhắn ý định */
    const wantJump = now - p.jumpAt < 200;
    const wantPunch = now - p.punchAt < 220;
    const free = !downed && !p.heldBy && !thrown;

    /* bị túm: vùng vẫy */
    if (p.heldBy) {
      const holder = P[p.heldBy];
      if (!holder || holder.out || holder.falling && holder.committed) {
        p.heldBy = '';
      } else {
        if (Math.hypot(p.mx, p.my) > 0.3) p.struggle += dt * 1.0;
        if (wantJump) {
          p.struggle += 0.45;
          p.jumpAt = -1e9;
        }
        const need = holder.lifted ? 3.2 : 2.0;
        if (p.struggle >= need) release(p.heldBy, 'free');
        continue; // vị trí do người túm quyết định (bước 2)
      }
    }

    /* thể lực bám */
    if (p.holding || p.anchored) p.grip -= dt * (p.holding ? (p.lifted ? 17 : 9) : 20);
    else p.grip = Math.min(100, p.grip + dt * 16);
    if (p.grip <= 0) {
      p.grip = 0;
      p.gripTired = true;
      if (p.holding) {
        fx('tired', id);
        release(id, 'drop');
      }
      p.anchored = false;
    }
    if (p.gripTired && p.grip >= 30) p.gripTired = false;

    /* nhả nút túm */
    if (!p.grab) {
      if (p.holding) release(id, p.lifted ? 'lob' : 'drop');
      p.anchored = false;
    }

    /* hành động */
    if (free) {
      if (p.holding) {
        if (!P[p.holding] || P[p.holding].out) {
          p.holding = '';
          p.lifted = false;
        } else {
          if ((p.lift || wantJump) && !p.lifted) {
            p.lifted = true;
            p.jumpAt = -1e9;
            fx('lift', id, { b: p.holding });
          }
          if (wantPunch) {
            p.punchAt = -1e9;
            p.face = p.aim;
            release(id, 'throw');
          }
        }
      } else if (!stunned && wantPunch && now >= p.punchCd) {
        p.punchAt = -1e9;
        p.punchCd = now + PUNCH_CD;
        p.punchAnim = now + 320;
        p.face = p.aim;
        p.anchored = false;
        let hitAny = false;
        const dx = Math.sin(p.aim);
        const dy = Math.cos(p.aim);
        for (const oid of alive) {
          if (oid === id) continue;
          const o = P[oid];
          if (o.falling || Math.abs(o.b.z - b.z) > 1.4) continue;
          const ox = o.b.x - b.x;
          const oy = o.b.y - b.y;
          const dist = Math.hypot(ox, oy);
          if (dist > PUNCH_RANGE || dist < 1e-4) continue;
          if (Math.abs(angDiff(p.aim, Math.atan2(ox, oy))) > PUNCH_ARC) continue;
          hitAny = true;
          const k = (o.anchored ? 0.28 : 1) * (o.holding ? 0.6 : 1);
          o.b.vx += dx * 6.8 * k;
          o.b.vy += dy * 6.8 * k;
          if (o.b.z <= 0) o.b.vz = 2.2;
          o.stunUntil = Math.max(o.stunUntil, now + 600);
          if (o.heldBy) release(o.heldBy, 'free');
          if (o.holding) release(oid, 'drop');
          credit(o, id, 'punch');
          addWobble(o, 0.52);
          fx('hit', id, { b: oid });
        }
        if (!hitAny) {
          // đấm hụt: loạng choạng theo đà
          b.vx += dx * 3.8;
          b.vy += dy * 3.8;
          p.stunUntil = now + 520;
          p.whiffUntil = now + 520;
          addWobble(p, 0.5);
          fx('whiff', id);
        }
      } else if (p.grab && !p.holding && !p.anchored && !stunned && now >= p.grabCd && !p.gripTired) {
        // tìm người để túm
        let best = '';
        let bestD = GRAB_RANGE;
        for (const oid of alive) {
          if (oid === id) continue;
          const o = P[oid];
          if (o.falling || o.heldBy || Math.abs(o.b.z - b.z) > 1.1) continue;
          const ox = o.b.x - b.x;
          const oy = o.b.y - b.y;
          const dist = Math.hypot(ox, oy);
          if (dist > bestD) continue;
          if (dist > 0.4 && Math.abs(angDiff(p.aim, Math.atan2(ox, oy))) > GRAB_ARC) continue;
          best = oid;
          bestD = dist;
        }
        if (best) {
          const o = P[best];
          if (o.holding) release(best, 'drop');
          p.holding = best;
          p.lifted = false;
          p.face = p.aim;
          o.heldBy = id;
          o.struggle = 0;
          o.anchored = false;
          o.thrownUntil = 0;
          credit(o, id, 'drag');
          fx('grab', id, { b: best });
        } else {
          // gần mép xe thì bám lấy mép
          const edge = Math.min(HALF_W - Math.abs(b.x), b.y + cfg.L / 2);
          if (edge < 1.0 && b.z <= 0.05) {
            p.anchored = true;
            fx('anchor', id);
          }
        }
      }
    }

    /* vật lý */
    const hold = !!p.holding;
    let ax = 0;
    let ay = 0;
    if (!p.anchored) {
      const onG = b.z <= 0.001;
      const mul = (hold && p.lifted ? 1.5 : 1) * (onG ? 1 : 0.5);
      ax += sway * mul;
      for (const w of state.warns) {
        if (w.kind === 'brake' && t >= w.hitAt && t < w.hitAt + w.dur) ay += 15 * mul;
        else if (w.kind === 'gust' && t >= w.hitAt && t < w.hitAt + w.dur) ax += w.a * 6.5 * mul * (onG ? 1 : 1.6);
      }
    }
    const slick = !p.anchored && state.warns.some((w) => w.kind === 'brake' && t >= w.hitAt && t < w.hitAt + w.dur);
    const m = Math.hypot(p.mx, p.my);
    const control = free && !p.falling;
    const jumped = stepBody(cfg, b, control ? p.mx : 0, control ? p.my : 0, dt, {
      speedMul: p.anchored ? 0.25 : hold ? (p.lifted ? 0.5 : 0.62) : stunned ? 0.55 : 1,
      accelMul: stunned ? 0.5 : 1,
      ax,
      ay,
      slick,
      noControl: !control,
      jump: control && wantJump && !hold && !p.anchored && !stunned,
    });
    if (jumped) p.jumpAt = -1e9;
    if (!control && downed) p.mx = p.my = 0;

    /* hướng thân */
    if (hold || now < p.punchAnim || p.anchored) p.face = p.aim;
    else if (control && m > 0.15) p.face += angDiff(p.face, Math.atan2(p.mx, p.my)) * Math.min(1, dt * 12);

    /* người bay hạ cánh */
    if (thrown && b.z <= 0 && b.vz <= 0 && supported(cfg, b.x, b.y)) {
      p.thrownUntil = 0;
      p.stunUntil = Math.max(p.stunUntil, now + 650);
      addWobble(p, 0.5);
      fx('land', id);
    }

    /* mất chỗ đứng → rơi */
    if (!supported(cfg, b.x, b.y) && b.z <= 0.05) {
      p.falling = true;
      p.committed = false;
      p.anchored = false;
      p.thrownUntil = 0;
    }
  }

  /* ---------- 2. người bị túm đi theo người túm ---------- */
  for (const id of alive) {
    const h = P[id];
    if (!h.holding || h.falling && h.committed) continue;
    const v = P[h.holding];
    if (!v || v.out) continue;
    const dx = Math.sin(h.aim);
    const dy = Math.cos(h.aim);
    if (h.lifted) {
      v.b.x = h.b.x + dx * 0.1;
      v.b.y = h.b.y + dy * 0.1;
      v.b.z = h.b.z + 1.75;
    } else {
      const k = 1 - Math.exp(-dt * 16);
      v.b.x += (h.b.x + dx * 0.95 - v.b.x) * k;
      v.b.y += (h.b.y + dy * 0.95 - v.b.y) * k;
      v.b.z = h.b.z;
    }
    v.b.vx = h.b.vx;
    v.b.vy = h.b.vy;
    v.b.vz = 0;
    v.face = h.face + Math.PI;
    v.falling = h.falling;
    if (!h.falling && !h.lifted) constrain(cfg, v.b);
    v.cause = { by: id, kind: 'drag', at: now };
  }

  /* ---------- 3. va chạm giữa người với nhau + người bị quăng ---------- */
  for (let i = 0; i < alive.length; i++) {
    const A = P[alive[i]];
    if (A.out || A.falling) continue;
    for (let j = i + 1; j < alive.length; j++) {
      const B = P[alive[j]];
      if (B.out || B.falling) continue;
      if (A.heldBy === alive[j] || B.heldBy === alive[i] || A.heldBy || B.heldBy) continue;
      if (Math.abs(A.b.z - B.b.z) > 1.3) continue;
      const dx = B.b.x - A.b.x;
      const dy = B.b.y - A.b.y;
      const d = Math.hypot(dx, dy);
      if (d >= 0.85) continue;
      const nx = d > 1e-3 ? dx / d : 1;
      const ny = d > 1e-3 ? dy / d : 0;
      // người bị quăng đâm trúng: va chạm dây chuyền
      for (const [S, V, sid, vid] of [
        [A, B, alive[i], alive[j]],
        [B, A, alive[j], alive[i]],
      ] as const) {
        if (now < S.thrownUntil && !S.thrownHit.has(vid) && Math.hypot(S.b.vx, S.b.vy) > 3.5) {
          S.thrownHit.add(vid);
          V.b.vx += S.b.vx * 0.8;
          V.b.vy += S.b.vy * 0.8;
          V.b.vz = Math.max(V.b.vz, 2.5);
          V.stunUntil = Math.max(V.stunUntil, now + 800);
          S.b.vx *= 0.45;
          S.b.vy *= 0.45;
          if (V.holding) release(vid, 'drop');
          credit(V, S.thrownBy || sid, 'bowl');
          addWobble(V, 0.75);
          fx('bowl', sid, { b: vid, c: S.thrownBy });
        }
      }
      const push = (0.85 - d) / 2;
      A.b.x -= nx * push;
      A.b.y -= ny * push;
      B.b.x += nx * push;
      B.b.y += ny * push;
      const rv = (B.b.vx - A.b.vx) * nx + (B.b.vy - A.b.vy) * ny;
      if (rv < -2.5) {
        // đâm sầm vào nhau
        A.b.vx -= nx * 1.4;
        A.b.vy -= ny * 1.4;
        B.b.vx += nx * 1.4;
        B.b.vy += ny * 1.4;
        addWobble(A, 0.12);
        addWobble(B, 0.12);
      }
      constrain(cfg, A.b);
      constrain(cfg, B.b);
    }
  }

  /* ---------- 4. chướng ngại ---------- */
  for (const w of state.warns) {
    if (w.kind === 'pothole') {
      if (t >= w.hitAt && !(w as any)._done) {
        (w as any)._done = true;
        ctx.broadcast({ type: 'fx', k: 'pothole', a: '', x: 0, y: 0, z: 0 });
        for (const id of alive) {
          const p = P[id];
          if (p.falling || p.heldBy) continue;
          if (p.b.z <= 0.001) {
            const k = p.anchored ? 0.3 : 1;
            p.b.vz = 6 * k + 1;
            p.b.vx += rnd(-3.2, 3.2) * k;
            p.b.vy += rnd(-2.4, 2.4) * k;
            addWobble(p, 0.38 * k);
          }
        }
      }
    } else if (w.kind === 'bridge') {
      const yc = bridgeY(cfg, w.hitAt, t);
      const yp = bridgeY(cfg, w.hitAt, t - dt * 1000);
      for (const id of alive) {
        const p = P[id];
        if (p.falling || p.hazHit.has(w.id)) continue;
        const b = p.b;
        if (b.y > yp + 0.55 || b.y < yc - 0.55) continue;
        if (b.z > BRIDGE_H - 0.1) continue; // nhảy cao quá thanh chắn (hiếm)
        if (Math.abs(b.x - w.a) < w.b / 2 - 0.1) continue; // đúng khe an toàn
        p.hazHit.add(w.id);
        const k = p.anchored ? 0.45 : 1;
        b.vx += rnd(-1.5, 1.5);
        b.vy = -13 * k;
        b.vz = 3.2;
        p.stunUntil = Math.max(p.stunUntil, now + 900);
        p.downUntil = Math.max(p.downUntil, now + 1000);
        p.anchored = false;
        if (p.heldBy) release(p.heldBy, 'free');
        if (p.holding) release(id, 'drop');
        credit(p, '', 'hazard', 'bridge');
        fx('crash', id);
      }
    } else if (w.kind === 'sign') {
      if (t < w.hitAt || t > w.hitAt + w.dur) continue;
      const sx = signX(w.a, w.hitAt, t);
      for (const id of alive) {
        const p = P[id];
        if (p.falling || p.hazHit.has(w.id)) continue;
        const b = p.b;
        if (b.z > 0.9 || Math.abs(b.y - w.b) > 0.8 || Math.abs(b.x - sx) > 0.9) continue;
        p.hazHit.add(w.id);
        const k = p.anchored ? 0.45 : 1;
        b.vx = -w.a * 10 * k;
        b.vy += rnd(-1.5, 1.5);
        b.vz = 3;
        p.stunUntil = Math.max(p.stunUntil, now + 800);
        p.anchored = false;
        if (p.heldBy) release(p.heldBy, 'free');
        if (p.holding) release(id, 'drop');
        addWobble(p, 0.75);
        credit(p, '', 'hazard', 'sign');
        fx('crash', id);
      }
    }
  }
}
