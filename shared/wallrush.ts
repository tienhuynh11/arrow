// ĐUA TƯỜNG (Quoridor) - luật chơi thuần, dùng chung server + client. Không phụ thuộc gì.
//
// Toạ độ: ô (x, y) với x, y ∈ 0..8; y tăng xuống phía dưới màn hình (y=8 là cạnh dưới).
// Tường: đặt tại GIAO ĐIỂM (x, y), x, y ∈ 0..7 - giao điểm nằm ở góc dưới-phải của ô (x, y).
//   o = 'h' : tường ngang, chắn giữa hàng y và y+1, phủ cột x và x+1
//   o = 'v' : tường dọc,  chắn giữa cột x và x+1, phủ hàng y và y+1

export const N = 9;
export const WALL_N = N - 1;

export type Orient = 'h' | 'v';
export interface Pos {
  x: number;
  y: number;
}
export interface Wall {
  x: number;
  y: number;
  o: Orient;
}

/** cạnh xuất phát: S = dưới, N = trên, W = trái, E = phải */
export type Side = 'S' | 'N' | 'W' | 'E';

/** thứ tự ghế = thứ tự lượt (đi vòng quanh bàn) */
export const SEATS_BY_COUNT: Record<number, Side[]> = {
  1: ['S'],
  2: ['S', 'N'],
  3: ['S', 'W', 'N'],
  4: ['S', 'W', 'N', 'E'],
};

export const WALLS_BY_COUNT: Record<number, number> = { 1: 10, 2: 10, 3: 6, 4: 5 };

const MID = (N - 1) / 2;

export function startPos(side: Side): Pos {
  if (side === 'S') return { x: MID, y: N - 1 };
  if (side === 'N') return { x: MID, y: 0 };
  if (side === 'W') return { x: 0, y: MID };
  return { x: N - 1, y: MID };
}

/** đích = cạnh đối diện */
export function reachedGoal(side: Side, p: Pos): boolean {
  if (side === 'S') return p.y === 0;
  if (side === 'N') return p.y === N - 1;
  if (side === 'W') return p.x === N - 1;
  return p.x === 0;
}

export interface Board {
  sides: Side[];
  pos: Pos[];
  walls: Wall[];
  wallsLeft: number[];
}

export function newBoard(count: number): Board {
  const c = Math.max(1, Math.min(4, count));
  const sides = SEATS_BY_COUNT[c];
  return {
    sides,
    pos: sides.map(startPos),
    walls: [],
    wallsLeft: sides.map(() => WALLS_BY_COUNT[c]),
  };
}

/* ---------------- tường chặn ---------------- */

/** hb[y*N+x]: chặn giữa (x,y) và (x,y+1) · vb[y*N+x]: chặn giữa (x,y) và (x+1,y) */
export interface Edges {
  hb: Uint8Array;
  vb: Uint8Array;
}

export function buildEdges(walls: readonly Wall[]): Edges {
  const hb = new Uint8Array(N * N);
  const vb = new Uint8Array(N * N);
  for (const w of walls) addWall({ hb, vb }, w);
  return { hb, vb };
}

function addWall(e: Edges, w: Wall) {
  if (w.o === 'h') {
    e.hb[w.y * N + w.x] = 1;
    e.hb[w.y * N + w.x + 1] = 1;
  } else {
    e.vb[w.y * N + w.x] = 1;
    e.vb[(w.y + 1) * N + w.x] = 1;
  }
}

const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N;

/** có tường (hoặc biên) chắn bước (x,y) → (x+dx,y+dy)? dx,dy ∈ {-1,0,1}, đúng một trục */
export function blocked(e: Edges, x: number, y: number, dx: number, dy: number): boolean {
  const nx = x + dx;
  const ny = y + dy;
  if (!inB(nx, ny)) return true;
  if (dx === 1) return e.vb[y * N + x] === 1;
  if (dx === -1) return e.vb[y * N + nx] === 1;
  if (dy === 1) return e.hb[y * N + x] === 1;
  return e.hb[ny * N + x] === 1;
}

const DIRS: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/* ---------------- đường đi ---------------- */

/** khoảng cách (số bước đi thường, bỏ qua quân khác) từ mọi ô tới cạnh đích; -1 = không tới được */
export function distanceField(e: Edges, side: Side): Int16Array {
  const dist = new Int16Array(N * N).fill(-1);
  const q: number[] = [];
  for (let i = 0; i < N; i++) {
    const p: Pos = side === 'S' ? { x: i, y: 0 } : side === 'N' ? { x: i, y: N - 1 } : side === 'W' ? { x: N - 1, y: i } : { x: 0, y: i };
    dist[p.y * N + p.x] = 0;
    q.push(p.y * N + p.x);
  }
  for (let h = 0; h < q.length; h++) {
    const cur = q[h];
    const cx = cur % N;
    const cy = (cur - cx) / N;
    for (const [dx, dy] of DIRS) {
      if (blocked(e, cx, cy, dx, dy)) continue;
      const ni = (cy + dy) * N + cx + dx;
      if (dist[ni] >= 0) continue;
      dist[ni] = dist[cur] + 1;
      q.push(ni);
    }
  }
  return dist;
}

export function pathLength(e: Edges, side: Side, p: Pos): number {
  return distanceField(e, side)[p.y * N + p.x];
}

/* ---------------- nước đi ---------------- */

/** các ô quân `i` được phép bước tới (có nhảy qua quân khác / bước chéo) */
export function legalMoves(b: Board, i: number): Pos[] {
  const e = buildEdges(b.walls);
  return legalMovesE(e, b.pos, i);
}

