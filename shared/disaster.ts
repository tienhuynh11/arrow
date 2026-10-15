// SURVIVAL HỖN LOẠN - lõi mô phỏng XÁC ĐỊNH dùng chung cho server và client. Không phụ thuộc gì.
//
// Ý tưởng: thế giới của một vòng chỉ là hàm của (seed, tick). Thảm họa (thiên thạch, động đất, lũ,
// lốc xoáy, sàn sụp) KHÔNG được stream: client tự dựng World từ seed rồi tự tính. Mỗi người chơi là một
// PSim độc lập (không va chạm giữa người với nhau) nên server có thể tua lại (rewind) từng người khi
// input tới trễ, và client dự đoán đúng từng bit với server.
//
// Toạ độ: x sang phải, y xuống dưới màn hình, gốc ở giữa sàn. Mỗi tick = 1/60 giây.
// Chỉ dùng + - * / sqrt (không Math.sin/cos) để mọi engine ra cùng kết quả.

export const TICK_HZ = 60;
export const STEP_MS = 1000 / TICK_HZ;
export const DT = 1 / TICK_HZ;

export const GRID = 12;
export const TS = 2.4;
export const HALF = (GRID * TS) / 2;
export const HSTEP = 0.8;
export const MAX_H = 3;
const VOID = -999;

const SPEED_T = 7 * DT;
const JUMP_V = 8.6;
const GRAV = 24;
const STEP_DOWN = 0.9;
const KDRAG = 0.92;
const FALL_DEAD_Z = -6;

export const INTRO = 180;
export const WARN = 120;
export const GAP = 60;
export const TAIL = 60;
export const MAX_PHASES = 4;

/** thiên thạch */
export const MET_WARN = 88;
export const MET_KILL_R = 2.4;
const MET_KNOCK_R = 4.8;
const MET_KNOCK_V = 11;
/** động đất */
export const QUAKE_V = 15 * DT;
export const QUAKE_BAND = 1.15;
export const QUAKE_LIFE = 170;
export const QUAKE_PRE = 45;
const QUAKE_KNOCK = 22;
/** lốc xoáy */
export const TORN_PULL = 8;
export const TORN_KILL = 1.25;
const TORN_PULL_V = 5.6;
const TORN_SWIRL_V = 3.2;
/** lũ */
const DROWN_TICKS = 120;
/** sàn sập */
export const CRACK_WARN = 90;

export const K_NONE = 0;
export const K_METEOR = 1;
export const K_QUAKE = 2;
export const K_FLOOD = 3;
export const K_TORNADO = 4;
export const K_COLLAPSE = 5;

export const KIND_NAME = ['', 'THIÊN THẠCH', 'ĐỘNG ĐẤT', 'LŨ LỤT', 'LỐC XOÁY', 'SÀN SỤP ĐỔ'];
export const KIND_ICON = ['❓', '☄️', '🌋', '🌊', '🌪️', '🕳️'];
export const KIND_HINT = [
  '',
  'Nhìn vòng đỏ trên sàn: chạy ra khỏi đó trước khi thiên thạch rơi!',
  'Sóng chấn động lan ra: NHẢY đúng lúc sóng chạy qua chân, đừng đứng sát mép sàn!',
  'Nước dâng cao: chạy lên chỗ đất cao nhất!',
  'Lốc xoáy hút mọi thứ: tránh xa cột xoáy!',
  'Sàn nứt rồi sụp từ rìa vào: dồn vào giữa, đừng đứng ô đỏ!',
];
export const THEME_NAME = ['Đồng cỏ', 'Sa mạc', 'Vùng tuyết', 'Núi lửa'];
/** thời lượng pha hoạt động theo loại thảm họa (tick) */
const ACT_DUR = [0, 540, 480, 600, 600, 540];

/* ---------------- số ngẫu nhiên + lượng giác tự dựng ---------------- */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;
export function sn(x: number): number {
  let r = x - TWO_PI * Math.floor(x / TWO_PI + 0.5);
  if (r > PI / 2) r = PI - r;
  else if (r < -PI / 2) r = -PI - r;
  const r2 = r * r;
  let t = r;
  let s = r;
  for (let n = 1; n < 8; n++) {
    t *= -r2 / ((2 * n) * (2 * n + 1));
    s += t;
  }
  return s;
}
export const cs = (x: number) => sn(x + PI / 2);

