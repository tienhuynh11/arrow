import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';

interface Config {
  windowMs: number;
  minIntervalMs: number;
  /** các khoảng ĐÈN ĐỎ (offset từ startAt) - nhấn trong lúc này bị trừ điểm */
  danger: { from: number; to: number }[];
}

interface PState {
  count: number;
  rejected: number;
  burned: number; // số lần nhấn nhầm lúc đèn đỏ
  lastAt: number;
  /** đơ tay sau khi nhấn nhầm đèn đỏ */
  frozenUntil: number;
}

interface State {
  players: Record<string, PState>;
  lastBroadcast: number;
}

const WINDOW = 38_000;
const MIN_INTERVAL = 45; // caps at ~22 valid taps/sec
const DANGER_COUNT = 8;
/** đèn đỏ ngắn dần: càng về cuối càng khó kịp nhấc tay */
const DANGER_LEN_START = 900;
const DANGER_LEN_END = 520;
/** nhấn nhầm lúc đèn đỏ: trừ chừng này lượt + đơ tay một lúc (ván dài nên 3 lượt không còn đáng kể) */
const BURN_PENALTY = 15;
const BURN_FREEZE_MS = 600;

export const buttonBattleGame: GameDefinition<Config, State> = {
  id: 'button',
  name: 'BẤM NHANH TAY - CHƯA CẬP NHẬT',
  instructions:
    'Bấm SPACE thật nhanh để ghi điểm. Khi nút chuyển ĐỎ thì DỪNG TAY: bấm lúc đỏ bị trừ điểm và đơ tay. Nhiều điểm nhất thắng.',
  controls: [{ keys: ['SPACE'], desc: 'Bấm khi nút cam · dừng khi nút đỏ' }],
  duration: WINDOW + 900,
  minPlayers: 1,
  maxPlayers: 16,

  createConfig() {
    // các khoảng đèn đỏ rải đều, vị trí trong mỗi khoảng là ngẫu nhiên, độ dài ngắn dần
    const danger: { from: number; to: number }[] = [];
    const first = 2500;
    const slot = (WINDOW - first - 1200) / DANGER_COUNT;
    for (let i = 0; i < DANGER_COUNT; i++) {
      const len = Math.round(DANGER_LEN_START + ((DANGER_LEN_END - DANGER_LEN_START) * i) / (DANGER_COUNT - 1));
      const from = Math.round(first + i * slot + Math.random() * (slot - len));
      danger.push({ from, to: from + len });
    }
    return { windowMs: WINDOW, minIntervalMs: MIN_INTERVAL, danger };
  },

  createState(ctx) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) players[id] = { count: 0, rejected: 0, burned: 0, lastAt: 0, frozenUntil: 0 };
    return { players, lastBroadcast: 0 };
  },

  handleInput(ctx, state, config, playerId, input: GameInput) {
    if (input.type !== 'tap') return;
    const p = state.players[playerId];
    if (!p) return;
    const now = ctx.now();
    if (now < ctx.startAt || now > ctx.startAt + config.windowMs) return;
    if (now < p.frozenUntil || now - p.lastAt < config.minIntervalMs) {
      p.rejected += 1;
      return;
    }
    p.lastAt = now;

    const rel = now - ctx.startAt;
    if (config.danger.some((d) => rel >= d.from && rel <= d.to)) {
      p.burned += 1;
      p.count = Math.max(0, p.count - BURN_PENALTY); // nhấn lúc đèn đỏ rất đắt
      p.frozenUntil = now + BURN_FREEZE_MS;
      return;
    }
    p.count += 1;
  },

  update(ctx, state) {
    const now = ctx.now();
    if (now - state.lastBroadcast < 100) return;
    state.lastBroadcast = now;
    const counts: Record<string, number> = {};
    for (const id of ctx.playerIds) counts[id] = state.players[id].count;
    ctx.broadcast({ type: 'counts', counts });
  },

  isFinished(ctx, _state, config) {
    return ctx.now() >= ctx.startAt + config.windowMs;
  },

  calculateScore(ctx, state) {
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      out[id] = {
        raw: p.count,
        detail: `${p.count} lần${p.burned > 0 ? ` · ${p.burned} lỗi đèn đỏ` : ''}`,
      };
    }
    return out;
  },
};
