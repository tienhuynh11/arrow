// XE TĂNG ĐẠN NẢY - lõi mô phỏng XÁC ĐỊNH dùng chung cho server và client.
// Chỉ dùng + - * / sqrt và bảng sin/cos tự dựng (không Math.sin/cos) nên mọi engine ra cùng bit.
// Không cấp phát trong vòng bước: toàn bộ là typed array cố định kích thước.

export const TICK_HZ = 60;
export const STEP_MS = 1000 / TICK_HZ;
/** ô mê cung (đơn vị thế giới) */
export const CELL = 60;
export const WALL_HT = 3.5;
export const TANK_R = 11;
export const BULLET_R = 2.2;
/** góc là số nguyên 0..1023 (1024 = một vòng); 0 = +x, 256 = +y (hướng xuống màn hình) */
export const ANG_N = 1024;
export const ANG_MASK = ANG_N - 1;
export const TURN_RATE = 7;
export const V_FWD = 80 / TICK_HZ;
export const V_BACK = 52 / TICK_HZ;
export const MAXT = 6;
export const MAXB = 96;
/** vòng đệm lịch sử vị trí xe (lag compensation + rewind), phải là luỹ thừa 2 */
export const RING = 64;
export const MUZZLE = 13;
export const IMMUNE_DIST = 30;
/** tối đa 15 tick (250 ms) bù trễ cho phát bắn */
export const LC_MAX = 15;
/** input chuyển động tới trễ tối đa 24 tick (400 ms) vẫn được tua lại cho khớp bản dự đoán */
export const MOVE_REWIND_MAX = 24;

/* ---------------- bảng lượng giác tự dựng ---------------- */
function sinT(x: number) {
  let t = x;
  let s = x;
  for (let n = 1; n < 10; n++) {
    t *= (-x * x) / ((2 * n) * (2 * n + 1));
    s += t;
  }
  return s;
}
function cosT(x: number) {
  let t = 1;
  let s = 1;
  for (let n = 1; n < 10; n++) {
    t *= (-x * x) / ((2 * n - 1) * (2 * n));
    s += t;
  }
  return s;
}
export const SIN = new Float64Array(ANG_N);
export const COS = new Float64Array(ANG_N);
(function buildTables() {
  const PI = 3.141592653589793;
  for (let i = 0; i < ANG_N; i++) {
    const q = i >> 8;
    const r = i & 255;
    let s0: number;
    let c0: number;
    if (r <= 128) {
      const x = (r * PI) / 512;
      s0 = sinT(x);
      c0 = cosT(x);
    } else {
      const x2 = ((256 - r) * PI) / 512;
      s0 = cosT(x2);
      c0 = sinT(x2);
    }
    if (q === 0) { COS[i] = c0; SIN[i] = s0; }
    else if (q === 1) { COS[i] = -s0; SIN[i] = c0; }
    else if (q === 2) { COS[i] = -c0; SIN[i] = -s0; }
    else { COS[i] = s0; SIN[i] = -c0; }
  }
})();

/** vòng góc (số nguyên) → radian, chỉ để hiển thị */
export const angToRad = (a: number) => (a * Math.PI * 2) / ANG_N;
/** hiệu góc ngắn nhất, trong (-512, 512] */
export function angDiff(a: number, b: number) {
  let d = (b - a) & ANG_MASK;
  if (d > ANG_N / 2) d -= ANG_N;
  return d;
}

/* ---------------- PRNG có seed ---------------- */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- loại đạn / vật phẩm ---------------- */
export const BK_NORMAL = 0;
export const BK_RAPID = 1;
export const BK_PELLET = 2;
export const BK_MISSILE = 3;
export const BSPEED = [200 / TICK_HZ, 270 / TICK_HZ, 200 / TICK_HZ, 150 / TICK_HZ];
export const BLIFE = [480, 150, 360, 300];