export function legalMovesE(e: Edges, all: readonly Pos[], i: number): Pos[] {
  const me = all[i];
  const occ = (x: number, y: number) => all.some((p, j) => j !== i && p.x === x && p.y === y);
  const out: Pos[] = [];
  const push = (x: number, y: number) => {
    if (!out.some((p) => p.x === x && p.y === y)) out.push({ x, y });
  };
  for (const [dx, dy] of DIRS) {
    if (blocked(e, me.x, me.y, dx, dy)) continue;
    const nx = me.x + dx;
    const ny = me.y + dy;
    if (!occ(nx, ny)) {
      push(nx, ny);
      continue;
    }
    // ô kế có quân: nhảy thẳng nếu phía sau trống và không bị chặn
    const fx = nx + dx;
    const fy = ny + dy;
    if (!blocked(e, nx, ny, dx, dy) && !occ(fx, fy)) {
      push(fx, fy);
      continue;
    }
    // bị chặn → bước chéo sang hai bên quân đó
    const sides: [number, number][] = dx === 0 ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
    for (const [sx, sy] of sides) {
      if (blocked(e, nx, ny, sx, sy)) continue;
      const tx = nx + sx;
      const ty = ny + sy;
      if (!occ(tx, ty)) push(tx, ty);
    }
  }
  return out;
}

export type MoveKind = 'step' | 'jump' | 'diag';

/** loại nước đi (chỉ gọi với nước đã hợp lệ): bước thường / nhảy qua quân / bước chéo */
export function moveKind(from: Pos, to: Pos): MoveKind {
  const d = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  if (d === 1) return 'step';
  if (d === 2 && (to.x === from.x || to.y === from.y)) return 'jump';
  return 'diag';
}

export function isLegalMove(b: Board, i: number, to: Pos): boolean {
  return legalMoves(b, i).some((p) => p.x === to.x && p.y === to.y);
}

/** quân đứng ở giữa nước nhảy / nước chéo (để hiện "A nhảy qua B"); -1 nếu bước thường */
export function jumpedOver(b: Board, i: number, to: Pos): number {
  const from = b.pos[i];
  const kind = moveKind(from, to);
  if (kind === 'step') return -1;
  for (let j = 0; j < b.pos.length; j++) {
    if (j === i) continue;
    const p = b.pos[j];
    if (kind === 'jump' && p.x === (from.x + to.x) / 2 && p.y === (from.y + to.y) / 2) return j;
    if (kind === 'diag' && Math.abs(p.x - from.x) + Math.abs(p.y - from.y) === 1 && Math.abs(p.x - to.x) + Math.abs(p.y - to.y) === 1) return j;
  }
  return -1;
}

/** nước đi tự động (hết giờ lượt): bước làm quãng đường ngắn nhất giảm nhiều nhất */
export function autoMove(b: Board, i: number): Pos | null {
  const e = buildEdges(b.walls);
  const df = distanceField(e, b.sides[i]);
  const moves = legalMovesE(e, b.pos, i);
  let best: Pos | null = null;
  let bd = Infinity;
  for (const m of moves) {
    const d = df[m.y * N + m.x];
    const dd = d < 0 ? 999 : d;
    if (dd < bd) {
      bd = dd;
      best = m;
    }
  }
  return best;
}

/* ---------------- đặt tường ---------------- */

export type WallCheck = { ok: true } | { ok: false; reason: string };

/** kiểm tra tường (không tính lượt/số tường còn lại): trong bàn, không chồng/cắt, không bít kín đường của bất kỳ quân nào */
export function checkWallShape(b: Board, w: Wall): WallCheck {
  if (!Number.isInteger(w.x) || !Number.isInteger(w.y) || (w.o !== 'h' && w.o !== 'v')) return { ok: false, reason: 'tường không hợp lệ' };
  if (w.x < 0 || w.y < 0 || w.x >= WALL_N || w.y >= WALL_N) return { ok: false, reason: 'ngoài bàn cờ' };
  for (const o of b.walls) {
    if (o.x === w.x && o.y === w.y) return { ok: false, reason: o.o === w.o ? 'trùng tường khác' : 'cắt chéo tường khác' };
    if (o.o === w.o) {
      if (w.o === 'h' && o.y === w.y && Math.abs(o.x - w.x) === 1) return { ok: false, reason: 'chồng lên tường khác' };
      if (w.o === 'v' && o.x === w.x && Math.abs(o.y - w.y) === 1) return { ok: false, reason: 'chồng lên tường khác' };
    }
  }
  const e = buildEdges(b.walls);
  addWall(e, w);
  for (let i = 0; i < b.pos.length; i++) {
    if (pathLength(e, b.sides[i], b.pos[i]) < 0) return { ok: false, reason: 'chặn kín đường' };
  }
  return { ok: true };
}

/** kiểm tra đầy đủ cho người chơi `i` đặt tường */
export function checkWall(b: Board, i: number, w: Wall): WallCheck {
  if ((b.wallsLeft[i] ?? 0) <= 0) return { ok: false, reason: 'hết tường' };
  return checkWallShape(b, w);
}

/** quãng đường ngắn nhất còn lại của quân i (-1 nếu bị bít, không xảy ra với bàn hợp lệ) */
export function remaining(b: Board, i: number): number {
  return pathLength(buildEdges(b.walls), b.sides[i], b.pos[i]);
}

/** chia người chơi thành các bàn 2–4 người, đều nhau (5→3+2, 7→4+3, 16→4×4) */
export function tableSizes(n: number): number[] {
  if (n <= 0) return [];
  if (n <= 4) return [n];
  const t = Math.ceil(n / 4);
  const base = Math.floor(n / t);
  const extra = n - base * t;
  return Array.from({ length: t }, (_, i) => base + (i < extra ? 1 : 0));
}
