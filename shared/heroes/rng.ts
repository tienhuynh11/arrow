// PRNG có seed (mulberry32) — server và client ra cùng kết quả từ cùng seed.
// CHỈ dùng cho trận đánh. Gacha/thưởng dùng crypto.randomInt ở server.

export interface Rng {
  /** số thực [0,1) */
  next(): number;
  /** số nguyên [0,n) */
  int(n: number): number;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n) => Math.floor(next() * n) };
}
