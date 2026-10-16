// Bản đồ "ĐỀN HOANG ĐẢO KHỈ": bãi đất trống giữa rừng, tàn tích đền đá, thùng gỗ, đá tảng, cây.
// Vật cản chỉ gồm hình tròn (cột, cây, đá) và hộp thẳng trục (tường, thùng) để va chạm + bắn tia rẻ và xác định.

export const ARENA = 34; // nửa cạnh sân (m)
export const PLAYER_R = 0.42;

export interface Circle { x: number; z: number; r: number; h: number; kind: 'pillar' | 'tree' | 'rock' | 'stump' }
export interface Box { x: number; z: number; hx: number; hz: number; h: number; kind: 'wall' | 'crate' | 'altar' | 'hut' }

const C = (x: number, z: number, r: number, h: number, kind: Circle['kind']): Circle => ({ x, z, r, h, kind });
const B = (x: number, z: number, hx: number, hz: number, h: number, kind: Box['kind']): Box => ({ x, z, hx, hz, h, kind });

export const CIRCLES: Circle[] = [
  // 4 cột đền quanh bàn thờ
  C(-7, -7, 0.9, 6.5, 'pillar'), C(7, -7, 0.9, 6.5, 'pillar'), C(-7, 7, 0.9, 6.5, 'pillar'), C(7, 7, 0.9, 6.5, 'pillar'),
  // cột gãy
  C(-15, -3, 0.8, 2.2, 'pillar'), C(15, 3, 0.8, 2.6, 'pillar'), C(3, 17, 0.8, 1.8, 'pillar'), C(-3, -17, 0.8, 2.4, 'pillar'),
  // cây trong sân
  C(-22, -6, 0.6, 9, 'tree'), C(23, 8, 0.6, 9, 'tree'), C(-9, 24, 0.6, 9, 'tree'), C(10, -24, 0.6, 9, 'tree'),
  C(-26, 15, 0.6, 9, 'tree'), C(26, -14, 0.6, 9, 'tree'), C(18, 25, 0.6, 9, 'tree'), C(-18, -25, 0.6, 9, 'tree'),
  // đá tảng
  C(-12, 13, 1.5, 1.4, 'rock'), C(12, -13, 1.5, 1.4, 'rock'), C(25, 22, 1.3, 1.2, 'rock'), C(-25, -22, 1.3, 1.2, 'rock'),
  C(-28, 3, 1.1, 1.0, 'rock'), C(28, -3, 1.1, 1.0, 'rock'),
  // gốc cây
  C(5, 28, 0.7, 0.7, 'stump'), C(-5, -28, 0.7, 0.7, 'stump'),
];

export const BOXES: Box[] = [
  // bàn thờ chuối vàng giữa sân
  B(0, 0, 1.6, 1.6, 1.2, 'altar'),
  // tường đổ 4 phía (có khe đi qua)
  B(-5, -14, 3.2, 0.5, 2.4, 'wall'), B(6.5, -14, 2.0, 0.5, 1.6, 'wall'),
  B(5, 14, 3.2, 0.5, 2.4, 'wall'), B(-6.5, 14, 2.0, 0.5, 1.6, 'wall'),
  B(-14, 5, 0.5, 3.2, 2.4, 'wall'), B(-14, -6.5, 0.5, 2.0, 1.6, 'wall'),
  B(14, -5, 0.5, 3.2, 2.4, 'wall'), B(14, 6.5, 0.5, 2.0, 1.6, 'wall'),
  // cụm thùng gỗ
  B(-20, -18, 0.6, 0.6, 1.2, 'crate'), B(-18.7, -18, 0.6, 0.6, 1.2, 'crate'), B(-19.4, -16.7, 0.6, 0.6, 1.2, 'crate'),
  B(20, 18, 0.6, 0.6, 1.2, 'crate'), B(21.3, 18.2, 0.6, 0.6, 1.2, 'crate'),
  B(-21, 21, 0.6, 0.6, 1.2, 'crate'), B(19, -21, 0.6, 0.6, 1.2, 'crate'), B(19, -19.7, 0.6, 0.6, 1.2, 'crate'),
  // chòi canh (nhà sàn nhỏ) ở góc
  B(-27, -27, 2.2, 2.2, 3.4, 'hut'), B(27, 27, 2.2, 2.2, 3.4, 'hut'),
];

/** cổng khỉ ùa vào (mép rừng) */
export const SPAWNS: { x: number; z: number }[] = [
  { x: -33, z: 0 }, { x: 33, z: 0 }, { x: 0, z: -33 }, { x: 0, z: 33 },
  { x: -31, z: -14 }, { x: 31, z: 14 }, { x: -14, z: 31 }, { x: 14, z: -31 },
  { x: -32, z: 24 }, { x: 32, z: -24 },
];

export const PLAYER_SPAWNS: { x: number; z: number }[] = [
  { x: -3.5, z: -3.5 }, { x: 3.5, z: -3.5 }, { x: -3.5, z: 3.5 }, { x: 3.5, z: 3.5 },
];

