// Lưới lục giác dùng chung cho server và client (minigame SÀN TỔ ONG).
// Toạ độ trục (q, r), ô "nhọn đỉnh" (đỉnh hướng theo trục y của sân), tâm lưới ở (0, 0).

export interface HexCell {
  q: number;
  r: number;
}

const SQRT3 = Math.sqrt(3);

/** Thứ tự cố định: theo hàng r rồi tới q. Server và client dựng giống hệt nhau nên chỉ cần gửi `radius`. */
export function hexCells(radius: number): HexCell[] {
  const out: HexCell[] = [];
  for (let r = -radius; r <= radius; r++) {
    for (let q = -radius; q <= radius; q++) {
      if (Math.abs(q + r) <= radius) out.push({ q, r });
    }
  }
  return out;
}

/** Tâm ô theo đơn vị sân; `size` là khoảng cách từ tâm tới đỉnh. */
export function hexCenter(c: HexCell, size: number): { x: number; y: number } {
  return { x: size * SQRT3 * (c.q + c.r / 2), y: size * 1.5 * c.r };
}

/** Ô lục giác chứa một điểm (làm tròn trong toạ độ cube). */
export function hexAt(x: number, y: number, size: number): HexCell {
  const qf = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
  const rf = ((2 / 3) * y) / size;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(-qf - rf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - (-qf - rf));
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

export interface HexGrid {
  radius: number;
  cells: HexCell[];
  /** chỉ số của ô (q, r) trong `cells`, hoặc -1 nếu nằm ngoài lưới */
  indexOf(q: number, r: number): number;
}

export function makeHexGrid(radius: number): HexGrid {
  const cells = hexCells(radius);
  const width = radius * 2 + 1;
  const table = new Int16Array(width * width).fill(-1);
  cells.forEach((c, i) => {
    table[(c.q + radius) * width + (c.r + radius)] = i;
  });
  return {
    radius,
    cells,
    indexOf(q, r) {
      if (Math.abs(q) > radius || Math.abs(r) > radius || Math.abs(q + r) > radius) return -1;
      return table[(q + radius) * width + (r + radius)];
    },
  };
}
