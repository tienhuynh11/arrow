import type { GameContext, GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import {
  CHARGE_LEAD,
  CHARGE_MAX,
  CHARGE_SPEED_MUL,
  COMBO_FINISH_CD,
  COMBO_FORCE,
  COMBO_STUN,
  COMBO_WINDOW,
  COMBO_WOBBLE,
  COUNTER_DMG_MULT,
  COUNTER_EXTRA_STUN,
  COUNTER_EXTRA_WOBBLE,
  COUNTER_MULT,
  DMG_BOWL,
  DMG_BOWL_SELF,
  DMG_HEAVY_MAX,
  DMG_HEAVY_MIN,
  DMG_QUICK,
  DMG_THROW_LAND,
  DODGE_CD,
  DODGE_IFRAME,
  DODGE_MS,
  DODGE_SPEED,
  DODGE_WOBBLE,
  DOWN_MS,
  DOWN_WOBBLE_RESET,
  F_CHARGE,
  F_DODGE,
  F_DOWN,
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
  KILL_CREDIT_MS,
  KNOCK_WOBBLE_BOOST,
  LOB_V,
  MATCH_MS,
  PRESSURE_AT,
  PRESSURE_DPS0,
  PRESSURE_DPS1,
  QUICK_ARC,
  QUICK_CD,
  QUICK_LURCH,
  QUICK_RANGE,
  QUICK_WHIFF_CD,
  RT_CHARS,
  SB_ARMOR,
  SB_BLEED,
  SB_DASH,
  SB_HASTE,
  SB_PECK,
  SB_RAGE,
  SB_SHIELD,
  SB_SPIN,
  SK_ARMOR_DMG,
  SK_ARMOR_KNOCK,
  SK_ARMOR_MS,
  SK_BANANA,
  SK_BEAR_SLAM,
  SK_BULL_DASH,
  SK_BULL_ROAR,
  SK_FOX_BLINK,
  SK_HASTE_MS,
  SK_HASTE_SPEED,
  SK_MONKEY_LEAP,
  SK_RAGE_DMG,
  SK_RAGE_MS,
  SK_RAGE_SPEED,
  SK_ROOSTER_PECK,
  SK_ROOSTER_WING,
  SK_SHIELD_MS,
  SK_SHIELD_REFLECT,
  SK_TIGER_POUNCE,
  SK_TURTLE_SPIN,
  SPEED_FORCE_K,
  SPLASH_MULT,
  STRUGGLE_NEED,
  STRUGGLE_NEED_LIFT,
  THROW_V,
  THROW_VZ,
  THROW_VZ_LIFT,
  WALL_DMG_K,
  WALL_DMG_MAX,
  WALL_DMG_MIN_SPEED,
  WALL_M,
  WHIFF_STUN,
  WHIFF_VULN_MS,
  WHIFF_WALL_DMG,
  WHIFF_WOBBLE,
  WOBBLE_DECAY,
  WOBBLE_STEER_BONUS,
  constrain,
  newBody,
  stepBody,
  type RtBody,
  type RtChar,
  type RtConfig,
} from '../../../shared/rooftop.js';

/**
 * ĐẤU VẬT TRÊN NÓC NHÀ (kiểu Gang Beasts + đấu trường thú): mọi người đánh nhau trên nóc xe tải đang đậu.
 * Mỗi người được random một nhân vật thú (HP, tốc độ, khối lượng, 2 kỹ năng). Đòn đánh trừ máu; hết máu là KO.
 * Nóc xe bao kín bằng tường vô hình (không ai rơi). Sau ~70s "áp lực cuối trận" làm mọi người mất máu dần.
 * Server chốt tất cả: đấm nhanh/mạnh/combo, né, túm–nhấc–quăng, kỹ năng, sát thương, KO.
 */
const DURATION = MATCH_MS;
const TURN_RATE = 16; // rad/s: tốc độ quay thân tối đa
const TICK_BUDGET = 45; // gói input / giây tối đa

type CauseKind = string;
interface Cause {
  by: string;
  kind: CauseKind;
  at: number;
}

interface PState {
  b: RtBody;
  chr: RtChar;
  hp: number;
  maxHp: number;
  dmgDealt: number;
  face: number; // hướng thân
  aim: number; // hướng đánh do client tính (thân / mục tiêu khoá)
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
  lifted: boolean;
  struggle: number;
  out: boolean;
  outAt: number;
  kills: number;
  lastDmg: Cause | null;
  thrownUntil: number;
  thrownBy: string;
  thrownHit: Set<string>;
  tokens: number;
  tokAt: number;
  /* kỹ năng */
  sk1At: number;
  sk2At: number;
  skCd: [number, number];
  armorUntil: number;
  shieldUntil: number;
  hasteUntil: number;
  rageUntil: number;
  autoDodge: number;
  spinUntil: number;
  spinNext: number;
  dashUntil: number;
  dashKind: string;
  dashDx: number;
  dashDy: number;
  leapUntil: number;
  leapStart: number;
  peckLeft: number;
  peckNext: number;
  bleedUntil: number;
  bleedBy: string;
}

interface Banana {
  id: number;
  x: number;
  y: number;
  owner: string;
  born: number;
}

interface State {
  players: Record<string, PState>;
  bananas: Banana[];
  nextBanana: number;
  lastTick: number;
  endAt: number;
  alive: number;
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
const shuffle = <T,>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const rooftopBrawlGame: GameDefinition<RtConfig, State> = {
  id: 'rooftop',
  name: 'ĐẤU VẬT TRÊN NÓC NHÀ',
  instructions:
    'Mỗi người được random một nhân vật thú với thanh máu và 2 kỹ năng riêng, cùng đấm, túm, nhấc và quăng nhau trên nóc xe tải đang đậu. Hết máu là bị KO, sau một lúc áp lực cuối trận làm mọi người mất máu dần. Người cuối cùng còn sống thắng!',
  controls: [
    { keys: ['←', '↑', '→', '↓'], desc: 'Đi theo hướng camera · W A S D cũng được · SPACE nhảy' },
    { keys: ['CHUỘT'], desc: 'Bấm vào màn hình để khoá chuột, di chuột xoay camera quanh nhân vật · Esc nhả chuột' },
    { keys: ['CHUỘT GIỮA', 'TAB'], desc: 'Khoá / đổi mục tiêu: thân luôn nhìn mục tiêu, WASD đi vòng quanh nó (F cũng được)' },
    { keys: ['CLICK TRÁI'], desc: 'ĐẤM nhanh (nối 2–3 đòn = combo) · giữ rồi thả = ĐẤM MẠNH · đấm hụt là hở sườn!' },
    { keys: ['R', 'X'], desc: 'Kỹ năng 1 (hồi ngắn) · Kỹ năng 2 (chiêu cuối, hồi dài) của nhân vật thú — phím 1, 2 cũng được' },
    { keys: ['CTRL', 'Q'], desc: 'NÉ ngắn theo hướng đi (tránh được đấm, không tránh được túm)' },
    { keys: ['CLICK PHẢI', 'E'], desc: 'Giữ để TÚM người trước mặt · SPACE / SHIFT nhấc bổng · click trái hoặc thả nút = QUĂNG (gây sát thương)' },
  ],
  duration: DURATION + 1500,
  minPlayers: 2,
  maxPlayers: 16,

  createConfig(ctx) {
    const n = ctx.playerIds.length;
    const L = r1(clamp(15 + n * 1.0, 17, 30));
    const hw = r1(clamp(4.2 + n * 0.06, 4.4, 5.2));
    const ids = shuffle([...ctx.playerIds]);
    const spawns: RtConfig['spawns'] = {};
    ids.forEach((id, i) => {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.2;
      const x = Math.cos(a) * hw * 0.62;
      const y = Math.sin(a) * L * 0.34;
      spawns[id] = [r2(x), r2(y), r2(Math.atan2(-x, -y))];
    });
    // random nhân vật: không trùng khi số người ≤ số nhân vật
    const chars: RtConfig['chars'] = {};
    let pool: number[] = [];
    for (const id of ids) {
      if (!pool.length) pool = shuffle(RT_CHARS.map((_, i) => i));
      chars[id] = pool.pop()!;
    }
    return { L, hw, spawns, chars, endsAt: DURATION, pressureAt: PRESSURE_AT };
  },

  createState(ctx, config) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      const [x, y, yaw] = config.spawns[id];
      const chr = RT_CHARS[config.chars[id]];
      players[id] = {
        b: newBody(x, y),
        chr,
        hp: chr.hp,
        maxHp: chr.hp,
        dmgDealt: 0,
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
        out: false,
        outAt: 0,
        kills: 0,
        lastDmg: null,
        thrownUntil: 0,
        thrownBy: '',
        thrownHit: new Set(),
        tokens: TICK_BUDGET,
        tokAt: 0,
        sk1At: -1e9,
        sk2At: -1e9,
        skCd: [ctx.startAt + 2500, ctx.startAt + 6000], // mở màn: chưa dùng ngay được
        armorUntil: 0,
        shieldUntil: 0,
        hasteUntil: 0,
        rageUntil: 0,
        autoDodge: 0,
        spinUntil: 0,
        spinNext: 0,
        dashUntil: 0,
        dashKind: '',
        dashDx: 0,
        dashDy: 0,
        leapUntil: 0,
        leapStart: 0,
        peckLeft: 0,
        peckNext: 0,
        bleedUntil: 0,
        bleedBy: '',
      };
    }
    return { players, bananas: [], nextBanana: 1, lastTick: ctx.startAt, endAt: 0, alive: ctx.playerIds.length };
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
    if (input.skill1) p.sk1At = now;
    if (input.skill2) p.sk2At = now;
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
    if (!state.endAt && n >= 2 && state.alive <= 1) state.endAt = now + 2600;
    if (!state.endAt && n === 1 && state.alive === 0) state.endAt = now + 1500;

    /* ---------- gói vị trí ---------- */
    const pos: Record<string, number[]> = {};
    const hold: Record<string, string> = {};
    for (const id of ids) {
      const p = P[id];
      const b = p.b;
      let f = 0;
      if (b.z <= 0.001) f |= F_GROUND;
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
      if (now < p.punchAnim) f |= F_PUNCH;
      if (p.out) f |= F_OUT;
      if (now < p.thrownUntil) f |= F_THROWN;
      if (p.grab && !p.holding && !p.out) f |= F_REACH;
      if (now < p.whiffUntil) f |= F_WHIFF;
      if (now < p.dodgeUntil) f |= F_DODGE;
      if (p.chargeIn) f |= F_CHARGE;
      let sb = 0;
      if (now < p.armorUntil) sb |= SB_ARMOR;
      if (now < p.shieldUntil) sb |= SB_SHIELD;
      if (now < p.rageUntil) sb |= SB_RAGE;
      if (now < p.hasteUntil) sb |= SB_HASTE;
      if (now < p.spinUntil) sb |= SB_SPIN;
      if (now < p.bleedUntil) sb |= SB_BLEED;
      if (now < p.dashUntil) sb |= SB_DASH;
      if (p.peckLeft > 0) sb |= SB_PECK;
      pos[id] = [
        r2(b.x),
        r2(b.y),
        r2(b.z),
        r2(p.face),
        f,
        r1(b.vx),
        r1(b.vy),
        Math.round(p.wobble * 100) / 100,
        Math.max(0, Math.round(p.hp * 10) / 10),
        Math.round(p.grip),
        Math.max(0, Math.ceil((p.skCd[0] - now) / 100)),
        Math.max(0, Math.ceil((p.skCd[1] - now) / 100)),
        sb,
      ];
    }
    ctx.broadcast({ type: 'pos', t: Math.round(rel), pos, hold });
  },

  isFinished(ctx, state) {
    const now = ctx.now();
    if (state.endAt && now >= state.endAt) return true;
    return now - ctx.startAt >= DURATION;
  },

  calculateScore(ctx, state) {
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      const extra = `${p.chr.emoji} ${p.chr.name} · gây ${Math.round(p.dmgDealt)} sát thương${p.kills > 0 ? ` · hạ ${p.kills}` : ''}`;
      const bonus = p.kills * 8 + p.dmgDealt * 0.05;
      if (p.out) out[id] = { raw: Math.floor(p.outAt / 100) + bonus, detail: `KO sau ${Math.round(p.outAt / 1000)}s · ${extra}` };
      else out[id] = { raw: 100000 + p.hp + bonus, detail: `còn sống tới cuối (${Math.round(p.hp)} máu) · ${extra}` };
    }
    return out;
  },
};