/* ---------------- thế giới của một vòng ---------------- */
export class World {
  readonly seed: number;
  readonly round: number;
  /** tick toàn cục mà vòng này bắt đầu */
  base: number;
  theme = 0;
  heights = new Uint8Array(GRID * GRID);
  /** tick (cục bộ) mà ô biến mất; INF = không bao giờ */
  fallTick = new Int32Array(GRID * GRID).fill(0x7fffffff);
  nPhases = 0;
  pKind = new Uint8Array(MAX_PHASES);
  /** tick cục bộ bắt đầu cảnh báo / bắt đầu hoạt động / kết thúc của từng pha */
  pWarn = new Int32Array(MAX_PHASES);
  pAct = new Int32Array(MAX_PHASES);
  pEnd = new Int32Array(MAX_PHASES);
  /** theo loại thảm họa (1..5): pha chứa nó, -1 nếu vòng này không có */
  phaseOf = new Int8Array(6).fill(-1);
  endTick = 0;
  /** thiên thạch */
  nMet = 0;
  mTick!: Int32Array;
  mX!: Float32Array;
  mY!: Float32Array;
  mFirst!: Int32Array;
  /** động đất */
  nPulse = 0;
  pulseT = new Int32Array(16);
  pulseX = new Float64Array(16);
  pulseY = new Float64Array(16);
  /** lốc xoáy */
  nTorn = 0;
  tCx = new Float64Array(3);
  tCy = new Float64Array(3);
  tAx = new Float64Array(3);
  tAy = new Float64Array(3);
  tW1 = new Float64Array(3);
  tW2 = new Float64Array(3);
  tP1 = new Float64Array(3);
  tP2 = new Float64Array(3);
  /** vị trí tạm do tornado() ghi */
  tx = 0;
  ty = 0;
  /** lũ */
  floodPeak = 0;
  hillX = 0;
  hillY = 0;

