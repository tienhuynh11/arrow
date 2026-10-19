// Công thức chỉ số / chi phí — thuần số nguyên, dùng chung server + client.
import { MAX_LEVEL, MAX_STAR } from './config.js';
import { ROLE_COMBAT, STAR_COMBAT, statOf } from './combat.js';
import type { Rarity, Role, Stats } from './types.js';

/** chỉ số cấp 1, 1 sao, phẩm R theo vai trò */
export const ROLE_BASE: Record<Role, Stats> = {
  tank: { hp: 1400, atk: 70, def: 70, spd: 85 },
  warrior: { hp: 1100, atk: 100, def: 50, spd: 100 },
  mage: { hp: 850, atk: 120, def: 35, spd: 100 },
  archer: { hp: 900, atk: 115, def: 38, spd: 110 },
  healer: { hp: 950, atk: 80, def: 40, spd: 95 },
  support: { hp: 950, atk: 85, def: 42, spd: 105 },
};
/** hệ số phẩm (%) */
export const RARITY_MULT: Record<Rarity, number> = { R: 100, SR: 115, SSR: 130, UR: 150 };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** chỉ số thật của một tướng ở cấp + sao đã cho */
export function statsAt(role: Role, rarity: Rarity, level: number, star: number): Stats {
  const lv = clamp(Math.floor(level), 1, MAX_LEVEL);
  const st = clamp(Math.floor(star), 1, MAX_STAR);
  const base = ROLE_BASE[role];
  const mul = (RARITY_MULT[rarity] * (100 + 12 * (lv - 1)) * (100 + 20 * (st - 1))) / 1_000_000;
  return {
    hp: Math.floor(base.hp * mul),
    atk: Math.floor(base.atk * mul),
    def: Math.floor(base.def * mul),
    spd: base.spd,
    // chỉ số chiến đấu mới: mặc định theo vai trò, tăng nhẹ theo sao
    aspd: ROLE_COMBAT[role].aspd + STAR_COMBAT.aspd * (st - 1),
    crit: ROLE_COMBAT[role].crit + STAR_COMBAT.crit * (st - 1),
    critDmg: ROLE_COMBAT[role].critDmg + STAR_COMBAT.critDmg * (st - 1),
  };
}
/** chỉ số quái: như tướng phẩm R, 1 sao, nhân thêm hệ số (%) */
export function monsterStatsAt(role: Role, level: number, mult: number): Stats {
  const s = statsAt(role, 'R', level, 1);
  return { ...s, hp: Math.floor((s.hp * mult) / 100), atk: Math.floor((s.atk * mult) / 100) };
}
/** lực chiến để hiển thị */
export function powerOf(s: Stats): number {
  // thêm một phần nhỏ cho tốc đánh / bạo kích / hút máu (chỉ tính phần vượt mặc định)
  const extra = Math.max(0, statOf(s, 'aspd') - 100) * 3 + Math.max(0, statOf(s, 'crit') - 10) * 3 + Math.max(0, statOf(s, 'critDmg') - 150) + statOf(s, 'lifesteal') * 10;
  return Math.floor(s.hp / 5 + s.atk * 4 + s.def * 3 + s.spd * 2 + extra);
}

/** nâng cấp tướng từ cấp `level` lên `level+1` */
export function levelUpCost(level: number): { gold: number; exp: number } {
  return { gold: 100 + 60 * level, exp: 20 + 10 * level };
}
/** nâng liên tiếp được bao nhiêu cấp với vàng/EXP đang có (dừng khi hết tiền hoặc chạm trần cấp của sao) */
export function levelUpPlan(level: number, star: number, gold: number, exp: number, maxTimes = MAX_LEVEL): { n: number; gold: number; exp: number } {
  const cap = levelCapOf(star);
  let n = 0;
  let g = 0;
  let e = 0;
  for (let lv = level; n < maxTimes && lv < cap; lv++) {
    const c = levelUpCost(lv);
    if (gold - g < c.gold || exp - e < c.exp) break;
    g += c.gold;
    e += c.exp;
    n++;
  }
  return { n, gold: g, exp: e };
}
/** mảnh cần để lên sao từ `star` lên `star+1` (null = đã tối đa) */
export function starUpCost(star: number): number | null {
  return [20, 40, 80, 160][star - 1] ?? null;
}
/** mảnh nhận được khi quay trùng tướng */
export const DUPE_SHARDS: Record<Rarity, number> = { R: 10, SR: 20, SSR: 40, UR: 80 };
/** cấp tướng tối đa theo sao */
export function levelCapOf(star: number): number {
  return Math.min(MAX_LEVEL, 20 + 10 * star);
}
/** EXP tài khoản cần để lên cấp kế */
export function accountXpToNext(level: number): number {
  return 100 + 50 * level;
}
