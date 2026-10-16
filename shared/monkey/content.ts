// Dữ liệu game: nhân vật, vũ khí theo bậc, các loài khỉ, công thức đợt (wave) và kinh tế.
// Mọi con số cân bằng nằm ở đây để server/client/bài test cùng đọc một nguồn.

import { TICK_HZ } from './config.js';
import type { Modifier } from './progression.js';

/* ======================= VŨ KHÍ (mỗi nhân vật một dòng súng riêng, nâng bậc bằng phím V) ======================= */
export type WeaponModel = 'pistol' | 'revolver' | 'smg' | 'shotgun' | 'rifle' | 'lmg' | 'sniper' | 'launcher';
export type WeaponSound = 'pistol' | 'revolver' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'launcher';
export interface WeaponDef {
  name: string;
  short: string;
  /** họ hình dáng (mô hình súng 3D + biểu tượng cửa hàng) */
  model: WeaponModel;
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
  sound: WeaponSound;
}

type WIn = Omit<WeaponDef, 'pierce' | 'splashR' | 'splashDmg'> & Partial<Pick<WeaponDef, 'pierce' | 'splashR' | 'splashDmg'>>;
const wpn = (w: WIn): WeaponDef => ({ pierce: 0, splashR: 0, splashDmg: 0, ...w });

/* các khẩu dùng chung giữa nhiều dòng */
const K9 = wpn({ name: 'Súng lục K-9', short: 'SÚNG LỤC', model: 'pistol', dmg: 34, pellets: 1, interval: 1300, mag: 12, reload: 66, spread: 0.012, range: 60, falloff: 40, kick: 1.2, cost: 0, color: 0x6b7280, sound: 'pistol' });
const ONG = wpn({ name: 'Tiểu liên Ong Vò Vẽ', short: 'TIỂU LIÊN', model: 'smg', dmg: 16, pellets: 1, interval: 500, mag: 36, reload: 96, spread: 0.034, range: 45, falloff: 25, kick: 0.55, cost: 250, color: 0x2563eb, sound: 'smg' });
const SAM_REN = { name: 'Súng săn Sấm Rền', short: 'SÚNG SĂN', model: 'shotgun', dmg: 15, pellets: 10, interval: 4200, mag: 8, reload: 120, spread: 0.105, range: 24, falloff: 9, kick: 3.2, color: 0x9a3412, sound: 'shotgun' } as const;