  constructor(seed: number, round: number, base: number) {
    this.seed = seed;
    this.round = round;
    this.base = base;
    const r = rng(seed ^ Math.imul(round + 1, 0x9e3779b1));
    this.theme = Math.floor(r() * 4);

    /* địa hình: vài ngọn đồi, ngọn đầu luôn cao nhất để lũ luôn có chỗ trú */
    const hills = 3 + Math.floor(r() * 3);
    for (let i = 0; i < hills; i++) {
      const cx = 1.5 + r() * (GRID - 3);
      const cy = 1.5 + r() * (GRID - 3);
      const rad = 2.2 + r() * 2.2;
      if (i === 0) {
        this.hillX = cx - 0.5;
        this.hillY = cy - 0.5;
      }
      const pk = i === 0 ? MAX_H : 2 + Math.floor(r() * 2);
      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d >= rad) continue;
          const h = Math.floor(pk * (1 - d / rad) + 0.5);
          const k = y * GRID + x;
          if (h > this.heights[k]) this.heights[k] = h > MAX_H ? MAX_H : h;
        }
      }
    }

    /* đỉnh đồi đầu tiên: một mảng 2x2 cao nhất để lũ luôn có chỗ trú */
    {
      const px = Math.min(GRID - 2, Math.max(0, Math.floor(this.hillX)));
      const py = Math.min(GRID - 2, Math.max(0, Math.floor(this.hillY)));
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) this.heights[(py + dy) * GRID + px + dx] = MAX_H;
    }

    /* thứ tự thảm họa: xáo 5 loại, lấy 3 (vòng đầu) hoặc 4 loại */
    const kinds = [1, 2, 3, 4, 5];
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = kinds[i];
      kinds[i] = kinds[j];
      kinds[j] = t;
    }
    this.nPhases = round === 0 ? 3 : 4;
    let cursor = INTRO;
    for (let i = 0; i < this.nPhases; i++) {
      const k = kinds[i];
      this.pKind[i] = k;
      if (i === this.nPhases - 1 && round > 0) cursor -= 330 + 40 * round;
      this.pWarn[i] = cursor;
      this.pAct[i] = cursor + WARN;
      this.pEnd[i] = cursor + WARN + ACT_DUR[k];
      this.phaseOf[k] = i;
      cursor = this.pEnd[i] + GAP;
    }
    this.endTick = cursor - GAP + TAIL;

    const diff = round;
    const len = this.endTick + 220;
    const half = HALF - 1.2;

    /* thiên thạch */
    {
      const p = this.phaseOf[K_METEOR];
      if (p >= 0) {
        const n = 14 + 5 * diff;
        const a = this.pAct[p] + MET_WARN;
        const b = this.pEnd[p] - 15;
        this.nMet = n;
        this.mTick = new Int32Array(n);
        this.mX = new Float32Array(n);
        this.mY = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          this.mTick[i] = Math.floor(a + ((i + r() * 0.9) * (b - a)) / n);
          const near = r() < 0.34;
          const span = near ? 5.5 : half;
          this.mX[i] = (r() * 2 - 1) * span;
          this.mY[i] = (r() * 2 - 1) * span;
        }
      } else {
        this.mTick = new Int32Array(0);
        this.mX = new Float32Array(0);
        this.mY = new Float32Array(0);
      }
      this.mFirst = new Int32Array(len + 2);
      let idx = 0;
      for (let t = 0; t < len + 2; t++) {
        while (idx < this.nMet && this.mTick[idx] < t) idx++;
        this.mFirst[t] = idx;
      }
    }

    /* động đất: sóng chấn động + vài ô nứt rơi */
    {
      const p = this.phaseOf[K_QUAKE];
      if (p >= 0) {
        const n = 8 + diff;
        this.nPulse = n;
        const a = this.pAct[p] + 40;
        const step = Math.floor((ACT_DUR[K_QUAKE] - 100) / n);
        for (let i = 0; i < n; i++) {
          this.pulseT[i] = a + i * step;
          this.pulseX[i] = (r() * 2 - 1) * half * 0.8;
          this.pulseY[i] = (r() * 2 - 1) * half * 0.8;
        }
        const cracks = 10 + 4 * diff;
        for (let i = 0; i < cracks; i++) {
          const tile = Math.floor(r() * GRID * GRID);
          const at = this.pAct[p] + 70 + Math.floor(r() * (ACT_DUR[K_QUAKE] - 170));
          if (at < this.fallTick[tile]) this.fallTick[tile] = at;
        }
      }
    }

    /* lốc xoáy */
    {
      const p = this.phaseOf[K_TORNADO];
      if (p >= 0) {
        this.nTorn = diff + 1;
        for (let k = 0; k < this.nTorn; k++) {
          this.tCx[k] = (r() * 2 - 1) * 3;
          this.tCy[k] = (r() * 2 - 1) * 3;
          this.tAx[k] = 6.5 + r() * 3.5;
          this.tAy[k] = 6.5 + r() * 3.5;
          this.tW1[k] = 0.3 + r() * 0.22;
          this.tW2[k] = 0.24 + r() * 0.2;
          this.tP1[k] = r() * TWO_PI;
          this.tP2[k] = r() * TWO_PI;
        }
      }
    }

    /* lũ */
    this.floodPeak = 1.9 + 0.45 * diff;

    /* sàn sập: rìa trước, trộn ngẫu nhiên */
    {
      const p = this.phaseOf[K_COLLAPSE];
      if (p >= 0) {
        const n = 100;
        const keys = new Float64Array(GRID * GRID);
        const order: number[] = [];
        for (let y = 0; y < GRID; y++) {
          for (let x = 0; x < GRID; x++) {
            const dx = x + 0.5 - GRID / 2;
            const dy = y + 0.5 - GRID / 2;
            const k = y * GRID + x;
            keys[k] = Math.sqrt(dx * dx + dy * dy) + r() * 3.2;
            order.push(k);
          }
        }
        order.sort((a, b) => keys[b] - keys[a] || a - b);
        const a = this.pAct[p] + CRACK_WARN;
        const span = ACT_DUR[K_COLLAPSE] - CRACK_WARN - 60;
        for (let i = 0; i < n; i++) {
          const tile = order[i];
          const at = a + Math.floor((i * span) / n) + Math.floor(r() * 18);
          if (at < this.fallTick[tile]) this.fallTick[tile] = at;
        }
      }
    }
  }

  /** chỉ số pha đang chiếm [cảnh báo, kết thúc) tại tick cục bộ, -1 nếu không có */
  phaseAt(tl: number): number {
    for (let i = this.nPhases - 1; i >= 0; i--) if (tl >= this.pWarn[i] && tl < this.pEnd[i]) return i;
    return -1;
  }

  tileAt(x: number, y: number): number {
    const ix = Math.floor((x + HALF) / TS);
    const iy = Math.floor((y + HALF) / TS);
    if (ix < 0 || iy < 0 || ix >= GRID || iy >= GRID) return -1;
    return iy * GRID + ix;
  }

  /** độ cao mặt đất tại (x, y) lúc tick cục bộ tl; VOID nếu hụt */
  groundZ(tl: number, x: number, y: number): number {
    const k = this.tileAt(x, y);
    if (k < 0 || tl >= this.fallTick[k]) return VOID;
    return this.heights[k] * HSTEP;
  }

  /** mực nước (đơn vị tầng đất, 0 = không có lũ) */
  water(tl: number): number {
    const p = this.phaseOf[K_FLOOD];
    if (p < 0) return 0;
    const a = this.pAct[p];
    const e = this.pEnd[p];
    if (tl <= a || tl >= e) return 0;
    const up = (tl - a) / 240;
    const down = (e - tl) / 120;
    const f = up < 1 ? up : 1;
    return this.floodPeak * (down < f ? down : f);
  }

  /** vị trí lốc xoáy k lúc tick tl (float) vào tx/ty; trả hệ số lớn nhỏ 0..1 (0 = chưa/hết) */
  tornado(k: number, tl: number): number {
    const p = this.phaseOf[K_TORNADO];
    if (p < 0 || k >= this.nTorn) return 0;
    const a = this.pAct[p];
    const e = this.pEnd[p];
    const tau = (tl - a) / TICK_HZ;
    this.tx = this.tCx[k] + this.tAx[k] * sn(this.tW1[k] * tau + this.tP1[k]);
    this.ty = this.tCy[k] + this.tAy[k] * sn(this.tW2[k] * tau + this.tP2[k]);
    const grow = (tl - (a - WARN)) / (WARN + 60);
    const shrink = (e - tl) / 60;
    const s = Math.min(grow < 0 ? 0 : grow, shrink < 0 ? 0 : shrink, 1);
    return s;
  }

  /** vị trí xuất phát của ghế `seat` trong arena `n` người (vòng tròn quanh tâm) */
  spawn(seat: number, n: number, out: Float64Array) {
    const a = (seat / n) * TWO_PI + 0.3;
    out[0] = cs(a) * 5.6;
    out[1] = sn(a) * 5.6;
  }
}

