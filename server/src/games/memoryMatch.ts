import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';

/**
 * Hãy chọn giá đúng (id memory): mỗi ô của sàn mang một HÌNH. Cả sàn hiện hình vài giây để ghi nhớ rồi úp lại;
 * lúc đó server mới báo HÌNH CẦN TÌM. Hết giờ, mọi ô khác hình rơi mất — ai đứng trên đó rơi theo.
 * Hình cần tìm là bí mật của server cho tới giây úp ô (`hideAt`), nên không ai đứng sẵn được.
 * Mỗi vòng client chỉ nhận một gói `round` + một gói `ask`; còn lại tự đếm theo đồng hồ server.
 */
interface Config {
  n: number;
  size: number;
  /** số hình tối đa trong bộ */
  symbols: number;
  speed: number;
  radius: number;
  endsAt: number;
  spawns: Record<string, [number, number]>;
  /** vòng đầu có sẵn trong config để sàn hiện ngay lúc đếm ngược */
  round0: Pub;
}

interface Round {
  r: number;
  startAt: number;
  /** mỗi ký tự là chỉ số hình của một ô (hàng trước, cột sau) */
  pattern: string;
  /** hình cần tìm — chỉ lộ ra từ `hideAt` */
  target: number;
  /** giờ server (ms) úp các ô lại và báo hình cần tìm */
  hideAt: number;
  /** giờ server (ms) ô sai hình rơi */
  dropAt: number;
  nextAt: number;
}

type Pub = Omit<Round, 'target'> & { target: number };

interface PState {
  x: number;
  y: number;
  dx: number;
  dy: number;
  moveAt: number;
  outAt: number | null;
  outRound: number;
}

interface State {
  players: Record<string, PState>;
  round: Round;
  asked: boolean;
  dropped: boolean;
  lastTick: number;
  lastBroadcast: number;
  lastRoundSent: number;
}

const SYMBOLS = 8;
const SIZE = 12;
const SPEED = 32;
const PLAYER_R = 2.6;
const FALL_GRACE_MS = 1600;
const HOLD_TIMEOUT = 900;
const DURATION = 150_000;
const GONE_MS = 2200;
const MAX_ROUNDS = 11;
const BROADCAST_MS = 70;

/** thời gian ghi nhớ: ngắn dần theo vòng */
const showMs = (r: number) => Math.max(2600, 6500 - r * 300);
/** thời gian chạy tới hình đúng sau khi úp ô */
const findMs = (r: number) => Math.max(4200, 6200 - r * 200);
const gridFor = (players: number) => (players <= 4 ? 10 : players <= 8 ? 12 : 14);
/** vòng càng cao càng nhiều hình → khó nhớ hơn */
const symbolsFor = (r: number) => Math.min(SYMBOLS, 3 + Math.floor(r / 2));

function makeRound(r: number, n: number, startAt: number): Round {
  const k = symbolsFor(r);
  const target = Math.floor(Math.random() * k);
  const cells = n * n;
  const pat: number[] = [];
  for (let i = 0; i < cells; i++) pat.push(Math.floor(Math.random() * k));
  // hình cần tìm phải chiếm chừng 1/k sàn, không hiếm hơn
  const want = Math.ceil(cells / k);
  let have = pat.filter((c) => c === target).length;
  while (have < want) {
    const i = Math.floor(Math.random() * cells);
    if (pat[i] !== target) {
      pat[i] = target;
      have++;
    }
  }
  const hideAt = startAt + showMs(r);
  const dropAt = hideAt + findMs(r);
  return { r, startAt, pattern: pat.join(''), target, hideAt, dropAt, nextAt: dropAt + GONE_MS };
}

/** bản gửi đi: chưa tới giờ úp thì giấu hình cần tìm (-1) */
const pub = (rd: Round, now: number): Pub => ({ ...rd, target: now >= rd.hideAt ? rd.target : -1 });

