/**
 * Luật dùng chung của MÊ CUNG ĐẶT BOM: lưới ô vuông, di chuyển mượt có trượt qua góc, danh sách vòng sập sàn.
 * Server chốt mọi thứ; client dùng cùng hàm này để dự đoán vị trí của chính mình.
 * Toạ độ tính theo ô (đơn vị = 1 ô): người đứng ở (x, y) thì đang ở ô (floor(x), floor(y)).
 */
export const CELL_FLOOR = 0;
export const CELL_WALL = 1;
export const CELL_CRATE = 2;

/** nửa cạnh thân người (< 0.5 để lọt hành lang 1 ô, đủ rộng để có chỗ trượt góc) */
export const BODY = 0.36;

/** lệch tâm làn tối đa (ô) mà còn tự kéo về tâm khi chạy; phần kéo = tỉ lệ so với quãng đã đi */
const LANE_SNAP = 0.3;
const LANE_PULL = 0.6;

export interface MazeGrid {
  cols: number;
  rows: number;
  /** CELL_* cho từng ô (hàng trước, cột sau) */
  cells: Uint8Array;
}

export const parseGrid = (cols: number, rows: number, str: string): MazeGrid => {
  const cells = new Uint8Array(cols * rows);
  for (let i = 0; i < cells.length; i++) cells[i] = str.charCodeAt(i) - 48;
  return { cols, rows, cells };
};

export const gridToString = (g: MazeGrid) => {
  let s = '';
  for (let i = 0; i < g.cells.length; i++) s += g.cells[i];
  return s;
};

export const inside = (g: MazeGrid, cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < g.cols && cy < g.rows;

export interface BombAt {
  cx: number;
  cy: number;
}

/** ô có chặn người này không: tường, thùng, hoặc bom (trừ bom mà người đó đang đứng chồng lên — đi ra được rồi thì không quay lại) */
function blocked(g: MazeGrid, bombs: BombAt[], cx: number, cy: number, px: number, py: number): boolean {
  if (!inside(g, cx, cy)) return true;
  if (g.cells[cy * g.cols + cx] !== CELL_FLOOR) return true;
  for (const b of bombs) {
    if (b.cx !== cx || b.cy !== cy) continue;
    // đang chồng lên bom này → được đi xuyên cho tới khi bước ra khỏi ô
    const overlap = Math.abs(px - (cx + 0.5)) < 0.5 + BODY && Math.abs(py - (cy + 0.5)) < 0.5 + BODY;
    if (!overlap) return true;
  }
  return false;
}

/** hộp của người tại (x,y) có vướng ô nào không */
function hits(g: MazeGrid, bombs: BombAt[], x: number, y: number, ox: number, oy: number): boolean {
  const x0 = Math.floor(x - BODY);
  const x1 = Math.floor(x + BODY);
  const y0 = Math.floor(y - BODY);
  const y1 = Math.floor(y + BODY);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (blocked(g, bombs, cx, cy, ox, oy)) return true;
  return false;
}

/** chạy 4 hướng: dx hoặc dy khác 0 (dx được ưu tiên). Có trượt qua góc để rẽ vào hành lang không cần canh chuẩn. */
export function stepMaze(g: MazeGrid, bombs: BombAt[], p: { x: number; y: number }, dx: number, dy: number, speed: number, dt: number) {
  if (dt <= 0 || (dx === 0 && dy === 0)) return;
  const horiz = dx !== 0;
  const s = Math.sign(horiz ? dx : dy);
  let left = speed * dt;
  while (left > 1e-6) {
    const step = Math.min(left, 0.2);
    left -= step;
    const ox = p.x;
    const oy = p.y;
    const nx = horiz ? p.x + s * step : p.x;
    const ny = horiz ? p.y : p.y + s * step;
    // bom được coi là "đang chồng lên" theo vị trí cũ của người chơi
    if (!hits(g, bombs, nx, ny, ox, oy)) {
      p.x = nx;
      p.y = ny;
      // tự căn làn kiểu Bomberman: lệch tâm làn ít thì kéo dần về tâm (chỉ khi chỗ đó không vướng) → rẽ trơn, không kẹt mép
      const cur = horiz ? p.y : p.x;
      const off = Math.floor(cur) + 0.5 - cur;
      if (off !== 0 && Math.abs(off) <= LANE_SNAP) {
        const adj = cur + Math.sign(off) * Math.min(Math.abs(off), step * LANE_PULL);
        const ax = horiz ? p.x : adj;
        const ay = horiz ? adj : p.y;
        if (!hits(g, bombs, ax, ay, ox, oy)) {
          p.x = ax;
          p.y = ay;
        }
      }
      continue;
    }
    // vướng: áp sát mép ô chặn
    if (horiz) {
      const col = Math.floor(nx + s * BODY);
      const edge = s > 0 ? col - BODY - 1e-4 : col + 1 + BODY + 1e-4;
      // hộp hai hàng, một hàng thông: nhích dần sang hàng thông
      const r0 = Math.floor(p.y - BODY);
      const r1 = Math.floor(p.y + BODY);
      if (r0 !== r1) {
        const free0 = !blocked(g, bombs, col, r0, ox, oy);
        const free1 = !blocked(g, bombs, col, r1, ox, oy);
        if (free0 !== free1) {
          const target = (free0 ? r0 : r1) + 0.5;
          const d = target - p.y;
          p.y += Math.sign(d) * Math.min(Math.abs(d), step);
          continue;
        }
      }
      if (s > 0 ? edge > p.x : edge < p.x) p.x = edge;
    } else {
      const row = Math.floor(ny + s * BODY);
      const edge = s > 0 ? row - BODY - 1e-4 : row + 1 + BODY + 1e-4;
      const c0 = Math.floor(p.x - BODY);
      const c1 = Math.floor(p.x + BODY);
      if (c0 !== c1) {
        const free0 = !blocked(g, bombs, c0, row, ox, oy);
        const free1 = !blocked(g, bombs, c1, row, ox, oy);
        if (free0 !== free1) {
          const target = (free0 ? c0 : c1) + 0.5;
          const d = target - p.x;
          p.x += Math.sign(d) * Math.min(Math.abs(d), step);
          continue;
        }
      }
      if (s > 0 ? edge > p.y : edge < p.y) p.y = edge;
    }
    break;
  }
}

/** thứ tự sập sàn: từ vòng ngoài xoáy dần vào tâm, chỉ gồm ô không phải tường cố định */
export function spiralOrder(g: MazeGrid): number[] {
  const out: number[] = [];
  let x0 = 1;
  let y0 = 1;
  let x1 = g.cols - 2;
  let y1 = g.rows - 2;
  const add = (cx: number, cy: number) => {
    const i = cy * g.cols + cx;
    if (g.cells[i] !== CELL_WALL) out.push(i);
  };
  while (x0 <= x1 && y0 <= y1) {
    for (let x = x0; x <= x1; x++) add(x, y0);
    for (let y = y0 + 1; y <= y1; y++) add(x1, y);
    if (y1 > y0) for (let x = x1 - 1; x >= x0; x--) add(x, y1);
    if (x1 > x0) for (let y = y1 - 1; y > y0; y--) add(x0, y);
    x0++;
    y0++;
    x1--;
    y1--;
  }
  return out;
}