/* ---------------- một người chơi ---------------- */
export const F_X = 0;
export const F_Y = 1;
export const F_Z = 2;
export const F_VZ = 3;
export const F_KX = 4;
export const F_KY = 5;
export const F_HIT = 6;
export const F_WET = 7;
export const F_GR = 8;
export const F_DM = 9;
/** 0 = còn sống; 1 thiên thạch · 2 lốc xoáy · 3 chết đuối · 4 rơi khỏi sàn */
export const F_DEAD = 10;
export const F_DTICK = 11;
export const F_INW = 12;
export const NF = 14;

export const DEATH_TXT = ['', 'bị thiên thạch nghiền', 'bị lốc xoáy cuốn', 'chết đuối', 'rơi khỏi sàn'];

/** một bước 1/60 giây của một người; s là mảng NF trạng thái (sửa tại chỗ) */
export function stepPlayer(w: World, s: Float64Array, tick: number, dx: number, dy: number, jump: number): void {
  if (s[F_DEAD] > 0) return;
  const tl = tick - w.base;
  let x = s[F_X];
  let y = s[F_Y];
  let z = s[F_Z];
  let vz = s[F_VZ];
  let kx = s[F_KX];
  let ky = s[F_KY];
  let gr = s[F_GR];
  let dm = s[F_DM];

  let mx = dx;
  let my = dy;
  if (mx !== 0 && my !== 0) {
    mx *= 0.7071067811865476;
    my *= 0.7071067811865476;
  }
  const sp = s[F_INW] > 0 ? SPEED_T * 0.6 : SPEED_T;
  x += mx * sp + kx * DT;
  y += my * sp + ky * DT;
  kx *= KDRAG;
  ky *= KDRAG;
  if (kx < 0.01 && kx > -0.01) kx = 0;
  if (ky < 0.01 && ky > -0.01) ky = 0;

  let cause = 0;

  /* lốc xoáy: hút + xoáy + chạm lõi là chết */
  for (let k = 0; k < w.nTorn; k++) {
    const sc = w.tornado(k, tl);
    if (sc <= 0 || tl < w.pAct[w.phaseOf[K_TORNADO]]) continue;
    const ddx = w.tx - x;
    const ddy = w.ty - y;
    const d2 = ddx * ddx + ddy * ddy;
    if (d2 >= TORN_PULL * TORN_PULL) continue;
    const d = Math.sqrt(d2) + 1e-9;
    const f = (1 - d / TORN_PULL) * sc;
    x += (ddx / d) * TORN_PULL_V * f * DT + (-ddy / d) * TORN_SWIRL_V * f * DT;
    y += (ddy / d) * TORN_PULL_V * f * DT + (ddx / d) * TORN_SWIRL_V * f * DT;
    if (d < TORN_KILL * (sc > 0.5 ? 1 : sc * 2) && z < 2.5) cause = 2;
  }

  if (x > HALF + 8) x = HALF + 8;
  else if (x < -HALF - 8) x = -HALF - 8;
  if (y > HALF + 8) y = HALF + 8;
  else if (y < -HALF - 8) y = -HALF - 8;

  /* nhảy + trọng lực + địa hình */
  if (jump && gr > 0) {
    vz = JUMP_V;
    gr = 0;
  }
  const gz = w.groundZ(tl, x, y);
  if (gz !== VOID && dm === 0) {
    if (z <= gz && vz <= 0) {
      z = gz;
      vz = 0;
      gr = 1;
    } else if (gr > 0 && vz <= 0 && z - gz <= STEP_DOWN) {
      z = gz;
      vz = 0;
    } else {
      gr = 0;
      vz -= GRAV * DT;
      z += vz * DT;
      if (z <= gz && vz <= 0) {
        z = gz;
        vz = 0;
        gr = 1;
      }
    }
  } else {
    gr = 0;
    vz -= GRAV * DT;
    z += vz * DT;
    if (z < -0.6) dm = 1;
  }
  if (z < FALL_DEAD_Z && cause === 0) cause = 4;

  /* thiên thạch rơi đúng tick này */
  if (w.nMet > 0 && tl >= 0 && tl < w.mFirst.length - 1) {
    for (let i = w.mFirst[tl]; i < w.nMet && w.mTick[i] === tl; i++) {
      const ddx = x - w.mX[i];
      const ddy = y - w.mY[i];
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < MET_KILL_R * MET_KILL_R) {
        if (z - (gz === VOID ? 0 : gz) < 3) cause = 1;
      } else if (d2 < MET_KNOCK_R * MET_KNOCK_R) {
        const d = Math.sqrt(d2);
        const f = (1 - d / MET_KNOCK_R) * MET_KNOCK_V + 3;
        kx += (ddx / d) * f;
        ky += (ddy / d) * f;
      }
    }
  }

  /* sóng động đất: chỉ ảnh hưởng người đang chạm đất, mỗi sóng đẩy một lần */
  if (w.nPulse > 0) {
    let hit = s[F_HIT];
    const low = gz === VOID ? false : z - gz < 0.4;
    for (let i = 0; i < w.nPulse; i++) {
      const age = tl - w.pulseT[i];
      if (age < 0 || age > QUAKE_LIFE) continue;
      const bit = 1 << i;
      if ((hit & bit) !== 0 || !low) continue;
      const ddx = x - w.pulseX[i];
      const ddy = y - w.pulseY[i];
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      const ring = age * QUAKE_V;
      const diff = d - ring;
      if (diff < QUAKE_BAND && diff > -QUAKE_BAND) {
        hit |= bit;
        const inv = d > 1e-6 ? 1 / d : 0;
        kx += (d > 1e-6 ? ddx * inv : 1) * QUAKE_KNOCK;
        ky += (d > 1e-6 ? ddy * inv : 0) * QUAKE_KNOCK;
      }
    }
    s[F_HIT] = hit;
  }

  /* lũ */
  const lv = w.water(tl);
  let wet = s[F_WET];
  let inw = 0;
  if (lv > 0 && z < lv * HSTEP - 0.3) {
    inw = 1;
    wet += 1;
    if (wet >= DROWN_TICKS && cause === 0) cause = 3;
  } else if (wet > 0) {
    wet -= 2;
    if (wet < 0) wet = 0;
  }

  s[F_X] = x;
  s[F_Y] = y;
  s[F_Z] = z;
  s[F_VZ] = vz;
  s[F_KX] = kx;
  s[F_KY] = ky;
  s[F_GR] = gr;
  s[F_DM] = dm;
  s[F_WET] = wet;
  s[F_INW] = inw;
  if (cause > 0) {
    s[F_DEAD] = cause;
    s[F_DTICK] = tl;
  }
}

