// Tiến trình lâu dài của Bầy Khỉ — v2 "mang đồ vào ải, chết là mất" (kiểu Võ Lâm Truyền Kỳ).
// Đồ đạc 5 phẩm, danh mục lớn (súng/dao/mũ/giáp/bao tay/giày/đai/bùa/nhẫn/trang phục/tiêu hao/nguyên liệu),
// nhân vật mở khoá, nâng kỹ năng, cấp người chơi, danh sách ải + rương ải + rớt đồ khi hạ khỉ, thương nhân.
// Thuần dữ liệu + hàm thuần — server, client và test cùng đọc. Mọi việc "tung xúc xắc" nhận rng từ ngoài vào.
//
// Ghi chú tiền tệ: mảnh nhân vật / sách kỹ năng / vàng VẪN là tiền tệ trên hồ sơ. Trong trận chúng có thể rơi ra
// dưới dạng món "nguyên liệu" có `currency` (c_manh, c_sach, c_vang) — khi mang về được (survived) store đổi
// thẳng thành tiền tệ (count = số lượng), không vào túi đồ. Đá Cường Hoá (m_da) là món đồ thật, dùng để cường hoá.

import { weaponOf, type WeaponDef, type WeaponModel } from './content.js';
import type { ConsumableEffect, EquipSlot, Grade, ItemKind, LootDrop, StatKey2 } from './gear.js';
import { SLOT_ACCEPTS } from './gear.js';

export type { ConsumableEffect, EquipSlot, Grade, ItemKind, LootDrop, StatKey2 } from './gear.js';
export { SLOT_ACCEPTS } from './gear.js';

/* ======================= PHẨM ======================= */
export interface GradeInfo {
  id: Grade;
  /** màu kiểu VLTK */
  name: string;
  /** tên bậc */
  tier: string;
  color: string;
  /** hệ số chỉ số gốc của trang bị (không phải súng) */
  statMul: number;
  /** hệ số sát thương súng */
  gunMul: number;
  /** số dòng phụ tung khi rớt */
  affixCount: number;
  /** giá bán cho thương nhân (cấp 1) */
  sellPrice: number;
  /** cấp nhân vật tối thiểu để mặc */
  levelReq: number;
}
export const GRADES: readonly GradeInfo[] = [
  { id: 0, name: 'Trắng', tier: 'Thường', color: '#e5e7eb', statMul: 1, gunMul: 1, affixCount: 0, sellPrice: 10, levelReq: 1 },
  { id: 1, name: 'Xanh', tier: 'Tốt', color: '#38bdf8', statMul: 1.3, gunMul: 1.15, affixCount: 1, sellPrice: 30, levelReq: 4 },
  { id: 2, name: 'Tím', tier: 'Hiếm', color: '#a855f7', statMul: 1.7, gunMul: 1.32, affixCount: 2, sellPrice: 90, levelReq: 10 },
  { id: 3, name: 'Vàng', tier: 'Sử thi', color: '#facc15', statMul: 2.2, gunMul: 1.52, affixCount: 3, sellPrice: 260, levelReq: 18 },
  { id: 4, name: 'Cam', tier: 'Huyền thoại', color: '#f97316', statMul: 2.8, gunMul: 1.75, affixCount: 4, sellPrice: 700, levelReq: 28 },
];
export const GRADE_MAX: Grade = 4;
export const clampGrade = (g: unknown): Grade => (Number.isFinite(g as number) ? (Math.max(0, Math.min(4, Math.floor(g as number))) as Grade) : 0);

/* ======================= CHỈ SỐ ======================= */
/** hp/regen/knifeDmg/pierce là điểm (regen = máu/giây, pierce = số khỉ xuyên thêm); còn lại % dạng 0.10 = +10% */
export const STAT2_INFO: Record<StatKey2, { name: string; pct: boolean; cap: number }> = {
  hp: { name: 'Máu', pct: false, cap: 300 },
  armor: { name: 'Giáp', pct: true, cap: 0.5 },
  dmg: { name: 'Sát thương', pct: true, cap: 0.8 },
  headDmg: { name: 'Bắn đầu', pct: true, cap: 1 },
  crit: { name: 'Chí mạng', pct: true, cap: 0.35 },
  critDmg: { name: 'ST chí mạng', pct: true, cap: 1.5 },
  lifesteal: { name: 'Hút máu', pct: true, cap: 0.08 },
  regen: { name: 'Hồi máu/giây', pct: false, cap: 10 },
  reload: { name: 'Nạp đạn nhanh', pct: true, cap: 0.4 },
  fireRate: { name: 'Tốc bắn', pct: true, cap: 0.3 },
  speed: { name: 'Tốc chạy', pct: true, cap: 0.15 },
  mag: { name: 'Băng đạn', pct: true, cap: 0.6 },
  pierce: { name: 'Xuyên thấu', pct: false, cap: 3 },
  cdr: { name: 'Giảm hồi chiêu', pct: true, cap: 0.35 },
  skillDmg: { name: 'ST kỹ năng', pct: true, cap: 0.8 },
  knifeDmg: { name: 'Sát thương dao', pct: false, cap: 600 },
  luck: { name: 'May mắn', pct: true, cap: 0.6 },
  pickup: { name: 'Tầm nhặt', pct: true, cap: 1 },
};
export type Stats2 = Partial<Record<StatKey2, number>>;
/** những chỉ số đã NƯỚNG SẴN vào WeaponDef (gameplay KHÔNG áp lại): tốc bắn, nạp đạn, băng đạn, xuyên */
export const BAKED_STATS: readonly StatKey2[] = ['fireRate', 'reload', 'mag', 'pierce'];
/** giá trị gốc 1 dòng phụ (nhân thêm theo phẩm + ngẫu nhiên) */
export const AFFIX_BASE: Record<StatKey2, number> = {
  hp: 15, armor: 0.02, dmg: 0.03, headDmg: 0.06, crit: 0.02, critDmg: 0.08, lifesteal: 0.006, regen: 0.6,
  reload: 0.03, fireRate: 0.02, speed: 0.012, mag: 0.06, pierce: 1, cdr: 0.02, skillDmg: 0.04, knifeDmg: 20, luck: 0.03, pickup: 0.1,
};

/* ======================= DANH MỤC ĐỒ ======================= */
export interface ItemDef2 {
  id: string;
  kind: ItemKind;
  name: string;
  desc: string;
  icon?: string;
  minGrade: Grade;
  maxGrade: Grade;
  /** chỉ số gốc ở phẩm Trắng cấp 1 (súng: rỗng — chỉ số nằm trong gun.base) */
  base: Stats2;
  /** dòng phụ có thể tung */
  affixPool: StatKey2[];
  /** hình dáng: súng kind = họ súng (WeaponModel); mũ/dao: kiểu; skin: 'skin' */
  look: { kind: string; color: number; accent?: number };
  gun?: { family: WeaponModel; base: Partial<WeaponDef> };
  consumable?: ConsumableEffect;
  /** số lượng tối đa một chồng (không có = không chồng, mỗi món một dòng) */
  stack?: number;
  /** chỉ có từ sự kiện / phần thưởng, không rớt ngẫu nhiên, không bán ở chợ */
  special?: boolean;
  /** cấp nhân vật tối thiểu (gộp với GRADES[g].levelReq — lấy cái lớn hơn) */
  levelReq?: number;
  /** giá bán 1 đơn vị cho thương nhân (tiêu hao/nguyên liệu); không có = theo phẩm */
  value?: number;
  /** món tiền tệ: mang về được thì đổi thành tiền tệ hồ sơ */
  currency?: 'gold' | 'shards' | 'books';
}

const KIND_ICON: Record<ItemKind, string> = {
  gun: '🔫', knife: '🔪', helmet: '⛑️', armor: '🦺', gloves: '🧤', boots: '🥾', belt: '🎗️', amulet: '📿', ring: '💍', skin: '👕', consumable: '🧪', material: '💎',
};
export const KIND_INFO: Record<ItemKind, { name: string; icon: string }> = {
  gun: { name: 'Súng', icon: KIND_ICON.gun },
  knife: { name: 'Dao', icon: KIND_ICON.knife },
  helmet: { name: 'Mũ', icon: KIND_ICON.helmet },
  armor: { name: 'Giáp', icon: KIND_ICON.armor },
  gloves: { name: 'Bao tay', icon: KIND_ICON.gloves },
  boots: { name: 'Giày', icon: KIND_ICON.boots },
  belt: { name: 'Đai lưng', icon: KIND_ICON.belt },
  amulet: { name: 'Hộ phù', icon: KIND_ICON.amulet },
  ring: { name: 'Nhẫn', icon: KIND_ICON.ring },
  skin: { name: 'Trang phục', icon: KIND_ICON.skin },
  consumable: { name: 'Tiêu hao', icon: KIND_ICON.consumable },
  material: { name: 'Nguyên liệu', icon: KIND_ICON.material },
};
/** thứ tự + tên hiển thị các ô trang bị */
export const EQUIP_SLOTS: { id: EquipSlot; name: string; icon: string }[] = [
  { id: 'weapon1', name: 'Súng chính', icon: '🔫' },
  { id: 'weapon2', name: 'Súng phụ', icon: '🔫' },
  { id: 'knife', name: 'Dao', icon: '🔪' },
  { id: 'helmet', name: 'Mũ', icon: '⛑️' },
  { id: 'armor', name: 'Giáp', icon: '🦺' },
  { id: 'gloves', name: 'Bao tay', icon: '🧤' },
  { id: 'boots', name: 'Giày', icon: '🥾' },
  { id: 'belt', name: 'Đai lưng', icon: '🎗️' },
  { id: 'amulet', name: 'Hộ phù', icon: '📿' },
  { id: 'ring1', name: 'Nhẫn trái', icon: '💍' },
  { id: 'ring2', name: 'Nhẫn phải', icon: '💍' },
  { id: 'skin', name: 'Trang phục', icon: '👕' },
  { id: 'quick1', name: 'Tiêu hao (3)', icon: '🧪' },
  { id: 'quick2', name: 'Tiêu hao (4)', icon: '🧪' },
  { id: 'secure', name: 'Túi an toàn', icon: '🔒' },
];
export const isEquipSlot = (s: unknown): s is EquipSlot => typeof s === 'string' && Object.prototype.hasOwnProperty.call(SLOT_ACCEPTS, s);

