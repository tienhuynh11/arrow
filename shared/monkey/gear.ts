// HỢP ĐỒNG v2 — "mang đồ vào ải, chết là mất" (kiểu extraction) + trang bị kiểu Võ Lâm Truyền Kỳ.
// File này chỉ chốt KIỂU + tên/ý nghĩa để 3 agent (data/DB, gameplay, giao diện) làm song song.
// Agent data điền nội dung (danh mục đồ lớn, công thức) và hợp nhất với progression.ts.

import type { WeaponDef, WeaponModel } from './content.js';

/* ---------- phẩm (5 bậc, màu kiểu VLTK) ---------- */
export type Grade = 0 | 1 | 2 | 3 | 4;
// 0 Trắng (Thường) · 1 Xanh (Tốt) · 2 Tím (Hiếm) · 3 Vàng (Sử thi) · 4 Cam (Huyền thoại)

/* ---------- ô trang bị ---------- */
export type EquipSlot =
  | 'weapon1' | 'weapon2' // súng chính / phụ (item kind 'gun')
  | 'knife'
  | 'helmet' | 'armor' | 'gloves' | 'boots' | 'belt'
  | 'amulet' | 'ring1' | 'ring2' // nhẫn: item kind 'ring' vào ring1 hoặc ring2
  | 'skin'
  | 'quick1' | 'quick2' // vật phẩm tiêu hao (kind 'consumable'), dùng phím 3 / 4
  | 'secure'; // túi an toàn: 1 món bất kỳ, KHÔNG mất khi chết (không dùng trong trận)
export type ItemKind = 'gun' | 'knife' | 'helmet' | 'armor' | 'gloves' | 'boots' | 'belt' | 'amulet' | 'ring' | 'skin' | 'consumable' | 'material';
/** ô nào nhận được loại đồ nào */
export const SLOT_ACCEPTS: Record<EquipSlot, ItemKind[]> = {
  weapon1: ['gun'], weapon2: ['gun'], knife: ['knife'],
  helmet: ['helmet'], armor: ['armor'], gloves: ['gloves'], boots: ['boots'], belt: ['belt'],
  amulet: ['amulet'], ring1: ['ring'], ring2: ['ring'], skin: ['skin'],
  quick1: ['consumable'], quick2: ['consumable'],
  secure: ['gun', 'knife', 'helmet', 'armor', 'gloves', 'boots', 'belt', 'amulet', 'ring', 'skin', 'consumable', 'material'],
};

/* ---------- chỉ số (mở rộng) ---------- */
export type StatKey2 =
  | 'hp' | 'armor' | 'dmg' | 'headDmg' | 'crit' | 'critDmg' | 'lifesteal' | 'regen'
  | 'reload' | 'fireRate' | 'speed' | 'mag' | 'pierce' | 'cdr' | 'skillDmg' | 'knifeDmg' | 'luck' | 'pickup';

/* ---------- vật phẩm tiêu hao ---------- */
export type ConsumableEffect =
  | { kind: 'heal'; amount: number }
  | { kind: 'shield'; amount: number; secs: number }
  | { kind: 'speed'; mul: number; secs: number }
  | { kind: 'grenade'; dmg: number; radius: number }
  | { kind: 'revive' }; // tự đứng dậy khi gục

/* ---------- vũ khí từ món đồ ---------- */
/**
 * Server tính sẵn WeaponDef thật cho từng người ở đầu trận ải (từ món súng đang mặc + phẩm + cấp + dòng phụ)
 * và gửi trong tin 'start' → client dự đoán dùng ĐÚNG số đó. Không có súng → súng bậc 0 của nhân vật.
 * Hàm cài đặt nằm ở progression.ts: weaponFromItem(it, cls): WeaponDef.
 */
export type GunFamily = WeaponModel;
export type StartWeapons = WeaponDef[]; // 1–2 khẩu, chỉ số 0 = weapon1

/* ---------- ba lô của trận + kết quả ---------- */
/** món nhặt được trong trận (chưa có uid — chỉ được ghi vào kho khi giữ được) */
export interface LootDrop { itemId: string; grade: Grade; subs: Partial<Record<StatKey2, number>>; count?: number }
/** túi đồ rơi trên mặt đất (ev 'loot') */
export interface GroundLoot { id: number; x: number; z: number; grade: Grade; itemId: string }
/** kết quả cho một người */
export interface ExtractResult {
  survived: boolean; // thắng và còn sống lúc kết thúc
  kept: number[]; // uid đồ mang vào được giữ lại
  lost: number[]; // uid đồ mang vào bị mất
  looted: LootDrop[]; // đồ nhặt trong trận (giữ nếu survived)
  usedConsumables: Record<string, number>; // itemId → số đã dùng
}