/* ---------------- bộ mô phỏng một người, có lịch sử để tua lại ---------------- */
export const RING = 128;
const RMASK = RING - 1;
/** input tới trễ tối đa chừng này tick vẫn được tua lại cho đúng (500 ms) */
export const REWIND_MAX = 30;

export class PSim {
  readonly s = new Float64Array(NF);
  readonly hist = new Float64Array(RING * NF);
  private ix = new Int8Array(RING);
  private iy = new Int8Array(RING);
  private ij = new Uint8Array(RING);
  /** trạng thái s đúng ở CUỐI tick này */
  tick = -1;
  /** tick lớn nhất đã có ô input */
  private top = -1;
  private hx = 0;
  private hy = 0;
  private jumpAt = -2;
  private lastK = -1;
  private baseTick = 0;
  frozen = false;

  /** đặt lại ở đầu vòng: trạng thái hợp lệ ở cuối tick `base - 1` */
  reset(base: number, x: number, y: number, z: number) {
    this.s.fill(0);
    this.s[F_X] = x;
    this.s[F_Y] = y;
    this.s[F_Z] = z;
    this.s[F_GR] = 1;
    this.tick = base - 1;
    this.top = base - 1;
    this.baseTick = base;
    this.lastK = base - 1;
    this.hx = 0;
    this.hy = 0;
    this.jumpAt = -2;
    this.frozen = false;
    this.save(this.tick);
  }

