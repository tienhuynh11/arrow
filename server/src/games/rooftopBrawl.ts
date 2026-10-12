import type { GameContext, GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import {
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
  F_DODGE,
  F_CHARGE,
  HALF_W,
  KILL_Z,
  constrain,
  roofScale,
  ANCHOR_KNOCK_MUL,
  CHARGE_LEAD,
  CHARGE_MAX,
  CHARGE_SPEED_MUL,
  COMBO_FINISH_CD,
  COMBO_FORCE,
  COMBO_STUN,
  COMBO_WINDOW,
  COMBO_WOBBLE,
  COUNTER_EXTRA_STUN,
  COUNTER_EXTRA_WOBBLE,
  COUNTER_MULT,
  DODGE_CD,
  DODGE_IFRAME,
  DODGE_MS,
  DODGE_SPEED,
  DODGE_WOBBLE,
  DOWN_MS,
  DOWN_WOBBLE_RESET,
  GETUP_REDUCE,
  GRAB_ARC,
  GRAB_RANGE,
  GRAB_TIE_EPS,
  HEAVY_ARC,
  HEAVY_CD,
  HEAVY_FORCE_MAX,
  HEAVY_FORCE_MIN,
  HEAVY_LURCH,
  HEAVY_MIN,
  HEAVY_RANGE,
  HEAVY_STUN,
  HEAVY_WHIFF_STUN,
  HEAVY_WHIFF_WOBBLE,
  HEAVY_WOBBLE,
  HOLDING_KNOCK_MUL,
  KNOCK_WOBBLE_BOOST,
  LOB_V,
  QUICK_ARC,
  QUICK_CD,
  QUICK_LURCH,
  QUICK_RANGE,
  QUICK_WHIFF_CD,
  SPEED_FORCE_K,
  STRUGGLE_NEED,
  STRUGGLE_NEED_LIFT,
  THROW_V,
  THROW_VZ,
  THROW_VZ_LIFT,
  WHIFF_STUN,
  WHIFF_VULN_MS,
  WHIFF_WOBBLE,
  WOBBLE_DECAY,
  WOBBLE_STEER_BONUS,
  newBody,
  stepBody,
  supported,
  type RtBody,
  type RtConfig,
  type RtRail,
} from '../../../shared/rooftop.js';

/**
 * ĐẤU VẬT TRÊN NÓC NHÀ (kiểu Gang Beasts): mọi người đánh nhau trên nóc một chiếc xe tải đang chạy.
 * Server chốt toàn bộ vật lý "mềm": đấm hất lùi + choáng, túm / kéo / nhấc bổng / quăng, bám lan can, ngã khi mất thăng bằng.
 * Sau ~55s nóc xe thu hẹp dần từ mép vào (lịch cố định trong config) để ván luôn kết thúc.
 * Rơi khỏi xe là bị loại; người cuối cùng còn trên xe thắng (kể cả khi chỉ né / người khác tự rơi hay kéo nhầm nhau).
 */
const DURATION = 130_000;
const SHRINK_AT = 55_000;
const CREDIT_MS = 5500;
const TICK_BUDGET = 45; // gói input / giây tối đa

type CauseKind = 'punch' | 'throw' | 'bowl' | 'drag';
interface Cause {
  by: string;
  kind: CauseKind;
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
  chargeIn: boolean;
  lmb: boolean;
  chargeAt: number;
  latched: boolean;
  relHeld: number;
  dodgeAt: number;
  dodgeCd: number;
  dodgeUntil: number;
  dodgeIframe: number;
  lastDx: number;
  lastDy: number;
  combo: number;
  lastQuickAt: number;
  comboHit: boolean;
  wasDown: boolean;
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
  ledgeAt: number;
  tokens: number;
  tokAt: number;
}

interface State {
  players: Record<string, PState>;
  lastTick: number;
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
    'Cả bọn đánh nhau trên nóc xe tải đang đậu: đấm hất lùi, túm rồi nhấc bổng và quăng đối thủ xuống đường. Sau một lúc nóc xe sập dần từ mép vào, lan can biến mất. Rơi khỏi xe là bị loại, người cuối cùng còn trên xe thắng (tự rơi hay kéo nhầm nhau cũng tính!).',
  controls: [
    { keys: ['←', '↑', '→', '↓'], desc: 'Đi theo hướng camera · W A S D cũng được · SPACE nhảy' },
    { keys: ['CHUỘT'], desc: 'Bấm vào màn hình để khoá chuột, di chuột xoay camera · Esc nhả chuột' },
    { keys: ['CLICK TRÁI'], desc: 'ĐẤM nhanh (nối 2–3 đòn = combo) · giữ rồi thả = ĐẤM MẠNH · đấm hụt là hở sườn!' },
    { keys: ['CTRL', 'Q'], desc: 'NÉ ngắn theo hướng đi (tránh được đấm, không tránh được túm)' },
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
    return { L, rails: makeRails(L), spawns, endsAt: DURATION, shrinkAt: SHRINK_AT };
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
        chargeIn: false,
        lmb: false,
        chargeAt: 0,
        latched: false,
        relHeld: -1,
        dodgeAt: -1e9,
        dodgeCd: 0,
        dodgeUntil: 0,
        dodgeIframe: 0,
        lastDx: 0,
        lastDy: 1,
        combo: 0,
        lastQuickAt: -1e9,
        comboHit: false,
        wasDown: false,
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
        ledgeAt: 0,
        tokens: TICK_BUDGET,
        tokAt: 0,
      };
    }
    return {
      players,
      lastTick: ctx.startAt,
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
    const c = !!input.charge;
    if (!c) p.latched = false;
    if (c && !p.lmb) {
      p.lmb = true;
      if (!p.latched && !p.chargeIn) {
        p.chargeIn = true;
        p.chargeAt = now;
      }
    } else if (!c && p.lmb) {
      p.lmb = false;
      if (p.chargeIn) p.relHeld = now - p.chargeAt + CHARGE_LEAD;
      else if (p.holding) p.relHeld = 0; // đang túm: thả chuột trái = quăng
      p.chargeIn = false;
    }
    if (input.dodge) p.dodgeAt = now;
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
      if (b.z <= 0.001 && supported(config, b.x, b.y, rel) && !p.falling) f |= F_GROUND;
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
      if (now < p.dodgeUntil) f |= F_DODGE;
      if (p.chargeIn) f |= F_CHARGE;
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
  const sc = roofScale(cfg, t);

  const fx = (k: string, a: string, extra: Record<string, unknown> = {}) => {
    const p = P[a];
    ctx.broadcast({ type: 'fx', k, a, x: r1(p.b.x), y: r1(p.b.y), z: r1(p.b.z), ...extra });
  };

  const addWobble = (p: PState, v: number) => {
    p.wobble += v;
    if (p.wobble >= 1 && now >= p.downUntil) {
      p.downUntil = now + DOWN_MS;
      p.wobble = DOWN_WOBBLE_RESET;
      p.chargeIn = false;
      p.latched = true;
      fx('down', findId(p));
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
      const sp = mode === 'throw' ? THROW_V : LOB_V;
      vid.b.vx = Math.sin(h.aim) * sp + h.b.vx * 0.4;
      vid.b.vy = Math.cos(h.aim) * sp + h.b.vy * 0.4;
      vid.b.vz = wasLifted ? THROW_VZ_LIFT : THROW_VZ;
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
  const credit = (victim: PState, by: string, kind: CauseKind) => {
    victim.cause = { by, kind, at: now };
  };

  /* ---------- 0. ảnh chụp trạng thái đầu bước: mọi quyết định đấm/túm dựa vào ảnh chụp này nên KHÔNG phụ thuộc thứ tự vòng lặp ---------- */
  interface Snap {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    wobble: number;
    stunned: boolean;
    downed: boolean;
    thrown: boolean;
    heldBy: string;
    holding: string;
    falling: boolean;
    anchored: boolean;
    whiff: boolean;
    dodgeI: boolean;
  }
  const S: Record<string, Snap> = {};
  for (const id of alive) {
    const q = P[id];
    S[id] = {
      x: q.b.x,
      y: q.b.y,
      z: q.b.z,
      vx: q.b.vx,
      vy: q.b.vy,
      wobble: q.wobble,
      stunned: now < q.stunUntil,
      downed: now < q.downUntil,
      thrown: now < q.thrownUntil,
      heldBy: q.heldBy,
      holding: q.holding,
      falling: q.falling,
      anchored: q.anchored,
      whiff: now < q.whiffUntil,
      dodgeI: now < q.dodgeIframe,
    };
  }
  interface Hit {
    att: string;
    vic: string;
    kind: 'quick' | 'heavy';
    idx: number;
    force: number;
    stun: number;
    wob: number;
    dx: number;
    dy: number;
    counter: boolean;
  }
  const hits: Hit[] = [];
  const grabReqs: { by: string; to: string; d: number }[] = [];

  /* ---------- 1. từng người: input, hành động, vật lý ---------- */
  for (const id of alive) {
    const p = P[id];
    const b = p.b;
    const sn = S[id];
    if (now - p.inAt > 700) {
      p.mx = p.my = 0;
      p.grab = false;
      p.lift = false;
      if (p.chargeIn) {
        p.chargeIn = false;
        p.latched = true;
      }
    }
    // thăng bằng hồi dần; bẻ lái ngược hướng đang trượt thì hồi nhanh hơn
    let decay = WOBBLE_DECAY;
    {
      const sp = Math.hypot(b.vx, b.vy);
      const mm = Math.hypot(p.mx, p.my);
      if (mm > 0.3 && sp > 1 && (p.mx * b.vx + p.my * b.vy) / (mm * sp) < -0.2) decay += WOBBLE_STEER_BONUS;
    }
    p.wobble = Math.max(0, p.wobble - dt * decay);
    const downed = sn.downed;
    const stunned = sn.stunned;
    const thrown = sn.thrown;
    if (p.wasDown && now >= p.downUntil) {
      p.wasDown = false;
      fx('getup', id);
    }
    if (downed) p.wasDown = true;

    /* đang rơi: chỉ còn có thể bám mép */
    if (p.falling) {
      if (!p.committed && supported(cfg, b.x, b.y, t)) {
        p.falling = false; // được kéo lại lên xe
      } else if (!p.committed) {
        const over = Math.max(Math.abs(b.x) - HALF_W * sc, Math.abs(b.y) - (cfg.L / 2) * sc, 0);
        if (p.grab && p.grip >= 40 && b.z > -1 && over < 1.1 && now - p.ledgeAt > 1500) {
          // bám mép kéo mình lên!
          b.x = clamp(b.x, -HALF_W * sc + 0.35, HALF_W * sc - 0.35);
          b.y = clamp(b.y, -(cfg.L / 2) * sc + 0.35, (cfg.L / 2) * sc - 0.35);
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
    let wantPunch = now - p.punchAt < 220;
    const wantDodge = now - p.dodgeAt < 200;
    const free = !downed && !p.heldBy && !thrown;
    let rel = p.relHeld; // chuột trái vừa thả: thời gian đã giữ
    p.relHeld = -1;
    if (p.chargeIn && now - p.chargeAt + CHARGE_LEAD >= CHARGE_MAX) {
      rel = CHARGE_MAX; // đủ tích lực: tự tung
      p.chargeIn = false;
      p.latched = true;
    }
    if (p.chargeIn && (!free || stunned || p.holding)) {
      p.chargeIn = false; // bị ngắt: hủy tích lực
      p.latched = true;
    }
    // nằm ngã: bấm Space / né để đứng dậy nhanh hơn
    if (downed) {
      if (wantJump || wantDodge) {
        p.downUntil = Math.max(now + 250, p.downUntil - GETUP_REDUCE);
        p.jumpAt = -1e9;
        p.dodgeAt = -1e9;
      }
      rel = -1;
      wantPunch = false;
    }

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
        const need = holder.lifted ? STRUGGLE_NEED_LIFT : STRUGGLE_NEED;
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
      const dodging = now < p.dodgeUntil;
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
          if (wantPunch || rel >= 0) {
            p.punchAt = -1e9;
            p.face = p.aim;
            release(id, 'throw');
          }
        }
      } else if (wantDodge && now >= p.dodgeCd && !dodging) {
        // né ngắn: theo hướng đang đi, đứng yên thì theo hướng ngắm; chỉ tránh được ĐẤM, không tránh được túm
        const mm = Math.hypot(p.mx, p.my);
        const dx = mm > 0.2 ? p.mx / mm : Math.sin(p.aim);
        const dy = mm > 0.2 ? p.my / mm : Math.cos(p.aim);
        p.dodgeAt = -1e9;
        p.dodgeCd = now + DODGE_CD;
        p.dodgeUntil = now + DODGE_MS;
        p.dodgeIframe = now + DODGE_IFRAME;
        p.anchored = false;
        p.chargeIn = false;
        p.latched = true;
        b.vx = dx * DODGE_SPEED;
        b.vy = dy * DODGE_SPEED;
        addWobble(p, DODGE_WOBBLE);
        fx('dodge', id);
      } else if (!stunned && !dodging && now >= p.punchCd && (wantPunch || rel >= 0)) {
        const heavy = rel >= HEAVY_MIN && !wantPunch;
        p.punchAt = -1e9;
        p.face = p.aim;
        p.anchored = false;
        const range = heavy ? HEAVY_RANGE : QUICK_RANGE;
        const arc = heavy ? HEAVY_ARC : QUICK_ARC;
        let idx = 0;
        if (!heavy) {
          idx = p.comboHit && now - p.lastQuickAt <= COMBO_WINDOW && p.combo < 2 ? p.combo + 1 : 0;
          p.combo = idx;
          p.lastQuickAt = now;
        } else p.combo = 0;
        p.comboHit = false;
        p.punchAnim = now + (heavy ? 420 : 300);
        const ax = Math.sin(p.aim);
        const ay = Math.cos(p.aim);
        const frac = heavy ? clamp((rel - HEAVY_MIN) / (CHARGE_MAX - HEAVY_MIN), 0, 1) : 0;
        let found = 0;
        let dodgedOne = '';
        for (const oid of alive) {
          if (oid === id) continue;
          const o = S[oid];
          if (o.falling || Math.abs(o.z - sn.z) > 1.4) continue;
          const ox = o.x - sn.x;
          const oy = o.y - sn.y;
          const dist = Math.hypot(ox, oy);
          if (dist > range || dist < 1e-4) continue;
          if (Math.abs(angDiff(p.aim, Math.atan2(ox, oy))) > arc) continue;
          if (o.dodgeI) {
            dodgedOne = oid;
            continue;
          }
          found++;
          // hướng đẩy: pha trộn hướng ngắm và hướng từ mình tới đối thủ
          let kx = ax * 0.6 + (ox / dist) * 0.4;
          let ky = ay * 0.6 + (oy / dist) * 0.4;
          const kl = Math.hypot(kx, ky) || 1;
          kx /= kl;
          ky /= kl;
          let force = heavy ? HEAVY_FORCE_MIN + (HEAVY_FORCE_MAX - HEAVY_FORCE_MIN) * frac : COMBO_FORCE[idx];
          force += Math.max(0, sn.vx * kx + sn.vy * ky) * SPEED_FORCE_K; // lao tới đấm thì mạnh hơn
          force *= 1 + o.wobble * KNOCK_WOBBLE_BOOST;
          force *= (o.anchored ? ANCHOR_KNOCK_MUL : 1) * (o.holding ? HOLDING_KNOCK_MUL : 1);
          let stun = heavy ? HEAVY_STUN : COMBO_STUN[idx];
          let wob = heavy ? HEAVY_WOBBLE : COMBO_WOBBLE[idx];
          const counter = o.whiff;
          if (counter) {
            force *= COUNTER_MULT;
            stun += COUNTER_EXTRA_STUN;
            wob += COUNTER_EXTRA_WOBBLE;
          }
          hits.push({ att: id, vic: oid, kind: heavy ? 'heavy' : 'quick', idx, force, stun, wob, dx: kx, dy: ky, counter });
        }
        if (found === 0) {
          // đấm hụt (hoặc bị né): lộ sơ hở, loạng choạng nhẹ, không trượt dài
          p.combo = 0;
          p.punchCd = now + (heavy ? HEAVY_CD : QUICK_WHIFF_CD);
          b.vx += ax * (heavy ? HEAVY_LURCH : QUICK_LURCH);
          b.vy += ay * (heavy ? HEAVY_LURCH : QUICK_LURCH);
          p.stunUntil = now + (heavy ? HEAVY_WHIFF_STUN : WHIFF_STUN);
          p.whiffUntil = now + WHIFF_VULN_MS;
          addWobble(p, heavy ? HEAVY_WHIFF_WOBBLE : WHIFF_WOBBLE);
          fx('whiff', id, { heavy });
          if (dodgedOne) fx('dodged', dodgedOne, { b: id });
        } else {
          p.punchCd = now + (heavy ? HEAVY_CD : idx === 2 ? COMBO_FINISH_CD : QUICK_CD);
        }
      } else if (p.grab && !p.holding && !p.anchored && !stunned && now >= p.grabCd && !p.gripTired && !dodging) {
        // tìm người để túm (dựa trên ảnh chụp); yêu cầu được phân xử sau vòng lặp để không phụ thuộc thứ tự
        let best = '';
        let bestD = GRAB_RANGE;
        let bestScore = 1e9;
        for (const oid of alive) {
          if (oid === id) continue;
          const o = S[oid];
          if (o.falling || o.heldBy || Math.abs(o.z - sn.z) > 1.1) continue;
          const ox = o.x - sn.x;
          const oy = o.y - sn.y;
          const dist = Math.hypot(ox, oy);
          if (dist > bestD) continue;
          const ad = dist > 0.4 ? Math.abs(angDiff(p.aim, Math.atan2(ox, oy))) : 0;
          if (ad > GRAB_ARC) continue;
          const score = dist + ad * 0.3;
          if (score < bestScore - GRAB_TIE_EPS || (Math.abs(score - bestScore) <= GRAB_TIE_EPS && oid < best)) {
            best = oid;
            bestScore = score;
          }
        }
        p.face = p.aim;
        if (best) grabReqs.push({ by: id, to: best, d: bestScore });
        else {
          // gần mép xe thì bám lấy mép
          const edge = Math.min(HALF_W * sc - Math.abs(b.x), (cfg.L / 2) * sc - Math.abs(b.y));
          if (edge < 1.0 && b.z <= 0.05) {
            p.anchored = true;
            fx('anchor', id);
          }
        }
      }
    }

    /* vật lý */
    const hold = !!p.holding;
    const m = Math.hypot(p.mx, p.my);
    const control = free && !p.falling;
    const jumped = stepBody(cfg, b, control ? p.mx : 0, control ? p.my : 0, dt, {
      speedMul: p.anchored ? 0.25 : hold ? (p.lifted ? 0.5 : 0.62) : p.chargeIn ? CHARGE_SPEED_MUL : stunned ? 0.55 : 1,
      accelMul: stunned ? 0.5 : 1,
      t,
      noControl: !control || now < p.dodgeUntil,
      jump: control && wantJump && !hold && !p.anchored && !stunned && !p.chargeIn && now >= p.dodgeUntil,
    });
    if (jumped) p.jumpAt = -1e9;
    if (!control && downed) p.mx = p.my = 0;

    /* hướng thân */
    // kiểu game sinh tồn góc nhìn thứ ba: điều khiển được thì thân LUÔN hướng theo camera (kể cả đứng yên / đi lùi / đi ngang)
    if (control && !stunned) p.face = p.aim;
    else if (hold || now < p.punchAnim || p.anchored) p.face = p.aim;
    else if (control && m > 0.15) p.face += angDiff(p.face, Math.atan2(p.mx, p.my)) * Math.min(1, dt * 12);

    /* người bay hạ cánh */
    if (thrown && b.z <= 0 && b.vz <= 0 && supported(cfg, b.x, b.y, t)) {
      p.thrownUntil = 0;
      p.stunUntil = Math.max(p.stunUntil, now + 650);
      addWobble(p, 0.5);
      fx('land', id);
    }

    /* mất chỗ đứng → rơi */
    if (!supported(cfg, b.x, b.y, t) && b.z <= 0.05) {
      p.falling = true;
      p.committed = false;
      p.anchored = false;
      p.thrownUntil = 0;
    }
  }

  /* ---------- 1b. áp dụng đòn đánh: sắp xếp cố định (lực lớn trước, rồi theo id) nên kết quả đồng thời nhất quán ---------- */
  hits.sort((a, b) => b.force - a.force || (a.att < b.att ? -1 : a.att > b.att ? 1 : a.vic < b.vic ? -1 : 1));
  const credited = new Set<string>();
  for (const h of hits) {
    const o = P[h.vic];
    const att = P[h.att];
    o.b.vx += h.dx * h.force;
    o.b.vy += h.dy * h.force;
    if (o.b.z <= 0) o.b.vz = Math.max(o.b.vz, h.kind === 'heavy' ? 3 : 2);
    o.stunUntil = Math.max(o.stunUntil, now + h.stun);
    o.chargeIn = false;
    o.latched = true;
    if (o.heldBy) release(o.heldBy, 'free');
    if (o.holding) release(h.vic, 'drop');
    if (!credited.has(h.vic)) {
      credit(o, h.att, 'punch');
      credited.add(h.vic);
    }
    addWobble(o, h.wob);
    att.comboHit = true;
    fx('hit', h.att, { b: h.vic, kind: h.kind, idx: h.idx, counter: h.counter, force: r1(h.force), dx: r2(h.dx), dy: r2(h.dy) });
  }

  /* ---------- 1c. phân xử túm: ưu tiên người gần/ngắm đúng hơn; ngang nhau thì theo id; mỗi người chỉ vào MỘT cặp ---------- */
  grabReqs.sort((a, b) => a.d - b.d || (a.by < b.by ? -1 : a.by > b.by ? 1 : 0));
  const used = new Set<string>();
  for (const r of grabReqs) {
    const p = P[r.by];
    const o = P[r.to];
    if (used.has(r.by) || used.has(r.to)) continue;
    if (p.out || o.out || p.falling || o.falling || p.holding || o.heldBy || now < p.stunUntil) continue; // vừa bị đánh trúng thì hụt túm
    used.add(r.by);
    used.add(r.to);
    if (o.holding) release(r.to, 'drop');
    p.holding = r.to;
    p.lifted = false;
    p.face = p.aim;
    o.heldBy = r.by;
    o.struggle = 0;
    o.anchored = false;
    o.thrownUntil = 0;
    o.chargeIn = false;
    o.latched = true;
    credit(o, r.by, 'drag');
    fx('grab', r.by, { b: r.to });
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
    if (!h.falling && !h.lifted) constrain(cfg, v.b, t);
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
      constrain(cfg, A.b, t);
      constrain(cfg, B.b, t);
    }
  }
}