/* ---- súng: khuôn chỉ số theo họ ---- */
type GunBase = Omit<WeaponDef, 'name' | 'short' | 'cost' | 'color'>;
const FAM: Record<WeaponModel, GunBase & { short: string }> = {
  pistol: { short: 'SÚNG LỤC', model: 'pistol', dmg: 34, pellets: 1, interval: 1300, mag: 12, reload: 66, spread: 0.012, range: 60, pierce: 0, falloff: 40, splashR: 0, splashDmg: 0, kick: 1.2, sound: 'pistol' },
  revolver: { short: 'Ổ QUAY', model: 'revolver', dmg: 58, pellets: 1, interval: 2200, mag: 6, reload: 80, spread: 0.007, range: 65, pierce: 0, falloff: 48, splashR: 0, splashDmg: 0, kick: 1.7, sound: 'revolver' },
  smg: { short: 'TIỂU LIÊN', model: 'smg', dmg: 16, pellets: 1, interval: 500, mag: 36, reload: 96, spread: 0.034, range: 45, pierce: 0, falloff: 25, splashR: 0, splashDmg: 0, kick: 0.55, sound: 'smg' },
  shotgun: { short: 'SÚNG SĂN', model: 'shotgun', dmg: 13, pellets: 9, interval: 3600, mag: 7, reload: 115, spread: 0.11, range: 22, pierce: 0, falloff: 9, splashR: 0, splashDmg: 0, kick: 2.8, sound: 'shotgun' },
  rifle: { short: 'SÚNG TRƯỜNG', model: 'rifle', dmg: 36, pellets: 1, interval: 750, mag: 26, reload: 100, spread: 0.016, range: 80, pierce: 1, falloff: 60, splashR: 0, splashDmg: 0, kick: 0.9, sound: 'rifle' },
  lmg: { short: 'TRUNG LIÊN', model: 'lmg', dmg: 30, pellets: 1, interval: 470, mag: 70, reload: 185, spread: 0.032, range: 70, pierce: 1, falloff: 50, splashR: 0, splashDmg: 0, kick: 0.75, sound: 'rifle' },
  sniper: { short: 'BẮN TỈA', model: 'sniper', dmg: 160, pellets: 1, interval: 5000, mag: 5, reload: 130, spread: 0.002, range: 120, pierce: 3, falloff: 120, splashR: 0, splashDmg: 0, kick: 3, sound: 'sniper' },
  launcher: { short: 'ỐNG PHÓNG', model: 'launcher', dmg: 40, pellets: 1, interval: 3200, mag: 5, reload: 130, spread: 0.011, range: 65, pierce: 0, falloff: 65, splashR: 2.2, splashDmg: 46, kick: 2.2, sound: 'launcher' },
};
const GUN_AFFIX: StatKey2[] = ['dmg', 'crit', 'critDmg', 'headDmg', 'fireRate', 'reload', 'mag', 'lifesteal'];
const GUN_AFFIX_PIERCE: StatKey2[] = [...GUN_AFFIX, 'pierce'];
type GS = [id: string, name: string, minG: Grade, maxG: Grade, lv: number, o: Partial<WeaponDef>, color: number, accent?: number, desc?: string];
function guns(fam: WeaponModel, list: GS[]): ItemDef2[] {
  return list.map(([id, name, minGrade, maxGrade, levelReq, o, color, accent, desc]) => ({
    id, kind: 'gun' as const, name, desc: desc ?? `${FAM[fam].short.toLowerCase()} — ${name}.`, minGrade, maxGrade, levelReq,
    base: {}, affixPool: fam === 'rifle' || fam === 'sniper' || fam === 'lmg' ? GUN_AFFIX_PIERCE : GUN_AFFIX,
    look: { kind: fam, color, accent },
    gun: { family: fam, base: o },
  }));
}

const GUNS: ItemDef2[] = [
  ...guns('pistol', [
    ['g_tanbinh', 'Súng Lục Tân Binh', 0, 0, 1, { dmg: 30 }, 0x6b7280, undefined, 'Súng phát cho tân binh. Không bao giờ thiếu.'],
    ['g_k9', 'Súng Lục K-9', 0, 2, 1, {}, 0x4b5563],
    ['g_songlong', 'Song Long Thương', 0, 3, 4, { dmg: 30, interval: 900, mag: 16 }, 0x0f766e, 0xfacc15],
    ['g_bachhac', 'Bạch Hạc Lục', 1, 3, 8, { dmg: 44, interval: 1200, spread: 0.009, range: 65 }, 0xf8fafc, 0xdc2626],
    ['g_hacphong', 'Hắc Phong Lục', 1, 4, 12, { dmg: 38, interval: 800, mag: 18, reload: 60 }, 0x111827, 0x6b7280],
    ['g_nganxa', 'Ngân Xà Lục', 2, 4, 16, { dmg: 52, interval: 1000, mag: 14, pierce: 1 }, 0xcbd5e1, 0x16a34a],
    ['g_tudien', 'Tử Điện Lục', 2, 4, 22, { dmg: 46, interval: 700, mag: 20, reload: 56 }, 0x7c3aed, 0xe9d5ff],
    ['g_thienlong', 'Thiên Long Lục', 3, 4, 30, { dmg: 64, interval: 850, mag: 18, pierce: 1 }, 0xeab308, 0xb91c1c],
  ]),
  ...guns('revolver', [
    ['g_cumeo', 'Ổ Quay Cú Mèo', 0, 2, 1, { dmg: 60, interval: 2400 }, 0x4c1d95],
    ['g_caoboi', 'Ổ Quay Cao Bồi', 0, 2, 1, { dmg: 32, interval: 1100, reload: 54, spread: 0.012, range: 50, falloff: 32 }, 0x92400e],
    ['g_vang', 'Súng Mạ Vàng', 1, 3, 5, { dmg: 50, interval: 1300, mag: 8 }, 0xeab308, 0xfef08a, 'Ổ quay mạ vàng — kẻ giàu ưa dùng.'],
    ['g_songsat', 'Song Sát Luân', 1, 3, 8, { dmg: 34, interval: 700, mag: 10, reload: 60 }, 0x78350f],
    ['g_ranchuong', 'Rắn Chuông Luân', 1, 4, 14, { dmg: 52, interval: 650, mag: 8, pierce: 1 }, 0x713f12, 0xfde68a],
    ['g_hoanghon', 'Hoàng Hôn Luân', 2, 4, 20, { dmg: 68, interval: 520, mag: 12, pierce: 2 }, 0xf59e0b],
    ['g_lietduong', 'Liệt Dương Luân', 3, 4, 26, { dmg: 110, interval: 1400, mag: 6, pierce: 2 }, 0xdc2626, 0xfbbf24],
    ['g_kimdieu', 'Kim Điêu Thần Luân', 3, 4, 32, { dmg: 85, interval: 480, mag: 12, pierce: 2, reload: 60 }, 0xfacc15, 0x1f2937],
  ]),
  ...guns('smg', [
    ['g_ongvo', 'Tiểu Liên Ong Vò Vẽ', 0, 2, 1, {}, 0xfacc15, 0x111827],
    ['g_daibangnon', 'Đại Bàng Non', 0, 2, 3, { dmg: 18, interval: 560, mag: 30 }, 0x2563eb],
    ['g_bang', 'Băng Phong Liên', 1, 3, 5, { dmg: 15, interval: 440, mag: 40, reload: 70 }, 0x7dd3fc, 0xe0f2fe, 'Nạp đạn nhanh như gió bấc.'],
    ['g_chimse', 'Chim Sẻ Liên', 1, 3, 8, { dmg: 21, interval: 420, mag: 45, reload: 90 }, 0x0891b2],
    ['g_lucdiep', 'Lục Diệp Liên', 1, 4, 12, { dmg: 20, interval: 380, mag: 50, spread: 0.04 }, 0x65a30d],
    ['g_huyetdiep', 'Huyết Điệp Liên', 2, 4, 18, { dmg: 25, interval: 400, mag: 48 }, 0xb91c1c, 0xfca5a5],
    ['g_phongvan', 'Phong Vân Liên', 2, 4, 24, { dmg: 27, interval: 340, mag: 60, reload: 88 }, 0x64748b, 0xf8fafc],
    ['g_thiensat', 'Thiên Sát Liên', 3, 4, 32, { dmg: 32, interval: 330, mag: 64, pierce: 1 }, 0x1e1b4b, 0xf43f5e],
  ]),
  ...guns('shotgun', [
    ['g_cuanong', 'Súng Săn Cưa Nòng', 0, 2, 1, { dmg: 11, pellets: 7, interval: 4000, mag: 6, reload: 110, spread: 0.12, range: 18, falloff: 7 }, 0x57534e],
    ['g_nongngan', 'Súng Săn Nòng Ngắn', 0, 2, 1, { dmg: 12, pellets: 8, interval: 3800, mag: 6, reload: 110 }, 0x78350f],
    ['g_samren', 'Sấm Rền Thương', 1, 3, 6, { dmg: 15, pellets: 10, interval: 4200, mag: 8, reload: 120, spread: 0.105, range: 24 }, 0x9a3412],
    ['g_nguahoang', 'Ngựa Hoang Thương', 1, 3, 10, { dmg: 14, pellets: 8, interval: 2400, mag: 6, reload: 84 }, 0xa16207],
    ['g_lienthanh', 'Liên Thanh Thương', 1, 4, 14, { dmg: 13, pellets: 8, interval: 2000, mag: 12, reload: 130 }, 0x1f2937],
    ['g_voirung', 'Voi Rừng Thương', 2, 4, 20, { dmg: 22, pellets: 10, interval: 3000, mag: 10, reload: 130, pierce: 1, range: 26 }, 0x7c2d12],
    ['g_hoaphung', 'Hoả Phụng Thương', 3, 4, 26, { dmg: 20, pellets: 12, interval: 2200, mag: 12, reload: 120 }, 0xea580c, 0xfde047],
    ['g_balong', 'Bá Long Thần Thương', 3, 4, 34, { dmg: 28, pellets: 12, interval: 2400, mag: 14, reload: 120, pierce: 1 }, 0x166534, 0xfacc15],
  ]),
  ...guns('rifle', [
    ['g_ranlua', 'Súng Trường Rắn Lửa', 0, 3, 1, { dmg: 34, interval: 800 }, 0xdc2626, 0xf97316],
    ['g_dieuhau', 'Diều Hâu Thương', 0, 2, 3, { dmg: 46, interval: 1200, mag: 20, spread: 0.008, range: 90 }, 0x6d28d9],
    ['g_mangxa', 'Mãng Xà Thương', 1, 3, 6, {}, 0x15803d],
    ['g_baphat', 'Ba Phát Thương', 1, 3, 10, { dmg: 40, interval: 520, mag: 30, reload: 96 }, 0x047857],
    ['g_homang', 'Hổ Mang Thương', 1, 4, 14, { dmg: 42, interval: 600, mag: 32 }, 0x166534],
    ['g_thienthan', 'Thiên Thần Thương', 2, 4, 20, { dmg: 58, interval: 560, mag: 36, pierce: 2 }, 0xf8fafc, 0xfacc15],
    ['g_kylan', 'Kỳ Lân Thương', 3, 4, 26, { dmg: 64, interval: 500, mag: 36, pierce: 2 }, 0x0e7490, 0xfde68a],
    ['g_cuulong', 'Cửu Long Thần Thương', 3, 4, 34, { dmg: 76, interval: 480, mag: 40, pierce: 2 }, 0xb45309, 0xfef3c7],
  ]),
  ...guns('lmg', [
    ['g_thoren', 'Trung Liên Thợ Rèn', 0, 2, 2, { dmg: 30, interval: 480, mag: 60, reload: 170 }, 0x374151],
    ['g_thietnguu', 'Thiết Ngưu Liên', 0, 2, 4, { dmg: 28, interval: 520, mag: 60 }, 0x52525b],
    ['g_cuoixay', 'Cối Xay Liên', 1, 3, 6, { dmg: 22, interval: 320, mag: 120, reload: 210, pierce: 0, spread: 0.05 }, 0x991b1b],
    ['g_baolua', 'Bão Lửa Liên', 1, 3, 10, { dmg: 36, interval: 430, mag: 80, reload: 190 }, 0x7f1d1d],
    ['g_hacho', 'Hắc Hổ Liên', 2, 4, 16, { dmg: 38, interval: 380, mag: 90 }, 0x18181b, 0xf59e0b],
    ['g_loison', 'Lôi Sơn Liên', 2, 4, 22, { dmg: 44, interval: 400, mag: 100, reload: 200 }, 0x334155, 0x60a5fa],
    ['g_dialong', 'Địa Long Liên', 3, 4, 28, { dmg: 40, interval: 280, mag: 150, reload: 210, spread: 0.045 }, 0x713f12, 0xf97316],
    ['g_battu', 'Bất Tử Thần Liên', 3, 4, 35, { dmg: 52, interval: 340, mag: 120, pierce: 2 }, 0x0f172a, 0xa855f7],
  ]),
  ...guns('sniper', [
    ['g_natre', 'Ná Tre Tỉa', 0, 1, 1, { dmg: 120, interval: 4200, mag: 6, pierce: 2 }, 0x84cc16],
    ['g_chimung', 'Bắn Tỉa Chim Ưng', 0, 2, 2, {}, 0x5b21b6],
    ['g_daibang', 'Đại Bàng Tỉa', 1, 3, 8, { dmg: 215, interval: 4300, mag: 6, pierce: 4, range: 130 }, 0x312e81],
    ['g_datam', 'Dạ Tâm Tỉa', 1, 3, 12, { dmg: 180, interval: 3500, mag: 7 }, 0x1e293b, 0x22d3ee],
    ['g_bachcot', 'Bạch Cốt Tỉa', 2, 4, 18, { dmg: 280, interval: 4800, mag: 5, pierce: 5 }, 0xf5f5f4, 0x44403c],
    ['g_thansam', 'Thần Sấm Tỉa', 2, 4, 24, { dmg: 330, interval: 3900, mag: 8, pierce: 6, range: 140 }, 0xa78bfa],
    ['g_truyhon', 'Truy Hồn Tỉa', 3, 4, 30, { dmg: 300, interval: 3000, mag: 8, pierce: 5 }, 0x4c0519, 0xf43f5e],
    ['g_xanhat', 'Xạ Nhật Thần Cung', 3, 4, 36, { dmg: 420, interval: 3600, mag: 8, pierce: 8, range: 150 }, 0xfbbf24, 0xdc2626],
  ]),
  ...guns('launcher', [
    ['g_phaotep', 'Ống Phóng Pháo Tép', 0, 2, 2, { dmg: 30, interval: 3000, mag: 4, splashR: 1.9, splashDmg: 36 }, 0x65a30d],
    ['g_phaotre', 'Pháo Ống Tre', 0, 2, 4, { dmg: 38, interval: 2600, mag: 5 }, 0xa3e635],
    ['g_phaochuoi', 'Pháo Chuối Nổ', 1, 3, 6, { dmg: 50, mag: 6, splashR: 2.4, splashDmg: 56 }, 0xeab308],
    ['g_phaodua', 'Pháo Dừa Nổ', 1, 3, 12, { dmg: 62, interval: 2800, mag: 8, splashR: 2.8, splashDmg: 76 }, 0x854d0e],
    ['g_saurieng', 'Pháo Sầu Riêng', 2, 4, 18, { dmg: 80, interval: 2400, mag: 10, splashR: 3.3, splashDmg: 100 }, 0x4d7c0f],
    ['g_hoalong', 'Hoả Long Pháo', 2, 4, 24, { dmg: 90, interval: 2200, mag: 10, splashR: 3.5, splashDmg: 120 }, 0xc2410c, 0xfde047],
    ['g_thienloi', 'Thiên Lôi Pháo', 3, 4, 30, { dmg: 120, interval: 2600, mag: 8, splashR: 4, splashDmg: 150 }, 0x1d4ed8, 0xe0f2fe],
    ['g_hongmong', 'Hồng Mông Thần Pháo', 3, 4, 36, { dmg: 110, interval: 1900, mag: 12, splashR: 3.8, splashDmg: 140 }, 0x581c87, 0xf0abfc],
  ]),
];

