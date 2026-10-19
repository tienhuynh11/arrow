// Quái + ải chiến dịch + thưởng AFK. Định nghĩa thuần dữ liệu / công thức, dùng chung server + client.
import type { BattleResult, BattleSetup, UnitInit } from './battle.js';
import { AFK_CAP_MS, BATTLE_HZ, FRONT_SLOTS, STAMINA_MAX, STAMINA_REGEN_MS } from './config.js';
import { monsterStatsAt } from './formulas.js';
import type { Element, Role } from './types.js';

export interface MonsterDef {
  id: string;
  name: string;
  role: Role;
  /** nhân chỉ số (%) so với tướng R cùng cấp */
  mult: number;
  skills: [string, string, string];
  boss?: boolean;
}
export const MONSTERS: MonsterDef[] = [
  { id: 'mk_con', name: 'Khỉ Con', role: 'warrior', mult: 90, skills: ['m_basic', 'm_a1', 'm_ult'] },
  { id: 'mk_da', name: 'Khỉ Đá', role: 'tank', mult: 110, skills: ['m_basic', 'm_a2', 'm_boss_u'] },
  { id: 'mk_nem', name: 'Khỉ Ném', role: 'archer', mult: 90, skills: ['m_basic', 'm_a1', 'm_ult'] },
  { id: 'mk_phap', name: 'Khỉ Pháp', role: 'mage', mult: 90, skills: ['m_basic', 'm_a2', 'm_ult'] },
  { id: 'mk_dot', name: 'Khỉ Đột', role: 'warrior', mult: 140, skills: ['m_basic', 'm_a1', 'm_boss_u'] },
  { id: 'mk_chua', name: 'Khỉ Chúa', role: 'tank', mult: 260, skills: ['m_basic', 'm_a1', 'm_boss_u'], boss: true },
];
const MONSTER_BY_ID: Record<string, MonsterDef> = Object.fromEntries(MONSTERS.map((m) => [m.id, m]));

export interface StageReward {
  gold: number;
  /** EXP bình */
  exp: number;
  /** EXP tài khoản */
  xp: number;
  /** kim cương thưởng lần đầu qua ải */
  gems: number;
}
export interface StageDef {
  id: string;
  chapter: number;
  /** 1..10 trong chương */
  n: number;
  /** 0..29 trên toàn chiến dịch */
  index: number;
  name: string;
  element: Element;
  level: number;
  /** độ khó (%) nhân vào chỉ số quái: ải đầu nhẹ cho tân thủ, từ ải 8 trở đi là 100 */
  diff: number;
  /** id quái của từng đợt, xếp theo ô (slot 0..) */
  waves: string[][];
  boss: boolean;
  reward: StageReward;
  /** ≤ bấy nhiêu tick thì được sao thứ 3 */
  star3Ticks: number;
}

export const CHAPTERS = [
  { name: 'Đền Rừng', element: 'forest' as Element },
  { name: 'Làng Ven Sông', element: 'water' as Element },
  { name: 'Mỏ Đá', element: 'earth' as Element },
];
export const STAGES_PER_CHAPTER = 10;

const FRONT_POOL = ['mk_con', 'mk_da', 'mk_dot'];
const BACK_POOL = ['mk_nem', 'mk_phap'];

/** ải boss trong mỗi chương: ải 5 (boss nhẹ) và ải 10 (boss mạnh) */
export const BOSS_STAGE_NS: readonly number[] = [5, 10];
export const isBossStageN = (n: number) => BOSS_STAGE_NS.includes(n);
/** hệ số độ khó (%) cho boss: ải 5 nhẹ hơn ải 10 */
const BOSS_DIFF = { 5: 88, 10: 100 } as Record<number, number>;