/** dòng súng theo id nhân vật — đúng 5 bậc, bậc 0 miễn phí */
const LINES: Record<string, WeaponDef[]> = {
  chienbinh: [
    K9,
    ONG,
    wpn({ name: 'Súng trường Mãng Xà', short: 'SÚNG TRƯỜNG', model: 'rifle', dmg: 36, pellets: 1, interval: 750, mag: 26, reload: 100, spread: 0.016, range: 80, pierce: 1, falloff: 60, kick: 0.9, cost: 650, color: 0x15803d, sound: 'rifle' }),
    wpn({ name: 'Súng tấn công Hổ Mang', short: 'TẤN CÔNG', model: 'rifle', dmg: 42, pellets: 1, interval: 600, mag: 32, reload: 100, spread: 0.018, range: 85, pierce: 1, falloff: 60, kick: 0.85, cost: 1300, color: 0x166534, sound: 'rifle' }),
    wpn({ name: 'Trung liên Bão Lửa', short: 'TRUNG LIÊN', model: 'lmg', dmg: 36, pellets: 1, interval: 430, mag: 80, reload: 190, spread: 0.03, range: 80, pierce: 1, falloff: 55, kick: 0.8, cost: 3200, color: 0x7f1d1d, sound: 'rifle' }),
  ],
  ysi: [
    K9,
    ONG,
    wpn({ name: 'Tiểu liên Chim Sẻ', short: 'TIỂU LIÊN+', model: 'smg', dmg: 21, pellets: 1, interval: 420, mag: 45, reload: 90, spread: 0.028, range: 50, falloff: 30, kick: 0.5, cost: 650, color: 0x0891b2, sound: 'smg' }),
    wpn({ name: 'Súng trường Ba Phát', short: 'BA PHÁT', model: 'rifle', dmg: 40, pellets: 1, interval: 520, mag: 30, reload: 96, spread: 0.014, range: 80, pierce: 1, falloff: 60, kick: 0.7, cost: 1300, color: 0x047857, sound: 'rifle' }),
    wpn({ name: 'Súng trường Thiên Thần', short: 'THIÊN THẦN', model: 'rifle', dmg: 58, pellets: 1, interval: 560, mag: 36, reload: 96, spread: 0.012, range: 90, pierce: 2, falloff: 70, kick: 0.8, cost: 3200, color: 0xf8fafc, sound: 'rifle' }),
  ],
  kysu: [
    K9,
    wpn({ name: 'Súng săn Nòng Ngắn', short: 'SĂN NGẮN', model: 'shotgun', dmg: 12, pellets: 8, interval: 3800, mag: 6, reload: 110, spread: 0.11, range: 22, falloff: 8, kick: 2.6, cost: 250, color: 0x78350f, sound: 'shotgun' }),
    wpn({ ...SAM_REN, cost: 650 }),
    wpn({ name: 'Trung liên Thợ Rèn', short: 'TRUNG LIÊN', model: 'lmg', dmg: 30, pellets: 1, interval: 480, mag: 60, reload: 170, spread: 0.03, range: 70, pierce: 1, falloff: 50, kick: 0.75, cost: 1300, color: 0x374151, sound: 'rifle' }),
    wpn({ name: 'Pháo Chuối Nổ', short: 'PHÁO CHUỐI', model: 'launcher', dmg: 70, pellets: 1, interval: 3600, mag: 6, reload: 140, spread: 0.01, range: 70, falloff: 70, splashR: 2.8, splashDmg: 80, kick: 2.6, cost: 3200, color: 0xeab308, sound: 'launcher' }),
  ],
  dausi: [
    wpn({ name: 'Súng săn Cưa Nòng', short: 'CƯA NÒNG', model: 'shotgun', dmg: 11, pellets: 7, interval: 4000, mag: 6, reload: 110, spread: 0.12, range: 18, falloff: 7, kick: 2.6, cost: 0, color: 0x57534e, sound: 'shotgun' }),
    wpn({ ...SAM_REN, cost: 250 }),
    wpn({ name: 'Súng săn Liên Thanh', short: 'SĂN TỰ ĐỘNG', model: 'shotgun', dmg: 13, pellets: 8, interval: 2000, mag: 12, reload: 130, spread: 0.11, range: 22, falloff: 9, kick: 2.2, cost: 650, color: 0x1f2937, sound: 'shotgun' }),
    wpn({ name: 'Súng săn Voi Rừng', short: 'VOI RỪNG', model: 'shotgun', dmg: 22, pellets: 10, interval: 3000, mag: 10, reload: 130, spread: 0.1, range: 26, pierce: 1, falloff: 10, kick: 3.4, cost: 1300, color: 0x7c2d12, sound: 'shotgun' }),
    wpn({ name: 'Súng máy Cối Xay', short: 'CỐI XAY', model: 'lmg', dmg: 26, pellets: 1, interval: 300, mag: 150, reload: 210, spread: 0.05, range: 60, falloff: 35, kick: 0.6, cost: 3200, color: 0x991b1b, sound: 'smg' }),
  ],
  xathu: [
    wpn({ name: 'Ổ quay Cú Mèo', short: 'Ổ QUAY', model: 'revolver', dmg: 60, pellets: 1, interval: 2400, mag: 6, reload: 90, spread: 0.006, range: 70, falloff: 50, kick: 1.8, cost: 0, color: 0x4c1d95, sound: 'revolver' }),
    wpn({ name: 'Súng trường Diều Hâu', short: 'DIỀU HÂU', model: 'rifle', dmg: 46, pellets: 1, interval: 1200, mag: 20, reload: 100, spread: 0.008, range: 90, pierce: 1, falloff: 70, kick: 1.1, cost: 250, color: 0x6d28d9, sound: 'rifle' }),
    wpn({ name: 'Bắn tỉa Chim Ưng', short: 'BẮN TỈA', model: 'sniper', dmg: 160, pellets: 1, interval: 5000, mag: 5, reload: 130, spread: 0.002, range: 120, pierce: 3, falloff: 120, kick: 3, cost: 650, color: 0x5b21b6, sound: 'sniper' }),
    wpn({ name: 'Bắn tỉa Đại Bàng', short: 'ĐẠI BÀNG', model: 'sniper', dmg: 215, pellets: 1, interval: 4300, mag: 6, reload: 125, spread: 0.002, range: 130, pierce: 4, falloff: 130, kick: 3.2, cost: 1300, color: 0x312e81, sound: 'sniper' }),
    wpn({ name: 'Bắn tỉa Thần Sấm', short: 'THẦN SẤM', model: 'sniper', dmg: 330, pellets: 1, interval: 3900, mag: 8, reload: 125, spread: 0.0015, range: 140, pierce: 6, falloff: 140, kick: 3.4, cost: 3200, color: 0xa78bfa, sound: 'sniper' }),
  ],
  phaothu: [
    K9,
    wpn({ name: 'Ống phóng Pháo Tép', short: 'PHÁO TÉP', model: 'launcher', dmg: 30, pellets: 1, interval: 3000, mag: 4, reload: 120, spread: 0.012, range: 60, falloff: 60, splashR: 1.9, splashDmg: 36, kick: 2, cost: 250, color: 0x65a30d, sound: 'launcher' }),
    wpn({ name: 'Pháo Chuối Nổ', short: 'PHÁO CHUỐI', model: 'launcher', dmg: 50, pellets: 1, interval: 3200, mag: 6, reload: 130, spread: 0.01, range: 70, falloff: 70, splashR: 2.4, splashDmg: 56, kick: 2.4, cost: 650, color: 0xeab308, sound: 'launcher' }),
    wpn({ name: 'Pháo Dừa Nổ', short: 'PHÁO DỪA', model: 'launcher', dmg: 62, pellets: 1, interval: 2800, mag: 8, reload: 130, spread: 0.01, range: 75, falloff: 75, splashR: 2.8, splashDmg: 76, kick: 2.6, cost: 1300, color: 0x854d0e, sound: 'launcher' }),
    wpn({ name: 'Pháo Sầu Riêng', short: 'SẦU RIÊNG', model: 'launcher', dmg: 80, pellets: 1, interval: 2400, mag: 10, reload: 130, spread: 0.01, range: 80, falloff: 80, splashR: 3.3, splashDmg: 100, kick: 2.8, cost: 3200, color: 0x4d7c0f, sound: 'launcher' }),
  ],
  caoboi: [
    wpn({ name: 'Ổ quay Cao Bồi', short: 'Ổ QUAY', model: 'revolver', dmg: 32, pellets: 1, interval: 1100, mag: 6, reload: 54, spread: 0.012, range: 50, falloff: 32, kick: 1.4, cost: 0, color: 0x92400e, sound: 'revolver' }),
    wpn({ name: 'Ổ quay Song Sát', short: 'SONG SÁT', model: 'revolver', dmg: 30, pellets: 1, interval: 700, mag: 10, reload: 60, spread: 0.016, range: 50, falloff: 32, kick: 1.1, cost: 250, color: 0x78350f, sound: 'revolver' }),
    wpn({ name: 'Súng săn Ngựa Hoang', short: 'NGỰA HOANG', model: 'shotgun', dmg: 14, pellets: 8, interval: 2400, mag: 6, reload: 84, spread: 0.1, range: 22, falloff: 9, kick: 2.6, cost: 650, color: 0xa16207, sound: 'shotgun' }),
    wpn({ name: 'Ổ quay Rắn Chuông', short: 'RẮN CHUÔNG', model: 'revolver', dmg: 52, pellets: 1, interval: 650, mag: 8, reload: 60, spread: 0.012, range: 60, pierce: 1, falloff: 40, kick: 1.3, cost: 1300, color: 0x713f12, sound: 'revolver' }),
    wpn({ name: 'Ổ quay Hoàng Hôn', short: 'HOÀNG HÔN', model: 'revolver', dmg: 68, pellets: 1, interval: 500, mag: 12, reload: 66, spread: 0.012, range: 65, pierce: 2, falloff: 45, kick: 1.3, cost: 3200, color: 0xf59e0b, sound: 'revolver' }),
  ],
};
/** bậc súng cao nhất (mỗi dòng đúng 5 bậc: 0..4) */
export const MAX_TIER = 4;