/* ---- trang bị thường ---- */
type ES = [id: string, name: string, desc: string, minG: Grade, maxG: Grade, base: Stats2, lookKind: string, color: number, accent?: number, special?: boolean];
function gear(kind: ItemKind, pool: StatKey2[], list: ES[]): ItemDef2[] {
  return list.map(([id, name, desc, minGrade, maxGrade, base, k, color, accent, special]) => ({
    id, kind, name, desc, minGrade, maxGrade, base, affixPool: pool, look: { kind: k, color, accent }, ...(special ? { special } : {}),
  }));
}

const KNIVES = gear('knife', ['knifeDmg', 'speed', 'lifesteal', 'crit', 'dmg'], [
  ['k_gam', 'Dao Găm', 'Dao cơ bản.', 0, 1, { knifeDmg: 60 }, 'dagger', 0xd1d5db],
  ['k_ruadua', 'Rựa Phát Cây', 'Rựa của tiều phu, phát rừng mở lối.', 0, 2, { knifeDmg: 75 }, 'machete', 0x78716c, 0x451a03],
  ['k_matau', 'Mã Tấu', 'Chém rộng, đau.', 0, 2, { knifeDmg: 90 }, 'machete', 0x9ca3af, 0x7c2d12],
  ['k_tre', 'Kiếm Tre', 'Nhẹ, nhanh.', 1, 3, { knifeDmg: 80, speed: 0.02 }, 'bamboo', 0x84cc16],
  ['k_doanan', 'Đoản Kiếm Ẩn Thân', 'Đâm lén, hay trúng chỗ hiểm.', 1, 3, { knifeDmg: 85, crit: 0.02 }, 'dagger', 0x334155, 0x94a3b8],
  ['k_liemtrang', 'Liềm Trăng', 'Lưỡi cong như trăng khuyết.', 1, 3, { knifeDmg: 100 }, 'machete', 0xe2e8f0, 0x60a5fa],
  ['k_lua', 'Dao Lửa', 'Lưỡi rực đỏ.', 1, 3, { knifeDmg: 120 }, 'fire', 0xf97316, 0xfde047],
  ['k_uyenuong', 'Uyên Ương Song Đao', 'Một cặp đao, một âm một dương.', 2, 4, { knifeDmg: 130, speed: 0.02 }, 'machete', 0xfda4af, 0x1e3a8a],
  ['k_thanhlong', 'Thanh Long Đao', 'Đại đao chém rồng xanh.', 2, 4, { knifeDmg: 150 }, 'machete', 0x0f766e, 0xfacc15],
  ['k_huyetma', 'Huyết Ma Đao', 'Uống máu kẻ địch.', 3, 4, { knifeDmg: 170, lifesteal: 0.01 }, 'fire', 0x7f1d1d, 0xef4444],
  ['k_ythien', 'Ỷ Thiên Kiếm', 'Thần binh trấn giang hồ.', 3, 4, { knifeDmg: 220, crit: 0.03 }, 'bamboo', 0xe0f2fe, 0x0ea5e9],
  ['k_dolong', 'Đồ Long Đao', 'Hiệu lệnh thiên hạ, ai dám không theo.', 4, 4, { knifeDmg: 260, dmg: 0.04 }, 'machete', 0x1c1917, 0xf59e0b],
]);
const HELMETS = gear('helmet', ['hp', 'armor', 'headDmg', 'regen', 'crit'], [
  ['h_tre', 'Nón Lá', 'Nhẹ, mát, che nắng.', 0, 1, { hp: 10 }, 'nonla', 0xe8c872],
  ['h_khan', 'Khăn Rằn', 'Khăn quấn đầu của dân rừng.', 0, 2, { hp: 8, speed: 0.01 }, 'nonla', 0x166534, 0x111827],
  ['h_mutre', 'Mũ Tre Đan', 'Đan chặt, đỡ chuối bay.', 0, 2, { hp: 15, armor: 0.02 }, 'nonla', 0xa3b84a],
  ['h_sat', 'Mũ Sắt', 'Mũ lính cứng cáp.', 0, 2, { hp: 20, armor: 0.03 }, 'helmet', 0x5b6b3a],
  ['h_xathu', 'Mũ Thợ Săn', 'Tập trung vào điểm yếu.', 1, 3, { headDmg: 0.12 }, 'hunter', 0x4d5e2a],
  ['h_daubac', 'Đầu Đà Bạc', 'Vòng bạc của đầu đà khổ hạnh.', 1, 3, { hp: 22, regen: 0.5 }, 'helmet', 0xcbd5e1],
  ['h_ky', 'Mũ Kỵ Sĩ', 'Che kín đầu, khó gục.', 1, 3, { hp: 30, armor: 0.05 }, 'knight', 0x9ca3af, 0xdc2626],
  ['h_kimkhoi', 'Kim Khôi', 'Mũ trụ mạ vàng của tướng quân.', 2, 4, { hp: 40, armor: 0.06 }, 'knight', 0xeab308, 0x7f1d1d],
  ['h_phuonghoang', 'Phượng Hoàng Quan', 'Mão lông phượng, mắt sáng như sao.', 3, 4, { hp: 35, headDmg: 0.15 }, 'hunter', 0xf97316, 0xfde047],
  ['h_bachho', 'Bạch Hổ Khôi', 'Khôi đầu hổ trắng, trấn giữ phương Tây.', 3, 4, { hp: 50, armor: 0.07 }, 'knight', 0xf8fafc, 0x111827],
  ['h_chuoi', 'Mũ Chuối Vàng', 'Phần thưởng sự kiện Tuần Lễ Chuối Vàng.', 2, 3, { hp: 25, luck: 0.1 }, 'banana', 0xffd23f, undefined, true],
]);
const ARMORS = gear('armor', ['hp', 'armor', 'regen', 'lifesteal', 'speed'], [
  ['a_vai', 'Áo Vải Dày', 'Đỡ được chút ít.', 0, 1, { hp: 15 }, 'vest', 0x8b7355],
  ['a_lua', 'Áo Lụa Tơ Tằm', 'Mỏng nhẹ, chạy nhanh.', 0, 2, { hp: 12, speed: 0.01 }, 'vest', 0xfef3c7, 0xdc2626],
  ['a_da', 'Giáp Da', 'Nhẹ mà chắc.', 0, 2, { hp: 20, armor: 0.04 }, 'leather', 0x6b4423],
  ['a_long', 'Áo Lông Khỉ', 'Lột từ... thôi đừng hỏi.', 0, 2, { hp: 22, regen: 0.4 }, 'leather', 0x7c4a26],
  ['a_tre', 'Giáp Tre Đan', 'Giáp của dân làng, rất bền.', 1, 3, { hp: 25, armor: 0.06 }, 'bamboo', 0xa3b84a],
  ['a_xich', 'Giáp Xích', 'Vòng sắt móc vào nhau.', 1, 3, { hp: 30, armor: 0.06 }, 'plate', 0x71717a],
  ['a_thep', 'Giáp Thép', 'Nặng nhưng trâu.', 1, 3, { hp: 35, armor: 0.08 }, 'plate', 0x9ca3af],
  ['a_huyenvu', 'Huyền Vũ Giáp', 'Mai rùa thần phương Bắc.', 2, 4, { hp: 45, armor: 0.1 }, 'plate', 0x1e3a8a, 0x22c55e],
  ['a_kimtam', 'Kim Tằm Y', 'Tơ tằm vàng, đao kiếm khó xuyên.', 2, 4, { hp: 40, armor: 0.08, regen: 0.6 }, 'vest', 0xfacc15, 0xfef9c3],
  ['a_kimcang', 'Kim Cang Bảo Giáp', 'Bảo giáp nhà chùa, kim cang bất hoại.', 3, 4, { hp: 60, armor: 0.12 }, 'plate', 0xd97706, 0xfef3c7],
  ['a_thienlong', 'Thiên Long Chiến Giáp', 'Chiến giáp của Thiên Long Bang chủ.', 3, 4, { hp: 70, armor: 0.12, regen: 1 }, 'plate', 0x7f1d1d, 0xfacc15],
]);
const GLOVES = gear('gloves', ['reload', 'fireRate', 'crit', 'dmg', 'headDmg'], [
  ['gl_vai', 'Bao Tay Vải', 'Cầm súng đỡ trơn.', 0, 1, { reload: 0.03 }, 'glove', 0xd6d3d1],
  ['gl_da', 'Bao Tay Da', 'Bóp cò nhẹ hơn.', 0, 2, { fireRate: 0.02 }, 'glove', 0x78350f],
  ['gl_xathu', 'Găng Xạ Thủ', 'Ngón trỏ hở, ngắm chuẩn.', 0, 2, { crit: 0.02 }, 'glove', 0x3f6212],
  ['gl_thep', 'Găng Thép', 'Đấm cũng đau.', 0, 2, { dmg: 0.03 }, 'glove', 0x6b7280],
  ['gl_ong', 'Găng Ong Đốt', 'Ngón tay nhanh như cánh ong.', 1, 3, { fireRate: 0.035 }, 'glove', 0xfacc15, 0x111827],
  ['gl_nhanh', 'Găng Thoăn Thoắt', 'Thay băng đạn trong chớp mắt.', 1, 3, { reload: 0.05 }, 'glove', 0x0ea5e9],
  ['gl_hotrao', 'Hổ Trảo Thủ', 'Móng hổ sắc lẻm.', 2, 4, { dmg: 0.05, crit: 0.02 }, 'glove', 0xea580c, 0x111827],
  ['gl_mathu', 'Ma Thủ', 'Bàn tay ma, nhắm đâu trúng đó.', 2, 4, { headDmg: 0.1 }, 'glove', 0x312e81, 0xa855f7],
  ['gl_thanhxa', 'Thanh Xà Thủ', 'Uyển chuyển như rắn xanh.', 2, 4, { fireRate: 0.04, reload: 0.04 }, 'glove', 0x15803d],
  ['gl_kimlong', 'Kim Long Thủ', 'Găng rồng vàng của võ lâm minh chủ.', 3, 4, { dmg: 0.06, fireRate: 0.04 }, 'glove', 0xeab308, 0xb91c1c],
]);
const BOOTS = gear('boots', ['speed', 'regen', 'hp', 'pickup', 'armor'], [
  ['b_rom', 'Dép Rơm', 'Chạy nhẹ như không.', 0, 1, { speed: 0.02 }, 'boot', 0xe8c872],
  ['b_vai', 'Giày Vải', 'Êm chân.', 0, 2, { speed: 0.015, hp: 8 }, 'boot', 0x57534e],
  ['b_da', 'Ủng Da', 'Không sợ gai.', 0, 2, { speed: 0.015, armor: 0.02 }, 'boot', 0x78350f],
  ['b_cogai', 'Giày Cỏ Gai', 'Đắp thảo dược, đi tới đâu lành tới đó.', 0, 2, { regen: 0.4 }, 'boot', 0x4d7c0f],
  ['b_langdu', 'Hài Lãng Du', 'Hài của khách giang hồ.', 1, 3, { speed: 0.03 }, 'boot', 0x0369a1],
  ['b_thietngoa', 'Thiết Ngoa', 'Giày sắt, đứng vững như núi.', 1, 3, { armor: 0.04, hp: 20 }, 'boot', 0x52525b],
  ['b_phonghanh', 'Phong Hành Hài', 'Gió nâng gót, nhặt đồ từ xa.', 1, 3, { speed: 0.035, pickup: 0.2 }, 'boot', 0x67e8f9],
  ['b_thaothuong', 'Thảo Thượng Phi', 'Bay trên ngọn cỏ.', 2, 4, { speed: 0.04 }, 'boot', 0x22c55e, 0xf0fdf4],
  ['b_vanvu', 'Vân Vũ Hài', 'Bước đi như mây, hồi sức như mưa.', 2, 4, { speed: 0.04, regen: 0.6 }, 'boot', 0xe0e7ff, 0x6366f1],
  ['b_thanhanh', 'Thần Hành Hài', 'Một ngày ngàn dặm.', 3, 4, { speed: 0.05 }, 'boot', 0xf59e0b, 0x7c2d12],
]);
const BELTS = gear('belt', ['hp', 'mag', 'regen', 'armor'], [
  ['bt_day', 'Dây Thừng', 'Buộc quần cho chắc.', 0, 1, { hp: 10 }, 'belt', 0xa8a29e],
  ['bt_da', 'Thắt Lưng Da', 'Có chỗ giắt đạn.', 0, 2, { hp: 15, mag: 0.04 }, 'belt', 0x78350f],
  ['bt_dan', 'Đai Đạn', 'Thêm vài viên mỗi băng.', 0, 2, { mag: 0.08 }, 'belt', 0x854d0e, 0xfacc15],
  ['bt_tre', 'Đai Tre', 'Đai tre đan, mát lưng.', 0, 2, { hp: 12, regen: 0.3 }, 'belt', 0xa3b84a],
  ['bt_linh', 'Đai Lính', 'Đai tiêu chuẩn của quan binh.', 1, 3, { hp: 20, armor: 0.02 }, 'belt', 0x3f6212],
  ['bt_ngoc', 'Ngọc Đái', 'Đai khảm ngọc bích.', 1, 3, { hp: 25, regen: 0.5 }, 'belt', 0x059669, 0xd1fae5],
  ['bt_hobi', 'Hổ Bì Đái', 'Da hổ, khí thế ngút trời.', 2, 4, { hp: 35 }, 'belt', 0xea580c, 0x111827],
  ['bt_bangkep', 'Đai Băng Đạn Kép', 'Hai hàng đạn quanh hông.', 2, 4, { mag: 0.15 }, 'belt', 0x44403c, 0xfbbf24],
  ['bt_kimlu', 'Kim Lũ Đái', 'Đai chỉ vàng của vương hầu.', 3, 4, { hp: 40, mag: 0.08 }, 'belt', 0xeab308],
  ['bt_thienton', 'Thiên Tôn Đái', 'Đai của bậc tôn giả.', 3, 4, { hp: 50, regen: 1 }, 'belt', 0xf8fafc, 0xf59e0b],
]);
const AMULETS = gear('amulet', ['cdr', 'skillDmg', 'hp', 'luck'], [
  ['am_go', 'Bùa Gỗ Đào', 'Gỗ đào trừ tà.', 0, 1, { cdr: 0.02 }, 'amulet', 0xb45309],
  ['am_nanh', 'Dây Nanh Thú', 'Nanh thú rừng xâu chuỗi.', 0, 2, { skillDmg: 0.04 }, 'amulet', 0xf5f5f4],
  ['am_dong', 'Hộ Phù Đồng', 'Phù đồng khắc chữ Bình An.', 0, 2, { hp: 12 }, 'amulet', 0xb87333],
  ['am_ngoc', 'Ngọc Bội', 'Ngọc bội đeo hông.', 1, 3, { cdr: 0.03, hp: 8 }, 'amulet', 0x34d399],
  ['am_tram', 'Trầm Hương Bội', 'Thơm ngát, tĩnh tâm.', 1, 3, { skillDmg: 0.05, cdr: 0.02 }, 'amulet', 0x78350f, 0xfde68a],
  ['am_huyet', 'Huyết Ngọc', 'Ngọc đỏ như máu.', 1, 3, { hp: 25 }, 'amulet', 0xdc2626],
  ['am_batquai', 'Bát Quái Phù', 'Âm dương xoay chuyển, chiêu thức liên hồi.', 2, 4, { cdr: 0.05 }, 'amulet', 0x111827, 0xf8fafc],
  ['am_longchau', 'Long Châu', 'Ngọc rồng, nội lực dồi dào.', 2, 4, { skillDmg: 0.1 }, 'amulet', 0x0ea5e9, 0xfacc15],
  ['am_thienco', 'Thiên Cơ Phù', 'Thấu thiên cơ, chiêu nào cũng mạnh.', 3, 4, { cdr: 0.06, skillDmg: 0.06 }, 'amulet', 0x7c3aed, 0xfde047],
  ['am_phuonghuyet', 'Phượng Huyết Châu', 'Máu phượng hoàng tái sinh.', 3, 4, { hp: 40, cdr: 0.05 }, 'amulet', 0xf97316, 0xfef3c7],
]);
const RINGS = gear('ring', ['crit', 'critDmg', 'lifesteal', 'luck', 'dmg', 'headDmg'], [
  ['r_dong', 'Nhẫn Đồng', 'Nhẫn đồng đơn sơ.', 0, 1, { crit: 0.015 }, 'ring', 0xb87333],
  ['r_bac', 'Nhẫn Bạc', 'Sáng loáng.', 0, 2, { critDmg: 0.08 }, 'ring', 0xd1d5db],
  ['r_tram', 'Nhẫn Gỗ Trầm', 'Mang lại may mắn.', 0, 2, { luck: 0.03 }, 'ring', 0x78350f],
  ['r_xuong', 'Nhẫn Xương Khỉ', 'Ghê ghê.', 0, 2, { lifesteal: 0.006 }, 'ring', 0xf5f5f4],
  ['r_bich', 'Nhẫn Ngọc Bích', 'Ngọc bích xanh mát.', 1, 3, { dmg: 0.03 }, 'ring', 0x10b981],
  ['r_matmeo', 'Nhẫn Mắt Mèo', 'Nhìn rõ điểm yếu.', 1, 3, { headDmg: 0.06, crit: 0.01 }, 'ring', 0xfacc15, 0x111827],
  ['r_huyet', 'Huyết Giới', 'Nhẫn uống máu.', 1, 3, { lifesteal: 0.012 }, 'ring', 0x991b1b],
  ['r_kim', 'Kim Giới', 'Nhẫn vàng ròng.', 2, 4, { crit: 0.03, critDmg: 0.1 }, 'ring', 0xeab308],
  ['r_phongthan', 'Phong Thần Giới', 'Thần gió ban phúc.', 2, 4, { luck: 0.08 }, 'ring', 0x67e8f9],
  ['r_thienma', 'Thiên Ma Giới', 'Ma công cái thế.', 3, 4, { dmg: 0.06, lifesteal: 0.012 }, 'ring', 0x4c0519, 0xa855f7],
  ['r_cuuu', 'Cửu U Giới', 'Từ chín tầng địa ngục.', 3, 4, { crit: 0.04, critDmg: 0.2 }, 'ring', 0x0f172a, 0x22d3ee],
]);
const SKINS = gear('skin', ['luck', 'pickup'], [
  ['s_rung', 'Rằn Ri Rừng', 'Màu lá rừng.', 0, 1, {}, 'skin', 0x4d7c0f, 0x365314],
  ['s_hoangtho', 'Hoàng Thổ', 'Màu đất phù sa.', 0, 1, {}, 'skin', 0xa16207, 0x713f12],
  ['s_hong', 'Kẹo Hồng', 'Dễ thương hết nấc.', 0, 2, {}, 'skin', 0xf472b6, 0xfdf2f8],
  ['s_truclam', 'Trúc Lâm', 'Áo xanh của môn phái Trúc Lâm.', 0, 2, {}, 'skin', 0x65a30d, 0xecfccb],
  ['s_lamhai', 'Lam Hải', 'Xanh như biển cả.', 1, 2, {}, 'skin', 0x0369a1, 0xbae6fd],
  ['s_tuyetson', 'Tuyết Sơn', 'Trắng như tuyết đỉnh non.', 1, 3, {}, 'skin', 0xf1f5f9, 0x94a3b8],
  ['s_hoadiem', 'Hoả Diệm', 'Đỏ rực như lửa.', 1, 3, {}, 'skin', 0xdc2626, 0xfbbf24],
  ['s_dem', 'Bóng Đêm', 'Đen tuyền bí ẩn.', 1, 3, {}, 'skin', 0x1f2937, 0x8b5cf6],
  ['s_tuvan', 'Tử Vân', 'Mây tím huyền ảo.', 2, 3, {}, 'skin', 0x7e22ce, 0xf5d0fe],
  ['s_bichngoc', 'Bích Ngọc', 'Lấp lánh ngọc xanh.', 2, 4, {}, 'skin', 0x059669, 0xa7f3d0],
  ['s_huyety', 'Huyết Y', 'Áo nhuộm máu chiến trường.', 2, 4, {}, 'skin', 0x7f1d1d, 0x111827],
  ['s_vang', 'Hoàng Kim', 'Lấp lánh vàng ròng.', 2, 4, {}, 'skin', 0xeab308, 0xfef9c3],
  ['s_thienlong', 'Thiên Long Bào', 'Long bào thêu chín con rồng.', 3, 4, {}, 'skin', 0xfacc15, 0xb91c1c],
  ['s_chuoi', 'Áo Chuối', 'Sự kiện Chuối Vàng.', 1, 3, {}, 'skin', 0xfde047, 0x65a30d, true],
]);

