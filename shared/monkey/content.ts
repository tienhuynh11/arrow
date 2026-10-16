// Dữ liệu game: lớp nhân vật, vũ khí theo bậc, các loài khỉ, công thức đợt (wave) và kinh tế.
// Mọi con số cân bằng nằm ở đây để server/client/bài test cùng đọc một nguồn.

import { TICK_HZ } from './config.js';

/* ======================= VŨ KHÍ (chung mọi lớp, nâng bậc bằng phím V) ======================= */
export interface WeaponDef {
  name: string;
  short: string;
  /** sát thương mỗi viên */
  dmg: number;
  pellets: number;
  /** khoảng cách giữa 2 phát, đơn vị 1/100 tick (60Hz) */
  interval: number;
  mag: number;
  /** thời gian nạp (tick 60Hz) */
  reload: number;
  /** độ tản (radian, bán kính nón) */
  spread: number;
  range: number;
  /** số khỉ xuyên thêm sau con đầu */
  pierce: number;
  /** từ khoảng cách này sát thương giảm dần còn 40% ở range */
  falloff: number;
  /** đạn nổ: bán kính + sát thương lan */
  splashR: number;
  splashDmg: number;
  /** lực giật camera (độ) */
  kick: number;
  /** giá mua bậc này (bậc 0 miễn phí) */
  cost: number;
  color: number;
  sound: 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'launcher';
}

export const WEAPONS: WeaponDef[] = [
  { name: 'Súng lục K-9', short: 'SÚNG LỤC', dmg: 34, pellets: 1, interval: 1300, mag: 12, reload: 66, spread: 0.012, range: 60, pierce: 0, falloff: 40, splashR: 0, splashDmg: 0, kick: 1.2, cost: 0, color: 0x6b7280, sound: 'pistol' },
  { name: 'Tiểu liên Ong Vò Vẽ', short: 'TIỂU LIÊN', dmg: 16, pellets: 1, interval: 500, mag: 36, reload: 96, spread: 0.034, range: 45, pierce: 0, falloff: 25, splashR: 0, splashDmg: 0, kick: 0.55, cost: 250, color: 0x2563eb, sound: 'smg' },
  { name: 'Súng săn Sấm Rền', short: 'SÚNG SĂN', dmg: 15, pellets: 10, interval: 4200, mag: 8, reload: 120, spread: 0.105, range: 24, pierce: 0, falloff: 9, splashR: 0, splashDmg: 0, kick: 3.2, cost: 650, color: 0x9a3412, sound: 'shotgun' },
  { name: 'Súng trường Mãng Xà', short: 'SÚNG TRƯỜNG', dmg: 40, pellets: 1, interval: 700, mag: 30, reload: 102, spread: 0.016, range: 80, pierce: 1, falloff: 60, splashR: 0, splashDmg: 0, kick: 0.9, cost: 1300, color: 0x15803d, sound: 'rifle' },
  { name: 'Pháo Chuối Nổ', short: 'PHÁO CHUỐI', dmg: 70, pellets: 1, interval: 3600, mag: 6, reload: 140, spread: 0.01, range: 70, pierce: 0, falloff: 70, splashR: 2.8, splashDmg: 80, kick: 2.6, cost: 3200, color: 0xeab308, sound: 'launcher' },
];
export const MAX_TIER = WEAPONS.length - 1;

/** tầm bay của đạn pháo (mô phỏng như tia ở tốc độ cao, có vệt bay ở client) */
export const LAUNCHER_SPEED = 55;

/* ======================= MÁU (nâng bằng phím C) ======================= */
export const HP_TIER_BONUS = 25;
export const HP_TIER_COST = [0, 150, 320, 560, 880, 1300];
export const MAX_HP_TIER = HP_TIER_COST.length - 1;

/* ======================= LỚP NHÂN VẬT ======================= */
export interface SkillDef {
  name: string;
  desc: string;
  /** giá xu mỗi lần dùng */
  cost: number;
  /** hồi chiêu (giây) */
  cd: number;
  icon: string;
}
export interface ClassDef {
  id: string;
  name: string;
  role: string;
  desc: string;
  passive: string;
  hp: number;
  speed: number;
  dmgMul: number;
  /** giảm sát thương nhận vào (0..1) */
  armor: number;
  reviveMul: number;
  regen: number;
  color: number;
  accent: number;
  g: SkillDef;
  x: SkillDef;
  q: { name: string; desc: string; icon: string };
}

