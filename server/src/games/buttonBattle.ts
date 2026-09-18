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
}

interface State {
  players: Record<string, PState>;
  lastBroadcast: number;
}

const WINDOW = 7000;
const MIN_INTERVAL = 45; // caps at ~22 valid taps/sec
const DANGER_LEN = 620;

export const buttonBattleGame: GameDefinition<Config, State> = {
  id: 'button',
  name: 'BẤM NHANH TAY',
  instructions:
    'Trong 7 giây, nhấn SPACE càng nhiều lần càng tốt. ' +
    'NHƯNG nút sẽ chuyển sang màu ĐỎ 3 lần trong ván - lúc đó phải DỪNG TAY ngay, ' +
    'vì mỗi lần lỡ nhấn khi nút đỏ sẽ bị trừ 3 lượt. ' +
    'Nhấn nhanh hơn 22 lần mỗi giây thì máy không tính (chống bấm tự động). ' +
    'Ai có nhiều lượt hợp lệ nhất thì thắng.',
  controls: [{ keys: ['SPACE'], desc: 'Bấm khi nút cam · dừng khi nút đỏ' }],
  duration: WINDOW + 900,
  minPlayers: 1,
  maxPlayers: 16,

  createConfig() {
    // 3 khoảng đèn đỏ rải đều, vị trí trong mỗi khoảng là ngẫu nhiên
    const danger: { from: number; to: number }[] = [];
    const slot = (WINDOW - 1200) / 3;
    for (let i = 0; i < 3; i++) {
      const from = Math.round(1200 + i * slot + Math.random() * (slot - DANGER_LEN));
      danger.push({ from, to: from + DANGER_LEN });
    }
    return { windowMs: WINDOW, minIntervalMs: MIN_INTERVAL, danger };
  },

  createState(ctx) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) players[id] = { count: 0, rejected: 0, burned: 0, lastAt: 0 };
    return { players, lastBroadcast: 0 };
  },

  handleInput(ctx, state, config, playerId, input: GameInput) {
    if (input.type !== 'tap') return;
    const p = state.players[playerId];
    if (!p) return;
    const now = ctx.now();
    if (now < ctx.startAt || now > ctx.startAt + config.windowMs) return;
    if (now - p.lastAt < config.minIntervalMs) {
      p.rejected += 1;
      return;
    }
    p.lastAt = now;

    const rel = now - ctx.startAt;
    if (config.danger.some((d) => rel >= d.from && rel <= d.to)) {
      p.burned += 1;
      p.count = Math.max(0, p.count - 3); // nhấn lúc đèn đỏ rất đắt
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
