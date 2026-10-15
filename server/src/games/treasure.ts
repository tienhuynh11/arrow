import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import { MAXC, STEP_MS, arenaDims, splitArenas } from '../../../shared/treasure.js';
import { PH_DONE, PH_OVER, T_DEFAULT, TreasureArena, type TreasureOpts } from './treasureArena.js';

/**
 * CƯỚP KHO BÁU (id treasure) - nhiều đấu trường 2-6 người chạy song song. Mỗi người có căn cứ riêng,
 * kho báu hồi sinh từng đợt ở giữa sân; mang càng nhiều chạy càng chậm; cướp được từ người đang mang.
 * Server mô phỏng 60 tick/s theo đồng hồ (tick = floor((now - startAt)/STEP)), snapshot ~20Hz (theo nhịp update 50ms).
 * Chi tiết mạng: xem treasureArena.ts và shared/treasureClient.ts.
 */
interface ArenaCfg {
  ids: string[];
  w: number;
  h: number;
}
interface Config {
  arenas: ArenaCfg[];
  maxCarry: number;
}
interface State {
  arenas: TreasureArena[];
  where: Map<string, number>;
  seat: Map<string, number>;
  doneAt: number;
  result: Record<string, PlayerResult> | null;
}

/** 2s đếm ngược + 100s chơi + dư */
const DURATION = 112_000;
const END_GRACE_MS = 3000;

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** để bài kiểm tra chỉnh lag compensation */
export const treasureTestOpts: TreasureOpts = { ...T_DEFAULT };

const dir = (v: unknown) => (Number(v) > 0 ? 1 : Number(v) < 0 ? -1 : 0);

export const treasureGame: GameDefinition<Config, State> = {
  id: 'treasure',
  name: '💰 CƯỚP KHO BÁU',
  instructions:
    'Kho báu rơi ở GIỮA sân - chạy ra nhặt rồi mang về căn cứ của bạn để ghi điểm. Mang càng nhiều chạy càng CHẬM! Đứng gần người đang vận chuyển rồi bấm SPACE để CƯỚP một nửa số đồ của họ (một phần rơi ra đất ai cũng nhặt được). Hết giờ ai NỘP nhiều kho báu nhất thì thắng - đồ đang mang không được tính!',
  controls: [
    { keys: ['W', 'A', 'S', 'D', '←', '↑', '↓', '→'], desc: 'Chạy 8 hướng' },
    { keys: ['SPACE'], desc: 'Cướp kho báu / đẩy người (hoặc chuột trái)' },
  ],
  duration: DURATION,
  minPlayers: 2,
  maxPlayers: 16,

  createConfig(ctx) {
    const ids = shuffle([...ctx.playerIds]);
    const arenas: ArenaCfg[] = [];
    let at = 0;
    for (const sz of splitArenas(ids.length)) {
      const [w, h] = arenaDims(sz);
      arenas.push({ ids: ids.slice(at, at + sz), w, h });
      at += sz;
    }
    return { arenas, maxCarry: MAXC };
  },

  createState(ctx, config) {
    const where = new Map<string, number>();
    const seat = new Map<string, number>();
    const arenas = config.arenas.map((ac, ai) => {
      ac.ids.forEach((id, s) => {
        where.set(id, ai);
        seat.set(id, s);
      });
      return new TreasureArena(ai, ac.ids, (payload) => {
        for (const id of ac.ids) ctx.send(id, payload);
      }, treasureTestOpts);
    });
    return { arenas, where, seat, doneAt: 0, result: null };
  },

  onStart(ctx, state) {
    const T = Math.max(0, Math.floor((ctx.now() - ctx.startAt) / STEP_MS));
    for (const a of state.arenas) {
      a.w.tick = T;
      a.start();
    }
  },

  handleInput(ctx, state, _config, playerId, input: GameInput) {
    if (input.type !== 'trs') return;
    const ai = state.where.get(playerId);
    if (ai === undefined) return;
    const a = state.arenas[ai];
    if (!a || a.phase === PH_DONE) return;
    const t = Number(input.t);
    const q = Number(input.q);
    const f = Number(input.a);
    if (!Number.isFinite(t) || !Number.isFinite(q) || !Number.isFinite(f)) return;
    const T = Math.floor((ctx.now() - ctx.startAt) / STEP_MS);
    if (T < 0) return;
    a.advance(T);
    const d = Number.isFinite(Number(input.d)) ? Math.max(0, Math.min(12, Math.trunc(Number(input.d)))) : -1;
    a.applyInput(state.seat.get(playerId)!, Math.trunc(t), Math.trunc(q), dir(input.dx), dir(input.dy), Math.trunc(f), d);
  },

  update(ctx, state) {
    const now = ctx.now();
    const T = Math.floor((now - ctx.startAt) / STEP_MS);
    if (T < 0 || state.result) return;
    let allOver = true;
    for (const a of state.arenas) {
      if (a.phase === PH_DONE) continue;
      a.advance(T);
      if (a.phase !== PH_OVER) allOver = false;
    }
    if (allOver && state.doneAt === 0) {
      state.doneAt = now;
      for (const a of state.arenas) for (const id of a.ids) ctx.send(id, { type: 'end', a: a.idx });
      return;
    }
    if (state.doneAt > 0) return;
    for (const a of state.arenas) {
      if (a.phase === PH_DONE || a.phase === PH_OVER) continue;
      const snap = a.snapshot();
      for (const id of a.ids) ctx.send(id, snap);
    }
    // gửi lại danh sách kho báu mỗi ~2s (chống mất đồng bộ nếu lỡ gói)
    if (Math.floor(now / 2000) !== Math.floor((now - 50) / 2000)) {
      for (const a of state.arenas) {
        if (a.phase === PH_DONE || a.phase === PH_OVER) continue;
        const m = a.syncMsg();
        for (const id of a.ids) ctx.send(id, m);
      }
    }
  },

  isFinished(ctx, state) {
    return state.doneAt > 0 && ctx.now() - state.doneAt >= END_GRACE_MS;
  },

  calculateScore(ctx, state) {
    if (state.result) return state.result;
    const out: Record<string, PlayerResult> = {};
    for (const a of state.arenas) {
      for (let s = 0; s < a.n; s++) {
        out[a.ids[s]] = {
          raw: a.rawOf(s),
          detail: `nộp ${a.dep[s]} 💰 · cướp ${a.steals[s]} lần`,
        };
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