export const CLASSES: ClassDef[] = [
  {
    id: 'chienbinh', name: 'CHIẾN BINH', role: 'Toàn diện', color: 0x3b82f6, accent: 0xfacc15,
    desc: 'Lính sống sót đa năng: ném lựu đạn dọn bầy khỉ, dựng rào làm chậm, gọi không kích.',
    passive: '+10% sát thương súng',
    hp: 100, speed: 6.0, dmgMul: 1.1, armor: 0, reviveMul: 1, regen: 0,
    g: { name: 'Lựu đạn', desc: 'Ném lựu đạn nổ sau 1 giây: 150 sát thương trong 4,2m.', cost: 50, cd: 3, icon: '💣' },
    x: { name: 'Rào chắn', desc: 'Dựng rào tre 4m trước mặt trong 30 giây, khỉ đi qua bị chậm 65%.', cost: 50, cd: 8, icon: '🚧' },
    q: { name: 'KHÔNG KÍCH', desc: 'Pháo sáng gọi 8 quả bom rải thẳng phía trước: 240 sát thương mỗi quả.', icon: '✈️' },
  },
  {
    id: 'ysi', name: 'Y SĨ', role: 'Hỗ trợ', color: 0x22c55e, accent: 0xffffff,
    desc: 'Giữ cả đội sống: hồi máu, đặt trạm hồi, đỡ đồng đội dậy nhanh gấp đôi.',
    passive: 'Đỡ dậy nhanh ×2 · tự hồi 2 máu/giây',
    hp: 100, speed: 6.2, dmgMul: 1, armor: 0, reviveMul: 2, regen: 2,
    g: { name: 'Hộp cứu thương', desc: 'Hồi 35 máu cho bạn và đồng đội gần nhất (6m).', cost: 40, cd: 5, icon: '🩹' },
    x: { name: 'Trạm hồi máu', desc: 'Đặt trạm hồi 9 máu/giây trong 4,5m, kéo dài 12 giây.', cost: 60, cd: 14, icon: '⛑️' },
    q: { name: 'BÁO ĐỘNG XANH', desc: 'Hồi đầy máu cả đội và đỡ dậy MỌI đồng đội đang gục, ở bất cứ đâu.', icon: '💚' },
  },
  {
    id: 'kysu', name: 'KỸ SƯ', role: 'Phòng thủ', color: 0xf97316, accent: 0x1f2937,
    desc: 'Dựng trụ súng tự động giữ cửa, sửa trụ giữa trận, kích quá tải khi bầy khỉ tràn tới.',
    passive: 'Trụ súng hưởng 50% nâng cấp vũ khí của bạn',
    hp: 100, speed: 6.0, dmgMul: 1, armor: 0, reviveMul: 1, regen: 0,
    g: { name: 'Sửa chữa', desc: 'Hồi đầy máu + thêm 20 giây cho mọi trụ và rào gần (10m).', cost: 30, cd: 4, icon: '🔧' },
    x: { name: 'Trụ súng', desc: 'Đặt trụ tự bắn khỉ trong 18m, tồn tại 45 giây (tối đa 2 trụ).', cost: 75, cd: 6, icon: '🗼' },
    q: { name: 'QUÁ TẢI', desc: '12 giây: trụ bắn nhanh gấp đôi, +50% sát thương, kèm một trụ miễn phí.', icon: '⚡' },
  },
  {
    id: 'dausi', name: 'ĐẤU SĨ', role: 'Đỡ đòn', color: 0xdc2626, accent: 0x111827,
    desc: 'Trâu bò, xông vào giữa bầy: dậm đất hất văng, gồng mình chịu đòn, gầm lên lôi hết khỉ về mình.',
    passive: '150 máu · giảm 15% sát thương nhận',
    hp: 150, speed: 5.6, dmgMul: 1, armor: 0.15, reviveMul: 1, regen: 0,
    g: { name: 'Dậm đất', desc: 'Dậm đất 5m: 80 sát thương, hất văng và làm choáng khỉ 1 giây.', cost: 40, cd: 5, icon: '👊' },
    x: { name: 'Gồng mình', desc: '5 giây giảm 45% sát thương nhận, đi chậm hơn 25%.', cost: 30, cd: 10, icon: '🛡️' },
    q: { name: 'CUỒNG NỘ', desc: 'Gầm lên: mọi khỉ trong 18m lao vào bạn 8 giây, +100 giáp ảo và giảm 50% sát thương.', icon: '🦍' },
  },
];

