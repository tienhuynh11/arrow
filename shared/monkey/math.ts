// Toán xác định: bảng sin/cos tự dựng (không dùng Math.sin/cos vì mỗi engine có thể lệch bit)
// để client dự đoán ra ĐÚNG từng bit như server. Góc là số nguyên 16 bit: 65536 = một vòng.

export const ANG_FULL = 65536;
const TBL_BITS = 12;
const TBL_N = 1 << TBL_BITS; // 4096 bậc
const TBL_SHIFT = 16 - TBL_BITS;

function sinT(x: number) {
  let t = x;
  let s = x;
  for (let n = 1; n < 12; n++) {
    t *= (-x * x) / ((2 * n) * (2 * n + 1));
    s += t;
  }
  return s;
}
function cosT(x: number) {
  let t = 1;
  let s = 1;
  for (let n = 1; n < 12; n++) {
    t *= (-x * x) / ((2 * n - 1) * (2 * n));
    s += t;
  }
  return s;
}

const SIN = new Float64Array(TBL_N);
const COS = new Float64Array(TBL_N);
(function build() {
  const PI = 3.141592653589793;
  const Q = TBL_N / 4;
  for (let i = 0; i < TBL_N; i++) {
    const q = Math.floor(i / Q);
    const r = i % Q;
    let s0: number;
    let c0: number;
    if (r <= Q / 2) {
      const x = (r * PI) / (2 * Q);
      s0 = sinT(x);
      c0 = cosT(x);
    } else {
      const x2 = ((Q - r) * PI) / (2 * Q);
      s0 = cosT(x2);
      c0 = sinT(x2);
    }
    if (q === 0) { SIN[i] = s0; COS[i] = c0; }
    else if (q === 1) { SIN[i] = c0; COS[i] = -s0; }
    else if (q === 2) { SIN[i] = -s0; COS[i] = -c0; }
    else { SIN[i] = -c0; COS[i] = s0; }
  }
})();

/** sin của góc 16 bit (xác định) */
export function isin(a: number) {
  return SIN[((a & 0xffff) >> TBL_SHIFT) & (TBL_N - 1)];
}
export function icos(a: number) {
  return COS[((a & 0xffff) >> TBL_SHIFT) & (TBL_N - 1)];
}

export const angToRad = (a: number) => (a / ANG_FULL) * Math.PI * 2;
export const radToAng = (r: number) => Math.round((r / (Math.PI * 2)) * ANG_FULL) & 0xffff;
/** pitch là số có dấu (±16384 = ±90°) */
export const pitchToRad = (p: number) => (p / ANG_FULL) * Math.PI * 2;
export const radToPitch = (r: number) => Math.round((r / (Math.PI * 2)) * ANG_FULL);

/** hiệu góc ngắn nhất, trong (-32768, 32768] */
export function angDiff(a: number, b: number) {
  let d = (b - a) & 0xffff;
  if (d > 32768) d -= 65536;
  return d;
}

/** PRNG có seed (mulberry32) — dùng chung cho tản đạn để client và server ra cùng hướng */
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

/** băm 2 số nguyên thành seed (không cấp phát) */
export function hash2(a: number, b: number) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return h >>> 0;
}

/** số ngẫu nhiên [0,1) xác định từ (seed, i) — không giữ trạng thái */
export function rnd01(seed: number, i: number) {
  return hash2(seed, i) / 4294967296;
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
