// Tháp thử thách: leo từng tầng, mỗi tầng một trận. Tầng sinh theo công thức (deterministic) nên server và client dựng giống hệt.
import { BATTLE_HZ } from './config.js';
import { CHAPTERS, type StageDef } from './stages.js';
import type { RandInt } from './gear.js';

export const TOWER_MAX_FLOOR = 100;
/** số lượt thử mỗi ngày (thua cũng tốn 1 lượt; thắng thì lên tầng) */
export const TOWER_TRIES = 5;

const FRONT = ['mk_con', 'mk_da', 'mk_dot'];
const BACK = ['mk_nem', 'mk_phap'];

export interface TowerReward {
  gold: number;
  /** EXP bình */
  exp: number;
  /** EXP tài khoản */
  xp: number;
  gems: number;
  stones: number;
  /** số lần rớt trang bị (rollGearDrops) */
  gearRolls: number;
}
export function towerReward(floor: number): TowerReward {
  const five = floor % 5 === 0;
  const ten = floor % 10 === 0;
  return {
    gold: 200 + 70 * floor,
    exp: 25 + 8 * floor,
    xp: 20 + 3 * floor,
    gems: five ? (ten ? 100 : 50) : 0,
    stones: ten ? 10 : 0,
    gearRolls: five ? (ten ? 2 : 1) : 0,
  };
}
export const isTowerBoss = (floor: number) => floor % 10 === 0;

/** dựng "ải" cho tầng `floor` (1..TOWER_MAX_FLOOR) để dùng chung stageSetup() */
export function towerStage(floor: number): StageDef {
  const f = Math.max(1, Math.min(TOWER_MAX_FLOOR, Math.floor(floor)));
  const boss = isTowerBoss(f);
  // MỘT đợt mỗi tầng, tối đa 6 quái; tầng boss (bội 10): boss ở ô đầu
  const count = Math.min(6, 3 + Math.floor(f / 25));
  const row: string[] = [];
  for (let s = 0; s < count; s++) {
    const pool = s < 2 ? FRONT : BACK;
    const kinds = Math.min(pool.length, 1 + Math.floor(f / 25));
    row.push(pool[(f + s) % kinds]);
  }
  if (boss) row[0] = 'mk_chua';
  const waves: string[][] = [row];
  const r = towerReward(f);
  return {
    id: `t-${f}`,
    chapter: 1 + Math.min(2, Math.floor((f - 1) / 34)),
    n: f,
    index: f - 1,
    name: `Tầng ${f}`,
    element: CHAPTERS[Math.min(2, Math.floor((f - 1) / 34))].element,
    level: Math.min(60, 3 + Math.floor(f * 1.3)),
    // độ khó: tầng đầu nhẹ, sau tầng 10 tăng đều (chỉ số quái nhân theo % này)
    diff: Math.floor((f <= 10 ? 50 + f * 5 : 100 + (f - 10) * 1.6) * (boss && f > 10 ? 0.85 : 1)),
    waves, boss,
    reward: { gold: r.gold, exp: r.exp, xp: r.xp, gems: r.gems },
    star3Ticks: 90 * BATTLE_HZ,
  };
}

export interface TowerState {
  /** tầng cao nhất đã qua (0 = chưa qua tầng nào) */
  floor: number;
  /** lượt thử còn lại hôm nay */
  tries: number;
}
export type { RandInt };
