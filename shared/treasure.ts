// CƯỚP KHO BÁU - lõi mô phỏng XÁC ĐỊNH dùng chung cho server và client.
// Chỉ dùng + - * / và sqrt nên server/client ra cùng bit. Không cấp phát trong vòng bước (typed array cố định).
// Cách mạng giống XE TĂNG: tick cố định 60Hz, input kèm tick, server tua lại riêng người đó, client dự đoán + hoà giải.

export const TICK_HZ = 60;
export const STEP_MS = 1000 / TICK_HZ;
export const MAXP = 6;
/** bán kính người chơi */
export const PR = 11;

/* ---------------- cân bằng: mang càng nhiều càng chậm ---------------- */
/** tốc độ tay không: 160 đơn vị/giây */
export const V0 = 160 / TICK_HZ;
/** số kho báu tối đa mang theo */
export const MAXC = 10;
/** hệ số chậm: tốc độ = V0 / (1 + LOAD_K · số_đang_mang). Bảng SPEED_MUL (0..MAXC) */
export const LOAD_K = 0.14;
export const SPEED_MUL = new Float64Array(MAXC + 1);
for (let l = 0; l <= MAXC; l++) SPEED_MUL[l] = 1 / (1 + LOAD_K * l);
const DIAG = 0.7071067811865476;

/* ---------------- luật ---------------- */
export const BASE_R = 44;
export const ITEM_R = 8;
/** server nhặt khi khoảng cách tâm < PICK_R; client dự đoán nhặt hẹp hơn một chút để ít bị "ảo" */
export const PICK_R = 21;
export const PICK_R_CLIENT = 19;
/** tầm cướp / đẩy (khoảng cách tâm hai người) */
export const ACT_R = 36;
export const STEAL_CD = 60;
export const MISS_CD = 30;
/** miễn nhiễm sau khi bị cướp (1.5s) */
export const IMMUNE_TICKS = 90;
/** người bị cướp không nhặt lại được ngay (0.7s) */
export const LOCK_TICKS = 42;
export const SHOVE_DIST = 26;
export const PILLAR_R = 26;

export const COUNT_TICKS = 120;
export const PLAY_TICKS = 6000;
/** nhịp hồi sinh kho báu giữa sân */
export const WAVE_EVERY = 660;
export const MAXI = 80;
/** số kho báu mỗi đợt theo số người trong đấu trường: công bằng giữa trường 2 và 6 người */
export const FIRST_WAVE_PER_P = 4;
export const WAVE_PER_P = 3;

/** vòng đệm lịch sử vị trí (lag compensation + tua lại), luỹ thừa 2 */
export const RING = 64;
/** tối đa 15 tick (250 ms) bù trễ cho phát cướp */
export const LC_MAX = 15;
/** input chuyển động tới trễ tối đa 24 tick (400 ms) vẫn được tua lại cho khớp bản dự đoán */
export const MOVE_REWIND_MAX = 24;

/** lượng bị cướp khi đang mang L: bị lấy ceil(L/2) (tối thiểu 1); trong số bị lấy, ~40% rơi xuống đất (nếu lấy ≥ 2) */
export function stealSplit(load: number): { lost: number; drop: number } {
  if (load <= 0) return { lost: 0, drop: 0 };
  const lost = Math.max(1, Math.ceil(load / 2));
  const drop = lost >= 2 ? Math.max(1, Math.floor(lost * 0.4)) : 0;
  return { lost, drop };
}

export function arenaDims(n: number): [number, number] {
  if (n <= 3) return [760, 500];
  if (n === 4) return [860, 560];
  return [960, 620];
}

/** chia người vào đấu trường 2-6 người, đều nhau */
export function splitArenas(total: number): number[] {
  const g = Math.max(1, Math.ceil(total / MAXP));
  const base = Math.floor(total / g);
  const extra = total - base * g;
  const out: number[] = [];
  for (let i = 0; i < g; i++) out.push(base + (i < extra ? 1 : 0));
  return out;
}

