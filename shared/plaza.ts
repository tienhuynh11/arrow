/**
 * Hòn đảo của GIẢ DẠNG NPC: sàn tròn giữa biển, vật cản rải rác (đài nước, cây, đá, ghế).
 * Dùng lại hàm chạy/va chạm/tầm nhìn của codeArena (bản đồ hộp chữ nhật), thêm kẹp trong vòng tròn.
 */
import type { CodeBox, CodeMap } from './codeArena.js';
import { freeAt, los, stepCode } from './codeArena.js';
export { stepCode, freeAt, los };

/** loại vật cản: 0 đài nước, 1 cây, 2 đá, 3 ghế */
export interface PlazaProp extends CodeBox {
  k: 0 | 1 | 2 | 3;
}

export interface Plaza {
  map: CodeMap;
  props: PlazaProp[];
  cx: number;
  cy: number;
  /** bán kính hòn đảo (đơn vị sân) */
  R: number;
}

export function makePlaza(): Plaza {
  const W = 300;
  const H = 300;
  const cx = W / 2;
  const cy = H / 2;
  const R = 120;
  const props: PlazaProp[] = [{ x: cx, y: cy, w: 34, d: 34, k: 0 }];
  // một mẫu xoay 4 lần quanh tâm (xoay 90°: (a,b) -> (-b,a), đổi w/d)
  const base: { a: number; b: number; w: number; d: number; k: 1 | 2 | 3 }[] = [
    { a: 62, b: 24, w: 12, d: 12, k: 1 },
    { a: 26, b: 80, w: 18, d: 14, k: 2 },
    { a: 88, b: -30, w: 10, d: 30, k: 3 },
  ];
  for (const m of base) {
    let a = m.a;
    let b = m.b;
    let w = m.w;
    let d = m.d;
    for (let i = 0; i < 4; i++) {
      props.push({ x: cx + a, y: cy + b, w, d, k: m.k });
      [a, b] = [-b, a];
      [w, d] = [d, w];
    }
  }
  return { map: { w: W, h: H, radius: 4.2, boxes: props.map(({ x, y, w, d }) => ({ x, y, w, d })) }, props, cx, cy, R };
}

/** kéo điểm (x,y) vào trong đĩa tâm (cx,cy) bán kính r */
export function clampDisk(p: { x: number; y: number }, cx: number, cy: number, r: number) {
  const dx = p.x - cx;
  const dy = p.y - cy;
  const d = Math.hypot(dx, dy);
  if (d > r) {
    p.x = cx + (dx / d) * r;
    p.y = cy + (dy / d) * r;
  }
}

/** đi một bước trên đảo: va chạm hộp + không ra khỏi mép đảo */
export function plazaStep(pl: Plaza, p: { x: number; y: number }, dx: number, dy: number, speed: number, dt: number) {
  const lim = pl.R - pl.map.radius - 1;
  stepCode(pl.map, p, dx, dy, speed, dt);
  for (let i = 0; i < 2; i++) {
    clampDisk(p, pl.cx, pl.cy, lim);
    stepCode(pl.map, p, 0, 0, 0, 1);
  }
  clampDisk(p, pl.cx, pl.cy, lim);
}

/** điểm đứng được trên đảo, cách vật cản và mép đảo ít nhất `margin` */
export function plazaFree(pl: Plaza, x: number, y: number, margin = 0): boolean {
  return Math.hypot(x - pl.cx, y - pl.cy) < pl.R - pl.map.radius - 1 - margin && freeAt(pl.map, x, y, margin);
}