type CS = [id: string, name: string, desc: string, grade: Grade, effect: ConsumableEffect, stack: number, value: number, icon: string];
const CONSUMABLES: ItemDef2[] = ([
  ['q_bangac', 'Băng Gạc', 'Hồi 25 máu.', 0, { kind: 'heal', amount: 25 }, 10, 4, '🩹'],
  ['q_maunho', 'Bình Máu Nhỏ', 'Hồi 50 máu.', 0, { kind: 'heal', amount: 50 }, 10, 8, '🧪'],
  ['q_maulon', 'Bình Máu Lớn', 'Hồi 120 máu.', 1, { kind: 'heal', amount: 120 }, 5, 25, '🍶'],
  ['q_kimsang', 'Kim Sang Dược', 'Thần dược giang hồ: hồi 250 máu.', 2, { kind: 'heal', amount: 250 }, 5, 70, '💊'],
  ['q_khientam', 'Khiên Tạm', 'Khiên chắn 60 sát thương trong 8 giây.', 1, { kind: 'shield', amount: 60, secs: 8 }, 5, 20, '🛡️'],
  ['q_kimcangphu', 'Kim Cang Phù', 'Khiên chắn 160 sát thương trong 12 giây.', 2, { kind: 'shield', amount: 160, secs: 12 }, 5, 60, '📜'],
  ['q_tochanh', 'Thuốc Tốc Hành', 'Chạy nhanh hơn 30% trong 8 giây.', 1, { kind: 'speed', mul: 1.3, secs: 8 }, 5, 18, '🏃'],
  ['q_thanhanhphu', 'Thần Hành Phù', 'Chạy nhanh hơn 50% trong 6 giây.', 2, { kind: 'speed', mul: 1.5, secs: 6 }, 5, 45, '🌀'],
  ['q_luudan', 'Lựu Đạn Tre', 'Ném nổ 160 sát thương trong 4m.', 0, { kind: 'grenade', dmg: 160, radius: 4 }, 10, 10, '💣'],
  ['q_hoaloi', 'Hoả Lôi', 'Ném nổ 320 sát thương trong 5m.', 2, { kind: 'grenade', dmg: 320, radius: 5 }, 5, 50, '🧨'],
  ['q_hoisinh', 'Bình Hồi Sinh', 'Tự đứng dậy khi gục (tự dùng).', 3, { kind: 'revive' }, 3, 150, '✨'],
] as CS[]).map(([id, name, desc, g, consumable, stack, value, icon]) => ({
  id, kind: 'consumable' as const, name, desc, icon, minGrade: g, maxGrade: g, base: {}, affixPool: [], look: { kind: 'consumable', color: 0xef4444 }, consumable, stack, value,
}));