/** hướng nhìn 0..7 (0 = +x, 2 = xuống màn hình) theo (dx, dy) ∈ {-1,0,1}; -1 = đứng yên */
const FACE_TAB = new Int8Array([5, 6, 7, 4, -1, 0, 3, 2, 1]);
export const faceOf = (dx: number, dy: number) => FACE_TAB[(dy + 1) * 3 + (dx + 1)];
export const faceRad = (f: number) => (f * Math.PI) / 4;
/** hiệu góc ngắn nhất giữa hai góc radian */
export function radDiff(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class TreasureWorld {
  n = 0;
  w = 0;
  h = 0;
  /** tick đã chạy xong gần nhất */
  tick = 0;

  x = new Float64Array(MAXP);
  y = new Float64Array(MAXP);
  face = new Int8Array(MAXP);
  load = new Int32Array(MAXP);

  hx = new Float64Array(MAXP * RING);
  hy = new Float64Array(MAXP * RING);

  /** căn cứ (vòng tròn) */
  bx = new Float64Array(MAXP);
  by = new Float64Array(MAXP);
  /** 4 cột đá */
  px = new Float64Array(4);
  py = new Float64Array(4);

  setup(n: number, w: number, h: number) {
    this.n = n;
    this.w = w;
    this.h = h;
    const cx = w / 2;
    const cy = h / 2;
    const rx = w / 2 - 64;
    const ry = h / 2 - 64;
    const a0 = n === 2 ? Math.PI : -Math.PI / 2;
    for (let i = 0; i < n; i++) {
      const a = a0 + (Math.PI * 2 * i) / n;
      this.bx[i] = cx + Math.cos(a) * rx;
      this.by[i] = cy + Math.sin(a) * ry;
      // xuất phát ngay trong căn cứ, quay mặt vào giữa
      this.x[i] = this.bx[i];
      this.y[i] = this.by[i];
      const dx = cx - this.bx[i];
      const dy = cy - this.by[i];
      this.face[i] = faceOf(Math.abs(dx) > Math.abs(dy) * 0.5 ? (dx > 0 ? 1 : -1) : 0, Math.abs(dy) > Math.abs(dx) * 0.5 ? (dy > 0 ? 1 : -1) : 0);
      this.load[i] = 0;
    }
    const ox = w * 0.2;
    const oy = h * 0.2;
    this.px[0] = cx - ox; this.py[0] = cy - oy;
    this.px[1] = cx + ox; this.py[1] = cy - oy;
    this.px[2] = cx - ox; this.py[2] = cy + oy;
    this.px[3] = cx + ox; this.py[3] = cy + oy;
    for (let i = 0; i < n; i++) for (let k = 0; k < RING; k++) this.recordAt(i, k);
  }

  recordAt(i: number, slot: number) {
    const o = i * RING + slot;
    this.hx[o] = this.x[i];
    this.hy[o] = this.y[i];
  }
  record(i: number) {
    this.recordAt(i, this.tick & (RING - 1));
  }
  restore(i: number, tick: number) {
    const o = i * RING + (tick & (RING - 1));
    this.x[i] = this.hx[o];
    this.y[i] = this.hy[o];
  }

  /** một bước điều khiển của người i: chạy 8 hướng, tốc độ giảm theo số kho báu đang mang */
  step(i: number, dx: number, dy: number) {
    if (dx === 0 && dy === 0) return;
    let vx = dx;
    let vy = dy;
    if (dx !== 0 && dy !== 0) {
      vx *= DIAG;
      vy *= DIAG;
    }
    const l = this.load[i];
    const sp = V0 * SPEED_MUL[l > MAXC ? MAXC : l];
    this.x[i] += vx * sp;
    this.y[i] += vy * sp;
    this.face[i] = faceOf(dx, dy);
    this.collide(i);
  }

  /** giữ trong sân + đẩy ra khỏi cột đá */
  collide(i: number) {
    let x = this.x[i];
    let y = this.y[i];
    const rr = PILLAR_R + PR;
    for (let pass = 0; pass < 2; pass++) {
      for (let p = 0; p < 4; p++) {
        const dx = x - this.px[p];
        const dy = y - this.py[p];
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        if (d2 > 1e-12) {
          const f = rr / Math.sqrt(d2);
          x = this.px[p] + dx * f;
          y = this.py[p] + dy * f;
        } else {
          x = this.px[p] + rr;
        }
      }
      if (x < PR) x = PR;
      else if (x > this.w - PR) x = this.w - PR;
      if (y < PR) y = PR;
      else if (y > this.h - PR) y = this.h - PR;
    }
    this.x[i] = x;
    this.y[i] = y;
  }
}
