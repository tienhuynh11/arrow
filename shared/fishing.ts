// CÂU CÁ TRANH TÀI (id fishing): luật + mô phỏng dùng chung cho server (authoritative) và client (dự đoán).
// Không phụ thuộc gì khác; mọi hàm mô phỏng đều thuần, không cấp phát.

/** một bước mô phỏng thanh kéo cá = 50ms (cùng nhịp tick của server) */
export const STEP_MS = 50;
export const STEP_S = STEP_MS / 1000;
/** server mô phỏng chậm hơn đồng hồ thật chừng này tick để nhận đủ lệnh giữ/nhả có dấu thời gian */
export const LAG_TICKS = 3;
export const DURATION_MS = 80_000;
/** quá thời gian này mà chưa kéo lên được thì đứt dây */
export const REEL_MAX_TICKS = 300;

export const WAIT_MIN_MS = 1800;
export const WAIT_MAX_MS = 5200;
/** phao rung nhẹ báo trước khi cá cắn */
export const NIB_MS = 600;
/** thời gian để giật cần sau khi phao nhúng */
export const HOOK_MS = 1000;
export const CAST_LOCK_MS = 450;
export const LAND_LOCK_MS = 700;
export const FAIL_LOCK_MS = 600;

/* ---- giật cá ---- */
/** cá vừa lên bờ có thể bị giật trong khoảng này */
export const STEAL_WINDOW_MS = 1700;
export const STEAL_CD_MS = 7000;
export const STEAL_MISS_STUN_MS = 3000;
export const STEAL_MISS_PENALTY = 5;
/** miễn nhiễm của người vừa bị giật mất cá */
export const IMMUNE_MS = 3800;
export const STEAL_CHANCE_LANDED = 0.55;
export const STEAL_CHANCE_REELING = 0.35;
/** kẻ giật chỉ hưởng phần này giá trị cá (người bị mất thì mất đủ) */
export const STEAL_SHARE = 0.5;
/** chưa kéo được chừng này ms thì chưa giật được (cá còn vừa cắn) */
export const STEAL_REEL_MIN_MS = 500;

export type Tier = 'common' | 'rare' | 'legend' | 'trash';

export interface Species {
  name: string;
  emoji: string;
  tier: Tier;
  /** điểm (rác âm hoặc 0) */
  value: number;
  /** lớp độ khó của ván kéo 0..4. Rác dùng lớp 0 nên không phân biệt được với cá thường lúc cắn */
  cls: number;
}

export const SPECIES: readonly Species[] = [
  { name: 'Cá rô', emoji: '🐟', tier: 'common', value: 10, cls: 0 },
  { name: 'Cá chép', emoji: '🐠', tier: 'common', value: 16, cls: 1 },
  { name: 'Cá nóc', emoji: '🐡', tier: 'rare', value: 30, cls: 2 },
  { name: 'Cá mập con', emoji: '🦈', tier: 'rare', value: 50, cls: 3 },
  { name: 'Rồng vàng', emoji: '🐉', tier: 'legend', value: 100, cls: 4 },
  { name: 'Giày cũ', emoji: '👟', tier: 'trash', value: -8, cls: 0 },
  { name: 'Lon rỗng', emoji: '🥫', tier: 'trash', value: -4, cls: 0 },
  { name: 'Rong rêu', emoji: '🌿', tier: 'trash', value: 0, cls: 0 },
];

/* ---- thông số theo lớp độ khó 0..4 ---- */
/** chiều cao thanh của người chơi (0..1) */
export const BAR_H = [0.28, 0.23, 0.185, 0.17, 0.155];
/** tốc độ đầy / tụt thanh tiến độ (mỗi giây) khi cá trong / ngoài thanh */
export const GAIN = [0.32, 0.27, 0.24, 0.22, 0.20];
export const LOSS = [0.12, 0.17, 0.21, 0.25, 0.27];
/** cá đổi hướng bơi sau mỗi bấy nhiêu tick */
export const PERIOD = [36, 26, 18, 15, 13];
/** biên độ dao động của cá quanh giữa */
export const SWING = [0.33, 0.37, 0.40, 0.42, 0.43];
export const START_PROGRESS = 0.35;

const UP_ACC = 3.4;
const GRAVITY = 2.8;
const DAMP = 0.9;
const BOUNCE = 0.25;

export const CLS_NAMES = ['dễ', 'vừa', 'khó', 'rất khó', 'huyền thoại'];

