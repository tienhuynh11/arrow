// Trang bị: 4 ô, 4 phẩm, cường hoá 0-10, rớt từ ải. Dữ liệu + công thức thuần, dùng chung server + client.
// Mọi món trang bị chỉ được TẠO ở server (rớt ải, quà khởi đầu, admin).
import type { Rarity, Stats } from './types.js';

export type GearSlot = 'weapon' | 'armor' | 'helmet' | 'accessory';
export const GEAR_SLOTS: readonly GearSlot[] = ['weapon', 'armor', 'helmet', 'accessory'];
export const GEAR_SLOT_NAME: Record<GearSlot, string> = { weapon: 'Vũ khí', armor: 'Giáp', helmet: 'Mũ', accessory: 'Phụ kiện' };

export const MAX_GEAR_LEVEL = 10;
/** số món tối đa trong kho trang bị của một tài khoản */
export const GEAR_CAP = 200;

export type GearTheme = 'forest' | 'water' | 'earth';
export const GEAR_THEMES: readonly GearTheme[] = ['forest', 'water', 'earth'];

export interface GearDef {
  id: string;
  slot: GearSlot;
  theme: GearTheme;
  rarity: Rarity;
  name: string;
}
/** một món cụ thể của người chơi */
export interface GearInst {
  uid: number;
  /** id GearDef */
  def: string;
  level: number;
  /** id tướng đang mặc ('' hoặc null = trong kho) */
  hero: string | null;
}

const RAR: Rarity[] = ['R', 'SR', 'SSR', 'UR'];
const PREFIX: Record<Rarity, string> = { R: 'Thường', SR: 'Tinh Xảo', SSR: 'Cổ Đại', UR: 'Thần Thoại' };
const BASE_NAME: Record<GearSlot, Record<GearTheme, string>> = {
  weapon: { forest: 'Gậy Gỗ Rừng', water: 'Kiếm Sóng', earth: 'Búa Đá' },
  armor: { forest: 'Giáp Vỏ Cây', water: 'Giáp Vảy Cá', earth: 'Giáp Đá' },
  helmet: { forest: 'Mũ Lá', water: 'Mũ Ốc Biển', earth: 'Mũ Đá' },
  accessory: { forest: 'Vòng Lá', water: 'Ngọc Sóng', earth: 'Nhẫn Đá' },
};

export const GEAR_DEFS: GearDef[] = GEAR_SLOTS.flatMap((slot) =>
  GEAR_THEMES.flatMap((theme) =>
    RAR.map((rarity): GearDef => ({ id: `${slot}_${theme}_${rarity}`, slot, theme, rarity, name: `${BASE_NAME[slot][theme]} ${PREFIX[rarity]}` })),
  ),
);
export const GEAR_BY_ID: Record<string, GearDef> = Object.fromEntries(GEAR_DEFS.map((g) => [g.id, g]));

export function gearDefOf(id: string): GearDef {
  const g = GEAR_BY_ID[id];
  if (!g) throw new Error(`unknown gear ${id}`);
  return g;
}

/* ------------------------------ CHỈ SỐ ------------------------------ */
/** chỉ số gốc (cấp 0) theo ô và phẩm: vũ khí → Công, giáp → Máu, mũ → Thủ, phụ kiện → nửa Công + nửa Máu */
const MAIN: Record<GearSlot, Record<Rarity, number>> = {
  weapon: { R: 12, SR: 20, SSR: 32, UR: 50 },
  armor: { R: 120, SR: 200, SSR: 320, UR: 500 },
  helmet: { R: 8, SR: 14, SSR: 22, UR: 35 },
  accessory: { R: 12, SR: 20, SSR: 32, UR: 50 },
};
export const ZERO_STATS: Stats = { hp: 0, atk: 0, def: 0, spd: 0 };