/** số khỉ hạ để sạc đầy tuyệt chiêu (Q) */
export const ULT_KILLS = 45;

/* ======================= LOÀI KHỈ ======================= */
export const MK_NAU = 0;
export const MK_CHAY = 1;
export const MK_NEM = 2;
export const MK_NO = 3;
export const MK_TRANG = 4;
export const MK_DOT = 5;
export const MK_VUA = 6;
export const MK_CON = 7;

export interface MonkeyDef {
  name: string;
  hp: number;
  speed: number;
  dmg: number;
  /** bán kính va chạm */
  r: number;
  /** tỉ lệ kích thước hình */
  scale: number;
  /** tầm đánh (tính từ mép) */
  reach: number;
  /** thời gian vung tay trước khi trúng (giây) */
  wind: number;
  /** hồi đòn (giây) */
  cd: number;
  reward: number;
  color: number;
  belly: number;
}

export const MONKEYS: MonkeyDef[] = [
  { name: 'Khỉ Nâu', hp: 50, speed: 3.5, dmg: 7, r: 0.45, scale: 1, reach: 0.55, wind: 0.4, cd: 1.2, reward: 8, color: 0x7c4a26, belly: 0xd9a066 },
  { name: 'Khỉ Chạy', hp: 30, speed: 6.1, dmg: 5, r: 0.38, scale: 0.85, reach: 0.5, wind: 0.25, cd: 0.8, reward: 10, color: 0xd97706, belly: 0xfcd34d },
  { name: 'Khỉ Ném Chuối', hp: 45, speed: 3.0, dmg: 11, r: 0.44, scale: 0.95, reach: 0.55, wind: 0.5, cd: 2.6, reward: 12, color: 0x4d7c0f, belly: 0xbef264 },
  { name: 'Khỉ Đỏ Nổ', hp: 35, speed: 5.2, dmg: 34, r: 0.42, scale: 0.95, reach: 1.2, wind: 0.6, cd: 1, reward: 12, color: 0xb91c1c, belly: 0xfca5a5 },
  { name: 'Khỉ Trắng', hp: 75, speed: 4.1, dmg: 14, r: 0.45, scale: 1.05, reach: 0.6, wind: 0.3, cd: 1.1, reward: 14, color: 0xe5e7eb, belly: 0xffffff },
  { name: 'Khỉ Đột', hp: 480, speed: 2.7, dmg: 26, r: 0.95, scale: 1.9, reach: 1.4, wind: 0.8, cd: 2.0, reward: 40, color: 0x374151, belly: 0x6b7280 },
  { name: 'VUA KHỈ ĐỘT', hp: 3600, speed: 3.1, dmg: 34, r: 1.7, scale: 3.3, reach: 1.8, wind: 0.9, cd: 2.2, reward: 350, color: 0x1f1b2e, belly: 0x4b3f63 },
  { name: 'Khỉ Con', hp: 28, speed: 4.6, dmg: 6, r: 0.32, scale: 0.7, reach: 0.45, wind: 0.25, cd: 0.9, reward: 4, color: 0x92400e, belly: 0xfde68a },
];

/** hình học trúng đạn: thân (cầu) + đầu (cầu, nhân đôi sát thương) theo tỉ lệ */
export function bodyY(t: number) { return 0.62 * MONKEYS[t].scale; }
export function bodyR(t: number) { return 0.46 * MONKEYS[t].scale; }
export function headY(t: number) { return 1.22 * MONKEYS[t].scale; }
export function headR(t: number) { return 0.3 * MONKEYS[t].scale; }
export const HEAD_MUL = 1.8;