type MS = [id: string, name: string, desc: string, grade: Grade, stack: number, value: number, icon: string, currency?: ItemDef2['currency']];
const MATERIALS: ItemDef2[] = ([
  ['m_da', 'Đá Cường Hoá', 'Dùng để cường hoá trang bị.', 0, 99, 15, '🪨'],
  ['m_longkhi', 'Lông Khỉ Vàng', 'Thương nhân mua làm chổi lông gà.', 0, 99, 6, '🪶'],
  ['m_nanhkhi', 'Nanh Khỉ Đột', 'Nanh to bằng ngón tay cái.', 1, 99, 25, '🦷'],
  ['m_ngocrung', 'Ngọc Rừng', 'Viên ngọc xanh tìm thấy trong bụng khỉ.', 2, 99, 80, '💚'],
  ['m_huyentinh', 'Huyền Tinh', 'Tinh thể hiếm, giá trên trời.', 3, 99, 240, '🔮'],
  ['c_vang', 'Túi Vàng', 'Mang về được thì thành vàng.', 0, 99999, 1, '💰', 'gold'],
  ['c_manh', 'Mảnh Nhân Vật', 'Mang về được thì cộng vào mảnh nhân vật.', 1, 999, 0, '🧩', 'shards'],
  ['c_sach', 'Sách Kỹ Năng', 'Mang về được thì cộng vào sách kỹ năng.', 2, 999, 0, '📘', 'books'],
] as MS[]).map(([id, name, desc, g, stack, value, icon, currency]) => ({
  id, kind: 'material' as const, name, desc, icon, minGrade: g, maxGrade: g, base: {}, affixPool: [], look: { kind: 'material', color: 0x94a3b8 }, stack, value, ...(currency ? { currency } : {}),
}));

export const ITEMS: ItemDef2[] = [...GUNS, ...KNIVES, ...HELMETS, ...ARMORS, ...GLOVES, ...BOOTS, ...BELTS, ...AMULETS, ...RINGS, ...SKINS, ...CONSUMABLES, ...MATERIALS];
for (const d of ITEMS) d.icon ??= KIND_ICON[d.kind];
export const ITEM_BY_ID: Record<string, ItemDef2> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
/** dao mặc định khi chưa mặc dao */
export const BASE_KNIFE_DMG = 45;

/** cấp nhân vật cần để mặc món def ở phẩm g */
export function itemLevelReq(def: ItemDef2 | undefined, g: Grade): number {
  if (!def || def.kind === 'consumable' || def.kind === 'material') return 1;
  return Math.max(def.levelReq ?? 1, GRADES[g]?.levelReq ?? 1);
}
/** phẩm nằm trong khoảng cho phép của món */
export const fitGrade = (def: ItemDef2, g: number): Grade => Math.min(def.maxGrade, Math.max(def.minGrade, clampGrade(g))) as Grade;

/* ======================= MÓN ĐỒ SỞ HỮU ======================= */
export interface ItemInst {
  uid: number;
  itemId: string;
  grade: Grade;
  level: number;
  /** dòng phụ đã tung (giá trị cố định) */
  affixes: Stats2;
  /** số lượng (đồ không chồng = 1) */
  count: number;
  /** đang mặc ở ô nào (null = trong túi/kho) */
  slot: EquipSlot | null;
  /** true = trong kho (rương nhà), false = trong túi đồ */
  stash: boolean;
}
export const BAG_CAP = 60;
export const STASH_CAP = 200;
export const ITEM_MAX_LEVEL = 10;
/** chi phí vàng để cường hoá từ level → level+1 */
export function upgradeCost(grade: Grade, level: number) {
  return Math.round(60 * (1 + grade * 0.8) * Math.pow(1.45, level - 1));
}
/** số Đá Cường Hoá (m_da) cần để cường hoá từ level → level+1 */
export const upgradeStones = (level: number) => Math.max(1, Math.ceil(level / 2));
export const UPGRADE_STONE = 'm_da';
/** vàng nhận khi bán cho thương nhân */
export function sellPrice(it: Pick<ItemInst, 'itemId' | 'grade' | 'level' | 'count'>): number {
  const def = ITEM_BY_ID[it.itemId];
  if (!def) return 0;
  const n = Math.max(1, it.count | 0);
  if (def.value !== undefined) return def.value * n;
  const kindMul = def.kind === 'gun' ? 1.5 : def.kind === 'skin' ? 0.6 : 1;
  return Math.round((GRADES[it.grade]?.sellPrice ?? 10) * kindMul * (1 + (Math.max(1, it.level) - 1) * 0.4)) * n;
}
/** @deprecated v1 — dùng sellPrice */
export const salvageValue = sellPrice;