export function addStats(a: Stats, b: Stats): Stats {
  return { hp: a.hp + b.hp, atk: a.atk + b.atk, def: a.def + b.def, spd: a.spd + b.spd };
}
/** chỉ số của một món ở cấp cường hoá `level` (mỗi cấp +10% chỉ số gốc) */
export function gearStats(def: GearDef, level: number): Stats {
  const lv = Math.max(0, Math.min(MAX_GEAR_LEVEL, Math.floor(level)));
  const v = Math.floor((MAIN[def.slot][def.rarity] * (10 + lv)) / 10);
  switch (def.slot) {
    case 'weapon': return { hp: 0, atk: v, def: 0, spd: 0 };
    case 'armor': return { hp: v, atk: 0, def: 0, spd: 0 };
    case 'helmet': return { hp: 0, atk: 0, def: v, spd: 0 };
    case 'accessory': return { hp: v * 5, atk: Math.floor(v / 2), def: 0, spd: 0 };
  }
}
/** tổng chỉ số cộng thêm từ các món đang mặc */
export function sumGear(items: readonly { def: string; level: number }[]): Stats {
  let s = ZERO_STATS;
  for (const it of items) {
    const d = GEAR_BY_ID[it.def];
    if (d) s = addStats(s, gearStats(d, it.level));
  }
  return s;
}

/* ------------------------------ CƯỜNG HOÁ / PHÂN RÃ ------------------------------ */
const ENH_MULT: Record<Rarity, number> = { R: 1, SR: 2, SSR: 4, UR: 8 };
/** chi phí nâng từ cấp `level` lên `level+1` (null = đã tối đa) */
export function enhanceCost(rarity: Rarity, level: number): { gold: number; stones: number } | null {
  if (level >= MAX_GEAR_LEVEL) return null;
  return { gold: 150 * (level + 1) * ENH_MULT[rarity], stones: (level + 1) * (rarity === 'UR' ? 2 : 1) };
}
const SALVAGE_BASE: Record<Rarity, number> = { R: 2, SR: 5, SSR: 12, UR: 30 };
/** đá cường hoá nhận được khi phân rã (hoàn lại nửa số đá đã đầu tư) */
export function salvageStones(rarity: Rarity, level: number): number {
  let invested = 0;
  for (let l = 0; l < level; l++) invested += enhanceCost(rarity, l)?.stones ?? 0;
  return SALVAGE_BASE[rarity] + Math.floor(invested / 2);
}

/* ------------------------------ RỚT ĐỒ ------------------------------ */
/** tỉ lệ (trên 100) mỗi phẩm theo chương (1..3) */
const DROP_WEIGHTS: Record<number, Record<Rarity, number>> = {
  1: { R: 80, SR: 19, SSR: 1, UR: 0 },
  2: { R: 55, SR: 38, SSR: 6, UR: 1 },
  3: { R: 35, SR: 45, SSR: 17, UR: 3 },
};
/** trả số nguyên ngẫu nhiên trong [0,n) (server: crypto.randomInt) */
export type RandInt = (n: number) => number;

/** rớt đồ của một lần thắng ải: luôn 1 món, 30% thêm món thứ hai; ải boss (n=10) +1 món */
export function rollGearDrops(chapter: number, boss: boolean, rand: RandInt): string[] {
  const w = DROP_WEIGHTS[Math.max(1, Math.min(3, chapter))];
  const count = 1 + (rand(100) < 30 ? 1 : 0) + (boss ? 1 : 0);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let r = rand(100);
    let rarity: Rarity = 'R';
    for (const k of RAR) {
      if (r < w[k]) {
        rarity = k;
        break;
      }
      r -= w[k];
    }
    const slot = GEAR_SLOTS[rand(GEAR_SLOTS.length)];
    const theme = GEAR_THEMES[rand(GEAR_THEMES.length)];
    out.push(`${slot}_${theme}_${rarity}`);
  }
  return out;
}
/** quà khởi đầu: một món R mỗi ô (không mặc sẵn) */
export const STARTER_GEAR: readonly string[] = GEAR_SLOTS.map((s) => `${s}_forest_R`);

/** tỉ lệ rớt (%) mỗi phẩm theo chương (để UI hiện gợi ý; cùng bảng với rollGearDrops) */
export function gearDropOdds(chapter: number): Record<Rarity, number> {
  return { ...DROP_WEIGHTS[Math.max(1, Math.min(3, chapter))] };
}