export const memoryMatchGame: GameDefinition<Config, State> = {
  id: 'memory',
  name: 'HÃY CHỌN GIÁ ĐÚNG',
  instructions:
    'Cả sàn hiện hình vài giây, hãy nhớ vị trí! Rồi các ô úp lại và báo HÌNH CẦN TÌM: chạy tới đứng đúng ô đó. Ô khác hình rơi mất, trụ lại cuối cùng thắng.',
  controls: [{ keys: ['←', '↑', '→', '↓'], desc: 'Giữ để chạy mọi hướng tới ô có hình cần tìm' }],
  duration: DURATION + 1500,
  minPlayers: 1,
  maxPlayers: 16,

  createConfig(ctx) {
    const n = gridFor(ctx.playerIds.length);
    const half = (n * SIZE) / 2;
    const spawns: Record<string, [number, number]> = {};
    const ids = [...ctx.playerIds];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const per = Math.ceil(Math.sqrt(ids.length));
    const step = Math.min(14, (half * 1.5) / per);
    ids.forEach((id, i) => {
      const cx = (i % per) - (per - 1) / 2;
      const cy = Math.floor(i / per) - (Math.ceil(ids.length / per) - 1) / 2;
      spawns[id] = [Math.round(cx * step * 10) / 10, Math.round(cy * step * 10) / 10];
    });
    // vòng đầu nằm trong config nên hình cần tìm bị giấu (-1); createState chọn hình đó sau
    const round0 = makeRound(0, n, ctx.startAt);
    return {
      n,
      size: SIZE,
      symbols: SYMBOLS,
      speed: SPEED,
      radius: PLAYER_R,
      endsAt: DURATION,
      spawns,
      round0: { ...round0, target: -1 },
    };
  },

  createState(ctx, config) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      const [x, y] = config.spawns[id];
      players[id] = { x, y, dx: 0, dy: 0, moveAt: 0, outAt: null, outRound: 0 };
    }
    // hình cần tìm của vòng đầu: chọn ngẫu nhiên trong các hình có thật trên sàn
    const present = [...new Set(config.round0.pattern.split('').map(Number))];
    return {
      players,
      round: { ...config.round0, target: present[Math.floor(Math.random() * present.length)] },
      asked: false,
      dropped: false,
      lastTick: ctx.startAt,
      lastBroadcast: 0,
      lastRoundSent: 0,
    };
  },

  onStart(ctx, state) {
    ctx.broadcast({ type: 'round', ...pub(state.round, ctx.now()) });
    state.lastRoundSent = ctx.now();
  },

  handleInput(ctx, state, _config, playerId, input: GameInput) {
    if (input.type !== 'moveXY') return;
    const p = state.players[playerId];
    if (!p || p.outAt !== null) return;
    p.dx = Math.max(-1, Math.min(1, Math.round(Number(input.dx) || 0)));
    p.dy = Math.max(-1, Math.min(1, Math.round(Number(input.dy) || 0)));
    p.moveAt = ctx.now();
  },

  update(ctx, state, config) {
    const now = ctx.now();
    const rel = now - ctx.startAt;
    const dt = Math.min(now - state.lastTick, 200) / 1000;
    state.lastTick = now;
    const half = (config.n * config.size) / 2;
    const lim = half - 1;

    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (p.outAt !== null || now < ctx.startAt) continue;
      if (now - p.moveAt > HOLD_TIMEOUT) {
        p.dx = 0;
        p.dy = 0;
      }
      if (dt > 0 && (p.dx !== 0 || p.dy !== 0)) {
        const len = Math.hypot(p.dx, p.dy) || 1;
        p.x = Math.max(-lim, Math.min(lim, p.x + (p.dx / len) * config.speed * dt));
        p.y = Math.max(-lim, Math.min(lim, p.y + (p.dy / len) * config.speed * dt));
      }
    }

    const rd = state.round;
    if (!state.asked && now >= rd.hideAt) {
      state.asked = true;
      ctx.broadcast({ type: 'ask', r: rd.r, target: rd.target });
    }
    if (!state.dropped && now >= rd.dropAt) {
      state.dropped = true;
      for (const id of ctx.playerIds) {
        const p = state.players[id];
        if (p.outAt !== null) continue;
        const cx = Math.min(config.n - 1, Math.max(0, Math.floor((p.x + half) / config.size)));
        const cy = Math.min(config.n - 1, Math.max(0, Math.floor((p.y + half) / config.size)));
        if (Number(rd.pattern[cy * config.n + cx]) !== rd.target) {
          p.outAt = now;
          p.outRound = rd.r + 1;
          p.dx = p.dy = 0;
          ctx.broadcast({ type: 'out', playerId: id, at: rel });
        }
      }
    }
    if (state.dropped && now >= rd.nextAt && rd.r + 1 < MAX_ROUNDS) {
      state.round = makeRound(rd.r + 1, config.n, rd.nextAt);
      state.asked = false;
      state.dropped = false;
      ctx.broadcast({ type: 'round', ...pub(state.round, now) });
      state.lastRoundSent = now;
    }

    if (now - state.lastBroadcast < BROADCAST_MS) return;
    state.lastBroadcast = now;
    const positions: Record<string, { x: number; y: number; out: boolean }> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      positions[id] = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, out: p.outAt !== null };
    }
    const payload: Record<string, unknown> = { type: 'pos', positions };
    // nhắc lại vòng hiện tại mỗi giây cho ai vào lại giữa ván
    if (now - state.lastRoundSent > 1000) {
      payload.round = pub(state.round, now);
      state.lastRoundSent = now;
    }
    ctx.broadcast(payload);
  },

  isFinished(ctx, state, config) {
    const now = ctx.now();
    if (now - ctx.startAt >= config.endsAt) return true;
    const total = ctx.playerIds.length;
    const alive = ctx.playerIds.filter((id) => state.players[id].outAt === null).length;
    if (total > 1 ? alive <= 1 : alive === 0) {
      const last = ctx.playerIds.reduce((m, id) => Math.max(m, state.players[id].outAt ?? 0), 0);
      return now - last >= FALL_GRACE_MS;
    }
    return state.dropped && state.round.r + 1 >= MAX_ROUNDS && now >= state.round.nextAt;
  },

  calculateScore(ctx, state) {
    const total = ctx.playerIds.length;
    const alive = ctx.playerIds.filter((id) => state.players[id].outAt === null).length;
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (p.outAt !== null) {
        out[id] = { raw: Math.max(0, p.outAt - ctx.startAt), detail: `rơi ở vòng ${p.outRound}` };
      } else {
        out[id] = {
          raw: 1_000_000,
          detail: total > 1 && alive === 1 ? '🏆 trụ lại cuối cùng' : 'sống sót đến hết',
        };
      }
    }
    return out;
  },
};
