import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';

interface Config {
  rounds: number;
  window: number;
}

interface Press {
  at: number;
  falseStart: boolean;
  ms: number;
  points: number;
}

/** lịch của một vòng, tính sẵn lúc tạo ván nhưng KHÔNG gửi cho client (GO phải bất ngờ) */
interface RoundPlan {
  startAt: number;
  goAt: number;
  endAt: number;
  /** tín hiệu giả: nhấn lúc này = FALSE START */
  decoys: number[];
}

interface State {
  plan: RoundPlan[];
  /** vòng đang diễn ra (-1 = chưa bắt đầu) */
  current: number;
  announced: boolean;
  decoyCursor: number;
  presses: Record<string, Press | undefined>[];
}

const ROUNDS = 6;
const RESPONSE_WINDOW = 1500;
const FIRST_DELAY = 1200;
/** nghỉ giữa hai vòng để mọi người kịp nhìn kết quả */
const GAP = 1000;
const WAIT_MIN = 1800;
const WAIT_MAX = 3600;
/** điểm mỗi vòng: nhanh hơn thì nhiều hơn; nhấn sớm bị phạt */
const MAX_POINTS = 1000;
const FALSE_START_PENALTY = 400;

export const reactionGame: GameDefinition<Config, State> = {
  id: 'reaction',
  name: 'PHẢN XẠ NHANH - CHƯA CẬP NHẬT',
  instructions:
    'Khi chữ chuyển XANH "CHẠY!" thì nhấn SPACE thật nhanh. Tín hiệu ĐỎ là giả, đừng nhấn: nhấn sớm bị trừ điểm. Điểm các vòng cộng dồn.',
  controls: [{ keys: ['SPACE'], desc: 'Chỉ nhấn khi thấy chữ xanh' }],
  // vòng nào cũng chờ lâu nhất: FIRST_DELAY + ROUNDS × (WAIT_MAX + RESPONSE_WINDOW + GAP)
  duration: FIRST_DELAY + ROUNDS * (WAIT_MAX + RESPONSE_WINDOW + GAP) + 1500,
  minPlayers: 1,
  maxPlayers: 16,

  createConfig() {
    return { rounds: ROUNDS, window: RESPONSE_WINDOW };
  },

  createState(ctx) {
    // Thời gian chờ của mọi vòng được chọn từ giờ trên server và giữ bí mật cho tới khi bắn.
    const plan: RoundPlan[] = [];
    let start = ctx.startAt + FIRST_DELAY;
    for (let r = 0; r < ROUNDS; r++) {
      const wait = WAIT_MIN + Math.random() * (WAIT_MAX - WAIT_MIN);
      const goAt = start + wait;

      // tín hiệu giả nhấp nháy trước GO thật (cách GO ít nhất 600ms); các vòng sau lừa nhiều hơn
      const decoys: number[] = [];
      const count = r === 0 ? 0 : r < 3 ? (Math.random() < 0.6 ? 1 : 0) : 1 + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const at = start + 700 + Math.random() * Math.max(1, wait - 1500);
        if (goAt - at > 600) decoys.push(at);
      }
      decoys.sort((a, b) => a - b);

      const endAt = goAt + RESPONSE_WINDOW;
      plan.push({ startAt: start, goAt, endAt, decoys });
      start = endAt + GAP;
    }
    return { plan, current: -1, announced: false, decoyCursor: 0, presses: plan.map(() => ({})) };
  },

  handleInput(ctx, state, _config, playerId, input: GameInput) {
    if (input.type !== 'press') return;
    const r = state.current;
    if (r < 0) return;
    const round = state.plan[r];
    const now = ctx.now();
    if (now > round.endAt) return; // đang nghỉ giữa hai vòng: không tính
    if (state.presses[r][playerId]) return; // mỗi vòng chỉ lần nhấn đầu tiên được tính

    const at = Math.min(Math.max(input.at, now - 250), now + 60);
    let press: Press;
    if (at < round.goAt) {
      press = { at, falseStart: true, ms: 0, points: -FALSE_START_PENALTY };
    } else {
      const ms = Math.round(at - round.goAt);
      press = { at, falseStart: false, ms, points: Math.max(1, MAX_POINTS - ms) };
    }
    state.presses[r][playerId] = press;
    ctx.broadcast({ type: 'press', round: r, playerId, falseStart: press.falseStart, ms: press.ms, points: press.points });
  },

  update(ctx, state) {
    const now = ctx.now();
    const next = state.current + 1;
    // sang vòng mới: báo cho client dọn đèn và đưa nhân vật về vạch
    if (next < state.plan.length && now >= state.plan[next].startAt) {
      state.current = next;
      state.announced = false;
      state.decoyCursor = 0;
      ctx.broadcast({ type: 'round', index: next, total: state.plan.length });
    }
    const r = state.current;
    if (r < 0) return;
    const round = state.plan[r];
    while (state.decoyCursor < round.decoys.length && now >= round.decoys[state.decoyCursor]) {
      state.decoyCursor += 1;
      ctx.broadcast({ type: 'fake', round: r });
    }
    if (!state.announced && now >= round.goAt) {
      state.announced = true;
      ctx.broadcast({ type: 'go', round: r, at: round.goAt });
    }
  },

  isFinished(ctx, state) {
    const last = state.plan[state.plan.length - 1];
    if (ctx.now() > last.endAt) return true;
    // vòng cuối: ai cũng nhấn rồi thì kết thúc luôn
    return state.current === state.plan.length - 1 && state.announced && ctx.playerIds.every((id) => state.presses[state.current][id]);
  },

  calculateScore(ctx, state) {
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      let total = 0;
      let fast = 0;
      let msSum = 0;
      let falseStarts = 0;
      let missed = 0;
      for (const round of state.presses) {
        const p = round[id];
        if (!p) {
          missed += 1;
        } else if (p.falseStart) {
          falseStarts += 1;
          total += p.points;
        } else {
          fast += 1;
          msSum += p.ms;
          total += p.points;
        }
      }
      const avg = fast > 0 ? `${Math.round(msSum / fast)} ms TB` : 'không có lần nào hợp lệ';
      const extras = `${falseStarts ? ` · ${falseStarts} lần nhấn sớm` : ''}${missed ? ` · ${missed} vòng bỏ lỡ` : ''}`;
      out[id] = { raw: total, detail: `${total} điểm · ${avg}${extras}` };
    }
    return out;
  },
};
