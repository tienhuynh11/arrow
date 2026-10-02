import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';

interface Config {
  /** bề ngang đường chạy (x ∈ [-w/2, w/2]); y là quãng đã chạy, 0 → finishY */
  w: number;
  cols: number;
  doorW: number;
  rows: number;
  rowY: number[];
  /** nửa bề dày của một hàng cửa */
  half: number;
  finishY: number;
  speed: number;
  radius: number;
  knock: number;
  stun: number;
  endsAt: number;
  spawns: Record<string, [number, number]>;
}

interface PState {
  x: number;
  y: number;
  dx: number;
  dy: number;
  moveAt: number;
  stunUntil: number;
  /** giờ về đích (ms từ lúc bắt đầu), 0 = chưa về */
  finishedAt: number;
}

interface State {
  /** BÍ MẬT: cửa nào là cửa thật — chỉ server biết, không bao giờ nằm trong config */
  real: boolean[];
  /** cửa thật đã bị ai đó đẩy mở (mở cho tất cả) */
  open: boolean[];
  players: Record<string, PState>;
  firstFinish: number;
  dirty: boolean;
  lastTick: number;
  lastBroadcast: number;
  lastSnap: number;
}

const COLS = 6;
const REAL_PER_ROW = 1;
const DOOR_W = 12;
const W = COLS * DOOR_W;
const ROWS = 8;
const FIRST_ROW = 70;
const ROW_GAP = 75;
const HALF = 2.5;
const RADIUS = 3;
const SPEED = 28;
const KNOCK = 16;
const STUN_MS = 550;
const HOLD_TIMEOUT = 900;
const DURATION = 75_000;
/** có người về đích rồi thì những người còn lại chỉ còn chừng này giây */
const LAST_CALL_MS = 25_000;
const FINISH_Y = FIRST_ROW + (ROWS - 1) * ROW_GAP + 55;

const shuffle = <T,>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const colOf = (x: number) => Math.max(0, Math.min(COLS - 1, Math.floor((x + W / 2) / DOOR_W)));

