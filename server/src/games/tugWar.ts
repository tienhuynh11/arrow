import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';

interface Config {
  /** kéo tới ±GOAL là thắng */
  goal: number;
  minInterval: number;
  endsAt: number;
  teams: { A: string[]; B: string[] };
}

interface PState {
  pulls: number;
  rejected: number;
  lastAt: number;
}

interface State {
  players: Record<string, PState>;
  /** âm = đội A đang thắng, dương = đội B */
  rope: number;
  winner: 'A' | 'B' | null;
  lastBroadcast: number;
}

const GOAL = 150;
const MIN_INTERVAL = 45; // trần ~22 cú kéo/giây, giống các game spam khác
const DURATION = 40_000;
/** lực mỗi cú kéo, chia cho sĩ số để đội ít người không bị thiệt */
const PULL_POWER = 3.4;

export const tugWarGame: GameDefinition<Config, State> = {
  id: 'tug',
  name: 'KÉO CO - CHƯA CẬP NHẬT',
  instructions:
    'Chia hai đội XANH và ĐỎ. Nhấn SPACE thật nhanh để kéo dây về phía đội mình. Kéo qua vạch đối phương, hoặc hết giờ đang lấn hơn là thắng.',
  controls: [{ keys: ['SPACE'], desc: 'Bấm liên tục để kéo dây về phía đội mình' }],
  duration: DURATION + 2500,
  minPlayers: 2,
  maxPlayers: 16,

  createConfig(ctx) {
    // chia đội xen kẽ cho cân, xáo trước để không phải lúc nào cũng cùng một cặp
    const ids = [...ctx.playerIds];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const A: string[] = [];
    const B: string[] = [];
    ids.forEach((id, i) => (i % 2 === 0 ? A : B).push(id));
    return { goal: GOAL, minInterval: MIN_INTERVAL, endsAt: DURATION, teams: { A, B } };
  },

  createState(ctx) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) players[id] = { pulls: 0, rejected: 0, lastAt: 0 };
    return { players, rope: 0, winner: null, lastBroadcast: 0 };
  },

  handleInput(ctx, state, config, playerId, input: GameInput) {
    if (input.type !== 'pull') return;
    if (state.winner) return;
    const p = state.players[playerId];
    if (!p) return;
    const now = ctx.now();
    if (now - p.lastAt < config.minInterval) {
      p.rejected += 1;
      return;
    }
    p.lastAt = now;
    p.pulls += 1;

    const inA = config.teams.A.includes(playerId);
    const size = Math.max(1, (inA ? config.teams.A : config.teams.B).length);
    state.rope += (inA ? -1 : 1) * (PULL_POWER / size);
    state.rope = Math.max(-config.goal, Math.min(config.goal, state.rope));
  },

  update(ctx, state, config) {
    const now = ctx.now();
    if (!state.winner) {
      if (state.rope <= -config.goal) state.winner = 'A';
      else if (state.rope >= config.goal) state.winner = 'B';
      if (state.winner) ctx.broadcast({ type: 'win', team: state.winner });
    }
    if (now - state.lastBroadcast < 80) return;
    state.lastBroadcast = now;
    ctx.broadcast({ type: 'rope', rope: Math.round(state.rope * 10) / 10 });
  },

  isFinished(ctx, state, config) {
    return state.winner !== null || ctx.now() - ctx.startAt >= config.endsAt;
  },

  calculateScore(ctx, state, config) {
    const winner: 'A' | 'B' = state.winner ?? (state.rope <= 0 ? 'A' : 'B');
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      const inA = config.teams.A.includes(id);
      const team: 'A' | 'B' = inA ? 'A' : 'B';
      const won = team === winner;
      // đội thắng luôn xếp trên; trong cùng đội thì ai kéo nhiều hơn xếp trước
      out[id] = {
        raw: (won ? 100_000 : 0) + p.pulls,
        detail: `${team === 'A' ? 'đội XANH' : 'đội ĐỎ'} · ${p.pulls} cú kéo · ${won ? 'THẮNG' : 'thua'}`,
      };
    }
    return out;
  },
};
