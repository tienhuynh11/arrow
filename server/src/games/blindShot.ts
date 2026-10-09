import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import { blindRadii, blindRadius, shoot, stepBlind, type BlindBody, type BlindCfg } from '../../../shared/blindArena.js';

/**
 * Đấu trường mù: mỗi vòng có 3 pha.
 *  1) CHUẨN BỊ: cả phòng thấy nhau, chạy chỗ và chọn thế đứng.
 *  2) ẨN: mọi người biến mất khỏi mắt nhau — chỉ thấy bản thân và khẩu súng của mình. Vẫn đi, xoay người và súng được.
 *  3) BẮN: tới giây cuối của pha ẩn, mọi người cùng nổ súng theo hướng đang ngắm; vị trí thật được lộ ra cùng kết quả.
 * Trúng đạn là BỊ LOẠI ngay. Mỗi vòng sân thu nhỏ lại (bảng `radii`). Còn ≤1 người sống hoặc hết vòng là kết thúc.
 * Trong pha ẩn server KHÔNG gửi vị trí của ai khác cho người còn sống; người đã bị loại (khán giả) thì được xem.
 */
interface Config extends BlindCfg {
  prepMs: number;
  hideMs: number;
  revealMs: number;
  rounds: number;
  /** bán kính sân của từng vòng */
  radii: number[];
  endsAt: number;
  /** vị trí xuất phát để dựng nhân vật lúc đếm ngược: [x, y, a] */
  spawns: Record<string, [number, number, number]>;
}

interface PState extends BlindBody {
  dx: number;
  dy: number;
  moveAt: number;
  kills: number;
  out: boolean;
  /** vòng bị loại (0-based), -1 nếu còn sống */
  diedRound: number;
}

interface State {
  players: Record<string, PState>;
  /** vòng gần nhất đã nổ súng */
  fired: number;
  /** thời điểm (tương đối startAt) ván kết thúc sớm vì còn ≤1 người */
  endAt: number | null;
  lastTick: number;
  lastBroadcast: number;
}

