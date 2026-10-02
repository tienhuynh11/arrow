import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';

interface Question {
  text: string; // "17 + 8"
  options: number[]; // 4 ô đáp án, theo thứ tự trái → phải
  answer: number; // index của ô đúng
  deadline: number; // offset từ startAt, hết giờ thì sang câu sau
}

interface Config {
  questions: Question[];
  lanes: number;
}

interface PState {
  cell: number;
  answeredAt: number[]; // theo index câu hỏi, -1 = chưa trả lời
  correct: number;
  wrong: number;
  points: number;
  lockedUntil: number;
  lastMoveAt: number;
}

interface State {
  players: Record<string, PState>;
  index: number; // câu hỏi hiện tại
  announced: number; // câu hỏi cuối đã broadcast
  /** số người đã chốt ĐÚNG ở câu hiện tại - dùng để thưởng người nhanh nhất */
  correctLocks: number;
}

const QUESTION_COUNT = 8;
const LANES = 4;
const TIME_START = 5200;
const TIME_END = 3000;
const WRONG_LOCK = 700;
/** thưởng thêm theo thứ tự chốt đúng: nhanh nhất ăn đậm nhất */
const ORDER_BONUS = [60, 35, 20, 10];

const rndInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

/** Sinh một câu hỏi khó dần: câu càng sau số càng lớn và có thể có 3 số hạng. */
function makeQuestion(i: number, startOffset: number): Question {
  const level = i / (QUESTION_COUNT - 1);
  const cap = Math.round(9 + level * 45); // 9 → 54
  let text: string;
  let value: number;

  if (i >= 4 && Math.random() < 0.45) {
    // ba số hạng cho các câu cuối
    const a = rndInt(5, cap);
    const b = rndInt(2, Math.max(3, Math.round(cap / 2)));
    const c = rndInt(2, Math.max(3, Math.round(cap / 2)));
    if (Math.random() < 0.5) {
      value = a + b - c;
      text = `${a} + ${b} - ${c}`;
    } else {
      value = a - b + c;
      text = `${a} - ${b} + ${c}`;
    }
  } else if (Math.random() < 0.5) {
    const a = rndInt(3, cap);
    const b = rndInt(2, cap);
    value = a + b;
    text = `${a} + ${b}`;
  } else {
    const a = rndInt(6, cap + 10);
    const b = rndInt(2, a - 1); // không cho kết quả âm
    value = a - b;
    text = `${a} - ${b}`;
  }

  // các đáp án nhiễu nằm sát kết quả đúng nên không thể đoán bừa
  const options = new Set<number>([value]);
  while (options.size < LANES) {
    const delta = rndInt(1, 6) * (Math.random() < 0.5 ? -1 : 1);
    const candidate = value + delta;
    if (candidate >= 0) options.add(candidate);
  }
  const shuffled = [...options].sort(() => Math.random() - 0.5);
  const time = Math.round(TIME_START + (TIME_END - TIME_START) * level);

  return { text, options: shuffled, answer: shuffled.indexOf(value), deadline: startOffset + time };
}

export const mathRushGame: GameDefinition<Config, State> = {
  id: 'math',
  name: 'TÍNH NHANH - CHƯA CẬP NHẬT',
  instructions:
    'Tính nhẩm phép tính, chạy ← → sang ô đáp án đúng rồi nhấn SPACE để chốt. Chốt đúng càng sớm càng nhiều điểm, sai bị trừ điểm.',
  controls: [
    { keys: ['←', '→'], desc: 'Chạy sang ô đáp án' },
    { keys: ['SPACE'], desc: 'Chốt đáp án' },
  ],
  duration: 48_000,
  minPlayers: 1,
  maxPlayers: 16,

  createConfig() {
    const questions: Question[] = [];
    let offset = 1200;
    for (let i = 0; i < QUESTION_COUNT; i++) {
      const q = makeQuestion(i, offset);
      questions.push(q);
      offset = q.deadline + 900; // nghỉ ngắn giữa hai câu
    }
    return { questions, lanes: LANES };
  },

  createState(ctx) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      players[id] = {
        cell: Math.floor(LANES / 2) - 1,
        answeredAt: new Array(QUESTION_COUNT).fill(-1),
        correct: 0,
        wrong: 0,
        points: 0,
        lockedUntil: 0,
        lastMoveAt: 0,
      };
    }
    return { players, index: 0, announced: -1, correctLocks: 0 };
  },

  handleInput(ctx, state, config, playerId, input: GameInput) {
    const p = state.players[playerId];
    if (!p) return;
    const now = ctx.now();
    const q = config.questions[state.index];
    if (!q) return;
    if (now < p.lockedUntil) return;

    if (input.type === 'move') {
      if (now - p.lastMoveAt < 70) return; // rate limit
      p.lastMoveAt = now;
      const next = p.cell + (input.dir === 'L' ? -1 : 1);
      if (next < 0 || next >= config.lanes) return;
      p.cell = next;
      ctx.broadcast({ type: 'move', playerId, cell: p.cell });
      return;
    }

    if (input.type !== 'lock') return;
    if (p.answeredAt[state.index] !== -1) return; // mỗi câu chỉ chốt một lần
    p.answeredAt[state.index] = now;

    const ok = p.cell === q.answer;
    let order = 0;
    let gained = 0;
    if (ok) {
      // điểm = nền + thưởng theo thời gian còn lại + thưởng theo thứ tự chốt đúng
      const remain = Math.max(0, q.deadline - (now - ctx.startAt));
      const opensAt = state.index === 0 ? 1200 : config.questions[state.index - 1].deadline + 900;
      const span = q.deadline - opensAt;
      const speed = span > 0 ? Math.min(1, remain / span) : 0;
      order = ++state.correctLocks;
      gained = 100 + Math.round(speed * 60) + (ORDER_BONUS[order - 1] ?? 0);
      p.correct += 1;
      p.points += gained;
    } else {
      p.wrong += 1;
      gained = -Math.min(25, p.points);
      p.points = Math.max(0, p.points - 25);
      p.lockedUntil = now + WRONG_LOCK;
    }
    ctx.broadcast({ type: 'lock', playerId, cell: p.cell, ok, order, gained });
  },

  update(ctx, state, config) {
    const rel = ctx.now() - ctx.startAt;

    if (state.announced < state.index) {
      state.announced = state.index;
      ctx.broadcast({ type: 'question', index: state.index, deadline: config.questions[state.index].deadline });
    }

    const q = config.questions[state.index];
    if (!q) return;

    const everyoneAnswered = ctx.playerIds.every((id) => state.players[id].answeredAt[state.index] !== -1);
    if (rel > q.deadline || everyoneAnswered) {
      ctx.broadcast({ type: 'reveal', index: state.index, answer: q.answer });
      state.index += 1;
      state.correctLocks = 0;
    }
  },

  isFinished(ctx, state, config) {
    return state.index >= config.questions.length;
  },

  calculateScore(ctx, state) {
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      out[id] = { raw: p.points, detail: `${p.correct} đúng · ${p.wrong} sai · ${p.points} pts` };
    }
    return out;
  },
};
