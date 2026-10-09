/**
 * Đấu trường MÃ SÁT THỦ, dùng chung cho server (chốt di chuyển + tầm nhìn) và client (dự đoán vị trí của chính mình).
 * Mọi khối đều chặn tầm nhìn: người sau tường không thấy được nhau, kể cả mã số trên đầu.
 */
export interface CodeBox {
  /** tâm khối (đơn vị sân) */
  x: number;
  y: number;
  w: number;
  d: number;
}

export interface CodeMap {
  w: number;
  h: number;
  radius: number;
  boxes: CodeBox[];
}

const W = 320;
const H = 220;

/** bố cục đối xứng 4 góc (lật qua x và y) + khối lớn ở giữa; mọi khe hở rộng hơn thân người */
export function makeMap(): CodeMap {
  const quarter: CodeBox[] = [
    { x: 74, y: 44, w: 56, d: 9 },
    { x: 44, y: 88, w: 9, d: 46 },
    { x: 112, y: 84, w: 9, d: 38 },
    { x: 140, y: 42, w: 16, d: 16 },
    { x: 84, y: 100, w: 22, d: 12 },
  ];
  const boxes: CodeBox[] = [{ x: W / 2, y: H / 2, w: 34, d: 34 }];
  for (const b of quarter) {
    for (const fx of [false, true]) {
      for (const fy of [false, true]) {
        boxes.push({ x: fx ? W - b.x : b.x, y: fy ? H - b.y : b.y, w: b.w, d: b.d });
      }
    }
  }
  return { w: W, h: H, radius: 5, boxes };
}

/** đẩy vòng tròn ra khỏi mọi khối */
function pushOut(map: CodeMap, p: { x: number; y: number }) {
  const r = map.radius;
  for (const b of map.boxes) {
    const nx = Math.max(b.x - b.w / 2, Math.min(b.x + b.w / 2, p.x));
    const ny = Math.max(b.y - b.d / 2, Math.min(b.y + b.d / 2, p.y));
    const dx = p.x - nx;
    const dy = p.y - ny;
    const dist = Math.hypot(dx, dy);
    if (dist >= r) continue;
    if (dist > 1e-4) {
      p.x = nx + (dx / dist) * r;
      p.y = ny + (dy / dist) * r;
    } else {
      const left = p.x - (b.x - b.w / 2);
      const right = b.x + b.w / 2 - p.x;
      const top = p.y - (b.y - b.d / 2);
      const bottom = b.y + b.d / 2 - p.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) p.x = b.x - b.w / 2 - r;
      else if (m === right) p.x = b.x + b.w / 2 + r;
      else if (m === top) p.y = b.y - b.d / 2 - r;
      else p.y = b.y + b.d / 2 + r;
    }
  }
}

/** một bước di chuyển theo (dx,dy) đã chuẩn hoá, trượt dọc tường */
export function stepCode(map: CodeMap, p: { x: number; y: number }, dx: number, dy: number, speed: number, dt: number) {
  if (dt <= 0) return;
  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy) || 1;
    p.x += (dx / len) * speed * dt;
    p.y += (dy / len) * speed * dt;
  }
  const r = map.radius;
  p.x = Math.max(r, Math.min(map.w - r, p.x));
  p.y = Math.max(r, Math.min(map.h - r, p.y));
  for (let i = 0; i < 2; i++) pushOut(map, p);
  p.x = Math.max(r, Math.min(map.w - r, p.x));
  p.y = Math.max(r, Math.min(map.h - r, p.y));
}

/** điểm (x,y) đứng được, cách mọi khối ít nhất `margin` */
export function freeAt(map: CodeMap, x: number, y: number, margin = 0): boolean {
  const r = map.radius + margin;
  if (x < r || y < r || x > map.w - r || y > map.h - r) return false;
  for (const b of map.boxes) {
    const nx = Math.max(b.x - b.w / 2, Math.min(b.x + b.w / 2, x));
    const ny = Math.max(b.y - b.d / 2, Math.min(b.y + b.d / 2, y));
    if (Math.hypot(nx - x, ny - y) < r) return false;
  }
  return true;
}

/** đoạn thẳng a→b có bị khối nào che không (slab test); false = bị che */
export function los(map: CodeMap, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  for (const b of map.boxes) {
    let t0 = 0;
    let t1 = 1;
    const minX = b.x - b.w / 2;
    const maxX = b.x + b.w / 2;
    const minY = b.y - b.d / 2;
    const maxY = b.y + b.d / 2;
    let hit = true;
    for (const [p, d, lo, hi] of [
      [ax, dx, minX, maxX],
      [ay, dy, minY, maxY],
    ] as const) {
      if (Math.abs(d) < 1e-9) {
        if (p < lo || p > hi) {
          hit = false;
          break;
        }
      } else {
        let ta = (lo - p) / d;
        let tb = (hi - p) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) {
          hit = false;
          break;
        }
      }
    }
    if (hit) return false;
  }
  return true;
}
