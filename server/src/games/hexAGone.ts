import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import { hexAt, hexCenter, makeHexGrid, type HexGrid } from '../../../shared/hex.js';

interface Config {
  radius: number;
  size: number;
  layers: number;
  speed: number;
  playerRadius: number;
  /** từ lúc bước lên tới lúc ô rơi */
  delay: number;
  /** nửa cạnh vùng người chơi được chạy (ngoài lưới là rơi) */
  bound: number;
  endsAt: number;
  /** thời gian một cú nhảy (ms) */
  jumpMs: number;
  /** chỗ xuất phát của từng người — để client dựng sẵn nhân vật lúc đếm ngược */
  spawns: Record<string, [number, number]>;
}

interface PState {
  x: number;
  y: number;
  dx: number;
  dy: number;
  moveAt: number;
  /** 0 = tầng thấp nhất; -1 = đã rơi khỏi sân */
  layer: number;
  dropUntil: number;
  /** đang bay trên không tới lúc này: không chạm ô, nhảy qua được chỗ trống */
  jumpUntil: number;
  outAt: number | null;
}

interface State {
  grid: HexGrid;
  /** số ô mỗi tầng */
  n: number;
  players: Record<string, PState>;
  /** 0 = còn nguyên, 1 = đang nháy báo sắp rơi, 2 = đã rơi */
  tiles: Uint8Array;
  fallAt: Float64Array;
  touchFrom: number;
  nextDecay: number;
  dirty: boolean;
  lastTick: number;
  lastBroadcast: number;
  lastSnap: number;
}

const SIZE = 11;
const LAYERS = 3;
const SPEED = 34;
const PLAYER_R = 3;
/** HEX_DELAY=ms: kéo dài thời gian ô tồn tại để chạy thử/chụp ảnh khi phát triển */
const DELAY = Math.max(300, Number(process.env.HEX_DELAY) || 820);
/** vừa rơi xuống tầng dưới thì được "tiếp đất" một chút rồi mới tính ô dưới chân */
const DROP_MS = 520;
/** thời gian bay + nghỉ ngắn sau khi đáp mới nhảy tiếp được */
const JUMP_MS = 620;
const JUMP_COOLDOWN = 0;
/** bù trễ mạng: bấm nhảy tiếp ngay lúc vừa đáp không bị server từ chối */
const JUMP_SLACK = 90;
/** sau lần rơi cuối, chờ nhân vật rơi hẳn khỏi sàn rồi mới kết thúc ván */
const FALL_GRACE_MS = 1600;
const HOLD_TIMEOUT = 900;
const GRACE_MS = 1300;
const DECAY_START = 11_000;
const DURATION = 75_000;

/** sàn to theo số người để ván không kết thúc quá nhanh khi phòng đông */
const radiusFor = (players: number) => (players <= 2 ? 7 : players <= 4 ? 8 : players <= 8 ? 9 : 10);

const shuffle = <T,>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** các ô rơi theo lịch nhanh dần: 1,5s/ô lúc đầu → 0,3s/ô cuối ván */
const decayGap = (rel: number) => {
  const p = Math.min(1, Math.max(0, (rel - DECAY_START) / 40_000));
  return 1500 - 1200 * p;
};

const lastOutAt = (ctx: { playerIds: string[] }, state: State) =>
  ctx.playerIds.reduce((m, id) => Math.max(m, state.players[id].outAt ?? 0), 0);