  private save(t: number) {
    this.hist.set(this.s, (t & RMASK) * NF);
  }
  private load(t: number) {
    const o = (t & RMASK) * NF;
    for (let i = 0; i < NF; i++) this.s[i] = this.hist[o + i];
  }
  /** trường f của trạng thái ở cuối tick t (phải còn trong vòng đệm) */
  at(t: number, f: number): number {
    return this.hist[(t & RMASK) * NF + f];
  }

  advance(w: World, to: number) {
    while (this.tick < to) {
      const t = this.tick + 1;
      if (t > this.top) {
        this.ix[t & RMASK] = this.hx;
        this.iy[t & RMASK] = this.hy;
        this.ij[t & RMASK] = this.jumpAt === t ? 1 : 0;
        this.top = t;
      }
      if (!this.frozen) stepPlayer(w, this.s, t, this.ix[t & RMASK], this.iy[t & RMASK], this.ij[t & RMASK]);
      this.tick = t;
      this.save(t);
    }
  }

  /** input hiệu lực từ tick k trở đi (giữ hướng dx,dy); j = nhảy một lần ở tick k */
  input(w: World, k: number, dx: number, dy: number, j: number) {
    const target = this.tick;
    if (k > this.tick + 1) k = this.tick + 1;
    if (k < this.tick - REWIND_MAX + 1) k = this.tick - REWIND_MAX + 1;
    if (k < this.lastK) k = this.lastK;
    if (k < this.baseTick) k = this.baseTick;
    const sameTick = k === this.lastK;
    this.hx = dx;
    this.hy = dy;
    if (k <= this.top) {
      for (let t = k; t <= this.top; t++) {
        this.ix[t & RMASK] = dx;
        this.iy[t & RMASK] = dy;
        this.ij[t & RMASK] = t === k ? (j | (sameTick ? this.ij[t & RMASK] : 0)) : 0;
      }
      if (k <= this.tick) {
        this.load(k - 1);
        this.tick = k - 1;
      }
    } else if (j) {
      this.jumpAt = k;
    }
    this.lastK = k;
    this.advance(w, target);
  }

  /** đặt trạng thái cuối tick T bằng dữ liệu của server (tick sau T dùng lại input đã lưu) */
  restore(T: number, src: ArrayLike<number>) {
    for (let i = 0; i < NF; i++) this.s[i] = src[i];
    this.tick = T;
    this.save(T);
    if (this.top < T) this.top = T;
  }
}