/** vật phẩm / vũ khí đang cầm (0 = không) */
export const WP_NONE = 0;
export const WP_RAPID = 1;
export const WP_SPREAD = 2;
export const WP_LASER = 3;
export const WP_MISSILE = 4;
export const PK_SHIELD = 5;
export const PK_NAME = ['', 'LIÊN THANH', 'ĐẠN CHÙM', 'TIA LAZE', 'TÊN LỬA', 'KHIÊN'];
export const PK_ICON = ['', '🔫', '💥', '⚡', '🎯', '🛡'];
/** lượng dùng: rapid = tick, còn lại = số phát */
export const PK_AMOUNT = [0, 360, 4, 1, 2, 0];
export const SPREAD_OFF = 34;
export const SHIELD_TICKS = 900;

export function fireCooldown(w: number, sudden: boolean) {
  if (w === WP_RAPID) return 5;
  if (sudden) return 8;
  if (w === WP_SPREAD) return 18;
  if (w === WP_LASER || w === WP_MISSILE) return 30;
  return 15;
}
export function fireCap(w: number, sudden: boolean) {
  if (w === WP_RAPID || sudden) return 10;
  if (w === WP_SPREAD) return 9;
  if (w === WP_LASER || w === WP_MISSILE) return 99;
  return 5;
}

/* ---------------- mê cung ---------------- */
export function mazeDims(n: number): [number, number] {
  if (n <= 3) return [9, 7];
  if (n === 4) return [10, 8];
  return [12, 9];
}

export class Maze {
  w = 0;
  h = 0;
  /** tường ngang: dòng j (0..h) cột i: hw[j*w+i] */
  hw = new Uint8Array(0);
  /** tường dọc: hàng j cột i (0..w): vw[j*(w+1)+i] */
  vw = new Uint8Array(0);

  gen(seed: number, w: number, h: number, rng: () => number) {
    this.w = w;
    this.h = h;
    this.hw = new Uint8Array((h + 1) * w).fill(1);
    this.vw = new Uint8Array(h * (w + 1)).fill(1);
    const seen = new Uint8Array(w * h);
    const stack = new Int16Array(w * h);
    const nb = new Int8Array(4);
    let sp = 0;
    const start = Math.floor(rng() * w * h);
    stack[sp++] = start;
    seen[start] = 1;
    while (sp > 0) {
      const c = stack[sp - 1];
      const cx = c % w;
      const cy = (c / w) | 0;
      let m = 0;
      if (cx > 0 && !seen[c - 1]) nb[m++] = 0;
      if (cx < w - 1 && !seen[c + 1]) nb[m++] = 1;
      if (cy > 0 && !seen[c - w]) nb[m++] = 2;
      if (cy < h - 1 && !seen[c + w]) nb[m++] = 3;
      if (m === 0) {
        sp--;
        continue;
      }
      const d = nb[Math.floor(rng() * m)];
      let nc: number;
      if (d === 0) { nc = c - 1; this.vw[cy * (w + 1) + cx] = 0; }
      else if (d === 1) { nc = c + 1; this.vw[cy * (w + 1) + cx + 1] = 0; }
      else if (d === 2) { nc = c - w; this.hw[cy * w + cx] = 0; }
      else { nc = c + w; this.hw[(cy + 1) * w + cx] = 0; }
      seen[nc] = 1;
      stack[sp++] = nc;
    }
    // lối thông phụ: mê cung có vòng lặp, ít ngõ cụt
    const extra = Math.max(4, Math.round(w * h * 0.2));
    for (let k = 0; k < extra; k++) {
      if (rng() < 0.5) {
        const j = 1 + Math.floor(rng() * (h - 1));
        const i = Math.floor(rng() * w);
        this.hw[j * w + i] = 0;
      } else {
        const j = Math.floor(rng() * h);
        const i = 1 + Math.floor(rng() * (w - 1));
        this.vw[j * (w + 1) + i] = 0;
      }
    }
  }
}

/* ---------------- va chạm với tường ---------------- */
const BOX = new Float64Array(64);

