import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';

interface Config {
  window: number;
}

interface State {
  goAt: number; // server clock, never sent to clients before it fires
  announced: boolean;
  /** tín hiệu giả: nhấn lúc này = FALSE START */
  decoys: number[];
  decoyCursor: number;
  presses: Record<string, { at: number; falseStart: boolean } | undefined>;
}

const RESPONSE_WINDOW = 2200;

export const reactionGame: GameDefinition<Config, State> = {
  id: 'reaction',
  name: 'PHẢN XẠ NHANH',
  instructions:
    'Màn hình đang hiện "CHỜ...". Khi nào nó chuyển thành "CHẠY!" MÀU XANH thì nhấn SPACE thật nhanh. ' +
    'Ai nhấn nhanh nhất được nhiều điểm nhất. ' +
    'Cẩn thận: có 1-2 lần màn hình loé ĐỎ để lừa bạn - đó là tín hiệu giả, đừng nhấn. ' +
    'Nhấn trước khi có tín hiệu thật thì bị phạt 30 điểm!',
  controls: [{ keys: ['SPACE'], desc: 'Chỉ nhấn khi thấy chữ xanh' }],
  duration: 12_000,
  minPlayers: 1,
  maxPlayers: 16,

  createConfig() {
    return { window: RESPONSE_WINDOW };
  },

  createState(ctx) {
    // The wait is chosen server-side and stays secret until it fires.
    const wait = 2600 + Math.random() * 4600;
    const goAt = ctx.startAt + wait;

    // 1-2 tín hiệu giả nhấp nháy trước GO thật, cách GO thật ít nhất 600ms
    const decoys: number[] = [];
    const count = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const at = ctx.startAt + 900 + Math.random() * (wait - 1600);
      if (goAt - at > 600) decoys.push(at);
    }
    decoys.sort((a, b) => a - b);

    return { goAt, announced: false, decoys, decoyCursor: 0, presses: {} };
  },

  handleInput(ctx, state, _config, playerId, input: GameInput) {
    if (input.type !== 'press') return;
    if (state.presses[playerId]) return; // only the first press counts
    const now = ctx.now();
    const at = Math.min(Math.max(input.at, now - 250), now + 60);

    if (at < state.goAt) {
      state.presses[playerId] = { at, falseStart: true };
      ctx.broadcast({ type: 'press', playerId, falseStart: true, ms: 0 });
      return;
    }
    state.presses[playerId] = { at, falseStart: false };
    ctx.broadcast({ type: 'press', playerId, falseStart: false, ms: Math.round(at - state.goAt) });
  },

  update(ctx, state) {
    const now = ctx.now();
    while (state.decoyCursor < state.decoys.length && now >= state.decoys[state.decoyCursor]) {
      state.decoyCursor += 1;
      ctx.broadcast({ type: 'fake' });
    }
    if (!state.announced && now >= state.goAt) {
      state.announced = true;
      ctx.broadcast({ type: 'go', at: state.goAt });
    }
  },

  isFinished(ctx, state) {
    if (ctx.playerIds.every((id) => state.presses[id])) return true;
    return state.announced && ctx.now() > state.goAt + RESPONSE_WINDOW;
  },

  calculateScore(ctx, state) {
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.presses[id];
      if (!p) {
        out[id] = { raw: -500, detail: 'NO PRESS' };
        continue;
      }
      if (p.falseStart) {
        out[id] = { raw: -1000, detail: 'FALSE START' };
        continue;
      }
      const ms = Math.round(p.at - state.goAt);
      out[id] = { raw: Math.max(1, 3000 - ms), detail: `${ms} ms` };
    }
    return out;
  },
};