/** chuối ném: tốc độ ngang + trọng lực */
export const BANANA_SPEED = 13;
export const PROJ_G = 18;
export const BOMB_RADIUS = 3.6;
/** khỉ trắng vồ */
export const POUNCE_RANGE = 8;
export const POUNCE_SPEED = 13;
/** sóng xung kích của Vua Khỉ: lan 11 m/s tới 14m, nhảy để né */
export const SHOCK_SPEED = 11;
export const SHOCK_MAX = 14;
export const SHOCK_BAND = 1.1;

/* ======================= ĐỢT (WAVE) ======================= */
export interface WaveSpec {
  n: number;
  total: number;
  maxAlive: number;
  /** giây giữa 2 lần thả khỉ */
  every: number;
  hpMul: number;
  dmgMul: number;
  spdMul: number;
  boss: boolean;
  /** trọng số chọn loài (index theo MK_*) */
  weights: number[];
}

const PLAYER_MUL = [1, 1.65, 2.2, 2.7];

export function waveSpec(n: number, players: number): WaveSpec {
  const p = Math.max(1, Math.min(4, players));
  const boss = n % 5 === 0;
  let total = Math.round((6 + n * 4 + n * n * 0.3) * PLAYER_MUL[p - 1]);
  if (boss) total = Math.round(total * 0.6);
  const maxAlive = Math.min(150, Math.round((10 + n * 2.6) * (0.65 + 0.35 * p)));
  const every = Math.max(0.1, (1.5 - n * 0.06) / Math.sqrt(p));
  const k = n - 1;
  // đông người thì khỉ trâu hơn một chút; về cuối tăng nhanh (bậc 2)
  const hpMul = (1 + 0.1 * k + 0.008 * k * k) * (1 + 0.12 * (p - 1));
  // chơi một mình: khỉ đánh nhẹ hơn 15% (không ai đỡ dậy)
  const dmgMul = (1 + 0.045 * k) * (p === 1 ? 0.85 : 1);
  const spdMul = Math.min(1.28, 1 + 0.014 * k);
  const w = [0, 0, 0, 0, 0, 0, 0, 0];
  w[MK_NAU] = 10;
  if (n >= 3) w[MK_CHAY] = 1.2 + n * 0.35;
  if (n >= 4) w[MK_NEM] = 1.2 + n * 0.15;
  if (n >= 6) w[MK_NO] = 0.6 + n * 0.18;
  if (n >= 8) w[MK_TRANG] = 0.5 + n * 0.15;
  if (n >= 7) w[MK_DOT] = 0.2 + n * 0.06;
  return { n, total, maxAlive, every, hpMul, dmgMul, spdMul, boss, weights: w };
}

/** máu boss theo số người + đợt */
export function bossHp(n: number, players: number) {
  // boss đầu tiên (đợt 5) nhẹ hơn để người mới làm quen
  return Math.round(MONKEYS[MK_VUA].hp * (players === 1 ? 0.75 : 1 + 0.6 * (players - 1)) * (1 + 0.45 * (n / 5 - 1)) * (n <= 5 ? 0.7 : 1));
}

/** nghỉ giữa 2 đợt (giây). Cả đội bấm SẴN SÀNG thì rút còn 3 giây */
export const BREAK_SECS = 14;
export const FIRST_BREAK_SECS = 8;

/* ======================= KINH TẾ ======================= */
/** đồng đội (không phải người hạ) nhận phần chia */
export const TEAM_SHARE = 0.3;
export function waveBonus(n: number) {
  return 40 + 10 * n;
}
export const START_CASH = 60;

/** gục: số giây chờ đồng đội trước khi chết hẳn; chết hẳn thì hồi sinh đầu đợt sau */
export const BLEED_SECS = 25;
/** giữ E bao lâu để đỡ dậy (giây) */
export const REVIVE_SECS = 3;
export const REVIVE_RANGE = 2.4;
export const REVIVE_HP = 0.35;

export function maxHpOf(cls: number, hpTier: number) {
  return CLASSES[cls].hp + HP_TIER_BONUS * hpTier;
}

export const ticksOf = (secs: number) => Math.round(secs * TICK_HZ);
