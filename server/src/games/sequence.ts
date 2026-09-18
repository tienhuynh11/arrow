import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';

type Key = 'L' | 'U' | 'R' | 'D';

interface Config {
  rounds: Key[][];
  penaltyMs: number;
}

interface PState {
  round: number;
  index: number;
  errors: number;
  timeouts: number;
  lockedUntil: number;
  finishedAt: number | null;
  lastInputAt: number;
  lastProgressAt: number;
}

interface State {
  players: Record<string, PState>;
}

const KEYS: Key[] = ['L', 'U', 'R', 'D'];
const PENALTY = 650;
const ROUNDS = 5;
/** chần chừ quá lâu giữa hai phím là mất chuỗi - ép phải bấm liên tục */
const IDLE_RESET = 1300;

export const sequenceGame: GameDefinition<Config, State> = {
  id: 'sequence',
  name: 'GÕ ĐÚNG CHUỖI',
  instructions:
    'Màn hình hiện một dãy mũi tên. Bấm phím mũi tên theo đúng thứ tự từ trái sang phải. ' +
    'Bấm sai một phím là phải gõ lại CẢ DÃY từ đầu, đồng thời bị khoá phím 0.65 giây. ' +
    'Dừng quá 1.3 giây giữa hai phím cũng bị tính là làm lại từ đầu, nên phải gõ liên tục. ' +
    'Có 5 dãy, dài dần từ 5 đến 9 phím. Ai gõ xong cả 5 dãy sớm nhất thì thắng.',
  controls: [{ keys: ['←', '↑', '→', '↓'], desc: 'Gõ theo đúng thứ tự trên màn hình' }],
  duration: 34_000,
  minPlayers: 1,
  maxPlayers: 16,

  createConfig() {
    const rounds: Key[][] = [];
    for (let r = 0; r < ROUNDS; r++) {
      const len = 5 + r; // 5, 6, 7, 8, 9 - chuỗi sau dài hơn hẳn
      const seq: Key[] = [];
      for (let i = 0; i < len; i++) {
        let k = KEYS[Math.floor(Math.random() * KEYS.length)];
        // tránh ba phím giống nhau liên tiếp cho đỡ nhàm
        if (i >= 2 && seq[i - 1] === k && seq[i - 2] === k) {
          k = KEYS[(KEYS.indexOf(k) + 1) % KEYS.length];
        }
        seq.push(k);
      }
      rounds.push(seq);
    }
    return { rounds, penaltyMs: PENALTY };
  },

  createState(ctx) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      players[id] = {
        round: 0,
        index: 0,
        errors: 0,
        timeouts: 0,
        lockedUntil: 0,
        finishedAt: null,
        lastInputAt: 0,
        lastProgressAt: 0,
      };
    }
    return { players };
  },

  handleInput(ctx, state, config, playerId, input: GameInput) {
    if (input.type !== 'key') return;
    const p = state.players[playerId];
    if (!p || p.finishedAt !== null) return;
    const now = ctx.now();
    if (now < p.lockedUntil) return;
    if (now - p.lastInputAt < 45) return; // rate limit
    p.lastInputAt = now;

    const expected = config.rounds[p.round][p.index];
    const ok = input.key === expected;
    if (ok) {
      p.index += 1;
      p.lastProgressAt = now;
      if (p.index >= config.rounds[p.round].length) {
        p.round += 1;
        p.index = 0;
        if (p.round >= config.rounds.length) p.finishedAt = now;
      }
    } else {
      p.errors += 1;
      p.index = 0;
      p.lockedUntil = now + config.penaltyMs;
    }

    ctx.broadcast({
      type: 'progress',
      playerId,
      round: p.round,
      index: p.index,
      errors: p.errors,
      done: p.finishedAt !== null,
      ok,
    });
  },

  update(ctx, state) {
    // ai dừng giữa chuỗi quá lâu thì mất tiến độ chuỗi đó
    const now = ctx.now();
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (p.finishedAt !== null || p.index === 0) continue;
      if (now < p.lockedUntil) continue;
      if (now - p.lastProgressAt > IDLE_RESET) {
        p.index = 0;
        p.timeouts += 1;
        p.lastProgressAt = now;
        ctx.broadcast({ type: 'progress', playerId: id, round: p.round, index: 0, errors: p.errors, done: false, ok: false, timeout: true });
      }
    }
  },

  isFinished(ctx, state) {
    return ctx.playerIds.every((id) => state.players[id].finishedAt !== null);
  },

  calculateScore(ctx, state, config) {
    const total = config.rounds.reduce((a, r) => a + r.length, 0);
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (p.finishedAt !== null) {
        const ms = Math.round(p.finishedAt - ctx.startAt);
        out[id] = {
          raw: 1_000_000 - ms,
          detail: `${(ms / 1000).toFixed(2)}s · ${p.errors} lỗi${p.timeouts ? ` · ${p.timeouts} trễ` : ''}`,
        };
      } else {
        const done = config.rounds.slice(0, p.round).reduce((a, r) => a + r.length, 0) + p.index;
        out[id] = { raw: done, detail: `${done}/${total} phím` };
      }
    }
    return out;
  },
};
