import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';

interface Config {
  distance: number;
  hurdles: number[];
  jumpMs: number;
  speed: number; // đơn vị quãng đường mỗi giây
}

interface PState {
  pos: number;
  holding: 'L' | 'R' | 'N';
  holdAt: number; // lần cuối client xác nhận đang giữ phím
  jumpUntil: number;
  jumpCooldown: number;
  stunUntil: number;
  cleared: number; // chỉ số rào kế tiếp
  trips: number;
  finishedAt: number | null;
}

interface State {
  players: Record<string, PState>;
  lastTick: number;
  lastBroadcast: number;
}

const DISTANCE = 110;
const HURDLES = [18, 34, 50, 64, 79, 93];
const JUMP_MS = 520;
const SPEED = 12;
/** nếu quá lâu không nhận tín hiệu giữ phím thì coi như đã nhả (chống kẹt phím khi mất gói) */
const HOLD_TIMEOUT = 900;

export const raceGame: GameDefinition<Config, State> = {
  id: 'race',
  name: 'VƯỢT RÀO',
  instructions:
    'Cả phòng chạy chung một đường đua. GIỮ phím → để chạy tới, thả ra là đứng lại. ' +
    'Trên đường có 6 cái rào: khi sắp tới rào phải nhấn ↑ (hoặc SPACE) để nhảy qua. ' +
    'Đâm vào rào là vấp: đứng hình 1 giây, bị đẩy lùi lại VÀ VẪN PHẢI NHẢY QUA CÁI RÀO ĐÓ ' +
    '- không đi vòng được. Ai về đích trước thì thắng.',
  controls: [
    { keys: ['→'], desc: 'Giữ để chạy tới' },
    { keys: ['↑', 'SPACE'], desc: 'Nhảy qua rào' },
  ],
  duration: 45_000,
  minPlayers: 1,
  maxPlayers: 16,

  createConfig() {
    return { distance: DISTANCE, hurdles: HURDLES, jumpMs: JUMP_MS, speed: SPEED };
  },

  createState(ctx) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      players[id] = {
        pos: 0,
        holding: 'N',
        holdAt: 0,
        jumpUntil: 0,
        jumpCooldown: 0,
        stunUntil: 0,
        cleared: 0,
        trips: 0,
        finishedAt: null,
      };
    }
    return { players, lastTick: ctx.startAt, lastBroadcast: 0 };
  },

  handleInput(ctx, state, config, playerId, input: GameInput) {
    const p = state.players[playerId];
    if (!p || p.finishedAt !== null) return;
    const now = ctx.now();

    if (input.type === 'hold') {
      p.holding = input.dir;
      p.holdAt = now;
      return;
    }

    if (input.type === 'jump') {
      if (now < p.jumpCooldown || now < p.stunUntil) return;
      p.jumpUntil = now + config.jumpMs;
      p.jumpCooldown = now + config.jumpMs + 220;
      ctx.broadcast({ type: 'jump', playerId });
    }
  },

  update(ctx, state, config) {
    const now = ctx.now();
    const dt = Math.min(now - state.lastTick, 250) / 1000; // bỏ qua khoảng lag dài
    state.lastTick = now;
    if (dt <= 0) return;

    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (p.finishedAt !== null) continue;

      const holding = now - p.holdAt > HOLD_TIMEOUT ? 'N' : p.holding;
      if (now < p.stunUntil || holding === 'N') continue;

      p.pos = Math.max(0, p.pos + (holding === 'R' ? 1 : -0.7) * config.speed * dt);

      // Tới rào thì phải đang ở trên không. Vấp thì KHÔNG tính là đã qua rào:
      // người chơi bị đẩy lùi và vẫn phải nhảy qua đúng cái rào đó.
      while (p.cleared < config.hurdles.length && p.pos >= config.hurdles[p.cleared]) {
        if (now < p.jumpUntil) {
          p.cleared += 1; // đang bay, qua được
          continue;
        }
        p.trips += 1;
        p.stunUntil = now + 1000;
        p.pos = Math.max(0, config.hurdles[p.cleared] - 3.5);
        ctx.broadcast({ type: 'trip', playerId: id, at: config.hurdles[p.cleared] });
        break;
      }

      if (p.pos >= config.distance) {
        p.pos = config.distance;
        p.finishedAt = now;
        ctx.broadcast({ type: 'finish', playerId: id, ms: Math.round(now - ctx.startAt) });
      }
    }

    if (now - state.lastBroadcast < 100) return;
    state.lastBroadcast = now;
    const positions: Record<string, { pos: number; jumping: boolean; stunned: boolean; running: boolean }> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      positions[id] = {
        pos: Math.round(p.pos * 10) / 10,
        jumping: now < p.jumpUntil,
        stunned: now < p.stunUntil,
        running: p.finishedAt === null && now - p.holdAt <= HOLD_TIMEOUT && p.holding !== 'N',
      };
    }
    ctx.broadcast({ type: 'pos', positions });
  },

  isFinished(ctx, state) {
    return ctx.playerIds.every((id) => state.players[id].finishedAt !== null);
  },

  calculateScore(ctx, state, config) {
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (p.finishedAt !== null) {
        const ms = Math.round(p.finishedAt - ctx.startAt);
        out[id] = { raw: 1_000_000 - ms, detail: `${(ms / 1000).toFixed(2)}s · ${p.trips} vấp` };
      } else {
        out[id] = { raw: p.pos, detail: `${Math.round((p.pos / config.distance) * 100)}% quãng đường` };
      }
    }
    return out;
  },
};