/** gom các hộp tường quanh ô (cx, cy); mỗi hộp 4 số xmin,xmax,ymin,ymax */
function gather(m: Maze, cx: number, cy: number): number {
  let n = 0;
  const w = m.w;
  const h = m.h;
  for (let j = cy; j <= cy + 1; j++) {
    if (j < 0 || j > h) continue;
    for (let i = cx - 1; i <= cx + 1; i++) {
      if (i < 0 || i >= w) continue;
      if (m.hw[j * w + i]) {
        BOX[n++] = i * CELL - WALL_HT;
        BOX[n++] = (i + 1) * CELL + WALL_HT;
        BOX[n++] = j * CELL - WALL_HT;
        BOX[n++] = j * CELL + WALL_HT;
      }
    }
  }
  for (let i = cx; i <= cx + 1; i++) {
    if (i < 0 || i > w) continue;
    for (let j = cy - 1; j <= cy + 1; j++) {
      if (j < 0 || j >= h) continue;
      if (m.vw[j * (w + 1) + i]) {
        BOX[n++] = i * CELL - WALL_HT;
        BOX[n++] = i * CELL + WALL_HT;
        BOX[n++] = j * CELL - WALL_HT;
        BOX[n++] = (j + 1) * CELL + WALL_HT;
      }
    }
  }
  return n >> 2;
}

const cellOf = (v: number, n: number) => {
  const c = Math.floor(v / CELL);
  return c < 0 ? 0 : c >= n ? n - 1 : c;
};

/** kết quả của sweep (module-level để khỏi cấp phát) */
const SW = { t: 0, ax: 0 };

/**
 * Quét một điểm (bán kính rad) đi theo (vx, vy) trong thời gian tối đa tmax, tìm lần chạm tường ĐẦU TIÊN.
 * Hộp tường được nở ra rad nên điểm-vs-hộp. ax: 1 = mặt vuông góc trục x, 2 = trục y, 3 = đúng góc (cả hai).
 */
function sweep(m: Maze, px: number, py: number, vx: number, vy: number, tmax: number, rad: number): boolean {
  const nb = gather(m, cellOf(px, m.w), cellOf(py, m.h));
  let best = Infinity;
  let bestAx = 0;
  for (let k = 0; k < nb; k++) {
    const o = k << 2;
    const xmin = BOX[o] - rad;
    const xmax = BOX[o + 1] + rad;
    const ymin = BOX[o + 2] - rad;
    const ymax = BOX[o + 3] + rad;
    let tnx: number;
    let tex: number;
    let tny: number;
    let tey: number;
    if (vx > 0) { tnx = (xmin - px) / vx; tex = (xmax - px) / vx; }
    else if (vx < 0) { tnx = (xmax - px) / vx; tex = (xmin - px) / vx; }
    else {
      if (px < xmin || px > xmax) continue;
      tnx = -Infinity;
      tex = Infinity;
    }
    if (vy > 0) { tny = (ymin - py) / vy; tey = (ymax - py) / vy; }
    else if (vy < 0) { tny = (ymax - py) / vy; tey = (ymin - py) / vy; }
    else {
      if (py < ymin || py > ymax) continue;
      tny = -Infinity;
      tey = Infinity;
    }
    const en = tnx > tny ? tnx : tny;
    const ex = tex < tey ? tex : tey;
    if (en > ex || en < 0 || en >= best || en > tmax) continue;
    best = en;
    bestAx = tnx > tny + 1e-9 ? 1 : tny > tnx + 1e-9 ? 2 : 3;
  }
  if (bestAx === 0) return false;
  SW.t = best;
  SW.ax = bestAx;
  return true;
}

/**
 * Vết tia laze: các điểm gãy (x0,y0,x1,y1,...) ghi vào out, trả số điểm.
 * Cùng hàm sweep với đạn nên phản xạ y hệt.
 */
export function traceRay(m: Maze, x: number, y: number, ang: number, maxLen: number, maxBounce: number, out: Float64Array): number {
  let vx = COS[ang];
  let vy = SIN[ang];
  let n = 0;
  out[n++] = x;
  out[n++] = y;
  let rem = maxLen;
  for (let b = 0; b <= maxBounce && rem > 1e-6; b++) {
    if (sweep(m, x, y, vx, vy, rem, 1)) {
      const t = SW.t;
      x += vx * t;
      y += vy * t;
      rem -= t;
      out[n++] = x;
      out[n++] = y;
      if (SW.ax & 1) vx = -vx;
      if (SW.ax & 2) vy = -vy;
    } else {
      x += vx * rem;
      y += vy * rem;
      out[n++] = x;
      out[n++] = y;
      rem = 0;
    }
  }
  return n >> 1;
}

