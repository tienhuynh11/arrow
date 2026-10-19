// Triệu hồi (gacha): tỉ lệ, pity, 50/50 cho UR nổi bật. Hàm thuần — nguồn ngẫu nhiên do caller đưa vào
// (server: crypto.randomInt; test: PRNG có seed).
import { poolOf } from './heroes.js';
import type { Rarity } from './types.js';

/** tỉ lệ trên 10.000 */
export const RATES: Record<Rarity, number> = { R: 6000, SR: 3200, SSR: 700, UR: 100 };
/** chắc chắn SSR+ sau bấy nhiêu lượt không ra, chắc chắn UR sau bấy nhiêu lượt */
export const SSR_PITY = 40;
export const UR_PITY = 90;

export const SUMMON_COST = { tickets: 1, gems: 300 };
export const SUMMON10_COST = { tickets: 10, gems: 2700 };

export interface Banner {
  id: string;
  name: string;
  /** id tướng UR nổi bật (null = banner thường) */
  featured: string | null;
}
export const BANNERS: Banner[] = [
  { id: 'standard', name: 'Triệu Hồi Thường', featured: null },
  { id: 'hau_vuong', name: 'Hầu Vương Giáng Thế', featured: 'hau_vuong' },
];
export const BANNER_BY_ID: Record<string, Banner> = Object.fromEntries(BANNERS.map((b) => [b.id, b]));

export interface PityState {
  /** số lượt từ lần ra SSR+ gần nhất */
  sinceSSR: number;
  /** số lượt từ lần ra UR gần nhất */
  sinceUR: number;
  /** lần UR kế chắc chắn là tướng nổi bật (đã trượt 50/50) */
  guaranteed: boolean;
}
export const NEW_PITY: PityState = { sinceSSR: 0, sinceUR: 0, guaranteed: false };

export interface Pull {
  heroId: string;
  rarity: Rarity;
}
/** trả số nguyên ngẫu nhiên trong [0,n) */
export type RandInt = (n: number) => number;

function rollRarity(rand: RandInt): Rarity {
  const r = rand(10000);
  if (r < RATES.UR) return 'UR';
  if (r < RATES.UR + RATES.SSR) return 'SSR';
  if (r < RATES.UR + RATES.SSR + RATES.SR) return 'SR';
  return 'R';
}

function pullOne(st: PityState, banner: Banner, rand: RandInt, forceSR: boolean): { pull: Pull; state: PityState } {
  const nUR = st.sinceUR + 1;
  const nSSR = st.sinceSSR + 1;
  let rarity: Rarity = nUR >= UR_PITY ? 'UR' : nSSR >= SSR_PITY ? 'SSR' : rollRarity(rand);
  if (forceSR && rarity === 'R') rarity = 'SR';

  let guaranteed = st.guaranteed;
  const pool = poolOf(rarity);
  let heroId: string;
  if (rarity === 'UR' && banner.featured && pool.some((h) => h.id === banner.featured)) {
    const others = pool.filter((h) => h.id !== banner.featured);
    if (guaranteed || others.length === 0 || rand(2) === 0) {
      heroId = banner.featured;
      guaranteed = false;
    } else {
      heroId = others[rand(others.length)].id;
      guaranteed = true;
    }
  } else heroId = pool[rand(pool.length)].id;

  const state: PityState =
    rarity === 'UR' ? { sinceSSR: 0, sinceUR: 0, guaranteed }
    : rarity === 'SSR' ? { sinceSSR: 0, sinceUR: nUR, guaranteed }
    : { sinceSSR: nSSR, sinceUR: nUR, guaranteed };
  return { pull: { heroId, rarity }, state };
}

/** quay 1 hoặc 10 lượt; lượt thứ 10 của x10 đảm bảo ít nhất SR nếu 9 lượt đầu toàn R */
export function summon(st: PityState, banner: Banner, count: 1 | 10, rand: RandInt): { pulls: Pull[]; state: PityState } {
  const pulls: Pull[] = [];
  let state = st;
  for (let i = 0; i < count; i++) {
    const force = count === 10 && i === 9 && pulls.every((p) => p.rarity === 'R');
    const r = pullOne(state, banner, rand, force);
    pulls.push(r.pull);
    state = r.state;
  }
  return { pulls, state };
}
