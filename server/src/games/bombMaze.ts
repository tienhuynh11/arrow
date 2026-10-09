import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import {
  CELL_CRATE,
  CELL_FLOOR,
  CELL_WALL,
  gridToString,
  inside,
  parseGrid,
  spiralOrder,
  stepMaze,
  type MazeGrid,
} from '../../../shared/bombMaze.js';

/**
 * Mê cung đặt bom (kiểu Bomberman): mê cung lưới ô vuông nhìn từ trên xuống. Chạy, đặt bom, phá thùng gỗ, nhặt vật phẩm,
 * nổ dây chuyền để hạ đối thủ. Người sống sót cuối cùng thắng. Sau một lúc sàn sập dần từ ngoài vào để ván luôn kết thúc.
 * Server chốt mọi thứ (di chuyển, bom, lửa, vật phẩm); vật phẩm nằm ẩn trong thùng tới lúc thùng vỡ.
 */
interface Config {
  cols: number;
  rows: number;
  /** '0' sàn · '1' tường cố định · '2' thùng gỗ (ban đầu) */
  grid: string;
  spawns: Record<string, [number, number]>;
  speed: number;
  speedStep: number;
  fuseMs: number;
  flameMs: number;
  closeStartMs: number;
  closeEveryMs: number;
  closeWarnMs: number;
  /** thứ tự các ô sập sàn (chỉ số ô) */
  spiral: number[];
  endsAt: number;
}

interface PState {
  x: number;
  y: number;
  dx: number;
  dy: number;
  moveAt: number;
  plantAt: number;
  alive: boolean;
  outAt: number | null;
  kills: number;
  maxBombs: number;
  range: number;
  lvl: number;
  shield: boolean;
  /** miễn nhiễm lửa ngắn sau khi khiên vỡ */
  immuneUntil: number;
}

interface Bomb {
  id: number;
  cx: number;
  cy: number;
  owner: string;
  at: number;
  range: number;
}

interface State {
  grid: MazeGrid;
  players: Record<string, PState>;
  bombs: Map<number, Bomb>;
  nextBomb: number;
  flames: Map<number, { until: number; owner: string }>;
  items: Map<number, string>;
  closed: number;
  lastDeath: number;
  lastTick: number;
  lastBroadcast: number;
  lastFull: number;
}

const SPEED = 4.3;
const SPEED_STEP = 0.55;
const FUSE_MS = 2400;
const FLAME_MS = 600;
const CLOSE_START = 70_000;
const CLOSE_EVERY = 380;
const CLOSE_WARN = 900;
const DURATION = 165_000;
const HOLD_TIMEOUT = 900;
const PLANT_COOLDOWN = 140;
const DROP_CHANCE = 0.42;
/** b: thêm bom · f: tầm nổ +1 · h: khiên · s: tốc độ (tỉ lệ rơi theo số lần xuất hiện) */
const KINDS = ['f', 'f', 'f', 'b', 'b', 'b', 'h', 'h', 's', 's'] as const;
const START_RANGE = 1;
const SHIELD_IMMUNE_MS = 700;
const MAX_BOMBS = 6;
const MAX_RANGE = 6;
const MAX_LVL = 5;
const BROADCAST_MS = 66;
const FULL_MS = 1500;
const END_GRACE = 1600;

const sizeFor = (players: number): [number, number] =>
  players <= 4 ? [15, 11] : players <= 8 ? [19, 13] : players <= 12 ? [21, 15] : [25, 15];

const r2 = (n: number) => Math.round(n * 100) / 100;