/** khoảng cách bình phương từ điểm tới đoạn */
export function segDist2(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((cx - x0) * dx + (cy - y0) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = x0 + dx * t - cx;
  const ey = y0 + dy * t - cy;
  return ex * ex + ey * ey;
}

/* ---------------- thế giới ---------------- */
export const B_BOUNCED = 1;
export const B_DEAD = 2;
export const B_EXPIRED = 4;

export class TankWorld {
  maze = new Maze();
  n = 0;
  /** tick đã chạy xong gần nhất */
  tick = 0;

  x = new Float64Array(MAXT);
  y = new Float64Array(MAXT);
  ang = new Int32Array(MAXT);
  alive = new Uint8Array(MAXT);
  spawnCell = new Int16Array(MAXT);

  hx = new Float64Array(MAXT * RING);
  hy = new Float64Array(MAXT * RING);
  ha = new Int32Array(MAXT * RING);

  bAct = new Uint8Array(MAXB);
  bx = new Float64Array(MAXB);
  by = new Float64Array(MAXB);
  bvx = new Float64Array(MAXB);
  bvy = new Float64Array(MAXB);
  bown = new Int8Array(MAXB);
  bkind = new Uint8Array(MAXB);
  bid = new Int32Array(MAXB);
  blife = new Int32Array(MAXB);
  bdist = new Float64Array(MAXB);
  bbn = new Int32Array(MAXB);
  bang = new Int32Array(MAXB);
  /** tick đạn được bắn (để dọn đạn dự đoán không được xác nhận) */
  bbirth = new Int32Array(MAXB);
  bn = 0;

  /** dựng mê cung + chỗ đứng cho một vòng; seed chung giữa server và client */
  setup(seed: number, w: number, h: number, n: number) {
    const rng = mulberry32(seed);
    this.maze.gen(seed, w, h, rng);
    this.n = n;
    // chọn ô xuất phát xa nhau (khoảng cách Manhattan lớn nhất tới các ô đã chọn)
    const total = w * h;
    const chosen = this.spawnCell;
    chosen[0] = Math.floor(rng() * total);
    for (let k = 1; k < n; k++) {
      let best = -1;
      let bestScore = -1;
      for (let c = 0; c < total; c++) {
        let md = 1e9;
        for (let q = 0; q < k; q++) {
          const d = Math.abs((c % w) - (chosen[q] % w)) + Math.abs(((c / w) | 0) - ((chosen[q] / w) | 0));
          if (d < md) md = d;
        }
        const sc = md + rng() * 0.9;
        if (sc > bestScore) {
          bestScore = sc;
          best = c;
        }
      }
      chosen[k] = best;
    }
    for (let i = 0; i < n; i++) {
      const cx = this.spawnCell[i] % w;
      const cy = (this.spawnCell[i] / w) | 0;
      this.x[i] = (cx + 0.5) * CELL;
      this.y[i] = (cy + 0.5) * CELL;
      const dx = w / 2 - (cx + 0.5);
      const dy = h / 2 - (cy + 0.5);
      this.ang[i] = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 512) : dy > 0 ? 256 : 768;
      this.alive[i] = 1;
    }
    this.bAct.fill(0);
    this.bn = 0;
    for (let i = 0; i < n; i++) for (let k = 0; k < RING; k++) this.recordAt(i, k);
  }

  recordAt(i: number, slot: number) {
    const o = i * RING + slot;
    this.hx[o] = this.x[i];
    this.hy[o] = this.y[i];
    this.ha[o] = this.ang[i];
  }
  record(i: number) {
    this.recordAt(i, this.tick & (RING - 1));
  }
  restore(i: number, tick: number) {
    const o = i * RING + (tick & (RING - 1));
    this.x[i] = this.hx[o];
    this.y[i] = this.hy[o];
    this.ang[i] = this.ha[o];
  }

  /** một bước điều khiển của xe i: xoay + tiến/lùi + trượt dọc tường */
  stepTank(i: number, turn: number, move: number) {
    if (turn !== 0) this.ang[i] = (this.ang[i] + turn * TURN_RATE) & ANG_MASK;
    if (move !== 0) {
      const a = this.ang[i];
      const sp = move > 0 ? V_FWD : -V_BACK;
      this.x[i] += COS[a] * sp;
      this.y[i] += SIN[a] * sp;
      this.collideTank(i);
    }
  }

  /** đẩy hình tròn của xe i ra khỏi các hộp tường (2 lượt cho góc) */
  collideTank(i: number) {
    let x = this.x[i];
    let y = this.y[i];
    const m = this.maze;
    const r2 = TANK_R * TANK_R;
    for (let pass = 0; pass < 2; pass++) {
      const nb = gather(m, cellOf(x, m.w), cellOf(y, m.h));
      let hit = false;
      for (let k = 0; k < nb; k++) {
        const o = k << 2;
        const nx = x < BOX[o] ? BOX[o] : x > BOX[o + 1] ? BOX[o + 1] : x;
        const ny = y < BOX[o + 2] ? BOX[o + 2] : y > BOX[o + 3] ? BOX[o + 3] : y;
        const dx = x - nx;
        const dy = y - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;
        hit = true;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          const f = (TANK_R - d) / d;
          x += dx * f;
          y += dy * f;
        } else {
          // tâm nằm trong hộp (hiếm): đẩy ra theo mặt gần nhất
          const l = x - BOX[o];
          const r = BOX[o + 1] - x;
          const t = y - BOX[o + 2];
          const b = BOX[o + 3] - y;
          const mn = Math.min(l, r, t, b);
          if (mn === l) x = BOX[o] - TANK_R;
          else if (mn === r) x = BOX[o + 1] + TANK_R;
          else if (mn === t) y = BOX[o + 2] - TANK_R;
          else y = BOX[o + 3] + TANK_R;
        }
      }
      if (!hit) break;
    }
    this.x[i] = x;
    this.y[i] = y;
  }

  /** đẩy xe i ra khỏi xe j một đoạn (dùng ở client để dự đoán va chạm xe-xe) */
  pushFrom(i: number, ox: number, oy: number, share: number) {
    const dx = this.x[i] - ox;
    const dy = this.y[i] - oy;
    const d2 = dx * dx + dy * dy;
    const min = TANK_R * 2;
    if (d2 >= min * min || d2 < 1e-9) return;
    const d = Math.sqrt(d2);
    const f = ((min - d) * share) / d;
    this.x[i] += dx * f;
    this.y[i] += dy * f;
  }

  /* ---------------- đạn ---------------- */
  freeSlot(): number {
    for (let b = 0; b < MAXB; b++) if (!this.bAct[b]) return b;
    return -1;
  }

  /** bắn một viên từ (sx, sy) theo góc ang; trả slot hoặc -1 (hết chỗ / tên lửa nổ ngay) */
  spawnBullet(owner: number, kind: number, sx: number, sy: number, ang: number, id: number): number {
    const b = this.freeSlot();
    if (b < 0) return -1;
    const sp = BSPEED[kind];
    this.bAct[b] = 1;
    this.bx[b] = sx;
    this.by[b] = sy;
    this.bvx[b] = COS[ang] * sp;
    this.bvy[b] = SIN[ang] * sp;
    this.bown[b] = owner;
    this.bkind[b] = kind;
    this.bid[b] = id;
    this.blife[b] = BLIFE[kind];
    this.bdist[b] = 0;
    this.bbn[b] = 0;
    this.bang[b] = ang;
    this.bbirth[b] = this.tick;
    this.bn++;
    const f = this.advanceBullet(b, MUZZLE / sp);
    if (f & B_DEAD) {
      this.kill(b);
      return -1;
    }
    return b;
  }

  kill(b: number) {
    if (this.bAct[b]) {
      this.bAct[b] = 0;
      this.bn--;
    }
  }

  /** đi tiếp rem tick (có thể lẻ) với phản xạ gương trên tường */
  advanceBullet(b: number, rem: number): number {
    let px = this.bx[b];
    let py = this.by[b];
    let vx = this.bvx[b];
    let vy = this.bvy[b];
    const sp = BSPEED[this.bkind[b]];
    this.bdist[b] += sp * rem;
    let flags = 0;
    const missile = this.bkind[b] === BK_MISSILE;
    for (let it = 0; it < 6 && rem > 1e-9; it++) {
      if (sweep(this.maze, px, py, vx, vy, rem, BULLET_R)) {
        const t = SW.t;
        px += vx * t;
        py += vy * t;
        rem -= t;
        if (missile) {
          flags |= B_DEAD;
          break;
        }
        if (SW.ax & 1) vx = -vx;
        if (SW.ax & 2) vy = -vy;
        flags |= B_BOUNCED;
        this.bbn[b]++;
      } else {
        px += vx * rem;
        py += vy * rem;
        rem = 0;
      }
    }
    this.bx[b] = px;
    this.by[b] = py;
    this.bvx[b] = vx;
    this.bvy[b] = vy;
    return flags;
  }

  /** một tick cho đạn b (chỉ tường); trả cờ B_* */
  bulletTick(b: number): number {
    let f = this.advanceBullet(b, 1);
    if (--this.blife[b] <= 0) f |= B_EXPIRED;
    return f;
  }

  /** tên lửa: lái bám mục tiêu (cx, cy) bằng góc nguyên, xác định */
  steerMissile(b: number, cx: number, cy: number) {
    const a = this.bang[b];
    const cross = COS[a] * (cy - this.by[b]) - SIN[a] * (cx - this.bx[b]);
    if (cross > 1e-9) this.bang[b] = (a + 6) & ANG_MASK;
    else if (cross < -1e-9) this.bang[b] = (a - 6) & ANG_MASK;
    const na = this.bang[b];
    const sp = BSPEED[BK_MISSILE];
    this.bvx[b] = COS[na] * sp;
    this.bvy[b] = SIN[na] * sp;
  }

  /** client: chạy tất cả đạn một tick (không xét trúng, server chốt) */
  stepBulletsOnly() {
    for (let b = 0; b < MAXB; b++) {
      if (!this.bAct[b]) continue;
      const f = this.bulletTick(b);
      if (f & (B_DEAD | B_EXPIRED)) this.kill(b);
    }
  }

  /** băm trạng thái (xe + đạn theo id) để so server/client */
  hash(): number {
    let h = 2166136261 >>> 0;
    const mix = (v: number) => {
      F64[0] = v;
      h = Math.imul(h ^ U32[0], 16777619) >>> 0;
      h = Math.imul(h ^ U32[1], 16777619) >>> 0;
    };
    for (let i = 0; i < this.n; i++) {
      mix(this.x[i]);
      mix(this.y[i]);
      mix(this.ang[i]);
    }
    let acc = 0;
    for (let b = 0; b < MAXB; b++) {
      if (!this.bAct[b]) continue;
      // cộng giao hoán theo viên → không phụ thuộc thứ tự slot
      let bh = 2166136261 >>> 0;
      const m2 = (v: number) => {
        F64[0] = v;
        bh = Math.imul(bh ^ U32[0], 16777619) >>> 0;
        bh = Math.imul(bh ^ U32[1], 16777619) >>> 0;
      };
      m2(this.bx[b]);
      m2(this.by[b]);
      m2(this.bvx[b]);
      m2(this.bvy[b]);
      m2(this.blife[b]);
      acc = (acc + bh) >>> 0;
    }
    return (h ^ acc) >>> 0;
  }
}

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);

/* ---------------- nhịp vòng đấu (tick) ---------------- */
export const ROUNDS = 5;
export const COUNT_TICKS = 180;
export const SUDDEN_TICKS = 1500;
export const ROUND_TICKS = 2700;
export const OVER_TICKS = 150;
export const LASER_LEN = 700;
export const LASER_BOUNCE = 4;
export const ITEM_R = 15;
export const MAX_ITEMS = 3;
/** số xe mỗi đấu trường: 2-6, chia đều */
export function splitArenas(total: number): number[] {
  const g = Math.max(1, Math.ceil(total / MAXT));
  const base = Math.floor(total / g);
  const extra = total - base * g;
  const out: number[] = [];
  for (let i = 0; i < g; i++) out.push(base + (i < extra ? 1 : 0));
  return out;
}
