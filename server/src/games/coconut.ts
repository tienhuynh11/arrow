import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';

interface Wind {
  /** offset từ startAt: bắt đầu lắc / ngừng lắc. Client cảnh báo trước WARN_MS */
  from: number;
  to: number;
}

interface Config {
  durationMs: number;
  /** số lần bấm luân phiên để leo hết một cây rồi hái được 1 quả */
  climbTo: number;
  winds: Wind[];
  warnMs: number;
  stunMs: number;
  /** số nấc bị trượt xuống mỗi lần leo nhầm lúc gió lắc */
  slip: number;
  minIntervalMs: number;
}

interface PState {
  height: number;
  coconuts: number;
  slips: number;
  lastSide: 'L' | 'R' | null;
  lastAt: number;
  stunnedUntil: number;
  rejected: number;
}

interface State {
  players: Record<string, PState>;
  lastBroadcast: number;
}

const DURATION = 38_000;
const CLIMB_TO = 40;
/** trần ~14 lần bấm/giây, giống các game spam khác (chống auto-click) */
const MIN_INTERVAL = 70;
const WIND_LEN = 1300;
const WARN_MS = 600;
const STUN_MS = 900;
/** gió lắc mà vẫn leo thì bị trượt xuống chừng này nấc (đủ đau để buông tay còn lợi hơn liều) */
const SLIP = 10;

export const coconutGame: GameDefinition<Config, State> = {
  id: 'coconut',
  name: 'HÁI DỪA - CHƯA CẬP NHẬT',
  instructions:
    'Bấm luân phiên ← → để leo cây và hái dừa. Gió lắc thì BUÔNG TAY, lỡ leo là bị tụt xuống. Hái nhiều dừa nhất thắng.',
  controls: [
    { keys: ['←', '→'], desc: 'Bấm luân phiên để leo · buông tay khi gió lắc' },
  ],
  duration: DURATION + 900,
  minPlayers: 1,
  maxPlayers: 16,

  createConfig() {
    // lịch gió tính sẵn từ giờ trên server, client chỉ đọc nên ai cũng thấy đúng cùng một lịch
    const winds: Wind[] = [];
    let from = 3500;
    while (from + WIND_LEN < DURATION - 1500) {
      winds.push({ from: Math.round(from), to: Math.round(from + WIND_LEN) });
      from += WIND_LEN + 2000 + Math.random() * 1300;
    }
    return {
      durationMs: DURATION,
      climbTo: CLIMB_TO,
      winds,
      warnMs: WARN_MS,
      stunMs: STUN_MS,
      slip: SLIP,
      minIntervalMs: MIN_INTERVAL,
    };
  },

  createState(ctx) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      players[id] = { height: 0, coconuts: 0, slips: 0, lastSide: null, lastAt: 0, stunnedUntil: 0, rejected: 0 };
    }
    return { players, lastBroadcast: 0 };
  },

  handleInput(ctx, state, config, playerId, input: GameInput) {
    if (input.type !== 'climb') return;
    if (input.side !== 'L' && input.side !== 'R') return;
    const p = state.players[playerId];
    if (!p) return;
    const now = ctx.now();
    if (now < ctx.startAt || now > ctx.startAt + config.durationMs) return;
    if (now < p.stunnedUntil) return; // đang choáng
    if (now - p.lastAt < config.minIntervalMs) {
      p.rejected += 1;
      return;
    }
    p.lastAt = now;

    const rel = now - ctx.startAt;
    if (config.winds.some((w) => rel >= w.from && rel <= w.to)) {
      p.slips += 1;
      p.height = Math.max(0, p.height - config.slip);
      p.stunnedUntil = now + config.stunMs;
      p.lastSide = null;
      ctx.broadcast({ type: 'slip', playerId });
      return;
    }

    // phải bấm LUÂN PHIÊN: bấm lặp lại cùng một phía không leo thêm
    if (input.side === p.lastSide) return;
    p.lastSide = input.side;
    p.height += 1;
    if (p.height >= config.climbTo) {
      p.height = 0;
      p.coconuts += 1;
      ctx.broadcast({ type: 'harvest', playerId, coconuts: p.coconuts });
    }
  },

  update(ctx, state) {
    const now = ctx.now();
    if (now - state.lastBroadcast < 150) return;
    state.lastBroadcast = now;
    const snap: Record<string, { h: number; c: number; s: boolean }> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      snap[id] = { h: p.height, c: p.coconuts, s: now < p.stunnedUntil };
    }
    ctx.broadcast({ type: 'snap', players: snap });
  },

  isFinished(ctx, _state, config) {
    return ctx.now() >= ctx.startAt + config.durationMs;
  },

  calculateScore(ctx, state) {
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      // số dừa là chính; chiều cao dở dang chỉ để phân hạng khi hoà dừa
      out[id] = {
        raw: p.coconuts * 1000 + p.height * 10,
        detail: `${p.coconuts} quả dừa${p.slips > 0 ? ` · ${p.slips} lần trượt` : ''}`,
      };
    }
    return out;
  },
};