export const doorDashGame: GameDefinition<Config, State> = {
  id: 'door',
  name: 'CỬA BÍ MẬT',
  instructions:
    'Mỗi hàng chỉ có MỘT cửa thật, còn lại là cửa giả (văng bạn lại và làm choáng). Nhìn người khác thử cửa để đoán đường. Về đích nhanh nhất thắng.',
  controls: [{ keys: ['←', '↑', '→', '↓'], desc: 'Giữ để chạy · đâm vào cửa để thử: cửa thật mở, cửa giả văng bạn lại' }],
  duration: DURATION + 1500,
  minPlayers: 1,
  maxPlayers: 16,

  createConfig(ctx) {
    const n = ctx.playerIds.length;
    // xếp hàng ngang ở vạch xuất phát, tối đa 8 người một hàng
    const perRow = Math.min(8, n);
    const spacing = Math.min(9, (W - 14) / Math.max(1, perRow - 1 || 1));
    const spawns: Record<string, [number, number]> = {};
    shuffle([...ctx.playerIds]).forEach((id, i) => {
      const r = Math.floor(i / 8);
      const inRow = Math.min(8, n - r * 8);
      const c = i % 8;
      spawns[id] = [(c - (inRow - 1) / 2) * spacing, 8 + r * 8];
    });
    return {
      w: W,
      cols: COLS,
      doorW: DOOR_W,
      rows: ROWS,
      rowY: Array.from({ length: ROWS }, (_, i) => FIRST_ROW + i * ROW_GAP),
      half: HALF,
      finishY: FINISH_Y,
      speed: SPEED,
      radius: RADIUS,
      knock: KNOCK,
      stun: STUN_MS,
      endsAt: DURATION,
      spawns,
    };
  },

  createState(ctx, config) {
    // mỗi hàng đúng REAL_PER_ROW cửa thật, vị trí ngẫu nhiên
    const real: boolean[] = [];
    for (let r = 0; r < ROWS; r++) {
      const row = shuffle(Array.from({ length: COLS }, (_, c) => c < REAL_PER_ROW));
      real.push(...row);
    }
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      const [x, y] = config.spawns[id];
      players[id] = { x, y, dx: 0, dy: 0, moveAt: 0, stunUntil: 0, finishedAt: 0 };
    }
    return {
      real,
      open: new Array(ROWS * COLS).fill(false),
      players,
      firstFinish: 0,
      dirty: true,
      lastTick: ctx.startAt,
      lastBroadcast: 0,
      lastSnap: 0,
    };
  },

  handleInput(ctx, state, _config, playerId, input: GameInput) {
    if (input.type !== 'moveXY') return;
    const p = state.players[playerId];
    if (!p || p.finishedAt) return;
    p.dx = Math.max(-1, Math.min(1, Math.round(Number(input.dx) || 0)));
    // dy > 0 = chạy về phía đích
    p.dy = Math.max(-1, Math.min(1, Math.round(Number(input.dy) || 0)));
    p.moveAt = ctx.now();
  },

  update(ctx, state, config) {
    const now = ctx.now();
    const rel = now - ctx.startAt;
    const dt = Math.min(now - state.lastTick, 200) / 1000;
    state.lastTick = now;
    const { w, radius: R, half } = config;
    const maxX = w / 2 - R;

    /** hàng cửa đang chắn nếu đứng ở (x, y) */
    const blockedRow = (x: number, y: number) => {
      for (let r = 0; r < config.rows; r++) {
        const front = config.rowY[r] - half - R;
        const back = config.rowY[r] + half + R;
        if (y > front && y < back && !state.open[r * COLS + colOf(x)]) return r;
      }
      return -1;
    };

    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (p.finishedAt || now < ctx.startAt) continue;
      if (now < p.stunUntil) continue;

      if (now - p.moveAt > HOLD_TIMEOUT) {
        p.dx = 0;
        p.dy = 0;
      }
      if (dt <= 0 || (p.dx === 0 && p.dy === 0)) continue;
      const len = Math.hypot(p.dx, p.dy) || 1;
      const nx = Math.max(-maxX, Math.min(maxX, p.x + (p.dx / len) * config.speed * dt));
      const ny = Math.max(0, p.y + (p.dy / len) * config.speed * dt);

      if (blockedRow(nx, ny) < 0) {
        p.x = nx;
        p.y = ny;
      } else {
        const r = blockedRow(p.x, ny);
        if (r >= 0) {
          const front = config.rowY[r] - half - R;
          // chỉ "đâm" cửa khi đang chạy tới từ phía trước
          if (p.dy > 0 && p.y <= front + 0.001) {
            p.y = front - 0.01;
            const c = colOf(p.x);
            const slot = r * COLS + c;
            if (state.real[slot]) {
              state.open[slot] = true;
              state.dirty = true;
              ctx.broadcast({ type: 'door', row: r, col: c, by: id });
            } else {
              p.y = Math.max(0, p.y - config.knock);
              p.stunUntil = now + config.stun;
              p.dx = p.dy = 0;
              ctx.broadcast({ type: 'bump', row: r, col: c, by: id });
            }
          }
          // trượt dọc theo cửa
          if (blockedRow(nx, p.y) < 0) p.x = nx;
        } else {
          p.y = ny; // chỉ bị chặn khi đi ngang (đang đứng trong khung cửa)
        }
      }

      if (p.y >= config.finishY) {
        p.y = config.finishY;
        p.finishedAt = Math.max(1, rel);
        p.dx = p.dy = 0;
        if (!state.firstFinish) state.firstFinish = now;
        ctx.broadcast({ type: 'finish', playerId: id, at: p.finishedAt });
      }
    }

    if (now - state.lastBroadcast < 60) return;
    state.lastBroadcast = now;
    const positions: Record<string, { x: number; y: number; s: boolean; f: number }> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      positions[id] = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, s: now < p.stunUntil, f: p.finishedAt };
    }
    const payload: Record<string, unknown> = { type: 'pos', positions };
    // cửa nào đang mở chỉ gửi khi đổi (và nhắc lại mỗi giây cho ai vào lại giữa ván)
    if ((state.dirty && now - state.lastSnap > 100) || now - state.lastSnap > 1000) {
      payload.open = state.open.map((o) => (o ? '1' : '0')).join('');
      state.dirty = false;
      state.lastSnap = now;
    }
    ctx.broadcast(payload);
  },

  isFinished(ctx, state, config) {
    const now = ctx.now();
    if (now - ctx.startAt >= config.endsAt) return true;
    if (state.firstFinish && now - state.firstFinish >= LAST_CALL_MS) return true;
    return ctx.playerIds.every((id) => state.players[id].finishedAt > 0);
  },

  calculateScore(ctx, state, config) {
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (p.finishedAt) {
        out[id] = { raw: 1_000_000 - p.finishedAt, detail: `về đích sau ${(p.finishedAt / 1000).toFixed(1)}s` };
      } else {
        const passed = config.rowY.filter((y) => p.y > y).length;
        out[id] = { raw: Math.floor(p.y), detail: `qua ${passed}/${config.rows} hàng cửa` };
      }
    }
    return out;
  },
};