/** chỉ số (không phải súng) của món ở phẩm + cấp hiện tại: gốc × statMul × (1+8%/cấp) + dòng phụ × (1+5%/cấp) */
export function itemStats(it: Pick<ItemInst, 'itemId' | 'grade' | 'level' | 'affixes'>): Stats2 {
  const def = ITEM_BY_ID[it.itemId];
  const out: Stats2 = {};
  if (!def) return out;
  const lv = Math.max(1, it.level);
  const k = (GRADES[it.grade]?.statMul ?? 1) * (1 + 0.08 * (lv - 1));
  for (const [s, v] of Object.entries(def.base) as [StatKey2, number][]) out[s] = v * k;
  for (const [s, v] of Object.entries(it.affixes ?? {}) as [StatKey2, number][]) {
    if (!(s in STAT2_INFO) || typeof v !== 'number') continue;
    out[s] = (out[s] ?? 0) + (s === 'pierce' ? v : v * (1 + 0.05 * (lv - 1)));
  }
  return out;
}

/** giá trị một dòng phụ ngẫu nhiên (rng ∈ [0,1)) */
export function rollAffix(stat: StatKey2, grade: Grade, rng: () => number) {
  if (stat === 'pierce') return 1;
  const v = AFFIX_BASE[stat] * (0.6 + rng() * 0.8) * (1 + grade * 0.3);
  return STAT2_INFO[stat].pct ? Math.round(v * 1000) / 1000 : Math.round(v * 10) / 10;
}
export function rollAffixes(def: ItemDef2, grade: Grade, rng: () => number): Stats2 {
  const out: Stats2 = {};
  const pool = [...def.affixPool];
  for (let n = 0; n < (GRADES[grade]?.affixCount ?? 0) && pool.length; n++) {
    const k = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    out[k] = (out[k] ?? 0) + rollAffix(k, grade, rng);
  }
  return out;
}
/** @deprecated v1 — dùng rollAffixes */
export const rollSubs = rollAffixes;

/* ======================= SÚNG TỪ MÓN ĐỒ ======================= */
const cap = (k: StatKey2, v: number) => Math.min(STAT2_INFO[k].cap, Math.max(0, v || 0));
/**
 * WeaponDef thật của một khẩu súng (null → súng bậc 0 của nhân vật). Nướng sẵn: phẩm (gunMul), cấp (+4%/cấp),
 * dòng phụ của chính khẩu (dmg, fireRate, reload, mag, pierce) + `extra` (fireRate/reload/mag/pierce từ đồ khác).
 * Chí mạng / bắn đầu / hút máu KHÔNG nằm ở đây (server tính, xem Loadout2.stats). Hệ số nạp đạn của nhân vật
 * (CLASSES[cls].reloadMul) vẫn do gameplay áp như cũ.
 */
export function weaponFromItem(it: ItemInst | null, cls: number, extra: Stats2 = {}): WeaponDef {
  const def = it ? ITEM_BY_ID[it.itemId] : undefined;
  const a: Stats2 = it?.affixes ?? {};
  const fr = cap('fireRate', (a.fireRate ?? 0) + (extra.fireRate ?? 0));
  const rl = cap('reload', (a.reload ?? 0) + (extra.reload ?? 0));
  const mg = cap('mag', (a.mag ?? 0) + (extra.mag ?? 0));
  const pc = Math.round(cap('pierce', (a.pierce ?? 0) + (extra.pierce ?? 0)));
  if (!def?.gun || !it) {
    const w = weaponOf(cls, 0);
    if (!fr && !rl && !mg && !pc) return w;
    return { ...w, interval: Math.round(w.interval / (1 + fr)), reload: Math.max(1, Math.round(w.reload * (1 - rl))), mag: Math.max(1, Math.round(w.mag * (1 + mg))), pierce: w.pierce + pc };
  }
  const g = fitGrade(def, it.grade);
  const f = FAM[def.gun.family];
  const b = { ...f, ...def.gun.base };
  const lv = 1 + 0.04 * (Math.max(1, Math.min(ITEM_MAX_LEVEL, it.level)) - 1);
  const dm = GRADES[g].gunMul * lv * (1 + cap('dmg', a.dmg ?? 0));
  return {
    name: def.name,
    short: f.short,
    model: def.gun.family,
    dmg: Math.round(b.dmg * dm),
    pellets: b.pellets,
    interval: Math.max(60, Math.round(b.interval / (1 + fr))),
    mag: Math.max(1, Math.round(b.mag * (1 + mg + 0.05 * g))),
    reload: Math.max(1, Math.round(b.reload * (1 - rl))),
    spread: b.spread,
    range: b.range,
    pierce: b.pierce + pc,
    falloff: b.falloff,
    splashR: b.splashR,
    splashDmg: Math.round(b.splashDmg * dm),
    kick: b.kick,
    cost: 0,
    color: def.look.color,
    sound: b.sound,
  };
}

/* ======================= NHÂN VẬT ======================= */
/** chỉ số CLASSES; mở khoá */
export type UnlockRule = { kind: 'default' } | { kind: 'level'; level: number } | { kind: 'stage'; stage: string } | { kind: 'shards'; shards: number } | { kind: 'event' };
export const CHAR_UNLOCK: UnlockRule[] = [
  { kind: 'default' }, // 0 chiến binh
  { kind: 'default' }, // 1 y sĩ
  { kind: 'default' }, // 2 kỹ sư
  { kind: 'level', level: 5 }, // 3 đấu sĩ
  { kind: 'stage', stage: '1-10' }, // 4 xạ thủ
  { kind: 'shards', shards: 30 }, // 5 pháo thủ
  { kind: 'level', level: 15 }, // 6 cao bồi (hoặc tặng từ sự kiện)
];
export function unlockText(r: UnlockRule) {
  switch (r.kind) {
    case 'default': return 'Có sẵn';
    case 'level': return `Đạt cấp ${r.level}`;
    case 'stage': return `Qua ải ${r.stage}`;
    case 'shards': return `Ghép ${r.shards} mảnh nhân vật`;
    case 'event': return 'Phần thưởng sự kiện';
  }
}

/* ======================= KỸ NĂNG ======================= */
export type SkillKey = 'g' | 'x' | 'q';
export const SKILL_MAX = 5;
/** chi phí nâng kỹ năng lên cấp `to` (2..5) */
export function skillCost(to: number) {
  return { gold: [0, 0, 300, 700, 1500, 3000][to] ?? 9999, books: [0, 0, 1, 2, 3, 5][to] ?? 99 };
}
/** hệ số sức mạnh kỹ năng theo cấp (sát thương / thời gian) */
export const skillPower = (lv: number) => 1 + 0.1 * (Math.max(1, lv) - 1);
/** hệ số giá xu + hồi chiêu theo cấp */
export const skillCostMul = (lv: number) => 1 - 0.05 * (Math.max(1, lv) - 1);

/* ======================= CẤP NGƯỜI CHƠI ======================= */
export const LEVEL_MAX = 50;
/** XP cần để lên từ level → level+1 */
export const xpToNext = (level: number) => Math.round(100 * Math.pow(level, 1.35));
export function addXp(level: number, xp: number, gain: number) {
  let lv = level;
  let x = xp + gain;
  let ups = 0;
  while (lv < LEVEL_MAX && x >= xpToNext(lv)) {
    x -= xpToNext(lv);
    lv++;
    ups++;
  }
  if (lv >= LEVEL_MAX) x = 0;
  return { level: lv, xp: x, ups };
}
/** vàng thưởng khi lên cấp */
export const levelUpGold = (newLevel: number) => 100 + newLevel * 20;

/* ======================= ẢI ======================= */
export type Modifier = 'night' | 'fast' | 'pistolOnly' | 'noShop' | 'bossRush' | 'explosiveOnly' | 'tough';
export const MODIFIER_INFO: Record<Modifier, { name: string; icon: string; desc: string }> = {
  night: { name: 'Đêm tối', icon: '🌙', desc: 'Tầm nhìn hẹp.' },
  fast: { name: 'Khỉ nhanh', icon: '💨', desc: 'Khỉ chạy nhanh hơn 25%.' },
  pistolOnly: { name: 'Chỉ súng lục', icon: '🔫', desc: 'Không nâng được súng.' },
  noShop: { name: 'Không cửa hàng', icon: '🚫', desc: 'Không mua nâng cấp giữa đợt.' },
  bossRush: { name: 'Boss liên tục', icon: '👑', desc: 'Boss xuất hiện mỗi 2 đợt.' },
  explosiveOnly: { name: 'Khỉ bom', icon: '💣', desc: 'Toàn khỉ nổ.' },
  tough: { name: 'Khỉ trâu', icon: '🛡️', desc: 'Khỉ nhiều máu hơn 40%.' },
};

/** trọng số phẩm [Trắng, Xanh, Tím, Vàng, Cam] */
export type GradeWeights = [number, number, number, number, number];
export interface DropRoll {
  /** loại đồ có thể rớt (rỗng = mọi loại trang bị, không gồm tiêu hao/nguyên liệu) */
  kinds: ItemKind[];
  /** xác suất rớt (0..1) trước khi cộng may mắn */
  chance: number;
  weights: GradeWeights;
}
/** rương ải (thưởng khi thắng) */
export interface DropTable {
  gold: [number, number];
  xp: number;
  rolls: DropRoll[];
  /** mảnh nhân vật (0 = không) */
  shards?: [number, number];
  /** xác suất rớt 1 sách kỹ năng */
  book?: number;
  /** Đá Cường Hoá [min,max] */
  stones?: [number, number];
}
/** món trong phần thưởng (chưa có uid). subs thiếu → store tự tung dòng phụ */
export interface RewardItem {
  itemId: string;
  grade: Grade;
  subs?: Stats2;
  count?: number;
}
export interface Reward {
  gold?: number;
  xp?: number;
  shards?: number;
  books?: number;
  items?: RewardItem[];
  /** mở khoá nhân vật (chỉ số CLASSES) */
  unlockChar?: number;
}

export interface StageDef {
  id: string;
  chapter: number;
  name: string;
  map: 'rung' | 'lang' | 'mo';
  /** số đợt phải vượt */
  waves: number;
  /** bắt đầu từ đợt mấy (độ khó gốc) */
  startWave: number;
  /** hệ số độ khó cộng thêm (máu/sát thương khỉ) — cũng đẩy phẩm đồ rơi */
  diff: number;
  mods: Modifier[];
  /** sao 2: còn ≥ X% máu đội; sao 3: không ai gục và xong trong T giây */
  star3Secs: number;
  /** rương ải */
  drops: DropTable;
  /** thưởng lần đầu qua */
  first: Reward;
  /** ải sự kiện: không nằm trong chuỗi chương */
  event?: boolean;
}