/* ---------------- RNG có seed ---------------- */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** hash số nguyên 32 bit → [0,1) */
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Túi cá của một người: trộn đều nên ít may rủi hơn bốc ngẫu nhiên thuần. Trả mảng chỉ số loài. */
export function makeBag(rng: () => number): number[] {
  const bag = [0, 0, 0, 0, 1, 1, 1, 2, 2, 3, 5, 6, 7];
  if (rng() < 0.6) bag.push(4);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = bag[i];
    bag[i] = bag[j];
    bag[j] = t;
  }
  return bag;
}

/* ---------------- ván kéo cá ---------------- */
/** vị trí cá (0..1) tại tick; công thức đóng nên server/client đều tính được không cần trạng thái */
export function fishY(seed: number, cls: number, tick: number): number {
  const per = PERIOD[cls];
  const n = Math.floor(tick / per);
  const f = (tick - n * per) / per;
  const s = f * f * (3 - 2 * f);
  const a = 0.5 + (hash01(seed, n) * 2 - 1) * SWING[cls];
  const b = 0.5 + (hash01(seed, n + 1) * 2 - 1) * SWING[cls];
  return a + (b - a) * s;
}

export interface ReelState {
  /** tâm thanh, vận tốc, tiến độ 0..1 */
  y: number;
  v: number;
  p: number;
}

export const newReel = (): ReelState => ({ y: 0.5, v: 0, p: START_PROGRESS });
export function resetReel(r: ReelState) {
  r.y = 0.5;
  r.v = 0;
  r.p = START_PROGRESS;
}
export function copyReel(to: ReelState, from: ReelState) {
  to.y = from.y;
  to.v = from.v;
  to.p = from.p;
}

/**
 * Một bước 50ms: thanh chịu lực nâng khi giữ / trọng lực khi nhả, rồi tính cá có trong thanh không.
 * Trả về 0 = tiếp tục, 1 = kéo lên được, -1 = cá thoát. `tick` là chỉ số bước TRƯỚC khi bước.
 */
/** chỉ phần thanh (không tính cá): dùng cho bot / hiệu ứng dự đoán */
export function stepBar(r: { y: number; v: number }, hold: boolean, cls: number) {
  let v = r.v + (hold ? UP_ACC : -GRAVITY) * STEP_S;
  v *= DAMP;
  let y = r.y + v * STEP_S * 6;
  const h = BAR_H[cls];
  const lo = h / 2;
  const hi = 1 - h / 2;
  if (y < lo) {
    y = lo;
    v = -v * BOUNCE;
  } else if (y > hi) {
    y = hi;
    v = -v * BOUNCE;
  }
  r.v = v;
  r.y = y;
}

/**
 * Một bước 50ms: thanh chịu lực nâng khi giữ / trọng lực khi nhả, rồi tính cá có trong thanh không.
 * Trả về 0 = tiếp tục, 1 = kéo lên được, -1 = cá thoát. `tick` là chỉ số bước TRƯỚC khi bước.
 */
export function stepReel(r: ReelState, hold: boolean, cls: number, seed: number, tick: number): number {
  stepBar(r, hold, cls);
  const h = BAR_H[cls];
  const fy = fishY(seed, cls, tick + 1);
  const inside = Math.abs(fy - r.y) <= h / 2;
  r.p += (inside ? GAIN[cls] : -LOSS[cls]) * STEP_S;
  if (r.p >= 1) {
    r.p = 1;
    return 1;
  }
  if (r.p <= 0) {
    r.p = 0;
    return -1;
  }
  return 0;
}

/* ---------------- chia hồ ---------------- */
/** ≤6 người: một hồ; nhiều hơn: chia đều thành các hồ ~4-5 người */
export function lakeSizes(n: number): number[] {
  if (n <= 6) return [n];
  const lakes = Math.ceil(n / 5);
  const base = Math.floor(n / lakes);
  const extra = n - base * lakes;
  return Array.from({ length: lakes }, (_, i) => base + (i < extra ? 1 : 0));
}

/* ---------------- mã hoá trạng thái người chơi trong snapshot ---------------- */
export const ST_IDLE = 0;
export const ST_WAIT = 1;
export const ST_NIB = 2;
export const ST_BITE = 3;
export const ST_REEL = 4;
/** vừa hụt / vừa bị giật / choáng */
export const ST_STUN = 5;

export const pointsLabel = (n: number) => `${n > 0 ? '+' : ''}${n}`;
