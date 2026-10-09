import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import { clampDisk, los, makePlaza, plazaFree, plazaStep } from '../../../shared/plaza.js';
import type { PlazaProp } from '../../../shared/plaza.js';
import type { CodeBox } from '../../../shared/codeArena.js';

/**
 * Giả dạng NPC (kiểu Just Act Natural): một hòn đảo tròn đông NPC do máy điều khiển. Mỗi vòng MỘT người làm thợ săn,
 * những người còn lại trốn bằng cách hoà vào đám NPC — đi, dừng, đi lại cho "tự nhiên". Thợ săn là khẩu súng bay quanh đảo,
 * rọi laze và bắn ĐẠN BAY THẬT (mất ~0.5–0.9s mới tới nơi): lúc tới, ai nằm trong bán kính trúng quanh điểm đích sẽ bị hạ.
 * Trúng người thật thì cả phòng xem kill cam quay chậm (server tạm dừng mô phỏng); trúng NPC thì thợ săn bị choáng.
 *
 * Bí mật nằm ở server: thực thể nào là người thật KHÔNG gửi cho ai (mỗi người trốn chỉ biết thực thể của chính mình).
 * Trong pha ẩn đầu vòng thợ săn không nhận vị trí gì cả.
 */
interface Config {
  w: number;
  h: number;
  radius: number;
  boxes: CodeBox[];
  props: PlazaProp[];
  cx: number;
  cy: number;
  /** bán kính hòn đảo */
  R: number;
  /** tổng số thực thể giống hệt nhau (NPC + người trốn) */
  ents: number;
  /** màu ẩn danh của từng thực thể (không liên quan màu người chơi) */
  colors: string[];
  speed: number;
  /** tốc độ thợ săn bay vòng quanh bản đồ (rad/giây) */
  orbitSpeed: number;
  /** thợ săn của từng vòng (công khai) */
  order: string[];
  rounds: number;
  hideMs: number;
  huntMs: number;
  restMs: number;
  shotCdMs: number;
  stunMs: number;
  hitR: number;
  regenMs: number;
  killCamMs: number;
  endsAt: number;
}

interface Ent {
  x: number;
  y: number;
  /** hướng mặt (rad), theo hướng đi gần nhất */
  face: number;
  alive: boolean;
  /** người chơi điều khiển thực thể này ('' = NPC) */
  owner: string;
  // NPC
  tx: number;
  ty: number;
  waitUntil: number;
  stuckAt: number;
  speedK: number;
  lx: number;
  ly: number;
}

interface PState {
  /** thợ săn: vị trí + hướng */
  x: number;
  y: number;
  dx: number;
  dy: number;
  moveAt: number;
  face: number;
  ent: number;
  alive: boolean;
  /** điểm tích luỹ */
  pts: number;
  kills: number;
  survived: number;
  diedAt: number;
}

interface Bullet {
  id: number;
  tx: number;
  ty: number;
  hitAt: number;
}

type Phase = 'hide' | 'hunt' | 'rest';

interface State {
  ents: Ent[];
  players: Record<string, PState>;
  round: number;
  seeker: string;
  phase: Phase;
  phaseAt: number;
  ammo: number;
  maxAmmo: number;
  regenAt: number;
  bullets: Bullet[];
  bulletSeq: number;
  /** đang tạm dừng (kill cam) tới giờ này */
  pauseUntil: number;
  pausedTotal: number;
  kc: { ent: number } | null;
  shotAt: number;
  stunUntil: number;
  /** góc thợ săn trên vòng quanh bản đồ + điểm đang rọi laze */
  orbit: number;
  aim: [number, number] | null;
  lastTick: number;
  lastBroadcast: number;
  lastRole: number;
  doneAt: number;
}

const COLORS = ['#ff5e8a', '#ffb627', '#5b8cff', '#8a5bff', '#2fd6a0', '#ff8a3d', '#4cc9f0', '#f15bb5', '#9be564', '#e0e0e0'];
/** số NPC (chưa kể người trốn) — chỉnh ở đây */
const NPC_COUNT = 13;
const SPEED = 22;
const ORBIT_SPEED = 0.6;
const HIDE_MS = 6000;
const HUNT_MS = 50_000;
const REST_MS = 4500;
const ROUND_MS = HIDE_MS + HUNT_MS + REST_MS;
const SHOT_CD = 700;
const STUN_MS = 1500;
const HIT_R = 7;
/** đạn mỗi vòng = số người trốn × AMMO_PER + AMMO_BASE; hồi 1 viên mỗi REGEN_MS tới tối đa ban đầu */
const AMMO_PER = 2;
const AMMO_BASE = 4;
const REGEN_MS = 8000;
const KILLCAM_MS = 2500;
/** thời gian bay của đạn: BASE + khoảng cách × PER_UNIT, kẹp trong [MIN, MAX] */
const FLY_MIN = 500;
const FLY_MAX = 900;
const FLY_BASE = 450;
const FLY_PER_UNIT = 1.8;
const HOLD_TIMEOUT = 900;
const BROADCAST_MS = 66;
const ROLE_MS = 1000;
const END_GRACE = 1400;
/** dự trù cho các lần kill cam (chỉ để tính hạn chót cứng của ván) */
const KC_BUDGET = 30 * KILLCAM_MS;