const CH = [
  { n: 1, map: 'rung' as const, name: 'Đền Rừng' },
  { n: 2, map: 'lang' as const, name: 'Làng Ven Sông' },
  { n: 3, map: 'mo' as const, name: 'Mỏ Đá' },
];
const MOD_PLAN: Modifier[][] = [[], [], ['fast'], [], ['night'], ['tough'], [], ['pistolOnly'], ['fast', 'tough'], ['bossRush']];
const NAMES = [
  ['Cổng Đền', 'Lối Rêu', 'Bậc Thang Đá', 'Sân Tượng', 'Đêm Đom Đóm', 'Tường Đổ', 'Hồ Sen', 'Đường Hẹp', 'Rừng Gào Thét', 'Vua Khỉ Đột'],
  ['Bến Đò', 'Chợ Phiên', 'Cầu Tre', 'Ruộng Lúa', 'Đêm Hội Đèn', 'Nhà Sàn', 'Bãi Thuyền', 'Đình Làng', 'Lũ Tràn', 'Thuyền Trưởng Khỉ'],
  ['Cửa Mỏ', 'Đường Ray', 'Giàn Gỗ', 'Hẻm Đá', 'Hầm Tối', 'Lò Luyện', 'Vách Đá', 'Kho Thuốc Nổ', 'Sập Hầm', 'Chúa Mỏ'],
];
const BOSS_FIRST = ['h_ky', 'a_tre', 'k_lua'];

function chapterStages(): StageDef[] {
  const out: StageDef[] = [];
  for (const c of CH) {
    for (let i = 1; i <= 10; i++) {
      const g = (c.n - 1) * 10 + i; // 1..30 độ khó tổng
      const boss = i === 10;
      out.push({
        id: `${c.n}-${i}`,
        chapter: c.n,
        name: NAMES[c.n - 1][i - 1],
        map: c.map,
        waves: Math.min(15, 4 + Math.ceil(g / 3)),
        startWave: 1 + Math.floor((g - 1) / 2),
        diff: 1 + (g - 1) * 0.06,
        mods: MOD_PLAN[i - 1],
        star3Secs: 90 + (4 + Math.ceil(g / 3)) * 55,
        drops: {
          gold: [40 + g * 12, 70 + g * 18],
          xp: 60 + g * 25,
          rolls: [
            { kinds: [], chance: 0.6, weights: [70 - g, 25 + g * 0.6, 4 + g * 0.35, 0.6 + g * 0.12, g * 0.03] },
            { kinds: [], chance: boss ? 0.95 : 0.18, weights: boss ? [10, 40, 32, 14 + g * 0.2, 2 + g * 0.1] : [55, 32, 10, 2.5, 0.5] },
          ],
          shards: c.n >= 2 ? [1, boss ? 6 : 2] : undefined,
          book: boss ? 0.8 : 0.08,
          stones: [1, 2 + Math.floor(g / 6) + (boss ? 3 : 0)],
        },
        first: boss
          ? { gold: 300 + g * 20, books: 1, items: [{ itemId: BOSS_FIRST[c.n - 1], grade: 2 }] }
          : { gold: 80 + g * 10 },
      });
    }
  }
  return out;
}

export const STAGES: StageDef[] = chapterStages();
/** ải của sự kiện (sự kiện trỏ tới bằng id) */
export const EVENT_STAGES: StageDef[] = [
  {
    id: 'ev-vuonchuoi', chapter: 0, name: 'Vườn Chuối', map: 'lang', waves: 5, startWave: 1, diff: 0.9, mods: [], star3Secs: 420, event: true,
    drops: { gold: [80, 140], xp: 120, rolls: [{ kinds: ['skin', 'helmet'], chance: 0.6, weights: [45, 35, 15, 4, 1] }], book: 0.2, stones: [1, 3] },
    first: { gold: 500, books: 1 },
  },
];
export const STAGE_BY_ID: Record<string, StageDef> = Object.fromEntries([...STAGES, ...EVENT_STAGES].map((s) => [s.id, s]));

/** ải kế tiếp trong chương (null nếu hết) */
export function nextStage(id: string): string | null {
  const i = STAGES.findIndex((s) => s.id === id);
  return i >= 0 && i + 1 < STAGES.length ? STAGES[i + 1].id : null;
}
/** ải có mở với người đã qua `cleared` không (ải đầu luôn mở) */
export function stageUnlocked(id: string, cleared: ReadonlySet<string>) {
  const s = STAGE_BY_ID[id];
  if (!s) return false;
  if (s.event) return true;
  const i = STAGES.findIndex((x) => x.id === id);
  return i === 0 || cleared.has(STAGES[i - 1].id);
}

/* ======================= RỚT ĐỒ ======================= */
function pickWeighted(w: readonly number[], rng: () => number) {
  const tot = w.reduce((a, b) => a + Math.max(0, b), 0);
  let r = rng() * tot;
  for (let i = 0; i < w.length; i++) {
    r -= Math.max(0, w[i]);
    if (r < 0) return i;
  }
  return w.length - 1;
}
const EQUIP_KINDS: ItemKind[] = ['gun', 'knife', 'helmet', 'armor', 'gloves', 'boots', 'belt', 'amulet', 'ring', 'skin'];
/** pool đồ thường (không special) theo loại */
const POOL_BY_KIND: Record<ItemKind, ItemDef2[]> = Object.fromEntries(
  (Object.keys(KIND_ICON) as ItemKind[]).map((k) => [k, ITEMS.filter((d) => d.kind === k && !d.special)]),
) as Record<ItemKind, ItemDef2[]>;
/** trọng số loại khi rớt trang bị (súng nhiều nhất, trang phục ít) */
const KIND_WEIGHT: Partial<Record<ItemKind, number>> = { gun: 5, knife: 2, helmet: 2, armor: 2, gloves: 2, boots: 2, belt: 2, amulet: 1.5, ring: 2, skin: 1 };
const luckOf = (luck: number) => Math.min(STAT2_INFO.luck.cap, Math.max(0, luck || 0));

/** tung một món trang bị phẩm theo trọng số w (đã đẩy may mắn) trong các loại `kinds` (rỗng = mọi trang bị) */
function rollGear(kinds: ItemKind[], w: readonly number[], rng: () => number): LootDrop | null {
  const ks = (kinds.length ? kinds : EQUIP_KINDS).filter((k) => POOL_BY_KIND[k]?.length);
  if (!ks.length) return null;
  const kind = ks[pickWeighted(ks.map((k) => KIND_WEIGHT[k] ?? 1), rng)];
  const want = pickWeighted(w, rng) as Grade;
  // ưu tiên món có phẩm đúng; không có thì lấy bất kỳ rồi kẹp phẩm
  const pool = POOL_BY_KIND[kind].filter((d) => d.minGrade <= want && want <= d.maxGrade);
  const src = pool.length ? pool : POOL_BY_KIND[kind];
  const def = src[Math.floor(rng() * src.length)];
  const grade = fitGrade(def, want);
  return { itemId: def.id, grade, subs: rollAffixes(def, grade, rng) };
}
const pushLuck = (w: readonly number[], L: number, extra = 0) => w.map((x, i) => x * (1 + (L * 1.5 + extra) * i));

/** tung rương ải cho một người. luck = chỉ số may mắn. Trả về phần thưởng (đồ chưa có uid). */
export function rollDrops(t: DropTable, luck: number, stars: number, rng: () => number): Reward & { items: (RewardItem & { subs: Stats2 })[] } {
  const L = luckOf(luck);
  const starMul = 0.7 + stars * 0.15; // 1 sao 0.85 … 3 sao 1.15
  const gold = Math.round((t.gold[0] + rng() * (t.gold[1] - t.gold[0])) * starMul);
  const items: (RewardItem & { subs: Stats2 })[] = [];
  for (const r of t.rolls) {
    if (rng() >= Math.min(0.98, r.chance * (1 + L) * starMul)) continue;
    const d = rollGear(r.kinds, pushLuck(r.weights, L), rng);
    if (d) items.push({ itemId: d.itemId, grade: d.grade, subs: d.subs });
  }
  if (t.stones) {
    const n = Math.round(t.stones[0] + rng() * (t.stones[1] - t.stones[0]));
    if (n > 0) items.push({ itemId: UPGRADE_STONE, grade: 0, subs: {}, count: n });
  }
  const shards = t.shards ? Math.round(t.shards[0] + rng() * (t.shards[1] - t.shards[0])) : 0;
  const books = t.book && rng() < t.book * (1 + L) ? 1 : 0;
  return { gold, xp: Math.round(t.xp * starMul), items, shards, books };
}

/* ---- rớt khi hạ khỉ (trong trận) ---- */
// chỉ số loài khỉ (khớp content.ts MONKEYS): 0 nâu,1 chạy,2 ném,3 nổ,4 trắng,5 khỉ đột,6 vua,7 khỉ con
const KILL_CHANCE = [0.04, 0.04, 0.05, 0.04, 0.14, 0.16, 1, 0.015];
const KILL_GRADE_PUSH = [0, 0, 0, 0, 0.35, 0.5, 1.2, 0];
const KILL_W: GradeWeights = [64, 26, 8, 1.7, 0.3];
/** số món boss rớt chắc chắn */
export const BOSS_DROPS: [number, number] = [2, 4];
export const isBossMonkey = (t: number) => t === 6;

/** một món rơi ngẫu nhiên khi hạ khỉ (đã qua xác suất) */
function killDrop(t: number, stage: StageDef, L: number, rng: () => number): LootDrop | null {
  const diffPush = Math.max(0, stage.diff - 1) * 0.9;
  const w = pushLuck(KILL_W, L, diffPush + (KILL_GRADE_PUSH[t] ?? 0));
  const r = rng();
  if (r < 0.55) return rollGear([], w, rng);
  if (r < 0.8) {
    // tiêu hao: phẩm thấp dễ ra hơn
    const g = pickWeighted(w, rng);
    const pool = POOL_BY_KIND.consumable.filter((d) => d.minGrade <= g);
    const def = pool[Math.floor(rng() * pool.length)];
    return { itemId: def.id, grade: def.minGrade, subs: {}, count: def.minGrade === 0 ? 1 + Math.floor(rng() * 2) : 1 };
  }
  // nguyên liệu / tiền tệ
  const m = rng();
  if (m < 0.35) return { itemId: UPGRADE_STONE, grade: 0, subs: {}, count: 1 + Math.floor(rng() * 2) };
  if (m < 0.6) return { itemId: 'c_vang', grade: 0, subs: {}, count: Math.round((10 + rng() * 25) * stage.diff) };
  if (m < 0.75) return { itemId: 'm_longkhi', grade: 0, subs: {}, count: 1 + Math.floor(rng() * 3) };
  if (m < 0.85) return { itemId: 'm_nanhkhi', grade: 1, subs: {}, count: 1 };
  if (m < 0.92) return { itemId: 'c_manh', grade: 1, subs: {}, count: 1 };
  if (m < 0.97) return { itemId: 'm_ngocrung', grade: 2, subs: {}, count: 1 };
  if (m < 0.99) return { itemId: 'c_sach', grade: 2, subs: {}, count: 1 };
  return { itemId: 'm_huyentinh', grade: 3, subs: {}, count: 1 };
}