/** súng bậc `tier` của nhân vật `cls` (kẹp chỉ số để không bao giờ undefined) */
export function weaponOf(cls: number, tier: number): WeaponDef {
  const c = CLASSES[cls] ?? CLASSES[0];
  return c.weapons[tier < 0 ? 0 : tier > MAX_TIER ? MAX_TIER : tier | 0];
}
/** số tick nạp đạn thực tế (đã nhân hệ số nhân vật) */
export function reloadTicks(cls: number, tier: number): number {
  return Math.max(1, Math.round(weaponOf(cls, tier).reload * (CLASSES[cls] ?? CLASSES[0]).reloadMul));
}

/** tầm bay của đạn pháo (mô phỏng như tia ở tốc độ cao, có vệt bay ở client) */
export const LAUNCHER_SPEED = 55;

/* ======================= MÁU (nâng bằng phím C) ======================= */
export const HP_TIER_BONUS = 25;
export const HP_TIER_COST = [0, 150, 320, 560, 880, 1300];
export const MAX_HP_TIER = HP_TIER_COST.length - 1;

/* ======================= NHÂN VẬT ======================= */
export interface SkillDef {
  name: string;
  desc: string;
  /** giá xu mỗi lần dùng */
  cost: number;
  /** hồi chiêu (giây) */
  cd: number;
  icon: string;
}
/** hiệu ứng khi đồng hồ braceT của người chơi > 0 (chung một bộ đếm, mỗi nhân vật hiểu khác nhau) */
export interface BuffDef {
  /** hệ số tốc chạy */
  slow: number;
  /** giảm sát thương nhận thêm (0..1) */
  armor: number;
  /** hệ số khoảng cách giữa 2 phát (<1 = bắn nhanh hơn) */
  fireMul: number;
  /** bắn không tốn đạn */
  freeAmmo: boolean;
  /** hệ số sát thương súng */
  dmg: number;
}
const NO_BUFF: BuffDef = { slow: 1, armor: 0, fireMul: 1, freeAmmo: false, dmg: 1 };

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
  /** hệ số sát thương khi trúng đầu */
  headMul: number;
  /** hệ số bán kính nổ của súng */
  splashMul: number;
  /** hệ số thời gian nạp đạn */
  reloadMul: number;
  /** hiệu ứng khi braceT > 0 */
  buff: BuffDef;
  color: number;
  accent: number;
  /** dòng súng riêng: đúng 5 bậc (MAX_TIER + 1), bậc 0 miễn phí */
  weapons: WeaponDef[];
  g: SkillDef;
  x: SkillDef;
  q: { name: string; desc: string; icon: string };
}