export const bombMazeGame: GameDefinition<Config, State> = {
  id: 'bombmaze',
  name: 'MÊ CUNG ĐẶT BOM',
  instructions:
    'Đặt bom (SPACE): ban đầu bom chỉ nổ chữ thập 1 ô mỗi hướng, nổ dây chuyền được cả bom khác. ' +
    'Phá thùng nhặt vật phẩm: thêm bom, tầm nổ xa hơn, chạy nhanh hơn và 🛡 khiên đỡ đúng một lần trúng lửa (không đỡ được sập sàn). ' +
    'Đừng đứng trong lửa, kể cả bom của mình — sàn sập dần từ ngoài vào, người sống sót cuối cùng thắng.',
  controls: [
    { keys: ['←', '↑', '→', '↓'], desc: 'Chạy 4 hướng · W A S D cũng được' },
    { keys: ['SPACE'], desc: 'Đặt bom ở ô đang đứng' },
  ],
  duration: DURATION + 1500,
  minPlayers: 2,
  maxPlayers: 16,

  createConfig(ctx) {
    const n = ctx.playerIds.length;
    const [cols, rows] = sizeFor(n);
    const cells = new Uint8Array(cols * rows);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const edge = cx === 0 || cy === 0 || cx === cols - 1 || cy === rows - 1;
        cells[cy * cols + cx] = edge || (cx % 2 === 0 && cy % 2 === 0) ? CELL_WALL : CELL_FLOOR;
      }
    }
    // chỗ xuất phát: các giao lộ (cột, hàng đều lẻ) rải xa nhau nhất
    const spots: [number, number][] = [];
    for (let cy = 1; cy < rows; cy += 2) for (let cx = 1; cx < cols; cx += 2) spots.push([cx, cy]);
    const picked: [number, number][] = [[1, 1]];
    while (picked.length < n) {
      let best = spots[0];
      let bestD = -1;
      for (const s of spots) {
        let d = Infinity;
        for (const p of picked) d = Math.min(d, Math.hypot(p[0] - s[0], p[1] - s[1]));
        if (d > bestD) {
          bestD = d;
          best = s;
        }
      }
      picked.push(best);
    }
    // chừa chỗ thoát quanh mỗi điểm xuất phát (2 ô theo từng hướng)
    const safe = new Set<number>();
    for (const [cx, cy] of picked) {
      safe.add(cy * cols + cx);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let k = 1; k <= 2; k++) {
          const x = cx + dx * k;
          const y = cy + dy * k;
          if (x > 0 && y > 0 && x < cols - 1 && y < rows - 1) safe.add(y * cols + x);
        }
      }
    }
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === CELL_FLOOR && !safe.has(i) && Math.random() < 0.72) cells[i] = CELL_CRATE;
    }
    const g: MazeGrid = { cols, rows, cells };
    const ids = [...ctx.playerIds];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const spawns: Record<string, [number, number]> = {};
    ids.forEach((id, i) => (spawns[id] = picked[i]));
    return {
      cols,
      rows,
      grid: gridToString(g),
      spawns,
      speed: SPEED,
      speedStep: SPEED_STEP,
      fuseMs: FUSE_MS,
      flameMs: FLAME_MS,
      closeStartMs: CLOSE_START,
      closeEveryMs: CLOSE_EVERY,
      closeWarnMs: CLOSE_WARN,
      spiral: spiralOrder(g),
      endsAt: DURATION,
    };
  },

  createState(ctx, config) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      const [cx, cy] = config.spawns[id];
      players[id] = {
        x: cx + 0.5,
        y: cy + 0.5,
        dx: 0,
        dy: 0,
        moveAt: 0,
        plantAt: 0,
        alive: true,
        outAt: null,
        kills: 0,
        maxBombs: 1,
        range: START_RANGE,
        lvl: 0,
        shield: false,
        immuneUntil: 0,
      };
    }
    return {
      grid: parseGrid(config.cols, config.rows, config.grid),
      players,
      bombs: new Map(),
      nextBomb: 1,
      flames: new Map(),
      items: new Map(),
      closed: 0,
      lastDeath: 0,
      lastTick: ctx.startAt,
      lastBroadcast: 0,
      lastFull: 0,
    };
  },

  handleInput(ctx, state, config, playerId, input: GameInput) {
    const p = state.players[playerId];
    if (!p || !p.alive) return;
    const now = ctx.now();
    if (input.type === 'moveXY') {
      p.dx = Math.max(-1, Math.min(1, Math.round(Number(input.dx) || 0)));
      p.dy = Math.max(-1, Math.min(1, Math.round(Number(input.dy) || 0)));
      p.moveAt = now;
      return;
    }
    if (input.type !== 'plant') return;
    if (now < ctx.startAt || now - p.plantAt < PLANT_COOLDOWN) return;
    const cx = Math.floor(p.x);
    const cy = Math.floor(p.y);
    const idx = cy * state.grid.cols + cx;
    if (state.grid.cells[idx] !== CELL_FLOOR) return;
    for (const b of state.bombs.values()) if (b.cx === cx && b.cy === cy) return;
    let mine = 0;
    for (const b of state.bombs.values()) if (b.owner === playerId) mine++;
    if (mine >= p.maxBombs) return;
    p.plantAt = now;
    const bomb: Bomb = { id: state.nextBomb++, cx, cy, owner: playerId, at: now + config.fuseMs, range: p.range };
    state.bombs.set(bomb.id, bomb);
    ctx.broadcast({ type: 'bomb', i: bomb.id, c: idx, o: playerId, at: bomb.at, r: bomb.range });
  },

  update(ctx, state, config) {
    const now = ctx.now();
    const rel = now - ctx.startAt;
    const dt = Math.min(now - state.lastTick, 200) / 1000;
    state.lastTick = now;
    if (rel < 0) return;
    const g = state.grid;

    const die = (id: string, by: string) => {
      const v = state.players[id];
      if (!v.alive) return;
      v.alive = false;
      v.outAt = now;
      v.dx = v.dy = 0;
      state.lastDeath = now;
      if (by && by !== id) state.players[by].kills += 1;
      ctx.broadcast({ type: 'die', p: id, by, at: rel });
    };

    // chạy
    const bombList = [...state.bombs.values()];
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (!p.alive) continue;
      if (now - p.moveAt > HOLD_TIMEOUT) p.dx = p.dy = 0;
      stepMaze(g, bombList, p, p.dx, p.dy, config.speed + config.speedStep * p.lvl, dt);
    }

    // sập sàn từ ngoài vào
    const shouldClose = rel < config.closeStartMs ? 0 : Math.min(config.spiral.length, Math.floor((rel - config.closeStartMs) / config.closeEveryMs) + 1);
    while (state.closed < shouldClose) {
      const idx = config.spiral[state.closed++];
      g.cells[idx] = CELL_WALL;
      state.items.delete(idx);
      state.flames.delete(idx);
      for (const [bid, b] of state.bombs) if (b.cy * g.cols + b.cx === idx) state.bombs.delete(bid);
      for (const id of ctx.playerIds) {
        const p = state.players[id];
        if (p.alive && Math.floor(p.y) * g.cols + Math.floor(p.x) === idx) die(id, '');
      }
    }

    // bom nổ (nổ dây chuyền xử lý trong cùng một lượt)
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const b of [...state.bombs.values()]) {
        if (b.at > now || !state.bombs.has(b.id)) continue;
        progressed = true;
        state.bombs.delete(b.id);
        const cells: number[] = [];
        const crates: [number, string][] = [];
        const add = (idx: number) => {
          cells.push(idx);
          state.flames.set(idx, { until: now + config.flameMs, owner: b.owner });
          state.items.delete(idx);
        };
        add(b.cy * g.cols + b.cx);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          for (let k = 1; k <= b.range; k++) {
            const cx = b.cx + dx * k;
            const cy = b.cy + dy * k;
            if (!inside(g, cx, cy)) break;
            const idx = cy * g.cols + cx;
            const t = g.cells[idx];
            if (t === CELL_WALL) break;
            if (t === CELL_CRATE) {
              g.cells[idx] = CELL_FLOOR;
              let drop = '';
              if (Math.random() < DROP_CHANCE) {
                drop = KINDS[Math.floor(Math.random() * KINDS.length)];
                state.items.set(idx, drop);
              }
              crates.push([idx, drop]);
              cells.push(idx);
              state.flames.set(idx, { until: now + config.flameMs, owner: b.owner });
              break;
            }
            add(idx);
            // gặp bom khác: kích nổ ngay và dừng lan ở đó
            let chained = false;
            for (const o of state.bombs.values()) {
              if (o.cx === cx && o.cy === cy) {
                o.at = now;
                chained = true;
              }
            }
            if (chained) break;
          }
        }
        ctx.broadcast({ type: 'boom', i: b.id, cells, crates, at: now });
      }
    }

    // lửa: hết hạn thì tắt, ai đang đứng trong lửa thì bị hạ
    for (const [idx, f] of state.flames) if (f.until <= now) state.flames.delete(idx);
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (!p.alive) continue;
      const idx = Math.floor(p.y) * g.cols + Math.floor(p.x);
      const f = state.flames.get(idx);
      if (!f) continue;
      if (now < p.immuneUntil) continue;
      if (p.shield) {
        p.shield = false;
        p.immuneUntil = now + SHIELD_IMMUNE_MS;
        ctx.broadcast({ type: 'shield', p: id });
        continue;
      }
      die(id, f.owner);
    }

    // nhặt vật phẩm
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (!p.alive) continue;
      const idx = Math.floor(p.y) * g.cols + Math.floor(p.x);
      const kind = state.items.get(idx);
      if (!kind) continue;
      state.items.delete(idx);
      if (kind === 'b') p.maxBombs = Math.min(MAX_BOMBS, p.maxBombs + 1);
      else if (kind === 'h') p.shield = true;
      else if (kind === 'f') p.range = Math.min(MAX_RANGE, p.range + 1);
      else p.lvl = Math.min(MAX_LVL, p.lvl + 1);
      ctx.broadcast({ type: 'pick', c: idx, k: kind, p: id });
    }

    if (now - state.lastBroadcast < BROADCAST_MS) return;
    state.lastBroadcast = now;
    const pp: Record<string, number[]> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      pp[id] = [r2(p.x), r2(p.y), p.alive ? 1 : 0, p.maxBombs, p.range, p.lvl, p.shield ? 1 : 0];
    }
    const payload: Record<string, unknown> = { type: 's', p: pp };
    // nhắc lại toàn cảnh mỗi 1,5 giây cho ai vào lại giữa ván
    if (now - state.lastFull >= FULL_MS) {
      state.lastFull = now;
      payload.full = {
        grid: gridToString(g),
        bombs: [...state.bombs.values()].map((b) => [b.id, b.cy * g.cols + b.cx, b.owner, b.at, b.range]),
        flames: [...state.flames].map(([idx, f]) => [idx, f.until]),
        items: [...state.items],
      };
    }
    ctx.broadcast(payload);
  },

  isFinished(ctx, state, config) {
    const now = ctx.now();
    if (now - ctx.startAt >= config.endsAt) return true;
    const alive = ctx.playerIds.filter((id) => state.players[id].alive).length;
    return alive <= 1 && state.lastDeath > 0 && now - state.lastDeath >= END_GRACE;
  },

  calculateScore(ctx, state) {
    const alive = ctx.playerIds.filter((id) => state.players[id].alive).length;
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (p.alive) {
        out[id] = {
          raw: 1_000_000 + p.kills * 5000,
          detail: alive === 1 ? `🏆 sống sót cuối cùng · hạ ${p.kills}` : `sống sót đến hết · hạ ${p.kills}`,
        };
      } else {
        const t = (p.outAt ?? ctx.startAt) - ctx.startAt;
        out[id] = { raw: t + p.kills * 5000, detail: `sống ${(t / 1000).toFixed(0)}s · hạ ${p.kills}` };
      }
    }
    return out;
  },
};
