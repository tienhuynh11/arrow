import { randomBytes } from 'node:crypto';
import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import { isCorrect, loadPlayable, type Question } from '../quiz/store.js';

interface Config {
  key: string;
  total: number;
  resultMs: number;
  quizVersion: 1;
}

interface Ans {
  text: string;
  ok: boolean;
  pts: number;
  at: number;
}

interface State {
  questions: Question[];
  idx: number;
  phase: 'ask' | 'result';
  qStart: number;
  qEnd: number; // mốc hết giờ danh nghĩa của câu
  resultAt: number; // lúc bắt đầu pha result
  nextAt: number;
  answers: Map<string, Ans>;
  scores: Record<string, number>;
  correct: Record<string, number>;
  started: boolean;
  lastResend: number;
}

const RESULT_MS = 5000;
const MAX_QUESTIONS = 8;
const DEFAULT_SECONDS = 25;
const MAX_SECONDS = 120;
const RESEND_MS = 2000;
const MAX_TEXT = 120;
const SLACK_MS = 3000;
const KEEP_MS = 60 * 60 * 1000;

const secondsOf = (q: Question) => Math.min(MAX_SECONDS, Math.max(1, q.seconds || DEFAULT_SECONDS));

/** bản đầy đủ (có đáp án) giữ ở server, config gửi client không chứa câu hỏi */
const store = new Map<string, { questions: Question[]; at: number }>();
/** bộ câu hỏi chuẩn bị sẵn khi Room đọc `duration` (ngay trước createConfig, cùng một tick) */
let pending: Question[] | null = null;

function purgeOld() {
  const now = Date.now();
  for (const [k, v] of store) if (now - v.at > KEEP_MS) store.delete(k);
}

function selectQuestions(): Question[] {
  const all = loadPlayable().slice();
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, MAX_QUESTIONS);
}

const totalDuration = (qs: Question[]) => qs.reduce((s, q) => s + secondsOf(q) * 1000 + RESULT_MS, 0) + SLACK_MS;

function publicQ(s: State, i: number) {
  const q = s.questions[i];
  return {
    type: 'q',
    i,
    total: s.questions.length,
    text: q.text,
    ...(q.image ? { image: q.image } : {}),
    ...(q.audio ? { audio: q.audio } : {}),
    ...(q.video ? { video: q.video } : {}),
    seconds: secondsOf(q),
    startAt: s.qStart,
    endAt: s.qEnd,
    len: q.answers[0].length,
  };
}

function resultPayload(s: State, ctxPlayers: string[]) {
  const q = s.questions[s.idx];
  const rows = ctxPlayers.map((id) => {
    const a = s.answers.get(id);
    return a
      ? { id, text: a.text, ok: a.ok, pts: a.pts, ms: Math.max(0, Math.round(a.at - s.qStart)) }
      : { id, text: '', ok: false, pts: 0, ms: 0 };
  });
  return { type: 'result', i: s.idx, answer: q.answers[0], accepted: q.answers, rows, scores: { ...s.scores }, nextAt: s.nextAt };
}

function startQuestion(ctx: Parameters<GameDefinition['update']>[0], s: State, i: number, at: number) {
  s.idx = i;
  s.phase = 'ask';
  s.qStart = at;
  s.qEnd = at + secondsOf(s.questions[i]) * 1000;
  s.answers = new Map();
  s.lastResend = ctx.now();
  ctx.broadcast(publicQ(s, i));
}

function startResult(ctx: Parameters<GameDefinition['update']>[0], s: State) {
  const now = ctx.now();
  s.phase = 'result';
  s.resultAt = now;
  s.nextAt = now + RESULT_MS;
  s.lastResend = now;
  ctx.broadcast(resultPayload(s, ctx.playerIds));
}