const BASE = { armor: 0, reviveMul: 1, regen: 0, headMul: 1.8, splashMul: 1, reloadMul: 1, buff: NO_BUFF };

export const CLASSES: ClassDef[] = [
  {
    ...BASE,
    id: 'chienbinh', name: 'CHIẾN BINH', role: 'Toàn diện', color: 0x3b82f6, accent: 0xfacc15,
    desc: 'Lính sống sót đa năng: ném lựu đạn dọn bầy khỉ, dựng rào làm chậm, gọi không kích.',
    passive: '+10% sát thương súng',
    hp: 100, speed: 6.0, dmgMul: 1.1,
    weapons: LINES.chienbinh,
    g: { name: 'Lựu đạn', desc: 'Ném lựu đạn nổ sau 1 giây: 150 sát thương trong 4,2m.', cost: 50, cd: 3, icon: '💣' },
    x: { name: 'Rào chắn', desc: 'Dựng rào tre 4m trước mặt trong 30 giây, khỉ đi qua bị chậm 65%.', cost: 50, cd: 8, icon: '🚧' },
    q: { name: 'KHÔNG KÍCH', desc: 'Pháo sáng gọi 8 quả bom rải thẳng phía trước: 240 sát thương mỗi quả.', icon: '✈️' },
  },
  {
    ...BASE,
    id: 'ysi', name: 'Y SĨ', role: 'Hỗ trợ', color: 0x22c55e, accent: 0xffffff,
    desc: 'Giữ cả đội sống: hồi máu, đặt trạm hồi, đỡ đồng đội dậy nhanh gấp đôi.',
    passive: 'Đỡ dậy nhanh ×2 · tự hồi 2 máu/giây',
    hp: 100, speed: 6.2, dmgMul: 1, reviveMul: 2, regen: 2,
    weapons: LINES.ysi,
    g: { name: 'Hộp cứu thương', desc: 'Hồi 35 máu cho bạn và đồng đội gần nhất (6m).', cost: 40, cd: 5, icon: '🩹' },
    x: { name: 'Trạm hồi máu', desc: 'Đặt trạm hồi 9 máu/giây trong 4,5m, kéo dài 12 giây.', cost: 60, cd: 14, icon: '⛑️' },
    q: { name: 'BÁO ĐỘNG XANH', desc: 'Hồi đầy máu cả đội và đỡ dậy MỌI đồng đội đang gục, ở bất cứ đâu.', icon: '💚' },
  },
  {
    ...BASE,
    id: 'kysu', name: 'KỸ SƯ', role: 'Phòng thủ', color: 0xf97316, accent: 0x1f2937,
    desc: 'Dựng trụ súng tự động giữ cửa, sửa trụ giữa trận, kích quá tải khi bầy khỉ tràn tới.',
    passive: 'Trụ súng hưởng 50% nâng cấp vũ khí của bạn',
    hp: 100, speed: 6.0, dmgMul: 1,
    weapons: LINES.kysu,
    g: { name: 'Sửa chữa', desc: 'Hồi đầy máu + thêm 20 giây cho mọi trụ và rào gần (10m).', cost: 30, cd: 4, icon: '🔧' },
    x: { name: 'Trụ súng', desc: 'Đặt trụ tự bắn khỉ trong 18m, tồn tại 45 giây (tối đa 2 trụ).', cost: 75, cd: 6, icon: '🗼' },
    q: { name: 'QUÁ TẢI', desc: '12 giây: trụ bắn nhanh gấp đôi, +50% sát thương, kèm một trụ miễn phí.', icon: '⚡' },
  },
  {
    ...BASE,
    id: 'dausi', name: 'ĐẤU SĨ', role: 'Đỡ đòn', color: 0xdc2626, accent: 0x111827,
    desc: 'Trâu bò, xông vào giữa bầy: dậm đất hất văng, gồng mình chịu đòn, gầm lên lôi hết khỉ về mình.',
    passive: '150 máu · giảm 15% sát thương nhận',
    hp: 150, speed: 5.6, dmgMul: 1, armor: 0.15,
    buff: { ...NO_BUFF, slow: 0.75, armor: 0.45 },
    weapons: LINES.dausi,
    g: { name: 'Dậm đất', desc: 'Dậm đất 5m: 80 sát thương, hất văng và làm choáng khỉ 1 giây.', cost: 40, cd: 5, icon: '👊' },
    x: { name: 'Gồng mình', desc: '5 giây giảm 45% sát thương nhận, đi chậm hơn 25%.', cost: 30, cd: 10, icon: '🛡️' },
    q: { name: 'CUỒNG NỘ', desc: 'Gầm lên: mọi khỉ trong 18m lao vào bạn 8 giây, +100 giáp ảo và giảm 50% sát thương.', icon: '🦍' },
  },
  {
    ...BASE,
    id: 'xathu', name: 'XẠ THỦ', role: 'Bắn tỉa', color: 0x8b5cf6, accent: 0xe5e7eb,
    desc: 'Mỏng máu nhưng một phát xuyên cả hàng khỉ: ném bom choáng, mở Mắt Ưng bắn liên tục, kết liễu bằng phát bắn thần.',
    passive: 'Trúng đầu ×2,6 sát thương (thường ×1,8) · chỉ 85 máu',
    hp: 85, speed: 6.0, dmgMul: 1, headMul: 2.6,
    buff: { ...NO_BUFF, freeAmmo: true, dmg: 1.35 },
    weapons: LINES.xathu,
    g: { name: 'Bom choáng', desc: 'Ném bom tới điểm ngắm (tối đa 22m), nổ sau 0,6 giây: 40 sát thương, choáng khỉ 2,5 giây trong 5m.', cost: 40, cd: 6, icon: '💫' },
    x: { name: 'Mắt Ưng', desc: '6 giây bắn không tốn đạn, +35% sát thương súng.', cost: 40, cd: 14, icon: '🦅' },
    q: { name: 'PHÁT BẮN THẦN', desc: 'Một tia sét xuyên thẳng 160m: 900 sát thương lên mọi khỉ trên đường (tối đa 16 con), trúng đầu còn đau hơn.', icon: '🎯' },
  },
  {
    ...BASE,
    id: 'phaothu', name: 'PHÁO THỦ', role: 'Chất nổ', color: 0xeab308, accent: 0x7f1d1d,
    desc: 'Mê thuốc nổ: súng nào cũng nổ tung, ném bom chùm, gọi pháo cối, trút mưa pháo quanh mình.',
    passive: '+20% bán kính nổ của súng · giảm 30% sát thương nổ nhận',
    hp: 110, speed: 5.7, dmgMul: 1, splashMul: 1.2,
    weapons: LINES.phaothu,
    g: { name: 'Bom chùm', desc: 'Ném 3 quả lựu đạn tỏa hình quạt, mỗi quả 90 sát thương trong 4,2m.', cost: 50, cd: 4, icon: '🧨' },
    x: { name: 'Pháo cối', desc: 'Gọi 5 quả pháo rơi quanh điểm ngắm (tối đa 30m) sau 1 giây: 110 sát thương mỗi quả.', cost: 60, cd: 9, icon: '🎇' },
    q: { name: 'MƯA PHÁO', desc: '4 giây: 20 quả pháo dội xuống quanh bạn trong 16m, 200 sát thương mỗi quả.', icon: '☄️' },
  },
  {
    ...BASE,
    id: 'caoboi', name: 'CAO BỒI', role: 'Cơ động', color: 0x14b8a6, accent: 0x78350f,
    desc: 'Nhanh tay nhanh chân, giỏi đấu gần–trung: quạt súng vào nhiều con cùng lúc, hất cát làm choáng, xả ổ quay như mưa.',
    passive: 'Chạy nhanh +13% · nạp đạn nhanh hơn 35%',
    hp: 95, speed: 6.8, dmgMul: 1.05, reloadMul: 0.65,
    buff: { ...NO_BUFF, fireMul: 0.4, freeAmmo: true, dmg: 1.2 },
    weapons: LINES.caoboi,
    g: { name: 'Quạt súng', desc: 'Tự ngắm 6 con khỉ gần nhất phía trước (22m), mỗi con ăn sát thương bằng 2,2 phát súng hiện tại.', cost: 40, cd: 5, icon: '🤠' },
    x: { name: 'Hất cát', desc: 'Hất cát hình nón 8m trước mặt: 25 sát thương, đẩy lùi và choáng khỉ 2 giây.', cost: 30, cd: 8, icon: '🌪️' },
    q: { name: 'THẦN TỐC', desc: '8 giây: bắn nhanh gấp 2,5 lần, không tốn đạn, +20% sát thương súng.', icon: '🔥' },
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

/** tổng số khỉ của đợt theo số người (1..MAX_PLAYERS); quá 4 người tăng chậm lại */
const PLAYER_MUL = [1, 1.65, 2.2, 2.7, 3.15, 3.55, 3.9, 4.2, 4.5, 4.75];
/** trần khỉ còn sống cùng lúc (CPU server: AI + snapshot), < MAX_MONKEYS để còn slot đệm */
export const MAX_ALIVE = 150;

/** hệ số đám đông (số khỉ cùng lúc): tuyến tính tới 4 người, sau đó tăng chậm (10 người = 3.25) */
function crowdMul(p: number) {
  return p <= 4 ? 0.65 + 0.35 * p : 2.05 + 0.2 * (p - 4);
}

/** tham số ải đưa vào waveSpec (vô tận: không truyền) — StageDef thoả kiểu này */
export interface WaveStage {
  /** hệ số độ khó (máu + sát thương khỉ) */
  diff: number;
  mods: readonly Modifier[];
}
/** hệ số máu khỉ thêm của ải (dùng cả cho boss) */
export function stageHpMul(stage?: WaveStage) {
  if (!stage) return 1;
  return stage.diff * (stage.mods.includes('tough') ? 1.4 : 1);
}

export function waveSpec(n: number, players: number, stage?: WaveStage): WaveSpec {
  const p = Math.max(1, Math.min(PLAYER_MUL.length, players));
  const boss = stage?.mods.includes('bossRush') ? n % 2 === 0 : n % 5 === 0;
  let total = Math.round((6 + n * 4 + n * n * 0.3) * PLAYER_MUL[p - 1]);
  if (boss) total = Math.round(total * 0.6);
  const maxAlive = Math.min(MAX_ALIVE, Math.round((10 + n * 2.6) * crowdMul(p)));
  const every = Math.max(0.1, (1.5 - n * 0.06) / Math.sqrt(p));
  const k = n - 1;
  // đông người thì khỉ trâu hơn một chút (+12%/người tới 4 người, sau đó +8%/người); về cuối tăng nhanh (bậc 2)
  const hpMul = (1 + 0.1 * k + 0.008 * k * k) * (1 + 0.12 * Math.min(3, p - 1) + 0.08 * Math.max(0, p - 4));
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
  if (!stage) return { n, total, maxAlive, every, hpMul, dmgMul, spdMul, boss, weights: w };
  // ---- ải: độ khó + luật đặc biệt (xác định, server/client cùng tính) ----
  if (stage.mods.includes('explosiveOnly')) {
    w.fill(0);
    w[MK_NO] = 10;
  }
  return {
    n, total, maxAlive, every, boss, weights: w,
    hpMul: hpMul * stageHpMul(stage),
    dmgMul: dmgMul * stage.diff,
    spdMul: spdMul * (stage.mods.includes('fast') ? 1.25 : 1),
  };
}

/** máu boss theo số người + đợt */
export function bossHp(n: number, players: number, stage?: WaveStage) {
  players = Math.max(1, Math.min(PLAYER_MUL.length, players));
  // boss đầu tiên (đợt 5) nhẹ hơn để người mới làm quen
  return Math.round(MONKEYS[MK_VUA].hp * (players === 1 ? 0.75 : 1 + 0.6 * (players - 1)) * (1 + 0.45 * (n / 5 - 1)) * (n <= 5 ? 0.7 : 1) * stageHpMul(stage));
}

/** nghỉ giữa 2 đợt (giây). Cả đội bấm SẴN SÀNG thì rút còn 3 giây */
export const BREAK_SECS = 30;
export const FIRST_BREAK_SECS = 8;

/* ======================= KINH TẾ ======================= */
/** đồng đội (không phải người hạ) nhận phần chia */
export const TEAM_SHARE = 0.3;
/** phần chia cho MỖI đồng đội theo số người trong phòng: ≤4 người giữ 30%;
 *  đông hơn thì giảm theo căn (10 người ≈ 17%) để xu không lạm phát khi mỗi người hạ ít khỉ hơn */
export function teamShare(players: number) {
  return players <= 4 ? TEAM_SHARE : TEAM_SHARE * Math.sqrt(3 / (players - 1));
}
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