/**
 * Hạ một con khỉ → có rơi đồ không (null = không). Khỉ thường ~4%, khỉ con 1,5%, khỉ trắng/khỉ đột ~15%,
 * boss chắc chắn rơi (hàm này trả 1 món; dùng rollKillLoots để lấy đủ 2–4 món của boss).
 * Phẩm đẩy theo độ khó ải (stage.diff) + may mắn (luck).
 */
export function rollKillLoot(monkeyType: number, stage: StageDef, luck: number, rng: () => number): LootDrop | null {
  const L = luckOf(luck);
  const ch = KILL_CHANCE[monkeyType] ?? 0.04;
  if (ch < 1 && rng() >= ch * (1 + L)) return null;
  return killDrop(monkeyType, stage, L, rng);
}
/** mọi món rơi khi hạ một con khỉ (boss: 2–4 món, món đầu luôn là trang bị) */
export function rollKillLoots(monkeyType: number, stage: StageDef, luck: number, rng: () => number): LootDrop[] {
  if (!isBossMonkey(monkeyType)) {
    const d = rollKillLoot(monkeyType, stage, luck, rng);
    return d ? [d] : [];
  }
  const L = luckOf(luck);
  const n = BOSS_DROPS[0] + Math.floor(rng() * (BOSS_DROPS[1] - BOSS_DROPS[0] + 1));
  const out: LootDrop[] = [];
  const g = rollGear([], pushLuck(KILL_W, L, Math.max(0, stage.diff - 1) * 0.9 + (KILL_GRADE_PUSH[6] ?? 1)), rng);
  if (g) out.push(g);
  while (out.length < n) {
    const d = killDrop(6, stage, L, rng);
    if (d) out.push(d);
  }
  return out;
}

/* ======================= BỘ TÂN BINH + THƯƠNG NHÂN ======================= */
/** bộ đồ miễn phí, nhận lại bất cứ lúc nào không còn khẩu súng nào (kể cả trong kho) */
export const STARTER_KIT: { itemId: string; grade: Grade; count: number; slot: EquipSlot }[] = [
  { itemId: 'g_tanbinh', grade: 0, count: 1, slot: 'weapon1' },
  { itemId: 'k_gam', grade: 0, count: 1, slot: 'knife' },
  { itemId: 'q_maunho', grade: 0, count: 2, slot: 'quick1' },
];
/** được nhận bộ tân binh khi không sở hữu khẩu súng nào (túi + kho + đang mặc) */
export function canClaimStarter(items: readonly Pick<ItemInst, 'itemId'>[]): boolean {
  return !items.some((it) => ITEM_BY_ID[it.itemId]?.kind === 'gun');
}

export interface ShopEntry { itemId: string; grade: Grade; price: number }
/** hàng của thương nhân (giá mua 1 đơn vị) */
export const SHOP_STOCK: ShopEntry[] = [
  { itemId: 'q_bangac', grade: 0, price: 15 },
  { itemId: 'q_maunho', grade: 0, price: 30 },
  { itemId: 'q_maulon', grade: 1, price: 90 },
  { itemId: 'q_khientam', grade: 1, price: 80 },
  { itemId: 'q_tochanh', grade: 1, price: 70 },
  { itemId: 'q_luudan', grade: 0, price: 40 },
  { itemId: 'm_da', grade: 0, price: 60 },
  { itemId: 'g_k9', grade: 0, price: 120 },
  { itemId: 'g_ongvo', grade: 0, price: 220 },
  { itemId: 'g_nongngan', grade: 0, price: 220 },
  { itemId: 'g_ranlua', grade: 0, price: 260 },
  { itemId: 'g_cumeo', grade: 0, price: 240 },
  { itemId: 'g_natre', grade: 0, price: 260 },
  { itemId: 'g_phaotep', grade: 0, price: 300 },
  { itemId: 'g_thoren', grade: 0, price: 300 },
  { itemId: 'g_songlong', grade: 1, price: 600 },
  { itemId: 'g_mangxa', grade: 1, price: 750 },
  { itemId: 'k_ruadua', grade: 0, price: 90 },
  { itemId: 'k_matau', grade: 1, price: 300 },
  { itemId: 'h_mutre', grade: 0, price: 80 },
  { itemId: 'h_sat', grade: 1, price: 280 },
  { itemId: 'a_da', grade: 0, price: 100 },
  { itemId: 'a_xich', grade: 1, price: 320 },
  { itemId: 'gl_da', grade: 0, price: 80 },
  { itemId: 'gl_vai', grade: 1, price: 220 },
  { itemId: 'b_rom', grade: 0, price: 80 },
  { itemId: 'b_langdu', grade: 1, price: 300 },
  { itemId: 'bt_da', grade: 0, price: 80 },
  { itemId: 'am_go', grade: 0, price: 90 },
  { itemId: 'r_dong', grade: 0, price: 90 },
  { itemId: 'r_bac', grade: 1, price: 280 },
  { itemId: 's_rung', grade: 0, price: 50 },
];

/* ======================= LOADOUT (đầu trận) ======================= */
/** những gì server cần để áp vào trận cho một người */
export interface Loadout2 {
  /**
   * chỉ số cộng dồn đã chặn trần (để server áp + client hiển thị). LƯU Ý: fireRate/reload/mag/pierce đã nướng vào
   * `weapons` (BAKED_STATS) — gameplay KHÔNG áp lại; dmg ở đây KHÔNG gồm dòng dmg của chính khẩu súng (đã nướng).
   */
  stats: Stats2;
  /** 1–2 khẩu súng (0 = weapon1) */
  weapons: WeaponDef[];
  knifeDmg: number;
  /** vật phẩm ô quick1, quick2 (bỏ qua ô trống) */
  quick: { itemId: string; count: number; effect: ConsumableEffect }[];
  /** cấp kỹ năng của nhân vật đang chọn */
  skills: Record<SkillKey, number>;
  /** ngoại hình: id món đồ đang mặc theo ô (để client vẽ) */
  look: Partial<Record<EquipSlot, string>>;
  /** uid đồ mang vào trận (mọi ô trừ 'secure') — chết là mất */
  carried: number[];
}
/** phần chỉ số ảnh hưởng mô phỏng chuyển động (client dự đoán cần biết) — gửi trong tin 'start' */
export interface SimMods {
  speed: number;
  /** v2: luôn 0 cho loadout từ đồ (đã nướng vào WeaponDef); giữ cho tương thích sim */
  fireRate: number;
  /** v2: luôn 0 cho loadout từ đồ (đã nướng vào WeaponDef) */
  reload: number;
}
export const NO_MODS: SimMods = { speed: 0, fireRate: 0, reload: 0 };

export function capStats(s: Stats2): Stats2 {
  const out: Stats2 = {};
  for (const [k, v] of Object.entries(s) as [StatKey2, number][]) if (k in STAT2_INFO) out[k] = Math.min(STAT2_INFO[k].cap, Math.max(0, v));
  return out;
}

const NON_COMBAT: EquipSlot[] = ['secure'];
export function loadoutOf2(equipped: readonly ItemInst[], cls: number, skills: Record<SkillKey, number>): Loadout2 {
  const sum: Stats2 = {};
  const add = (k: StatKey2, v: number) => { sum[k] = (sum[k] ?? 0) + v; };
  const look: Partial<Record<EquipSlot, string>> = {};
  const bySlot: Partial<Record<EquipSlot, ItemInst>> = {};
  const carried: number[] = [];
  for (const it of equipped) {
    if (!it.slot) continue;
    const def = ITEM_BY_ID[it.itemId];
    if (!def || !SLOT_ACCEPTS[it.slot]?.includes(def.kind)) continue;
    if (bySlot[it.slot]) continue;
    bySlot[it.slot] = it;
    if (NON_COMBAT.includes(it.slot)) continue;
    carried.push(it.uid);
    look[it.slot] = def.id;
    if (def.kind === 'consumable' || def.kind === 'material') continue;
    if (def.kind === 'gun') {
      // dòng phụ của súng: crit/critDmg/headDmg/lifesteal tính chung; dmg/fireRate/reload/mag/pierce nướng vào khẩu đó
      for (const [k, v] of Object.entries(it.affixes ?? {}) as [StatKey2, number][]) if (!BAKED_STATS.includes(k) && k !== 'dmg' && k in STAT2_INFO) add(k, v);
      continue;
    }
    for (const [k, v] of Object.entries(itemStats(it)) as [StatKey2, number][]) add(k, v);
  }
  const extra: Stats2 = { fireRate: sum.fireRate ?? 0, reload: sum.reload ?? 0, mag: sum.mag ?? 0, pierce: sum.pierce ?? 0 };
  const weapons: WeaponDef[] = [];
  if (bySlot.weapon1) weapons.push(weaponFromItem(bySlot.weapon1, cls, extra));
  if (bySlot.weapon2) weapons.push(weaponFromItem(bySlot.weapon2, cls, extra));
  if (!weapons.length) weapons.push(weaponFromItem(null, cls, extra));
  const stats = capStats(sum);
  const knifeDmg = bySlot.knife ? stats.knifeDmg ?? BASE_KNIFE_DMG : Math.min(STAT2_INFO.knifeDmg.cap, BASE_KNIFE_DMG + (stats.knifeDmg ?? 0));
  stats.knifeDmg = knifeDmg;
  const quick: Loadout2['quick'] = [];
  for (const s of ['quick1', 'quick2'] as const) {
    const it = bySlot[s];
    const eff = it && ITEM_BY_ID[it.itemId]?.consumable;
    if (it && eff && it.count > 0) quick.push({ itemId: it.itemId, count: it.count, effect: eff });
  }
  return { stats, weapons, knifeDmg, quick, skills, look, carried };
}
export function simModsOf(l: Loadout2 | null | undefined): SimMods {
  if (!l) return NO_MODS;
  return { speed: l.stats.speed ?? 0, fireRate: 0, reload: 0 };
}

/* ======================= BÍ DANH v1 (để mã cũ biên dịch trong lúc chuyển) ======================= */
/** @deprecated dùng Grade */
export type Rarity = Grade;
/** @deprecated dùng StatKey2 */
export type StatKey = StatKey2;
/** @deprecated dùng Stats2 */
export type Stats = Stats2;
/** @deprecated dùng STAT2_INFO */
export const STAT_INFO = STAT2_INFO;
/** @deprecated dùng GRADES */
export const RARITY = GRADES;
/** @deprecated dùng ItemDef2 */
export type ItemDef = ItemDef2;
/** @deprecated dùng Loadout2 */
export type Loadout = Loadout2;
/** @deprecated dùng EquipSlot */
export type Slot = EquipSlot;