export const hexAGoneGame: GameDefinition<Config, State> = {
  id: 'hex',
  name: 'SÀN TỔ ONG',
  instructions:
    'Ô nào bạn bước lên sẽ rơi sau chưa tới 1 giây, nên cứ chạy hoặc nhấn SPACE để nhảy qua chỗ trống. Rơi khỏi tầng thấp nhất là bị loại. Trụ lại lâu nhất thắng.',
  controls: [
    { keys: ['←', '↑', '→', '↓'], desc: 'Giữ để chạy mọi hướng · đứng yên là ô dưới chân sẽ rơi' },
    { keys: ['SPACE'], desc: 'Nhảy: bay qua chỗ trống, đang bay thì không chạm ô' },
  ],
  duration: DURATION + 1500,
  minPlayers: 1,
  maxPlayers: 16,

  createConfig(ctx) {
    const radius = radiusFor(ctx.playerIds.length);
    const grid = makeHexGrid(radius);
    // mỗi người một ô riêng trên tầng cao nhất, rải đều
    const spots = shuffle([...grid.cells]).slice(0, ctx.playerIds.length);
    const spawns: Record<string, [number, number]> = {};
    ctx.playerIds.forEach((id, i) => {
      const c = hexCenter(spots[i], SIZE);
      spawns[id] = [c.x, c.y];
    });
    return {
      radius,
      size: SIZE,
      layers: LAYERS,
      speed: SPEED,
      playerRadius: PLAYER_R,
      delay: DELAY,
      bound: SIZE * Math.sqrt(3) * (radius + 1.6),
      endsAt: DURATION,
      jumpMs: JUMP_MS,
      spawns,
    };
  },

  createState(ctx, config) {
    const grid = makeHexGrid(config.radius);
    const n = grid.cells.length;
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      const [x, y] = config.spawns[id];
      players[id] = { x, y, dx: 0, dy: 0, moveAt: 0, layer: LAYERS - 1, dropUntil: 0, jumpUntil: 0, outAt: null };
    }
    return {
      grid,
      n,
      players,
      tiles: new Uint8Array(LAYERS * n),
      fallAt: new Float64Array(LAYERS * n),
      touchFrom: ctx.startAt + GRACE_MS,
      nextDecay: ctx.startAt + DECAY_START,
      dirty: true,
      lastTick: ctx.startAt,
      lastBroadcast: 0,
      lastSnap: 0,
    };
  },

  handleInput(ctx, state, _config, playerId, input: GameInput) {
    const p = state.players[playerId];
    if (!p || p.outAt !== null) return;
    if (input.type === 'jump') {
      const now = ctx.now();
      // chỉ nhảy khi đã bắt đầu ván, không nhảy khi đang rơi, và phải đáp xong một nhịp
      if (now >= ctx.startAt && now >= p.dropUntil && now >= p.jumpUntil - JUMP_SLACK) p.jumpUntil = now + JUMP_MS;
      return;
    }
    if (input.type !== 'moveXY') return;
    p.dx = Math.max(-1, Math.min(1, Math.round(Number(input.dx) || 0)));
    p.dy = Math.max(-1, Math.min(1, Math.round(Number(input.dy) || 0)));
    p.moveAt = ctx.now();
  },

  update(ctx, state, config) {
    const now = ctx.now();
    const rel = now - ctx.startAt;
    const { grid, n: N } = state;
    const dt = Math.min(now - state.lastTick, 200) / 1000;
    state.lastTick = now;

    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (p.outAt !== null) continue;

      // di chuyển
      if (now - p.moveAt > HOLD_TIMEOUT) {
        p.dx = 0;
        p.dy = 0;
      }
      if (dt > 0 && (p.dx !== 0 || p.dy !== 0)) {
        const len = Math.hypot(p.dx, p.dy) || 1;
        p.x = Math.max(-config.bound, Math.min(config.bound, p.x + (p.dx / len) * config.speed * dt));
        p.y = Math.max(-config.bound, Math.min(config.bound, p.y + (p.dy / len) * config.speed * dt));
      }

      if (now < p.dropUntil || now < p.jumpUntil) continue;

      // ô dưới chân
      const c = hexAt(p.x, p.y, config.size);
      const idx = grid.indexOf(c.q, c.r);
      const slot = p.layer * N + idx;
      const gone = idx < 0 || state.tiles[slot] === 2;
      if (gone) {
        p.layer -= 1;
        p.dropUntil = now + DROP_MS;
        if (p.layer < 0) {
          p.outAt = now;
          p.dx = p.dy = 0;
          ctx.broadcast({ type: 'out', playerId: id, at: now - ctx.startAt });
        }
        continue;
      }
      if (state.tiles[slot] === 0 && now >= state.touchFrom) {
        state.tiles[slot] = 1;
        state.fallAt[slot] = now + config.delay;
        state.dirty = true;
      }
    }

    // ô đang nháy tới giờ thì rơi
    for (let i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i] === 1 && now >= state.fallAt[i]) {
        state.tiles[i] = 2;
        state.dirty = true;
      }
    }

    // rơi theo lịch: nhanh dần, một nửa số lần nhằm đúng ô người đang đứng
    if (now >= state.nextDecay && now >= state.touchFrom) {
      const alive = ctx.playerIds.filter((id) => state.players[id].outAt === null);
      let slot = -1;
      if (alive.length && Math.random() < 0.55) {
        const p = state.players[alive[Math.floor(Math.random() * alive.length)]];
        const c = hexAt(p.x, p.y, config.size);
        const idx = grid.indexOf(c.q, c.r);
        if (idx >= 0 && p.layer >= 0 && state.tiles[p.layer * N + idx] === 0) slot = p.layer * N + idx;
      }
      if (slot < 0) {
        const layers = new Set(alive.map((id) => state.players[id].layer));
        const pool: number[] = [];
        for (let i = 0; i < state.tiles.length; i++) {
          if (state.tiles[i] === 0 && (layers.size === 0 || layers.has(Math.floor(i / N)))) pool.push(i);
        }
        if (pool.length) slot = pool[Math.floor(Math.random() * pool.length)];
      }
      if (slot >= 0) {
        state.tiles[slot] = 1;
        state.fallAt[slot] = now + config.delay;
        state.dirty = true;
      }
      state.nextDecay = now + decayGap(rel);
    }

    if (now - state.lastBroadcast < 60) return;
    state.lastBroadcast = now;
    const positions: Record<string, { x: number; y: number; l: number; out: boolean; j: boolean }> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      positions[id] = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, l: p.layer, out: p.outAt !== null, j: now < p.jumpUntil };
    }
    const payload: Record<string, unknown> = { type: 'pos', positions };
    // trạng thái ô chỉ gửi khi đổi (và nhắc lại mỗi giây để ai vào lại giữa ván vẫn thấy đủ)
    if ((state.dirty && now - state.lastSnap > 140) || now - state.lastSnap > 1000) {
      let s = '';
      for (let i = 0; i < state.tiles.length; i++) s += state.tiles[i];
      payload.tiles = s;
      state.dirty = false;
      state.lastSnap = now;
    }
    ctx.broadcast(payload);
  },

  isFinished(ctx, state, config) {
    if (ctx.now() - ctx.startAt >= config.endsAt) return true;
    const total = ctx.playerIds.length;
    const alive = ctx.playerIds.filter((id) => state.players[id].outAt === null).length;
    if (!(total > 1 ? alive <= 1 : alive === 0)) return false;
    // chờ người rơi cuối cùng rơi xong rồi mới chốt kết quả
    return ctx.now() - lastOutAt(ctx, state) >= FALL_GRACE_MS;
  },

  calculateScore(ctx, state) {
    const total = ctx.playerIds.length;
    const alive = ctx.playerIds.filter((id) => state.players[id].outAt === null).length;
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (p.outAt !== null) {
        const t = p.outAt - ctx.startAt;
        out[id] = { raw: Math.max(0, t), detail: `rơi sau ${(t / 1000).toFixed(1)}s` };
      } else {
        out[id] = {
          raw: 1_000_000,
          detail: total > 1 && alive === 1 ? '🏆 trụ lại cuối cùng' : 'sống sót đến hết giờ',
        };
      }
    }
    return out;
  },
};