/* ===================================================================== */

type HitKind = 'quick' | 'heavy' | 'skill';
interface Hit {
  att: string;
  vic: string;
  kind: HitKind;
  idx: number;
  force: number;
  stun: number;
  wob: number;
  dmg: number;
  dx: number;
  dy: number;
  counter: boolean;
  tag: string;
  bleed?: boolean;
  slam?: boolean;
}

function simulate(ctx: GameContext, state: State, cfg: RtConfig, dt: number, now: number, t: number) {
  const P = state.players;
  const ids = ctx.playerIds;
  const alive = ids.filter((id) => !P[id].out);

  const fx = (k: string, a: string, extra: Record<string, unknown> = {}) => {
    const p = P[a];
    ctx.broadcast({ type: 'fx', k, a, x: r1(p.b.x), y: r1(p.b.y), z: r1(p.b.z), ...extra });
  };
  const findId = (p: PState) => ids.find((i) => P[i] === p) ?? '';

  const addWobble = (p: PState, v: number) => {
    p.wobble += v;
    if (p.wobble >= 1 && now >= p.downUntil && !p.out) {
      p.downUntil = now + DOWN_MS;
      p.wobble = DOWN_WOBBLE_RESET;
      p.chargeIn = false;
      p.latched = true;
      p.peckLeft = 0;
      p.spinUntil = 0;
      p.dashUntil = 0;
      fx('down', findId(p));
      p.stunUntil = Math.max(p.stunUntil, p.downUntil);
      if (p.holding) release(findId(p), 'drop');
    }
  };

  /** KO: hết máu */
  function ko(id: string) {
    const v = P[id];
    if (v.out) return;
    v.out = true;
    v.hp = 0;
    v.outAt = Math.round(t);
    state.alive--;
    const c = v.lastDmg && v.lastDmg.by !== id && now - v.lastDmg.at < KILL_CREDIT_MS ? v.lastDmg : null;
    if (c) P[c.by].kills++;
    if (v.holding) release(id, 'drop');
    if (v.heldBy) release(v.heldBy, 'drop');
    v.chargeIn = false;
    ctx.broadcast({ type: 'ko', playerId: id, by: c ? c.by : '', how: v.lastDmg && now - v.lastDmg.at < KILL_CREDIT_MS ? v.lastDmg.kind : 'self', left: state.alive });
  }

  /**
   * trừ máu. dot = sát thương theo thời gian (không bị khiên/né tự động chặn).
   * Trả về lượng máu thực sự mất (0 nếu bị chặn).
   */
  function damage(vid: string, amount: number, att: string, kind: string, dot = false): number {
    const v = P[vid];
    if (v.out || amount <= 0) return 0;
    const by = att && att !== vid ? att : '';
    if (by && !dot) {
      if (now < v.shieldUntil) {
        // mai khiên: chặn hết và phản lại một phần
        if (!P[by].out) {
          const a = P[by];
          const rd = Math.hypot(a.b.x - v.b.x, a.b.y - v.b.y) || 1;
          a.b.vx += ((a.b.x - v.b.x) / rd) * 6;
          a.b.vy += ((a.b.y - v.b.y) / rd) * 6;
          a.stunUntil = Math.max(a.stunUntil, now + 350);
          fx('reflect', vid, { b: by });
          v.lastDmg = null;
          damage(by, amount * SK_SHIELD_REFLECT, vid, 'reflect', true);
        }
        return 0;
      }
      if (v.autoDodge > 0) {
        v.autoDodge--;
        fx('dodged', vid, { b: by });
        return 0;
      }
    }
    if (now < v.armorUntil) amount *= SK_ARMOR_DMG;
    v.hp -= amount;
    if (by) {
      v.lastDmg = { by, kind, at: now };
      P[by].dmgDealt += amount;
    }
    if (v.hp <= 0) ko(vid);
    return amount;
  }

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
      const sp = (mode === 'throw' ? THROW_V : LOB_V) / Math.sqrt(vid.chr.mass);
      vid.b.vx = Math.sin(h.aim) * sp + h.b.vx * 0.4;
      vid.b.vy = Math.cos(h.aim) * sp + h.b.vy * 0.4;
      vid.b.vz = wasLifted ? THROW_VZ_LIFT : THROW_VZ;
      if (vid.b.z < 0.2) vid.b.z = 0.2;
      vid.thrownUntil = now + 1700;
      vid.thrownBy = holderId;
      vid.thrownHit = new Set([holderId]);
      vid.stunUntil = Math.max(vid.stunUntil, now + 900);
      vid.lastDmg = { by: holderId, kind: 'throw', at: now };
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
    }
  }

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
      whiff: now < q.whiffUntil,
      dodgeI: now < q.dodgeIframe,
    };
  }
  const hits: Hit[] = [];
  const grabReqs: { by: string; to: string; d: number }[] = [];

  /** đòn kỹ năng lên một nạn nhân (hướng đẩy dx,dy) */
  const skillHit = (att: string, vic: string, spec: { dmg: number; force: number; stun: number; wob: number }, dx: number, dy: number, tag: string, extra: Partial<Hit> = {}) => {
    hits.push({ att, vic, kind: 'skill', idx: 0, force: spec.force, stun: spec.stun, wob: spec.wob, dmg: spec.dmg, dx, dy, counter: false, tag, ...extra });
  };
  /** vùng tròn (hoặc quạt nếu có arc) quanh người dùng */
  const aoe = (id: string, radius: number, spec: { dmg: number; force: number; stun: number; wob: number }, tag: string, arc = 0, extra: Partial<Hit> = {}) => {
    const me = P[id];
    const sx = me.b.x;
    const sy = me.b.y;
    let n = 0;
    for (const oid of alive) {
      if (oid === id || P[oid].out) continue;
      const o = S[oid];
      if (Math.abs(o.z - me.b.z) > 1.6) continue;
      const ox = o.x - sx;
      const oy = o.y - sy;
      const d = Math.hypot(ox, oy);
      if (d > radius) continue;
      if (arc > 0 && d > 0.3 && Math.abs(angDiff(me.aim, Math.atan2(ox, oy))) > arc) continue;
      let dx = d > 1e-3 ? ox / d : Math.sin(me.aim);
      let dy = d > 1e-3 ? oy / d : Math.cos(me.aim);
      if (arc > 0) {
        dx = dx * 0.4 + Math.sin(me.aim) * 0.6;
        dy = dy * 0.4 + Math.cos(me.aim) * 0.6;
        const l = Math.hypot(dx, dy) || 1;
        dx /= l;
        dy /= l;
      }
      skillHit(id, oid, spec, dx, dy, tag, extra);
      n++;
    }
    return n;
  };

  /** dùng kỹ năng which (1 hoặc 2) của nhân vật */
  const useSkill = (id: string, which: 1 | 2) => {
    const p = P[id];
    const b = p.b;
    const chr = p.chr;
    p.skCd[which - 1] = now + chr.skills[which - 1].cd;
    p.face = p.aim;
    p.chargeIn = false;
    p.latched = true;
    p.punchAnim = now + 380;
    const ax = Math.sin(p.aim);
    const ay = Math.cos(p.aim);
    fx('skill', id, { s: which, ch: chr.id });
    const key = chr.id + which;
    switch (key) {
      case 'bull1':
        p.dashUntil = now + SK_BULL_DASH.ms;
        p.dashKind = 'bull';
        p.dashDx = ax;
        p.dashDy = ay;
        break;
      case 'bull2':
        aoe(id, SK_BULL_ROAR.radius, SK_BULL_ROAR, 'roar');
        break;
      case 'bear1':
        aoe(id, SK_BEAR_SLAM.radius, SK_BEAR_SLAM, 'slam');
        break;
      case 'bear2':
        p.armorUntil = now + SK_ARMOR_MS;
        break;
      case 'fox1': {
        // dịch chuyển ra sau lưng đối thủ phía trước (hoặc mục tiêu khoá — hướng thân đã quay về mục tiêu)
        let best = '';
        let bd = 1e9;
        for (const oid of alive) {
          if (oid === id) continue;
          const o = S[oid];
          const ox = o.x - b.x;
          const oy = o.y - b.y;
          const d = Math.hypot(ox, oy);
          if (d > SK_FOX_BLINK.range || d < 0.3) continue;
          const ad = Math.abs(angDiff(p.aim, Math.atan2(ox, oy)));
          if (ad > SK_FOX_BLINK.arc) continue;
          const sc = d + ad * 3;
          if (sc < bd) {
            bd = sc;
            best = oid;
          }
        }
        fx('blink', id, { x2: r1(b.x), y2: r1(b.y) });
        if (best) {
          const o = S[best];
          const ox = o.x - b.x;
          const oy = o.y - b.y;
          const d = Math.hypot(ox, oy) || 1;
          b.x = o.x + (ox / d) * SK_FOX_BLINK.behind;
          b.y = o.y + (oy / d) * SK_FOX_BLINK.behind;
          p.aim = p.face = Math.atan2(-ox, -oy); // quay lại nhìn mục tiêu
          constrain(cfg, b);
          skillHit(id, best, SK_FOX_BLINK, ox / d, oy / d, 'blink');
        } else {
          b.x += ax * 4.5;
          b.y += ay * 4.5;
          constrain(cfg, b);
        }
        b.vx = b.vy = 0;
        fx('blinkEnd', id);
        break;
      }
      case 'fox2':
        p.hasteUntil = now + SK_HASTE_MS;
        p.autoDodge = 1;
        break;
      case 'turtle1':
        p.shieldUntil = now + SK_SHIELD_MS;
        break;
      case 'turtle2':
        p.spinUntil = now + SK_TURTLE_SPIN.ms;
        p.spinNext = now;
        break;
      case 'monkey1':
        b.vz = SK_MONKEY_LEAP.vz;
        b.vx = ax * SK_MONKEY_LEAP.v;
        b.vy = ay * SK_MONKEY_LEAP.v;
        p.leapUntil = now + 1700;
        p.leapStart = now;
        break;
      case 'monkey2': {
        const mine = state.bananas.filter((x) => x.owner === id);
        if (mine.length >= SK_BANANA.max) {
          const old = mine[0];
          state.bananas = state.bananas.filter((x) => x !== old);
          ctx.broadcast({ type: 'banana', op: 'gone', id: old.id });
        }
        const bn: Banana = { id: state.nextBanana++, x: clamp(b.x + ax * SK_BANANA.ahead, -(cfg.hw - WALL_M), cfg.hw - WALL_M), y: clamp(b.y + ay * SK_BANANA.ahead, -(cfg.L / 2 - WALL_M), cfg.L / 2 - WALL_M), owner: id, born: now };
        state.bananas.push(bn);
        ctx.broadcast({ type: 'banana', op: 'add', id: bn.id, x: r1(bn.x), y: r1(bn.y) });
        break;
      }
      case 'tiger1':
        p.dashUntil = now + SK_TIGER_POUNCE.ms;
        p.dashKind = 'tiger';
        p.dashDx = ax;
        p.dashDy = ay;
        break;
      case 'tiger2':
        p.rageUntil = now + SK_RAGE_MS;
        break;
      case 'rooster1':
        p.peckLeft = SK_ROOSTER_PECK.count;
        p.peckNext = now;
        break;
      case 'rooster2':
        aoe(id, SK_ROOSTER_WING.range, SK_ROOSTER_WING, 'wing', SK_ROOSTER_WING.arc);
        break;
    }
  };

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

    /* tin nhắn ý định */
    const wantJump = now - p.jumpAt < 200;
    let wantPunch = now - p.punchAt < 220;
    const wantDodge = now - p.dodgeAt < 200;
    let wantSk1 = now - p.sk1At < 220;
    let wantSk2 = now - p.sk2At < 220;
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
      wantSk1 = wantSk2 = false;
    }

    /* bị túm: vùng vẫy */
    if (p.heldBy) {
      const holder = P[p.heldBy];
      if (!holder || holder.out) {
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
    if (p.holding) p.grip -= dt * (p.lifted ? 17 : 9);
    else p.grip = Math.min(100, p.grip + dt * 16);
    if (p.grip <= 0) {
      p.grip = 0;
      p.gripTired = true;
      if (p.holding) {
        fx('tired', id);
        release(id, 'drop');
      }
    }
    if (p.gripTired && p.grip >= 30) p.gripTired = false;

    /* nhả nút túm */
    if (!p.grab && p.holding) release(id, p.lifted ? 'lob' : 'drop');

    const dashing = now < p.dashUntil;
    const rageMul = now < p.rageUntil ? SK_RAGE_DMG : 1;

    /* kỹ năng đang chạy: lao, xoáy, mổ liên hoàn */
    if (dashing) {
      const spec = p.dashKind === 'bull' ? SK_BULL_DASH : SK_TIGER_POUNCE;
      b.vx = p.dashDx * spec.speed;
      b.vy = p.dashDy * spec.speed;
      for (const oid of alive) {
        if (oid === id) continue;
        const o = S[oid];
        if (Math.abs(o.z - sn.z) > 1.4) continue;
        const d = Math.hypot(o.x - sn.x, o.y - sn.y);
        if (d > 1.05) continue;
        skillHit(id, oid, spec, p.dashDx, p.dashDy, p.dashKind === 'bull' ? 'charge' : 'pounce', { bleed: p.dashKind === 'tiger' });
        p.dashUntil = now; // chạm người là dừng
        break;
      }
    }
    if (now < p.spinUntil && now >= p.spinNext) {
      p.spinNext = now + SK_TURTLE_SPIN.every;
      aoe(id, SK_TURTLE_SPIN.radius, SK_TURTLE_SPIN, 'spin');
      fx('spinpulse', id);
    }
    if (p.peckLeft > 0 && now >= p.peckNext && !stunned) {
      p.peckNext = now + SK_ROOSTER_PECK.every;
      p.peckLeft--;
      p.face = p.aim;
      aoe(id, SK_ROOSTER_PECK.range, SK_ROOSTER_PECK, 'peck', SK_ROOSTER_PECK.arc);
      fx('peck', id);
    } else if (stunned && p.peckLeft > 0) p.peckLeft = 0;

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
      } else if (wantDodge && now >= p.dodgeCd && !dodging && !dashing) {
        // né ngắn: theo hướng đang đi, đứng yên thì lùi lại; chỉ tránh được ĐẤM, không tránh được túm
        const mm = Math.hypot(p.mx, p.my);
        const dx = mm > 0.2 ? p.mx / mm : -Math.sin(p.face);
        const dy = mm > 0.2 ? p.my / mm : -Math.cos(p.face);
        p.dodgeAt = -1e9;
        p.dodgeCd = now + DODGE_CD;
        p.dodgeUntil = now + DODGE_MS;
        p.dodgeIframe = now + DODGE_IFRAME;
        p.chargeIn = false;
        p.latched = true;
        b.vx = dx * DODGE_SPEED;
        b.vy = dy * DODGE_SPEED;
        addWobble(p, DODGE_WOBBLE);
        fx('dodge', id);
      } else if ((wantSk1 || wantSk2) && !stunned && !dodging && !dashing) {
        if (wantSk1 && now >= p.skCd[0]) {
          p.sk1At = -1e9;
          useSkill(id, 1);
        } else if (wantSk2 && now >= p.skCd[1]) {
          p.sk2At = -1e9;
          useSkill(id, 2);
        }
      } else if (!stunned && !dodging && !dashing && now >= p.punchCd && (wantPunch || rel >= 0)) {
        const heavy = rel >= HEAVY_MIN && !wantPunch;
        p.punchAt = -1e9;
        p.face = p.aim;
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
          if (Math.abs(o.z - sn.z) > 1.4) continue;
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
          force *= o.holding ? HOLDING_KNOCK_MUL : 1;
          let stun = heavy ? HEAVY_STUN : COMBO_STUN[idx];
          let wob = heavy ? HEAVY_WOBBLE : COMBO_WOBBLE[idx];
          let dmg = (heavy ? DMG_HEAVY_MIN + (DMG_HEAVY_MAX - DMG_HEAVY_MIN) * frac : DMG_QUICK[idx]) * rageMul;
          const counter = o.whiff;
          if (counter) {
            force *= COUNTER_MULT;
            stun += COUNTER_EXTRA_STUN;
            wob += COUNTER_EXTRA_WOBBLE;
            dmg *= COUNTER_DMG_MULT;
          }
          hits.push({ att: id, vic: oid, kind: heavy ? 'heavy' : 'quick', idx, force, stun, wob, dmg, dx: kx, dy: ky, counter, tag: heavy ? 'heavy' : idx === 2 ? 'combo' : 'punch' });
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
          // đấm hụt vào tường: tự đập
          const wx = b.x + ax * 1.0;
          const wy = b.y + ay * 1.0;
          if (Math.abs(wx) > cfg.hw - WALL_M || Math.abs(wy) > cfg.L / 2 - WALL_M) {
            damage(id, WHIFF_WALL_DMG, '', 'wallpunch', true);
            fx('wallpunch', id);
          }
        } else {
          p.punchCd = now + (heavy ? HEAVY_CD : idx === 2 ? COMBO_FINISH_CD : QUICK_CD);
        }
      } else if (p.grab && !p.holding && !stunned && now >= p.grabCd && !p.gripTired && !dodging && !dashing) {
        // tìm người để túm (dựa trên ảnh chụp); yêu cầu được phân xử sau vòng lặp để không phụ thuộc thứ tự
        let best = '';
        let bestD = GRAB_RANGE;
        let bestScore = 1e9;
        for (const oid of alive) {
          if (oid === id) continue;
          const o = S[oid];
          if (o.heldBy || Math.abs(o.z - sn.z) > 1.1) continue;
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
      }
    }

    /* vật lý */
    const hold = !!p.holding;
    const m = Math.hypot(p.mx, p.my);
    const control = free;
    const buff = p.chr.speed * (now < p.hasteUntil ? SK_HASTE_SPEED : 1) * (now < p.rageUntil ? SK_RAGE_SPEED : 1) * (now < p.spinUntil ? SK_TURTLE_SPIN.speedMul : 1) * (p.peckLeft > 0 ? 0.5 : 1);
    const jumped = stepBody(cfg, b, control ? p.mx : 0, control ? p.my : 0, dt, {
      speedMul: buff * (hold ? (p.lifted ? 0.5 : 0.62) : p.chargeIn ? CHARGE_SPEED_MUL : stunned ? 0.55 : 1),
      accelMul: stunned ? 0.5 : 1,
      noControl: !control || now < p.dodgeUntil || now < p.dashUntil,
      jump: control && wantJump && !hold && !stunned && !p.chargeIn && now >= p.dodgeUntil && now >= p.dashUntil,
    });
    if (jumped) p.jumpAt = -1e9;
    if (!control && downed) p.mx = p.my = 0;

    /* hướng thân: quay mượt, giới hạn tốc độ quay */
    if (control && !stunned) p.face += clamp(angDiff(p.face, p.aim), -TURN_RATE * dt, TURN_RATE * dt);
    else if (hold || now < p.punchAnim) p.face = p.aim;
    else if (control && m > 0.15) p.face += angDiff(p.face, Math.atan2(p.mx, p.my)) * Math.min(1, dt * 12);

    /* va tường mạnh: mất máu (có công người đẩy gần nhất) */
    if ((b.wall ?? 0) > WALL_DMG_MIN_SPEED) {
      const d = Math.min(WALL_DMG_MAX, 2 + (b.wall! - WALL_DMG_MIN_SPEED) * WALL_DMG_K);
      damage(id, d, p.lastDmg && now - p.lastDmg.at < KILL_CREDIT_MS ? p.lastDmg.by : '', 'wall', true);
      addWobble(p, 0.15);
      fx('wall', id, { dmg: r1(d) });
    }
    b.wall = 0;
    if (p.out) continue;

    /* khỉ nhảy đá: chạm đất là giáng xuống */
    if (p.leapUntil > 0) {
      if (now >= p.leapUntil) p.leapUntil = 0;
      else if (now > p.leapStart + 200 && b.z <= 0.001 && b.vz <= 0) {
        p.leapUntil = 0;
        aoe(id, SK_MONKEY_LEAP.radius, SK_MONKEY_LEAP, 'kick');
        fx('stomp', id);
      }
    }

    /* người bay hạ cầm đất */
    if (thrown && b.z <= 0 && b.vz <= 0) {
      p.thrownUntil = 0;
      p.stunUntil = Math.max(p.stunUntil, now + 650);
      addWobble(p, 0.5);
      fx('land', id);
      damage(id, DMG_THROW_LAND, p.thrownBy, 'throw');
    }
  }

  /* ---------- sát thương theo thời gian: chảy máu + áp lực cuối trận ---------- */
  const pressure = t >= PRESSURE_AT ? PRESSURE_DPS0 + (PRESSURE_DPS1 - PRESSURE_DPS0) * clamp((t - PRESSURE_AT) / (DURATION - PRESSURE_AT - 15000), 0, 1) : 0;
  for (const id of alive) {
    const p = P[id];
    if (p.out) continue;
    if (now < p.bleedUntil) damage(id, SK_TIGER_POUNCE.bleedDps * dt, p.bleedBy, 'bleed', true);
    if (pressure > 0 && !p.out) damage(id, pressure * dt, '', 'pressure', true);
  }

  /* ---------- vỏ chuối ---------- */
  if (state.bananas.length) {
    for (const bn of [...state.bananas]) {
      if (now - bn.born > SK_BANANA.life) {
        state.bananas = state.bananas.filter((x) => x !== bn);
        ctx.broadcast({ type: 'banana', op: 'gone', id: bn.id });
        continue;
      }
      for (const id of ids) {
        const p = P[id];
        if (p.out || p.b.z > 0.3 || now < p.downUntil || p.heldBy) continue;
        if (id === bn.owner && now - bn.born < SK_BANANA.immuneMs) continue;
        if (Math.hypot(p.b.x - bn.x, p.b.y - bn.y) > SK_BANANA.radius) continue;
        state.bananas = state.bananas.filter((x) => x !== bn);
        ctx.broadcast({ type: 'banana', op: 'gone', id: bn.id, hit: id });
        p.b.vx += Math.sin(p.face) * SK_BANANA.slide;
        p.b.vy += Math.cos(p.face) * SK_BANANA.slide;
        p.lastDmg = { by: bn.owner, kind: 'banana', at: now };
        damage(id, SK_BANANA.dmg, bn.owner === id ? '' : bn.owner, 'banana', true);
        addWobble(p, SK_BANANA.wob);
        fx('slip', id);
        break;
      }
    }
  }

  /* ---------- 1b. áp dụng đòn đánh: sắp xếp cố định (lực lớn trước, rồi theo id) nên kết quả đồng thời nhất quán ---------- */
  hits.sort((a, b) => b.force - a.force || (a.att < b.att ? -1 : a.att > b.att ? 1 : a.vic < b.vic ? -1 : 1));
  for (const h of hits) {
    const o = P[h.vic];
    const att = P[h.att];
    if (o.out || att.out) continue;
    // túm nhầm: người thứ ba đánh trúng một người đang dính nhau thì đòn lan sang cả người còn lại
    const partner = o.heldBy || o.holding;
    if (partner && partner !== h.att && !P[partner].out) {
      damage(partner, h.dmg * SPLASH_MULT, h.att, h.tag, false);
      addWobble(P[partner], 0.3);
      fx('wrong', h.vic, { b: partner, c: h.att });
    }
    // chặn bởi khiên / tự né: không hất, không choáng
    const dmgDone = damage(h.vic, h.dmg * (h.kind === 'skill' ? (now < att.rageUntil ? SK_RAGE_DMG : 1) : 1), h.att, h.tag);
    if (dmgDone <= 0 && !o.out) continue;
    const knock = (h.force / o.chr.mass) * (now < o.armorUntil ? SK_ARMOR_KNOCK : 1);
    o.b.vx += h.dx * knock;
    o.b.vy += h.dy * knock;
    if (o.b.z <= 0) o.b.vz = Math.max(o.b.vz, h.kind === 'heavy' || h.force > 7 ? 3 : 2);
    o.stunUntil = Math.max(o.stunUntil, now + h.stun);
    o.chargeIn = false;
    o.latched = true;
    o.peckLeft = 0;
    if (o.heldBy) release(o.heldBy, 'free');
    if (o.holding) release(h.vic, 'drop');
    addWobble(o, h.wob / (o.chr.mass > 1.2 ? 1.15 : 1));
    if (h.bleed) {
      o.bleedUntil = now + SK_TIGER_POUNCE.bleedMs;
      o.bleedBy = h.att;
    }
    att.comboHit = true;
    fx('hit', h.att, { b: h.vic, kind: h.kind, tag: h.tag, idx: h.idx, counter: h.counter, force: r1(h.force), dmg: r1(dmgDone), dx: r2(h.dx), dy: r2(h.dy) });
  }

  /* ---------- 1c. phân xử túm: ưu tiên người gần/ngắm đúng hơn; ngang nhau thì theo id; mỗi người chỉ vào MỘT cặp ---------- */
  grabReqs.sort((a, b) => a.d - b.d || (a.by < b.by ? -1 : a.by > b.by ? 1 : 0));
  const used = new Set<string>();
  for (const r of grabReqs) {
    const p = P[r.by];
    const o = P[r.to];
    if (used.has(r.by) || used.has(r.to)) continue;
    if (p.out || o.out || p.holding || o.heldBy || now < p.stunUntil) continue; // vừa bị đánh trúng thì hụt túm
    used.add(r.by);
    used.add(r.to);
    if (o.holding) release(r.to, 'drop');
    p.holding = r.to;
    p.lifted = false;
    p.face = p.aim;
    o.heldBy = r.by;
    o.struggle = 0;
    o.thrownUntil = 0;
    o.chargeIn = false;
    o.latched = true;
    fx('grab', r.by, { b: r.to });
  }

  /* ---------- 2. người bị túm đi theo người túm ---------- */
  for (const id of alive) {
    const h = P[id];
    if (!h.holding || h.out) continue;
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
    constrain(cfg, v.b);
    v.b.wall = 0;
    if (!v.lastDmg || v.lastDmg.kind !== 'drag') v.lastDmg = { by: id, kind: 'drag', at: now };
    else v.lastDmg.at = now;
  }

  /* ---------- 3. va chạm giữa người với nhau + người bị quăng ---------- */
  for (let i = 0; i < alive.length; i++) {
    const A = P[alive[i]];
    if (A.out) continue;
    for (let j = i + 1; j < alive.length; j++) {
      const B = P[alive[j]];
      if (B.out) continue;
      if (A.heldBy || B.heldBy) continue;
      if (Math.abs(A.b.z - B.b.z) > 1.3) continue;
      const dx = B.b.x - A.b.x;
      const dy = B.b.y - A.b.y;
      const d = Math.hypot(dx, dy);
      if (d >= 0.85) continue;
      const nx = d > 1e-3 ? dx / d : 1;
      const ny = d > 1e-3 ? dy / d : 0;
      // người bị quăng đâm trúng: va chạm dây chuyền, cả hai cùng đau
      for (const [Sx, V, sid, vid] of [
        [A, B, alive[i], alive[j]],
        [B, A, alive[j], alive[i]],
      ] as const) {
        if (now < Sx.thrownUntil && !Sx.thrownHit.has(vid) && Math.hypot(Sx.b.vx, Sx.b.vy) > 3.5) {
          Sx.thrownHit.add(vid);
          V.b.vx += (Sx.b.vx * 0.8) / V.chr.mass;
          V.b.vy += (Sx.b.vy * 0.8) / V.chr.mass;
          V.b.vz = Math.max(V.b.vz, 2.5);
          V.stunUntil = Math.max(V.stunUntil, now + 800);
          Sx.b.vx *= 0.45;
          Sx.b.vy *= 0.45;
          if (V.holding) release(vid, 'drop');
          const thrower = Sx.thrownBy || sid;
          damage(vid, DMG_BOWL, thrower, 'bowl');
          damage(sid, DMG_BOWL_SELF, thrower, 'throw');
          addWobble(V, 0.75);
          fx('bowl', sid, { b: vid, c: thrower });
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
      A.b.wall = 0;
      B.b.wall = 0;
    }
  }
}
