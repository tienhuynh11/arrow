import type { GameContext, GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import {
  CAST_MOVE_MUL,
  COMBO_FINISH_CD,
  COMBO_FORCE,
  COMBO_STUN,
  COMBO_WINDOW,
  COMBO_WOBBLE,
  COUNTER_DMG_MULT,
  COUNTER_EXTRA_STUN,
  COUNTER_EXTRA_WOBBLE,
  COUNTER_MULT,
  DASH_STEER_MS,
  DASH_STEER_RATE,
  DMG_QUICK,
  DOWN_MS,
  DOWN_WOBBLE_RESET,
  F_CAST,
  F_DOWN,
  F_GROUND,
  F_OUT,
  F_PUNCH,
  F_STUN,
  F_WHIFF,
  GETUP_REDUCE,
  INPUT_BUFFER_MS,
  KILL_CREDIT_MS,
  KNOCK_WOBBLE_BOOST,
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
  SKILL_CANCEL_MS,
  SKILL_LINK_BONUS,
  SKILL_LINK_MS,
  SPEED_FORCE_K,
  WALL_DMG_K,
  WALL_DMG_MAX,
  WALL_DMG_MIN_SPEED,
  WALL_M,
  WHIFF_STUN,
  WHIFF_VULN_MS,
  WHIFF_WALL_DMG,
  WHIFF_WOBBLE,
  WOBBLE_DECAY,
  constrain,
  newBody,
  stepBody,
  type RtBody,
  type RtChar,
  type RtConfig,
} from '../../../shared/rooftop.js';

/**
 * ĐẤU VẬT TRÊN NÓC NHÀ (kiểu đấu trường thú): mỗi người random một nhân vật thú (HP, tốc độ, khối lượng, 2 kỹ năng).
 * Chỉ có ĐÁNH THƯỜNG (combo 3 đòn) + 2 KỸ NĂNG. Hết máu là KO; nóc xe bao kín bằng tường vô hình; sau ~70s
 * "áp lực cuối trận" làm mọi người mất máu dần. Server chốt tất cả: đòn, kỹ năng, hồi chiêu, sát thương, KO.
 * Skill linh hoạt: vừa chạy vừa tung, buffer input, huỷ/nối giữa đánh thường ↔ skill, lái hướng lúc lao.
 */
const DURATION = MATCH_MS;
const TURN_RATE = 16; // rad/s: tốc độ quay thân tối đa
const TICK_BUDGET = 45; // gói input / giây tối đa

interface Cause {
  by: string;
  kind: string;
  at: number;
}

interface PState {
  b: RtBody;
  chr: RtChar;
  hp: number;
  maxHp: number;
  dmgDealt: number;
  face: number;
  aim: number;
  mx: number;
  my: number;
  inAt: number;
  jumpAt: number;
  punchAt: number;
  punchCd: number;
  combo: number;
  lastQuickAt: number;
  comboHit: boolean;
  wasDown: boolean;
  punchAnim: number;
  whiffUntil: number;
  stunUntil: number;
  downUntil: number;
  wobble: number;
  out: boolean;
  outAt: number;
  kills: number;
  lastDmg: Cause | null;
  tokens: number;
  tokAt: number;
  /* kỹ năng */
  sk1At: number;
  sk2At: number;
  skCd: [number, number];
  linkUntil: number;
  castKey: string;
  castAt: number;
  armorUntil: number;
  shieldUntil: number;
  hasteUntil: number;
  rageUntil: number;
  autoDodge: number;
  spinUntil: number;
  spinNext: number;
  dashUntil: number;
  dashStart: number;
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
    'Mỗi người được random một nhân vật thú với thanh máu và 2 kỹ năng riêng, cùng đánh nhau trên nóc xe tải đang đậu. Đánh thường nối combo 3 đòn, xen kẽ hai kỹ năng để hạ đối thủ về 0 máu, sau một lúc áp lực cuối trận làm mọi người mất máu dần. Người cuối cùng còn sống thắng!',
  controls: [
    { keys: ['W', 'A', 'S', 'D'], desc: 'Di chuyển theo hướng camera · SPACE nhảy' },
    { keys: ['CHUỘT'], desc: 'Bấm vào màn hình để khoá chuột, di chuột xoay camera quanh nhân vật' },
    { keys: ['CLICK TRÁI'], desc: 'ĐÁNH thường: bấm liên tiếp nối combo 3 đòn (đòn kết đẩy + làm ngã), hụt là hở sườn' },
    { keys: ['R', 'X'], desc: 'Kỹ năng 1 (hồi ngắn) · Kỹ năng 2 (chiêu cuối, hồi dài) — phím 1, 2 cũng được; tung được khi đang chạy, nối với đòn thường' },
    { keys: ['CHUỘT GIỮA', 'TAB'], desc: 'Khoá / đổi mục tiêu: thân luôn nhìn mục tiêu, WASD đi vòng quanh nó' },
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
        jumpAt: -1e9,
        punchAt: -1e9,
        punchCd: 0,
        combo: 0,
        lastQuickAt: -1e9,
        comboHit: false,
        wasDown: false,
        punchAnim: 0,
        whiffUntil: 0,
        stunUntil: 0,
        downUntil: 0,
        wobble: 0,
        out: false,
        outAt: 0,
        kills: 0,
        lastDmg: null,
        tokens: TICK_BUDGET,
        tokAt: 0,
        sk1At: -1e9,
        sk2At: -1e9,
        skCd: [ctx.startAt + 2500, ctx.startAt + 6000], // mở màn: chưa dùng ngay được
        linkUntil: 0,
        castKey: '',
        castAt: 0,
        armorUntil: 0,
        shieldUntil: 0,
        hasteUntil: 0,
        rageUntil: 0,
        autoDodge: 0,
        spinUntil: 0,
        spinNext: 0,
        dashUntil: 0,
        dashStart: 0,
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
    p.inAt = now;
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

    /* ---------- gói vị trí: [x,y,z,face,cờ,vx,vy,wobble,hp,cd1,cd2,trạng thái kỹ năng] ---------- */
    const pos: Record<string, number[]> = {};
    for (const id of ids) {
      const p = P[id];
      const b = p.b;
      let f = 0;
      if (b.z <= 0.001) f |= F_GROUND;
      if (now < p.stunUntil) f |= F_STUN;
      if (now < p.downUntil) f |= F_DOWN;
      if (now < p.punchAnim) f |= F_PUNCH;
      if (p.out) f |= F_OUT;
      if (now < p.whiffUntil) f |= F_WHIFF;
      if (p.castKey) f |= F_CAST;
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
        Math.max(0, Math.ceil((p.skCd[0] - now) / 100)),
        Math.max(0, Math.ceil((p.skCd[1] - now) / 100)),
        sb,
      ];
    }
    ctx.broadcast({ type: 'pos', t: Math.round(rel), pos });
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

interface Hit {
  att: string;
  vic: string;
  kind: 'quick' | 'skill';
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
}

type Spec = { dmg: number; force: number; stun: number; wob: number };

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
      p.peckLeft = 0;
      p.spinUntil = 0;
      p.dashUntil = 0;
      p.castKey = '';
      fx('down', findId(p));
      p.stunUntil = Math.max(p.stunUntil, p.downUntil);
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
    ctx.broadcast({ type: 'ko', playerId: id, by: c ? c.by : '', how: v.lastDmg && now - v.lastDmg.at < KILL_CREDIT_MS ? v.lastDmg.kind : 'self', left: state.alive, x: r1(v.b.x), y: r1(v.b.y) });
  }

  /** trừ máu. dot = sát thương theo thời gian (không bị khiên/né tự động chặn). Trả về lượng máu thực sự mất. */
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

  /* ---------- 0. ảnh chụp trạng thái đầu bước: mọi quyết định dựa vào ảnh chụp này nên KHÔNG phụ thuộc thứ tự vòng lặp ---------- */
  interface Snap {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    wobble: number;
    whiff: boolean;
  }
  const S: Record<string, Snap> = {};
  for (const id of alive) {
    const q = P[id];
    S[id] = { x: q.b.x, y: q.b.y, z: q.b.z, vx: q.b.vx, vy: q.b.vy, wobble: q.wobble, whiff: now < q.whiffUntil };
  }
  const hits: Hit[] = [];

  const skillHit = (att: string, vic: string, spec: Spec, dx: number, dy: number, tag: string, extra: Partial<Hit> = {}) => {
    hits.push({ att, vic, kind: 'skill', idx: 0, force: spec.force, stun: spec.stun, wob: spec.wob, dmg: spec.dmg, dx, dy, counter: false, tag, ...extra });
  };
  /** vùng tròn (hoặc quạt nếu có arc) quanh người dùng */
  const aoe = (id: string, radius: number, spec: Spec, tag: string, arc = 0, extra: Partial<Hit> = {}) => {
    const me = P[id];
    for (const oid of alive) {
      if (oid === id || P[oid].out) continue;
      const o = S[oid];
      if (Math.abs(o.z - me.b.z) > 1.6) continue;
      const ox = o.x - me.b.x;
      const oy = o.y - me.b.y;
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
    }
  };

  /** nổ chiêu có niệm (sau chỉ báo trên sàn) */
  const execCast = (id: string, key: string) => {
    const p = P[id];
    p.face = p.aim;
    fx('skillgo', id, { ch: p.chr.id, s: Number(key.slice(-1)), yaw: r2(p.aim) });
    if (key === 'bull2') aoe(id, SK_BULL_ROAR.radius, SK_BULL_ROAR, 'roar');
    else if (key === 'bear1') aoe(id, SK_BEAR_SLAM.radius, SK_BEAR_SLAM, 'slam');
    else if (key === 'rooster2') aoe(id, SK_ROOSTER_WING.range, SK_ROOSTER_WING, 'wing', SK_ROOSTER_WING.arc);
  };

  /** dùng kỹ năng which (1 hoặc 2): vừa chạy vừa tung, không khoá di chuyển */
  const useSkill = (id: string, which: 1 | 2) => {
    const p = P[id];
    const b = p.b;
    const chr = p.chr;
    p.skCd[which - 1] = now + chr.skills[which - 1].cd;
    p.face = p.aim;
    p.punchAnim = now + 300;
    p.linkUntil = now + SKILL_LINK_MS;
    const ax = Math.sin(p.aim);
    const ay = Math.cos(p.aim);
    const key = chr.id + which;
    const delay = key === 'bull2' ? SK_BULL_ROAR.delay : key === 'bear1' ? SK_BEAR_SLAM.delay : key === 'rooster2' ? SK_ROOSTER_WING.delay : 0;
    const dur =
      key === 'bull1' ? SK_BULL_DASH.ms : key === 'tiger1' ? SK_TIGER_POUNCE.ms : key === 'bear2' ? SK_ARMOR_MS : key === 'turtle1' ? SK_SHIELD_MS : key === 'turtle2' ? SK_TURTLE_SPIN.ms : key === 'fox2' ? SK_HASTE_MS : key === 'tiger2' ? SK_RAGE_MS : 0;
    fx('skill', id, { s: which, ch: chr.id, yaw: r2(p.aim), delay, dur });
    if (delay > 0) {
      p.castKey = key;
      p.castAt = now + delay;
      return;
    }
    switch (key) {
      case 'bull1':
        p.dashUntil = now + SK_BULL_DASH.ms;
        p.dashStart = now;
        p.dashKind = 'bull';
        p.dashDx = ax;
        p.dashDy = ay;
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
        fx('blink', id, {});
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
        b.vx *= 0.3;
        b.vy *= 0.3;
        fx('blinkEnd', id, { yaw: r2(p.aim) });
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
        ctx.broadcast({ type: 'banana', op: 'add', id: bn.id, x: r1(bn.x), y: r1(bn.y), fx: r1(b.x), fy: r1(b.y) });
        break;
      }
      case 'tiger1':
        p.dashUntil = now + SK_TIGER_POUNCE.ms;
        p.dashStart = now;
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
    }
  };

  /* ---------- 1. từng người: input, hành động, vật lý ---------- */
  for (const id of alive) {
    const p = P[id];
    const b = p.b;
    const sn = S[id];
    if (now - p.inAt > 700) {
      p.mx = p.my = 0;
    }
    p.wobble = Math.max(0, p.wobble - dt * WOBBLE_DECAY);
    const downed = now < p.downUntil;
    const stunned = now < p.stunUntil;
    if (p.wasDown && now >= p.downUntil) {
      p.wasDown = false;
      fx('getup', id);
    }
    if (downed) p.wasDown = true;

    /* tin nhắn ý định (buffer: bấm hơi sớm vẫn ra đòn) */
    const wantJump = now - p.jumpAt < INPUT_BUFFER_MS;
    let wantPunch = now - p.punchAt < INPUT_BUFFER_MS;
    let wantSk1 = now - p.sk1At < INPUT_BUFFER_MS;
    let wantSk2 = now - p.sk2At < INPUT_BUFFER_MS;
    const free = !downed;
    if (downed) {
      // nằm ngã: bấm Space để đứng dậy nhanh hơn
      if (wantJump) {
        p.downUntil = Math.max(now + 250, p.downUntil - GETUP_REDUCE);
        p.jumpAt = -1e9;
      }
      wantPunch = wantSk1 = wantSk2 = false;
    }

    let dashing = now < p.dashUntil;
    const rageMul = now < p.rageUntil ? SK_RAGE_DMG : 1;

    /* chiêu niệm: bị choáng thì gián đoạn, hết niệm thì nổ */
    if (p.castKey) {
      if (stunned || downed) p.castKey = '';
      else if (now >= p.castAt) {
        const key = p.castKey;
        p.castKey = '';
        execCast(id, key);
      }
    }

    /* lao: bẻ hướng được trong cửa sổ ngắn theo hướng chạy / mục tiêu khoá (hướng ngắm) */
    if (dashing) {
      const spec = p.dashKind === 'bull' ? SK_BULL_DASH : SK_TIGER_POUNCE;
      if (now - p.dashStart < DASH_STEER_MS) {
        const mm = Math.hypot(p.mx, p.my);
        const cur = Math.atan2(p.dashDx, p.dashDy);
        const want = mm > 0.3 ? Math.atan2(p.mx, p.my) : p.aim;
        const na = cur + clamp(angDiff(cur, want), -DASH_STEER_RATE * dt, DASH_STEER_RATE * dt);
        p.dashDx = Math.sin(na);
        p.dashDy = Math.cos(na);
        p.aim = p.face = na;
      }
      b.vx = p.dashDx * spec.speed;
      b.vy = p.dashDy * spec.speed;
      for (const oid of alive) {
        if (oid === id) continue;
        const o = S[oid];
        if (Math.abs(o.z - sn.z) > 1.4) continue;
        if (Math.hypot(o.x - sn.x, o.y - sn.y) > 1.05) continue;
        skillHit(id, oid, spec, p.dashDx, p.dashDy, p.dashKind === 'bull' ? 'charge' : 'pounce', { bleed: p.dashKind === 'tiger' });
        p.dashUntil = now; // chạm người là dừng
        dashing = false;
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
      fx('peck', id, { yaw: r2(p.aim) });
    } else if (stunned && p.peckLeft > 0) p.peckLeft = 0;

    /* hành động: skill / đánh thường; lao có thể huỷ sau SKILL_CANCEL_MS để nối chiêu */
    if (free && !stunned) {
      const canAct = !dashing || now - p.dashStart >= SKILL_CANCEL_MS;
      if ((wantSk1 || wantSk2) && canAct && !p.castKey) {
        const w1 = wantSk1 && now >= p.skCd[0];
        const w2 = !w1 && wantSk2 && now >= p.skCd[1];
        if (w1 || w2) {
          if (dashing) {
            p.dashUntil = now;
            dashing = false;
          }
          if (w1) p.sk1At = -1e9;
          else p.sk2At = -1e9;
          useSkill(id, w1 ? 1 : 2);
        }
      } else if (wantPunch && canAct && now >= p.punchCd) {
        if (dashing) {
          p.dashUntil = now;
          dashing = false;
        }
        p.punchAt = -1e9;
        p.face = p.aim;
        let idx = p.comboHit && now - p.lastQuickAt <= COMBO_WINDOW && p.combo < 2 ? p.combo + 1 : 0;
        const linked = now < p.linkUntil; // vừa tung skill: đòn thường bồi thêm có thưởng
        if (linked && idx === 0) idx = 1;
        p.combo = idx;
        p.lastQuickAt = now;
        p.comboHit = false;
        p.punchAnim = now + 300;
        const ax = Math.sin(p.aim);
        const ay = Math.cos(p.aim);
        let found = 0;
        for (const oid of alive) {
          if (oid === id) continue;
          const o = S[oid];
          if (Math.abs(o.z - sn.z) > 1.4) continue;
          const ox = o.x - sn.x;
          const oy = o.y - sn.y;
          const dist = Math.hypot(ox, oy);
          if (dist > QUICK_RANGE || dist < 1e-4) continue;
          if (Math.abs(angDiff(p.aim, Math.atan2(ox, oy))) > QUICK_ARC) continue;
          found++;
          let kx = ax * 0.6 + (ox / dist) * 0.4;
          let ky = ay * 0.6 + (oy / dist) * 0.4;
          const kl = Math.hypot(kx, ky) || 1;
          kx /= kl;
          ky /= kl;
          let force = COMBO_FORCE[idx];
          force += Math.max(0, sn.vx * kx + sn.vy * ky) * SPEED_FORCE_K; // lao tới đánh thì mạnh hơn
          force *= 1 + o.wobble * KNOCK_WOBBLE_BOOST;
          let stun = COMBO_STUN[idx];
          let wob = COMBO_WOBBLE[idx];
          let dmg = DMG_QUICK[idx] * rageMul * (linked ? SKILL_LINK_BONUS : 1);
          const counter = o.whiff;
          if (counter) {
            force *= COUNTER_MULT;
            stun += COUNTER_EXTRA_STUN;
            wob += COUNTER_EXTRA_WOBBLE;
            dmg *= COUNTER_DMG_MULT;
          }
          hits.push({ att: id, vic: oid, kind: 'quick', idx, force, stun, wob, dmg, dx: kx, dy: ky, counter, tag: counter ? 'counter' : linked ? 'link' : idx === 2 ? 'combo' : 'punch' });
        }
        if (found === 0) {
          // đánh hụt: lộ sơ hở, loạng choạng nhẹ, không trượt dài
          p.combo = 0;
          p.punchCd = now + QUICK_WHIFF_CD;
          b.vx += ax * QUICK_LURCH;
          b.vy += ay * QUICK_LURCH;
          p.stunUntil = now + WHIFF_STUN;
          p.whiffUntil = now + WHIFF_VULN_MS;
          addWobble(p, WHIFF_WOBBLE);
          fx('whiff', id, { yaw: r2(p.aim) });
          // đánh hụt vào tường: tự đập
          if (Math.abs(b.x + ax) > cfg.hw - WALL_M || Math.abs(b.y + ay) > cfg.L / 2 - WALL_M) {
            damage(id, WHIFF_WALL_DMG, '', 'wallpunch', true);
            fx('wallpunch', id);
          }
        } else {
          p.punchCd = now + (idx === 2 ? COMBO_FINISH_CD : QUICK_CD);
        }
      }
    }

    /* vật lý */
    const m = Math.hypot(p.mx, p.my);
    const buff =
      p.chr.speed *
      (now < p.hasteUntil ? SK_HASTE_SPEED : 1) *
      (now < p.rageUntil ? SK_RAGE_SPEED : 1) *
      (now < p.spinUntil ? SK_TURTLE_SPIN.speedMul : 1) *
      (p.peckLeft > 0 ? 0.6 : 1) *
      (p.castKey ? CAST_MOVE_MUL : 1);
    const jumped = stepBody(cfg, b, free ? p.mx : 0, free ? p.my : 0, dt, {
      speedMul: buff * (stunned ? 0.55 : 1),
      accelMul: stunned ? 0.5 : 1,
      noControl: !free || now < p.dashUntil,
      jump: free && wantJump && !stunned && now >= p.dashUntil,
    });
    if (jumped) p.jumpAt = -1e9;
    if (downed) p.mx = p.my = 0;

    /* hướng thân: quay mượt, giới hạn tốc độ quay */
    if (free && !stunned) p.face += clamp(angDiff(p.face, p.aim), -TURN_RATE * dt, TURN_RATE * dt);
    else if (now < p.punchAnim) p.face = p.aim;
    else if (free && m > 0.15) p.face += angDiff(p.face, Math.atan2(p.mx, p.my)) * Math.min(1, dt * 12);

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
        if (p.out || p.b.z > 0.3 || now < p.downUntil) continue;
        if (id === bn.owner && now - bn.born < SK_BANANA.immuneMs) continue;
        if (Math.hypot(p.b.x - bn.x, p.b.y - bn.y) > SK_BANANA.radius) continue;
        state.bananas = state.bananas.filter((x) => x !== bn);
        ctx.broadcast({ type: 'banana', op: 'gone', id: bn.id, hit: id });
        p.b.vx += Math.sin(p.face) * SK_BANANA.slide;
        p.b.vy += Math.cos(p.face) * SK_BANANA.slide;
        damage(id, SK_BANANA.dmg, bn.owner === id ? '' : bn.owner, 'banana', true);
        addWobble(p, SK_BANANA.wob);
        fx('slip', id, { dmg: SK_BANANA.dmg });
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
    const dmgDone = damage(h.vic, h.dmg * (h.kind === 'skill' && now < att.rageUntil ? SK_RAGE_DMG : 1), h.att, h.tag);
    if (dmgDone <= 0 && !o.out) continue; // chặn bởi khiên / tự né: không hất, không choáng
    const knock = (h.force / o.chr.mass) * (now < o.armorUntil ? SK_ARMOR_KNOCK : 1);
    o.b.vx += h.dx * knock;
    o.b.vy += h.dy * knock;
    if (o.b.z <= 0) o.b.vz = Math.max(o.b.vz, h.force > 7 ? 3 : 2);
    o.stunUntil = Math.max(o.stunUntil, now + h.stun);
    o.peckLeft = 0;
    o.castKey = ''; // bị đánh trúng thì gián đoạn chiêu niệm
    addWobble(o, h.wob / (o.chr.mass > 1.2 ? 1.15 : 1));
    if (h.bleed) {
      o.bleedUntil = now + SK_TIGER_POUNCE.bleedMs;
      o.bleedBy = h.att;
    }
    att.comboHit = true;
    fx('hit', h.att, { b: h.vic, kind: h.kind, tag: h.tag, idx: h.idx, counter: h.counter, force: r1(h.force), dmg: r1(dmgDone), dx: r2(h.dx), dy: r2(h.dy) });
  }

  /* ---------- 3. va chạm giữa người với nhau (đẩy nhau nhẹ) ---------- */
  for (let i = 0; i < alive.length; i++) {
    const A = P[alive[i]];
    if (A.out) continue;
    for (let j = i + 1; j < alive.length; j++) {
      const B = P[alive[j]];
      if (B.out) continue;
      if (Math.abs(A.b.z - B.b.z) > 1.3) continue;
      const dx = B.b.x - A.b.x;
      const dy = B.b.y - A.b.y;
      const d = Math.hypot(dx, dy);
      if (d >= 0.85) continue;
      const nx = d > 1e-3 ? dx / d : 1;
      const ny = d > 1e-3 ? dy / d : 0;
      const push = (0.85 - d) / 2;
      A.b.x -= nx * push;
      A.b.y -= ny * push;
      B.b.x += nx * push;
      B.b.y += ny * push;
      const rv = (B.b.vx - A.b.vx) * nx + (B.b.vy - A.b.vy) * ny;
      if (rv < -2.5) {
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