const R = 105;
const BODY = 5;
const SPEED = 34;
const HIT = 6.5;
const PREP_MS = 4000;
const HIDE_MS = 8000;
const REVEAL_MS = 6500;
const ROUNDS = 11;
const R_MIN = 42;
const ROUND_MS = PREP_MS + HIDE_MS + REVEAL_MS;
const HOLD_TIMEOUT = 900;
const BROADCAST_MS = 66;

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export const blindShotGame: GameDefinition<Config, State> = {
  id: 'blindshot',
  name: 'ĐẤU TRƯỜNG MÙ',
  instructions:
    'Mỗi vòng, mọi người thấy nhau vài giây rồi TẤT CẢ BIẾN MẤT. Đoán đối thủ đứng đâu và xoay súng về hướng đó — hết giờ cả phòng cùng nổ súng, ai bị trúng là BỊ LOẠI. ' +
    'Sàn thu nhỏ dần mỗi vòng; người sống sót cuối cùng thắng.',
  controls: [
    { keys: ['←', '↑', '→', '↓'], desc: 'Chạy mọi hướng · W A S D cũng được' },
    { keys: ['CHUỘT'], desc: 'Di chuột để xoay súng · điện thoại: chạm vào màn hình để ngắm' },
    { keys: ['BỊ TRÚNG'], desc: 'Trúng đạn là bị loại · sàn thu nhỏ mỗi vòng' },
  ],
  duration: ROUNDS * ROUND_MS + 1500,
  minPlayers: 2,
  maxPlayers: 16,

  createConfig(ctx) {
    const n = ctx.playerIds.length;
    const ids = [...ctx.playerIds];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    // xếp đều trên một vòng, mặt hướng vào tâm
    const spawns: Record<string, [number, number, number]> = {};
    ids.forEach((id, i) => {
      const ang = (i / n) * Math.PI * 2 + 0.3;
      const x = Math.cos(ang) * R * 0.66;
      const y = Math.sin(ang) * R * 0.66;
      // hướng nhìn (sin a, cos a) trỏ về tâm
      spawns[id] = [r1(x), r1(y), r2(Math.atan2(-x, -y))];
    });
    return {
      r: R,
      radii: blindRadii(ROUNDS, R, R_MIN),
      body: BODY,
      speed: SPEED,
      hit: HIT,
      prepMs: PREP_MS,
      hideMs: HIDE_MS,
      revealMs: REVEAL_MS,
      rounds: ROUNDS,
      endsAt: ROUNDS * ROUND_MS,
      spawns,
    };
  },

  createState(ctx, config) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      const [x, y, a] = config.spawns[id];
      players[id] = { x, y, a, dx: 0, dy: 0, moveAt: 0, kills: 0, out: false, diedRound: -1 };
    }
    return { players, fired: -1, endAt: null, lastTick: ctx.startAt, lastBroadcast: 0 };
  },

  handleInput(ctx, state, _config, playerId, input: GameInput) {
    if (input.type !== 'steer') return;
    const p = state.players[playerId];
    if (!p || p.out) return;
    const c = (v: unknown) => Math.max(-1, Math.min(1, Math.round(Number(v) || 0)));
    p.dx = c(input.dx);
    p.dy = c(input.dy);
    // hướng súng do chuột đặt: nhận thẳng (chỉ cần là số hữu hạn)
    const a = Number(input.a);
    if (Number.isFinite(a)) p.a = Math.atan2(Math.sin(a), Math.cos(a));
    p.moveAt = ctx.now();
  },

  update(ctx, state, config) {
    const now = ctx.now();
    const rel = now - ctx.startAt;
    const dt = Math.min(now - state.lastTick, 200) / 1000;
    state.lastTick = now;
    if (rel < 0) return;

    const round = Math.min(config.rounds - 1, Math.floor(rel / ROUND_MS));
    const off = rel - round * ROUND_MS;
    const phase = off < PREP_MS ? 'prep' : off < PREP_MS + HIDE_MS ? 'hide' : 'reveal';
    const live = { ...config, r: blindRadius(config.radii, round, off) };
    const alive = ctx.playerIds.filter((id) => !state.players[id].out);

    if (phase !== 'reveal' && state.endAt === null) {
      // sân thu hẹp: ai đứng ngoài vòng mới sẽ bị đẩy vào trong (stepBlind luôn ép về bán kính hiện tại)
      for (const id of alive) {
        const p = state.players[id];
        if (now - p.moveAt > HOLD_TIMEOUT) p.dx = p.dy = 0;
        stepBlind(live, p, p.dx, p.dy, dt);
      }
    }

    // hết pha ẩn: cả phòng nổ súng một lúc, vị trí thật lộ ra, ai trúng đạn bị loại
    if (phase === 'reveal' && state.fired < round && state.endAt === null) {
      state.fired = round;
      const all = alive.map((id) => ({ id, x: state.players[id].x, y: state.players[id].y }));
      const shots: { id: string; hit: string | null; len: number }[] = [];
      const dead = new Set<string>();
      for (const id of alive) {
        const p = state.players[id];
        const res = shoot(live, p, all.filter((t) => t.id !== id));
        if (res.hit) {
          p.kills += 1;
          dead.add(res.hit);
        }
        shots.push({ id, hit: res.hit, len: r1(res.len) });
      }
      const pos: Record<string, [number, number, number]> = {};
      for (const id of alive) {
        const p = state.players[id];
        pos[id] = [r1(p.x), r1(p.y), r2(p.a)];
      }
      const kills: Record<string, number> = {};
      for (const id of ctx.playerIds) kills[id] = state.players[id].kills;
      for (const id of dead) {
        state.players[id].out = true;
        state.players[id].diedRound = round;
        state.players[id].dx = state.players[id].dy = 0;
      }
      const left = ctx.playerIds.filter((id) => !state.players[id].out).length;
      const out = ctx.playerIds.filter((id) => state.players[id].out);
      ctx.broadcast({ type: 'fire', r: round, pos, shots, dead: [...dead], out, alive: left, kills, rad: r1(live.r) });
      if (left <= 1 || round >= config.rounds - 1) state.endAt = (round + 1) * ROUND_MS;
    }

    if (phase === 'reveal') return; // đứng yên: client dựng cảnh từ event 'fire'
    if (now - state.lastBroadcast < BROADCAST_MS) return;
    state.lastBroadcast = now;

    const pos: Record<string, [number, number, number]> = {};
    for (const id of alive) {
      const p = state.players[id];
      pos[id] = [r1(p.x), r1(p.y), r2(p.a)];
    }
    if (phase === 'hide') {
      // pha ẩn: người còn sống CHỈ nhận vị trí của chính mình; người đã bị loại (khán giả) xem được tất cả
      for (const id of ctx.playerIds) {
        const p = state.players[id];
        if (p.out) ctx.send(id, { type: 'pos', ph: 'hide', all: pos });
        else ctx.send(id, { type: 'pos', ph: 'hide', me: [r1(p.x), r1(p.y), r2(p.a)] });
      }
      return;
    }
    ctx.broadcast({ type: 'pos', ph: phase, all: pos });
  },

  isFinished(ctx, state, config) {
    const rel = ctx.now() - ctx.startAt;
    return rel >= config.endsAt || (state.endAt !== null && rel >= state.endAt);
  },

  calculateScore(ctx, state, config) {
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      // sống sót > bị loại muộn hơn > bị loại sớm; cùng vòng thì ai hạ nhiều hơn xếp trên
      const life = p.out ? p.diedRound + 1 : config.rounds + 5;
      out[id] = {
        raw: life * 1000 + p.kills,
        detail: `${p.out ? `bị loại vòng ${p.diedRound + 1}` : 'sống sót'} · hạ ${p.kills}`,
      };
    }
    return out;
  },
};
