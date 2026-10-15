import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import { MAXT, OVER_TICKS, ROUNDS, STEP_MS, mazeDims, splitArenas } from '../../../shared/tank.js';
import { Arena, PH_COUNT, PH_DONE, PH_FIGHT, PH_OVER, type ArenaOpts, DEFAULT_OPTS } from './tankArena.js';

/**
 * XE TĂNG ĐẠN NẢY (id tanks) - nhiều đấu trường 2-6 xe chạy song song, mỗi trường mê cung riêng.
 * Server mô phỏng 60 tick/s theo đồng hồ (tick = floor((now - startAt)/STEP)), gửi snapshot xe ~20Hz,
 * đạn chỉ gửi sự kiện bắn (client tự mô phỏng nảy tường). Chi tiết mạng: xem tankArena.ts và shared/tankClient.ts.
 */
interface ArenaCfg {
  ids: string[];
  w: number;
  h: number;
}
interface Config {
  arenas: ArenaCfg[];
  rounds: number;
}
interface State {
  arenas: Arena[];
  where: Map<string, number>;
  seat: Map<string, number>;
  lastR: number;
  doneAt: number;
  result: Record<string, PlayerResult> | null;
}

const DURATION = 225_000;
const MIN_NEXT_ROUND_MS = 26_000;
const R_RESEND_MS = 1500;
const END_GRACE_MS = 2800;

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** để bài kiểm tra chỉnh lag compensation / đẩy xe / giết */
export const tankTestOpts: ArenaOpts = { ...DEFAULT_OPTS };

const killMul = (n: number) => (n <= 2 ? 1.5 : n === 3 ? 1.2 : 1);

export const tanksGame: GameDefinition<Config, State> = {
  id: 'tanks',
  name: 'XE TĂNG ĐẠN NẢY',
  instructions:
    'Lái xe tăng trong mê cung, bắn đạn NẢY tường để hạ đối thủ - đạn bật lại cũng có thể trúng chính bạn! Còn sống cuối cùng thì thắng vòng; nhặt hộp bí ẩn để có súng liên thanh, đạn chùm, tia laze, tên lửa hoặc khiên. Mỗi đấu trường 2-6 xe, đấu tối đa 5 vòng.',
  controls: [
    { keys: ['W', '↑'], desc: 'Tiến' },
    { keys: ['S', '↓'], desc: 'Lùi' },
    { keys: ['A', '←', 'D', '→'], desc: 'Xoay thân xe trái / phải' },
    { keys: ['SPACE'], desc: 'Bắn (hoặc chuột trái)' },
  ],
  duration: DURATION,
  minPlayers: 2,
  maxPlayers: 16,

  createConfig(ctx) {
    const ids = shuffle([...ctx.playerIds]);
    const arenas: ArenaCfg[] = [];
    let at = 0;
    for (const sz of splitArenas(ids.length)) {
      const [w, h] = mazeDims(sz);
      arenas.push({ ids: ids.slice(at, at + sz), w, h });
      at += sz;
    }
    return { arenas, rounds: ROUNDS };
  },

  createState(ctx, config) {
    const where = new Map<string, number>();
    const seat = new Map<string, number>();
    const arenas = config.arenas.map((ac, ai) => {
      ac.ids.forEach((id, s) => {
        where.set(id, ai);
        seat.set(id, s);
      });
      return new Arena(ai, ac.ids, (payload) => {
        for (const id of ac.ids) ctx.send(id, payload);
      }, tankTestOpts);
    });
    return { arenas, where, seat, lastR: 0, doneAt: 0, result: null };
  },

  onStart(ctx, state) {
    const T = Math.max(0, Math.floor((ctx.now() - ctx.startAt) / STEP_MS));
    for (const a of state.arenas) {
      a.w.tick = T;
      a.startRound();
    }
    state.lastR = ctx.now();
  },

  handleInput(ctx, state, _config, playerId, input: GameInput) {
    if (input.type !== 'tank') return;
    const ai = state.where.get(playerId);
    if (ai === undefined) return;
    const a = state.arenas[ai];
    if (!a || a.phase === PH_DONE) return;
    const t = Number(input.t);
    const q = Number(input.q);
    const f = Number(input.f);
    if (!Number.isFinite(t) || !Number.isFinite(q) || !Number.isFinite(f)) return;
    const turn = input.turn > 0 ? 1 : input.turn < 0 ? -1 : 0;
    const move = input.move > 0 ? 1 : input.move < 0 ? -1 : 0;
    const T = Math.floor((ctx.now() - ctx.startAt) / STEP_MS);
    if (T < 0 || a.round < 0) return;
    a.advance(T);
    const d = Number.isFinite(Number(input.d)) ? Math.max(0, Math.min(12, Math.trunc(Number(input.d)))) : -1;
    a.applyInput(state.seat.get(playerId)!, Math.trunc(t), Math.trunc(q), turn, move, Math.trunc(f), d);
  },

  update(ctx, state) {
    const now = ctx.now();
    const T = Math.floor((now - ctx.startAt) / STEP_MS);
    if (T < 0 || state.result) return;
    let allOver = true;
    for (const a of state.arenas) {
      if (a.phase === PH_DONE) continue;
      a.advance(T);
      if (a.phase === PH_COUNT || a.phase === PH_FIGHT || T < a.decidedAt + OVER_TICKS) allOver = false;
    }
    if (allOver && state.arenas.some((a) => a.phase === PH_OVER)) {
      const last = state.arenas[0].round + 1 >= ROUNDS;
      const timeLeft = ctx.endAt - now;
      if (last || timeLeft < MIN_NEXT_ROUND_MS) {
        for (const a of state.arenas) a.finish();
        state.doneAt = now;
        for (const a of state.arenas) for (const id of a.ids) ctx.send(id, { type: 'end', a: a.idx });
      } else {
        for (const a of state.arenas) {
          a.w.tick = Math.max(a.w.tick, T);
          a.startRound();
        }
        state.lastR = now;
      }
      return;
    }
    const resend = now - state.lastR >= R_RESEND_MS;
    if (resend) state.lastR = now;
    for (const a of state.arenas) {
      if (a.phase === PH_DONE) continue;
      const snap = a.snapshot();
      for (const id of a.ids) ctx.send(id, snap);
      if (resend) a.sendRound();
    }
  },

  isFinished(ctx, state) {
    return state.doneAt > 0 && ctx.now() - state.doneAt >= END_GRACE_MS;
  },

  calculateScore(ctx, state) {
    if (state.result) return state.result;
    const out: Record<string, PlayerResult> = {};
    const tmp = new Float64Array(MAXT);
    for (const a of state.arenas) {
      a.provisional(tmp);
      for (let s = 0; s < a.n; s++) {
        const raw = Math.round(tmp[s] + a.kills[s] * 150 * killMul(a.n));
        out[a.ids[s]] = { raw, detail: `thắng ${a.wins[s]} vòng · hạ ${a.kills[s]}` };
      }
    }
    for (const id of ctx.playerIds) out[id] ??= { raw: 0, detail: 'không vào đấu trường' };
    // xoá sạch dữ liệu ván (ván xong là giải phóng bộ nhớ)
    state.result = out;
    state.arenas.length = 0;
    state.where.clear();
    state.seat.clear();
    return out;
  },
};