export const quizGame: GameDefinition<Config, State> = {
  id: 'quiz',
  name: 'QUIZ ĐOÁN NHANH',
  instructions:
    'Xem ảnh, nghe nhạc hoặc xem video rồi gõ đáp án và nhấn ENTER để chốt. Chỉ được chốt một lần mỗi câu, phải khớp chính xác (không phân biệt hoa/thường). Đúng và chốt càng sớm càng nhiều điểm.',
  controls: [
    { keys: ['GÕ'], desc: 'Nhập đáp án' },
    { keys: ['ENTER'], desc: 'Chốt đáp án' },
  ],
  /** thời lượng tối đa phụ thuộc bộ câu đã chọn nên là getter (Room đọc ngay trước createConfig) */
  get duration() {
    pending = selectQuestions();
    return totalDuration(pending);
  },
  minPlayers: 1,
  maxPlayers: 16,

  createConfig() {
    const qs = pending ?? selectQuestions();
    pending = null;
    purgeOld();
    const key = randomBytes(12).toString('hex');
    store.set(key, { questions: qs, at: Date.now() });
    return { key, total: qs.length, resultMs: RESULT_MS, quizVersion: 1 };
  },

  createState(ctx, config) {
    const questions = store.get(config.key)?.questions ?? selectQuestions();
    const scores: Record<string, number> = {};
    const correct: Record<string, number> = {};
    for (const id of ctx.playerIds) {
      scores[id] = 0;
      correct[id] = 0;
    }
    return {
      questions,
      idx: 0,
      phase: 'ask',
      qStart: ctx.startAt,
      qEnd: ctx.startAt,
      resultAt: 0,
      nextAt: 0,
      answers: new Map(),
      scores,
      correct,
      started: false,
      lastResend: 0,
    };
  },

  handleInput(ctx, s, _config, playerId, input: GameInput) {
    if (input.type !== 'answer') return;
    if (!s.started || s.phase !== 'ask' || s.idx >= s.questions.length) return;
    if (!(playerId in s.scores)) return;
    if (s.answers.has(playerId)) return;
    if (typeof input.text !== 'string') return;
    const now = ctx.now();
    const text = input.text.slice(0, MAX_TEXT);
    const q = s.questions[s.idx];
    const ok = isCorrect(q, text);
    let pts = 0;
    if (ok) {
      const total = s.qEnd - s.qStart;
      const frac = total > 0 ? Math.min(1, Math.max(0, (s.qEnd - now) / total)) : 0;
      pts = Math.round(300 + 700 * frac);
      s.scores[playerId] += pts;
      s.correct[playerId] += 1;
    }
    s.answers.set(playerId, { text, ok, pts, at: now });
    ctx.broadcast({ type: 'prog', i: s.idx, ids: [...s.answers.keys()], total: ctx.playerIds.length });
    ctx.send(playerId, { type: 'ack', i: s.idx, text });
  },

  update(ctx, s) {
    const now = ctx.now();
    if (s.idx >= s.questions.length) return;
    if (!s.started) {
      s.started = true;
      startQuestion(ctx, s, 0, ctx.startAt);
      return;
    }
    if (s.phase === 'ask') {
      const all = ctx.playerIds.every((id) => s.answers.has(id));
      if (now >= s.qEnd || all) {
        startResult(ctx, s);
      } else if (now - s.lastResend >= RESEND_MS) {
        s.lastResend = now;
        ctx.broadcast(publicQ(s, s.idx));
      }
      return;
    }
    // pha result
    if (now >= s.nextAt) {
      const next = s.idx + 1;
      if (next >= s.questions.length) {
        s.idx = next;
      } else {
        startQuestion(ctx, s, next, s.nextAt);
      }
    } else if (now - s.lastResend >= RESEND_MS) {
      s.lastResend = now;
      ctx.broadcast(resultPayload(s, ctx.playerIds));
    }
  },

  isFinished(_ctx, s) {
    return s.started && s.idx >= s.questions.length;
  },

  calculateScore(ctx, s, config) {
    store.delete(config.key);
    const out: Record<string, PlayerResult> = {};
    const n = s.questions.length;
    for (const id of ctx.playerIds) {
      const p = s.scores[id] ?? 0;
      out[id] = { raw: p, detail: `đúng ${s.correct[id] ?? 0}/${n} · ${p} điểm` };
    }
    return out;
  },
};
