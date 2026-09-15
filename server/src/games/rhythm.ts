import type { GameDefinition, PlayerResult } from './types';
import type { GameInput, Judgement } from '../../../shared/protocol';

export type NoteType = 'normal' | 'gold' | 'trap';

interface Note {
  t: number; // offset từ startAt
  /** 0 = làn dưới (SPACE) · 1 = làn trên (↑) */
  lane: 0 | 1;
  type: NoteType;
}

interface Config {
  notes: Note[];
  windows: { perfect: number; great: number; good: number };
  bpmStart: number;
  bpmEnd: number;
}

interface PState {
  score: number;
  combo: number;
  maxCombo: number;
  hitCount: number;
  golds: number;
  traps: number;
  consumed: Set<number>;
  lastInputAt: number;
}

interface State {
  players: Record<string, PState>;
  cursor: number;
}

const WINDOWS = { perfect: 45, great: 90, good: 145 };
const POINTS: Record<Judgement, number> = { PERFECT: 100, GREAT: 70, GOOD: 40, MISS: 0, TRAP: 0 };
const TRAP_PENALTY = 70;

const NOTE_COUNT = 38;
const INTERVAL_START = 560;
const INTERVAL_END = 310;

export const rhythmGame: GameDefinition<Config, State> = {
  id: 'rhythm',
  name: 'BẮT NHỊP',
  instructions:
    'Có HAI làn nốt chạy từ phải sang: làn DƯỚI bấm SPACE, làn TRÊN bấm ↑. ' +
    'Khi nốt đi vào vùng vàng ở giữa thì bấm đúng phím của làn đó. ' +
    'Trúng sát tâm được nhiều điểm hơn, trúng liên tiếp lên COMBO nhân điểm tới 2 lần. ' +
    'Nốt VÀNG ⭐ gấp đôi điểm. Nốt ĐỎ ☠ là BẪY - phải để nó trôi qua, ' +
    'lỡ bấm là mất 70 điểm và đứt combo! Nhạc nhanh dần về cuối bài.',
  controls: [
    { keys: ['SPACE'], desc: 'Bắt nốt làn dưới' },
    { keys: ['↑'], desc: 'Bắt nốt làn trên' },
  ],
  duration: 30_000,
  minPlayers: 1,
  maxPlayers: 16,

  createConfig() {
    const notes: Note[] = [];
    let t = 1600;
    for (let i = 0; i < NOTE_COUNT; i++) {
      const p = i / (NOTE_COUNT - 1);
      const interval = INTERVAL_START + (INTERVAL_END - INTERVAL_START) * p;
      const swing = i % 8 === 3 ? -60 : i % 8 === 6 ? 55 : 0;

      // làn trên xuất hiện dần từ khoảng 1/5 bài
      const lane: 0 | 1 = p > 0.22 && Math.random() < 0.42 ? 1 : 0;
      let type: NoteType = 'normal';
      if (i > 3 && i % 7 === 0) type = 'gold';
      else if (p > 0.18 && Math.random() < 0.16) type = 'trap';

      notes.push({ t: Math.round(t + swing), lane, type });
      t += interval;
    }
    return { notes, windows: WINDOWS, bpmStart: INTERVAL_START, bpmEnd: INTERVAL_END };
  },

  createState(ctx) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      players[id] = {
        score: 0,
        combo: 0,
        maxCombo: 0,
        hitCount: 0,
        golds: 0,
        traps: 0,
        consumed: new Set(),
        lastInputAt: 0,
      };
    }
    return { players, cursor: 0 };
  },

  handleInput(ctx, state, config, playerId, input: GameInput) {
    if (input.type !== 'hit') return;
    const p = state.players[playerId];
    if (!p) return;

    const now = ctx.now();
    if (now - p.lastInputAt < 55) return; // chống spam
    p.lastInputAt = now;

    const lane: 0 | 1 = input.key === 'up' ? 1 : 0;
    const at = Math.min(Math.max(input.at, now - 250), now + 60);
    const rel = at - ctx.startAt;

    // chỉ khớp nốt CÙNG LÀN với phím vừa bấm
    let best = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < config.notes.length; i++) {
      const n = config.notes[i];
      if (n.lane !== lane || p.consumed.has(i)) continue;
      const d = Math.abs(n.t - rel);
      if (d < bestDelta) {
        bestDelta = d;
        best = i;
      }
      if (n.t - rel > config.windows.good) break;
    }

    let judge: Judgement = 'MISS';
    let type: NoteType = 'normal';
    if (best >= 0 && bestDelta <= config.windows.good) {
      p.consumed.add(best);
      type = config.notes[best].type;
      judge =
        type === 'trap'
          ? 'TRAP'
          : bestDelta <= config.windows.perfect
            ? 'PERFECT'
            : bestDelta <= config.windows.great
              ? 'GREAT'
              : 'GOOD';
    }

    if (judge === 'TRAP') {
      p.traps += 1;
      p.combo = 0;
      p.score = Math.max(0, p.score - TRAP_PENALTY);
    } else if (judge === 'MISS') {
      p.combo = 0;
    } else {
      p.combo += 1;
      p.maxCombo = Math.max(p.maxCombo, p.combo);
      p.hitCount += 1;
      if (type === 'gold') p.golds += 1;
      const mult = 1 + Math.min(Math.floor(p.combo / 2) * 0.1, 1.0);
      p.score += Math.round(POINTS[judge] * mult * (type === 'gold' ? 2 : 1));
    }

    ctx.broadcast({ type: 'judge', playerId, judge, combo: p.combo, score: p.score, note: type, lane });
  },

  update(ctx, state, config) {
    const rel = ctx.now() - ctx.startAt;
    while (state.cursor < config.notes.length && config.notes[state.cursor].t + config.windows.good < rel) {
      const idx = state.cursor++;
      const note = config.notes[idx];
      for (const id of ctx.playerIds) {
        const p = state.players[id];
        if (p.consumed.has(idx)) continue;
        p.consumed.add(idx);
        // né được bẫy là đúng, không phạt; bỏ lỡ nốt thường mới đứt combo
        if (note.type !== 'trap' && p.combo > 0) {
          p.combo = 0;
          ctx.broadcast({ type: 'judge', playerId: id, judge: 'MISS', combo: 0, score: p.score, note: 'normal' });
        }
      }
    }
  },

  isFinished(ctx, state, config) {
    const last = config.notes[config.notes.length - 1].t;
    return ctx.now() - ctx.startAt > last + config.windows.good + 400;
  },

  calculateScore(ctx, state, config) {
    const real = config.notes.filter((n) => n.type !== 'trap').length;
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      const acc = Math.round((p.hitCount / Math.max(1, real)) * 100);
      out[id] = {
        raw: p.score,
        detail: `${p.score} pts · ${acc}% · x${p.maxCombo}${p.golds ? ` · ${p.golds}⭐` : ''}${
          p.traps ? ` · ${p.traps}☠` : ''
        }`,
      };
    }
    return out;
  },
};