function buildStage(chapter: number, n: number): StageDef {
  const index = (chapter - 1) * STAGES_PER_CHAPTER + (n - 1);
  const boss = isBossStageN(n);
  // MỘT đợt duy nhất, tối đa 6 quái (bằng số ô tướng tối đa): 3 quái ở đầu chương, tăng dần tới 6
  const count = Math.min(6, 3 + Math.floor(index / 5));
  const row: string[] = [];
  for (let s = 0; s < count; s++) {
    const pool = s < FRONT_SLOTS ? FRONT_POOL : BACK_POOL;
    // công thức cố định (deterministic): càng về sau càng nhiều loại quái
    const kinds = Math.min(pool.length, 1 + Math.floor(index / 6));
    row.push(pool[(index + s) % kinds]);
  }
  if (boss) row[0] = 'mk_chua';
  return {
    id: `${chapter}-${n}`, chapter, n, index,
    name: `Ải ${chapter}-${n}`,
    element: CHAPTERS[chapter - 1].element,
    level: 1 + Math.floor(index * 1.8),
    diff: Math.floor(Math.min(100, 40 + index * 8) * (boss ? (BOSS_DIFF[n] ?? 100) / 100 : 1)),
    waves: [row], boss,
    reward: { gold: 100 + 40 * index, exp: 15 + 8 * index, xp: 20 + 6 * index, gems: boss ? 100 : 30 },
    // 70 giây đánh + ~6 giây hai bên tiến lại gần nhau
    star3Ticks: 76 * BATTLE_HZ,
  };
}
export const STAGES: StageDef[] = CHAPTERS.flatMap((_, c) =>
  Array.from({ length: STAGES_PER_CHAPTER }, (_x, i) => buildStage(c + 1, i + 1)),
);
export const STAGE_BY_ID: Record<string, StageDef> = Object.fromEntries(STAGES.map((s) => [s.id, s]));

export function stageOf(id: string): StageDef | undefined {
  return STAGE_BY_ID[id];
}
/** ải kế tiếp (null = hết chiến dịch) */
export function nextStage(id: string): StageDef | null {
  const s = STAGE_BY_ID[id];
  return s ? STAGES[s.index + 1] ?? null : null;
}

/** dựng cấu hình trận cho một ải (quái từ dữ liệu ải, người chơi do caller cung cấp) */
export function stageSetup(stage: StageDef, player: UnitInit[], seed: number): BattleSetup {
  const waves = stage.waves.map((row) =>
    row.map((mid, slot): UnitInit => {
      const m = MONSTER_BY_ID[mid];
      return {
        key: m.id, name: m.name, side: 1, slot, element: stage.element, role: m.role,
        stats: monsterStatsAt(m.role, stage.level, Math.floor((m.mult * stage.diff) / 100)), skills: m.skills, boss: m.boss,
      };
    }),
  );
  return { seed, player, waves };
}

/** số sao (0-3): thắng = 1, không ai gục = +1, nhanh = +1 */
export function starsOf(r: BattleResult, stage: StageDef): number {
  if (!r.win) return 0;
  return 1 + (r.deaths === 0 ? 1 : 0) + (r.ticks <= stage.star3Ticks ? 1 : 0);
}

/* ------------------------------ AFK + THỂ LỰC ------------------------------ */
/** thưởng AFK mỗi giờ theo ải cao nhất đã qua (-1 = chưa qua ải nào) */
export function afkRatePerHour(highestIndex: number): { gold: number; exp: number } {
  const i = highestIndex + 1;
  return { gold: 300 + 120 * i, exp: 30 + 20 * i };
}
/** thưởng AFK tích luỹ sau `elapsedMs` (đã chặn ở 12 giờ) */
export function afkReward(highestIndex: number, elapsedMs: number): { gold: number; exp: number } {
  const ms = Math.max(0, Math.min(AFK_CAP_MS, elapsedMs));
  const r = afkRatePerHour(highestIndex);
  return { gold: Math.floor((r.gold * ms) / 3_600_000), exp: Math.floor((r.exp * ms) / 3_600_000) };
}
/** thể lực hiện tại, tính từ giá trị lưu + mốc lưu (không cần vòng lặp) */
export function staminaNow(stored: number, atMs: number, nowMs: number): number {
  if (stored >= STAMINA_MAX) return stored;
  return Math.min(STAMINA_MAX, stored + Math.floor(Math.max(0, nowMs - atMs) / STAMINA_REGEN_MS));
}