const plaza = makePlaza();
const map = plaza.map;
const r1 = (n: number) => Math.round(n * 10) / 10;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function freePoint(): [number, number] {
  for (let i = 0; i < 80; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * (plaza.R - 8);
    const x = plaza.cx + Math.cos(a) * d;
    const y = plaza.cy + Math.sin(a) * d;
    if (plazaFree(plaza, x, y, 2)) return [x, y];
  }
  return [plaza.cx + 50, plaza.cy + 50];
}

export const actNaturalGame: GameDefinition<Config, State> = {
  id: 'actnatural',
  name: 'GIẢ DẠNG NPC',
  instructions:
    'Người trốn: hoà vào đám NPC trên đảo, đi và dừng như NPC. ' +
    'Thợ săn (khẩu súng bay quanh đảo): rọi laze rồi bấm để bắn — đạn bay mất chút thời gian nên nhắm đón đầu! ' +
    'Trúng người thật thì hạ được ngay, bắn nhầm NPC thì bị choáng.',
  controls: [
    { keys: ['←', '↑', '→', '↓'], desc: 'Người trốn: đi mọi hướng như NPC (W A S D cũng được) · đừng chạy thẳng tắp!' },
    { keys: ['←', '→'], desc: 'Thợ săn: bay vòng quanh đảo' },
    { keys: ['CHUỘT'], desc: 'Thợ săn: di chuột để rọi laze, bấm để bắn (đạn bay ~1 giây) · điện thoại: chạm vào mục tiêu' },
  ],
  duration: 3 * ROUND_MS + 1500 + KC_BUDGET,
  minPlayers: 2,
  maxPlayers: 16,

  createConfig(ctx) {
    const n = ctx.playerIds.length;
    const ents = NPC_COUNT + (n - 1);
    const colors: string[] = [];
    for (let i = 0; i < ents; i++) colors.push(COLORS[Math.floor(Math.random() * COLORS.length)]);
    const ids = [...ctx.playerIds];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const rounds = Math.min(n, 3);
    return {
      w: map.w,
      h: map.h,
      radius: map.radius,
      boxes: map.boxes,
      props: plaza.props,
      cx: plaza.cx,
      cy: plaza.cy,
      R: plaza.R,
      ents,
      colors,
      speed: SPEED,
      orbitSpeed: ORBIT_SPEED,
      order: ids.slice(0, rounds),
      rounds,
      hideMs: HIDE_MS,
      huntMs: HUNT_MS,
      restMs: REST_MS,
      shotCdMs: SHOT_CD,
      stunMs: STUN_MS,
      hitR: HIT_R,
      regenMs: REGEN_MS,
      killCamMs: KILLCAM_MS,
      endsAt: rounds * ROUND_MS,
    };
  },

  createState(ctx, config) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      players[id] = { x: 0, y: 0, dx: 0, dy: 0, moveAt: 0, face: 0, ent: -1, alive: true, pts: 0, kills: 0, survived: 0, diedAt: 0 };
    }
    const ents: Ent[] = [];
    for (let i = 0; i < config.ents; i++) {
      const [x, y] = freePoint();
      ents.push({ x, y, face: 0, alive: true, owner: '', tx: x, ty: y, waitUntil: 0, stuckAt: 0, speedK: 1, lx: x, ly: y });
    }
    return {
      ents,
      players,
      round: -1,
      seeker: '',
      phase: 'rest',
      phaseAt: ctx.startAt - 1,
      ammo: 0,
      maxAmmo: 0,
      regenAt: 0,
      bullets: [],
      bulletSeq: 0,
      pauseUntil: 0,
      pausedTotal: 0,
      kc: null,
      shotAt: 0,
      stunUntil: 0,
      orbit: Math.PI / 2,
      aim: null,
      lastTick: ctx.startAt,
      lastBroadcast: 0,
      lastRole: 0,
      doneAt: 0,
    };
  },

  handleInput(ctx, state, config, playerId, input: GameInput) {
    const p = state.players[playerId];
    if (!p) return;
    const now = ctx.now();
    if (input.type === 'moveXY') {
      p.dx = Math.max(-1, Math.min(1, Math.round(Number(input.dx) || 0)));
      p.dy = Math.max(-1, Math.min(1, Math.round(Number(input.dy) || 0)));
      p.moveAt = now;
      return;
    }
    const clampAim = (ax: number, ay: number): [number, number] => {
      const q = { x: Math.max(0, Math.min(config.w, ax)), y: Math.max(0, Math.min(config.h, ay)) };
      clampDisk(q, config.cx, config.cy, config.R);
      return [q.x, q.y];
    };
    if (input.type === 'aim') {
      if (playerId !== state.seeker || state.phase !== 'hunt') return;
      const ax = Number(input.x);
      const ay = Number(input.y);
      if (Number.isFinite(ax) && Number.isFinite(ay)) state.aim = clampAim(ax, ay);
      return;
    }
    if (input.type !== 'shoot' || playerId !== state.seeker || state.phase !== 'hunt') return;
    if (now < state.pauseUntil || now < state.shotAt + config.shotCdMs || now < state.stunUntil || state.ammo <= 0) return;
    const tx = Number(input.x);
    const ty = Number(input.y);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
    const [x, y] = clampAim(tx, ty);
    state.aim = [x, y];
    state.shotAt = now;
    if (state.ammo >= state.maxAmmo) state.regenAt = now;
    state.ammo -= 1;
    // đạn bay thật: tốc độ cố định nên xa thì lâu hơn; hit-scan chỉ xảy ra lúc đạn TỚI NƠI
    const gx = config.cx + Math.cos(state.orbit) * config.R * 1.1;
    const gy = config.cy + Math.sin(state.orbit) * config.R * 1.1;
    const fl = Math.round(Math.max(FLY_MIN, Math.min(FLY_MAX, FLY_BASE + Math.hypot(x - gx, y - gy) * FLY_PER_UNIT)));
    const id = ++state.bulletSeq;
    state.bullets.push({ id, tx: x, ty: y, hitAt: now + fl });
    ctx.broadcast({ type: 'bullet', id, x: r1(x), y: r1(y), phi: Math.round(state.orbit * 1000) / 1000, at: now, fl, ammo: state.ammo });
  },

  update(ctx, state, config) {
    const now = ctx.now();
    const dt = Math.min(now - state.lastTick, 200) / 1000;
    state.lastTick = now;
    if (now < ctx.startAt) return;
    const rel = now - ctx.startAt;
    void rel;
    const paused = now < state.pauseUntil;

    const startRound = (r: number) => {
      state.round = r;
      state.seeker = config.order[r];
      state.phase = 'hide';
      state.phaseAt = now;
      const hiders = ctx.playerIds.filter((id) => id !== state.seeker);
      // thực thể được giao ngẫu nhiên; mọi thực thể hồi sinh và rải lại khắp đảo
      const slots = state.ents.map((_, i) => i);
      for (let i = slots.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [slots[i], slots[j]] = [slots[j], slots[i]];
      }
      for (const e of state.ents) {
        const [x, y] = freePoint();
        e.x = x;
        e.y = y;
        e.alive = true;
        e.owner = '';
        e.tx = x;
        e.ty = y;
        e.waitUntil = now + rnd(0, 1500);
        e.speedK = rnd(0.75, 1);
        e.lx = x;
        e.ly = y;
        e.stuckAt = now;
      }
      for (const id of ctx.playerIds) {
        const p = state.players[id];
        p.alive = true;
        p.dx = p.dy = 0;
        p.ent = -1;
      }
      hiders.forEach((id, i) => {
        state.players[id].ent = slots[i];
        state.ents[slots[i]].owner = id;
      });
      state.aim = null;
      state.maxAmmo = hiders.length * AMMO_PER + AMMO_BASE;
      state.ammo = state.maxAmmo;
      state.regenAt = now;
      state.bullets = [];
      state.kc = null;
      state.shotAt = 0;
      state.stunUntil = 0;
      ctx.broadcast({ type: 'round', r, seeker: state.seeker, at: now, ammo: state.ammo, max: state.maxAmmo });
    };

    if (state.round < 0) startRound(0);

    /** tạm dừng mô phỏng `ms` mili giây: dịch mọi mốc thời gian để đồng hồ pha/choáng/hồi đạn đứng yên */
    const pause = (ms: number) => {
      state.pauseUntil = now + ms;
      state.pausedTotal += ms;
      state.phaseAt += ms;
      if (state.shotAt) state.shotAt += ms;
      state.stunUntil += ms;
      state.regenAt += ms;
      for (const b of state.bullets) b.hitAt += ms;
      for (const e of state.ents) {
        if (e.waitUntil > now) e.waitUntil += ms;
        e.stuckAt += ms;
      }
    };

    if (paused) {
      // kill cam đang chạy: không cập nhật gì, chỉ phát lại vị trí đóng băng
    } else {
      if (state.kc) {
        // hết kill cam: nạn nhân biến mất khỏi sân
        state.ents[state.kc.ent].alive = false;
        state.kc = null;
      }

      // pha
      if (state.phase === 'hide' && now - state.phaseAt >= config.hideMs) {
        state.phase = 'hunt';
        state.phaseAt = now;
        state.regenAt = now;
        ctx.broadcast({ type: 'hunt', r: state.round, at: now });
      }

      // đạn tới nơi: xét ai đang nằm trong bán kính trúng quanh điểm đích LÚC NÀY
      if (state.phase === 'hunt' && state.bullets.length) {
        const due = state.bullets.filter((b) => b.hitAt <= now);
        state.bullets = state.bullets.filter((b) => b.hitAt > now);
        for (const b of due) {
          if (state.kc) {
            // đã có người trúng trong cùng nhịp: viên này coi như trượt
            ctx.broadcast({ type: 'shot', id: b.id, x: r1(b.tx), y: r1(b.ty), ammo: state.ammo, at: now });
            continue;
          }
          let best = -1;
          let bestD = config.hitR;
          state.ents.forEach((e, i) => {
            if (!e.alive) return;
            const d = Math.hypot(e.x - b.tx, e.y - b.ty);
            if (d <= bestD) {
              bestD = d;
              best = i;
            }
          });
          if (best < 0) {
            ctx.broadcast({ type: 'shot', id: b.id, x: r1(b.tx), y: r1(b.ty), ammo: state.ammo, at: now });
            continue;
          }
          const e = state.ents[best];
          const owner = e.owner ? state.players[e.owner] : null;
          const seekerP = state.players[state.seeker];
          if (owner && owner.alive) {
            owner.alive = false;
            owner.diedAt = now;
            seekerP.kills += 1;
            seekerP.pts += 120;
            // người trốn bị tìm ra: điểm theo thời gian sống sót
            owner.pts += Math.round(Math.min(80, ((now - state.phaseAt) / config.huntMs) * 100));
            state.kc = { ent: best };
            ctx.broadcast({ type: 'kill', id: b.id, ent: best, who: e.owner, by: state.seeker, x: r1(e.x), y: r1(e.y), ammo: state.ammo, at: now, ms: config.killCamMs });
            pause(config.killCamMs);
          } else {
            state.stunUntil = now + config.stunMs;
            // NPC bị bắn nhầm: những người trốn còn sống được điểm "đánh lạc hướng"
            for (const id of ctx.playerIds) {
              const p = state.players[id];
              if (id !== state.seeker && p.alive) p.pts += 12;
            }
            ctx.broadcast({ type: 'miss', id: b.id, ent: best, x: r1(e.x), y: r1(e.y), ammo: state.ammo, at: now });
          }
        }
      }

      if (!state.kc && state.phase === 'hunt') {
        // hồi đạn
        if (state.ammo < state.maxAmmo && now - state.regenAt >= config.regenMs) {
          state.ammo += 1;
          state.regenAt = now;
        }
        const left = ctx.playerIds.filter((id) => id !== state.seeker && state.players[id].alive).length;
        if (left === 0 || now - state.phaseAt >= config.huntMs) {
          state.phase = 'rest';
          state.phaseAt = now;
          state.bullets = [];
          const reveal: Record<number, string> = {};
          for (const id of ctx.playerIds) {
            if (id === state.seeker) continue;
            const p = state.players[id];
            if (p.alive) {
              p.pts += 100;
              p.survived += 1;
            }
            reveal[p.ent] = id;
          }
          ctx.broadcast({ type: 'reveal', r: state.round, map: reveal, at: now });
          if (state.round + 1 >= config.rounds) state.doneAt = now;
        }
      }
      if (state.phase === 'rest' && !state.doneAt && now - state.phaseAt >= config.restMs) startRound(state.round + 1);
    }

    // di chuyển (đứng yên trong kill cam): thợ săn (trừ lúc choáng), người trốn (chỉ thực thể của mình), NPC tự đi lại
    const seeker = state.players[state.seeker];
    if (!paused && !state.kc) {
      // thợ săn bay vòng quanh bản đồ (← → chọn chiều), không đứng trong sân
      if (seeker && state.phase === 'hunt' && now >= state.stunUntil) {
        if (now - seeker.moveAt > HOLD_TIMEOUT) seeker.dx = seeker.dy = 0;
        state.orbit += seeker.dx * config.orbitSpeed * dt;
      }
      if (state.phase !== 'rest') {
        for (const e of state.ents) {
          if (!e.alive) continue;
          if (e.owner) {
            const p = state.players[e.owner];
            if (now - p.moveAt > HOLD_TIMEOUT) p.dx = p.dy = 0;
            if (p.dx || p.dy) e.face = Math.atan2(p.dx, p.dy);
            plazaStep(plaza, e, p.dx, p.dy, config.speed, dt);
            continue;
          }
          // NPC: đi tới điểm đích với tốc độ hơi khác nhau, tới nơi (hoặc kẹt) thì đứng nghỉ ngẫu nhiên rồi chọn đích mới
          if (now < e.waitUntil) continue;
          const dx = e.tx - e.x;
          const dy = e.ty - e.y;
          const d = Math.hypot(dx, dy);
          if (d < 2.5 || now - e.stuckAt > 1500) {
            e.waitUntil = now + (Math.random() < 0.3 ? rnd(2000, 4500) : rnd(300, 1600));
            let tries = 0;
            let tx = e.x;
            let ty = e.y;
            do {
              const a = Math.random() * Math.PI * 2;
              const len = rnd(25, 85);
              tx = e.x + Math.cos(a) * len;
              ty = e.y + Math.sin(a) * len;
              tries++;
            } while (tries < 14 && !(plazaFree(plaza, tx, ty, 2) && los(map, e.x, e.y, tx, ty)));
            if (tries >= 14) {
              [tx, ty] = freePoint();
            }
            e.tx = tx;
            e.ty = ty;
            e.speedK = rnd(0.75, 1);
            e.lx = e.x;
            e.ly = e.y;
            e.stuckAt = now;
            continue;
          }
          e.face = Math.atan2(dx, dy);
          const bx = e.x;
          const by = e.y;
          plazaStep(plaza, e, dx / d, dy / d, config.speed * e.speedK, dt);
          // có tiến triển thì gia hạn "kẹt"
          if (Math.hypot(e.x - bx, e.y - by) > config.speed * e.speedK * dt * 0.4) e.stuckAt = now;
        }
      }
    }

    if (now - state.lastBroadcast < BROADCAST_MS) return;
    state.lastBroadcast = now;
    // nạn nhân của kill cam vẫn hiện (đứng yên) cho tới khi kill cam kết thúc
    const list: ([number, number, number] | null)[] = state.ents.map((e, i) =>
      e.alive || state.kc?.ent === i ? [r1(e.x), r1(e.y), Math.round(e.face * 100) / 100] : null,
    );
    // tia laze của thợ săn ai cũng thấy (trừ lúc nhắm mắt đầu vòng, chưa có tia)
    const hunting = state.phase === 'hunt';
    const k = [
      Math.round(state.orbit * 1000) / 1000,
      hunting && state.aim ? r1(state.aim[0]) : null,
      hunting && state.aim ? r1(state.aim[1]) : null,
      state.ammo,
      hunting && now < state.stunUntil ? 1 : 0,
    ];
    const ph = state.phase === 'hide' ? 'h' : state.phase === 'hunt' ? 'u' : 'r';
    for (const id of ctx.playerIds) {
      // pha nhắm mắt: thợ săn không được biết gì về vị trí
      if (id === state.seeker && state.phase === 'hide') {
        ctx.send(id, { type: 'p', ph, r: state.round, k });
      } else {
        ctx.send(id, { type: 'p', ph, r: state.round, e: list, k });
      }
    }
    if (now - state.lastRole >= ROLE_MS) {
      state.lastRole = now;
      for (const id of ctx.playerIds) {
        const p = state.players[id];
        ctx.send(id, { type: 'role', r: state.round, seeker: state.seeker, ent: id === state.seeker ? -1 : p.ent, alive: id === state.seeker ? true : p.alive });
      }
    }
  },

  isFinished(ctx, state, config) {
    const now = ctx.now();
    if (now - ctx.startAt - state.pausedTotal >= config.endsAt) return true;
    return state.doneAt > 0 && now - state.doneAt >= config.restMs * 0.6 + END_GRACE;
  },

  calculateScore(ctx, state) {
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      out[id] = { raw: p.pts, detail: `${p.pts} điểm · hạ ${p.kills} · trốn thoát ${p.survived}` };
    }
    return out;
  },
};