/**
 * Đẩy một hình tròn (x,z,r) ra khỏi mọi vật cản + giữ trong sân.
 * Ghi kết quả vào out[0], out[1]. Xác định, không cấp phát.
 */
export function collide(x: number, z: number, r: number, out: Float64Array, bound = ARENA) {
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < CIRCLES.length; i++) {
      const c = CIRCLES[i];
      const dx = x - c.x;
      const dz = z - c.z;
      const rr = c.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          const k = (rr - d) / d;
          x += dx * k;
          z += dz * k;
        } else {
          x += rr;
        }
      }
    }
    for (let i = 0; i < BOXES.length; i++) {
      const b = BOXES[i];
      const px = x < b.x - b.hx ? b.x - b.hx : x > b.x + b.hx ? b.x + b.hx : x;
      const pz = z < b.z - b.hz ? b.z - b.hz : z > b.z + b.hz ? b.z + b.hz : z;
      const dx = x - px;
      const dz = z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          const k = (r - d) / d;
          x += dx * k;
          z += dz * k;
        } else {
          // tâm nằm trong hộp: đẩy ra cạnh gần nhất
          const ex = b.hx - Math.abs(x - b.x);
          const ez = b.hz - Math.abs(z - b.z);
          if (ex < ez) x = x < b.x ? b.x - b.hx - r : b.x + b.hx + r;
          else z = z < b.z ? b.z - b.hz - r : b.z + b.hz + r;
        }
      }
    }
  }
  const lim = bound - r;
  if (x < -lim) x = -lim;
  else if (x > lim) x = lim;
  if (z < -lim) z = -lim;
  else if (z > lim) z = lim;
  out[0] = x;
  out[1] = z;
}

/**
 * Tia 3D (o + d·t) chạm vật cản/mặt đất gần nhất trong [0, maxT]. Trả t (maxT nếu không chạm).
 * d không cần chuẩn hoá (t tính theo độ dài d).
 */
export function rayWorld(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number) {
  let best = maxT;
  if (dy < -1e-9) {
    const tg = -oy / dy;
    if (tg >= 0 && tg < best) best = tg;
  }
  const a = dx * dx + dz * dz;
  if (a > 1e-12) {
    for (let i = 0; i < CIRCLES.length; i++) {
      const c = CIRCLES[i];
      const fx = ox - c.x;
      const fz = oz - c.z;
      const b = fx * dx + fz * dz;
      const cc = fx * fx + fz * fz - c.r * c.r;
      if (cc <= 0) continue; // đang đứng trong (hiếm) → bỏ qua
      const disc = b * b - a * cc;
      if (disc < 0) continue;
      const t = (-b - Math.sqrt(disc)) / a;
      if (t < 0 || t >= best) continue;
      const y = oy + dy * t;
      if (y >= 0 && y <= c.h) best = t;
    }
  }
  for (let i = 0; i < BOXES.length; i++) {
    const bx = BOXES[i];
    let t0 = 0;
    let t1 = best;
    // slab x
    if (Math.abs(dx) < 1e-12) {
      if (ox < bx.x - bx.hx || ox > bx.x + bx.hx) continue;
    } else {
      let ta = (bx.x - bx.hx - ox) / dx;
      let tb = (bx.x + bx.hx - ox) / dx;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-12) {
      if (oz < bx.z - bx.hz || oz > bx.z + bx.hz) continue;
    } else {
      let ta = (bx.z - bx.hz - oz) / dz;
      let tb = (bx.z + bx.hz - oz) / dz;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    if (Math.abs(dy) < 1e-12) {
      if (oy < 0 || oy > bx.h) continue;
    } else {
      let ta = (0 - oy) / dy;
      let tb = (bx.h - oy) / dy;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    if (t0 < best) best = t0;
  }
  return best;
}

/** đoạn thẳng 2D có bị vật cản che không (pad = nới bán kính vật cản) */
export function losBlocked(x0: number, z0: number, x1: number, z1: number, pad: number) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return false;
  for (let i = 0; i < CIRCLES.length; i++) {
    const c = CIRCLES[i];
    const r = c.r + pad;
    let t = ((c.x - x0) * dx + (c.z - z0) * dz) / a;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = x0 + dx * t - c.x;
    const pz = z0 + dz * t - c.z;
    if (px * px + pz * pz < r * r) return true;
  }
  for (let i = 0; i < BOXES.length; i++) {
    const b = BOXES[i];
    const minx = b.x - b.hx - pad;
    const maxx = b.x + b.hx + pad;
    const minz = b.z - b.hz - pad;
    const maxz = b.z + b.hz + pad;
    let t0 = 0;
    let t1 = 1;
    if (Math.abs(dx) < 1e-12) {
      if (x0 < minx || x0 > maxx) continue;
    } else {
      let ta = (minx - x0) / dx;
      let tb = (maxx - x0) / dx;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-12) {
      if (z0 < minz || z0 > maxz) continue;
    } else {
      let ta = (minz - z0) / dz;
      let tb = (maxz - z0) / dz;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    return true;
  }
  return false;
}
