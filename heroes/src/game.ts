// Hàm tiện ích dữ liệu game cho UI (đọc từ `me` + dữ liệu dùng chung).
import { AFK_CAP_MS, BATTLE_HZ, MAX_LEVEL, SQUAD_SIZE } from '@shared/heroes/config';
import { levelCapOf, powerOf, statsAt } from '@shared/heroes/formulas';
import { HERO_BY_ID, HEROES } from '@shared/heroes/heroes';
import { afkReward, STAGES, type StageDef } from '@shared/heroes/stages';
import type { EffectType, HeroDef, OwnedHero, SkillDef, SkillTarget, Stats } from '@shared/heroes/types';
import type { MeResponse } from '@shared/heroes/api';
import { QUEST_DEFS, type QuestState } from '@shared/heroes/quests';
import { ARENA_START_RATING, ARENA_TRIES, type ArenaState } from '@shared/heroes/arena';
import { TOWER_MAX_FLOOR } from '@shared/heroes/tower';
import { addStats, enhanceCost, gearDefOf, gearStats, GEAR_BY_ID, GEAR_SLOTS, sumGear, ZERO_STATS, type GearInst, type GearSlot } from '@shared/heroes/gear';
import { me, serverNow } from './api';

export { AFK_CAP_MS, MAX_LEVEL, HEROES, HERO_BY_ID, levelCapOf };

export function ownedMap(m: MeResponse): Map<string, OwnedHero> {
  return new Map(m.heroes.map((h) => [h.id, h]));
}
/** trang bị đang mặc của một tướng, theo ô */
export function gearOf(m: MeResponse, heroId: string): Partial<Record<GearSlot, GearInst>> {
  const out: Partial<Record<GearSlot, GearInst>> = {};
  for (const g of m.gear) {
    if (g.hero !== heroId) continue;
    const d = GEAR_BY_ID[g.def];
    if (d) out[d.slot] = g;
  }
  return out;
}
/** chỉ số cộng thêm từ trang bị đang mặc (khớp với heroUnit(..., bonus) ở trận đánh/server) */
export function gearBonus(m: MeResponse, heroId: string): Stats {
  return sumGear(m.gear.filter((g) => g.hero === heroId));
}
/** món trong kho (chưa ai mặc) theo ô */
export function bagBySlot(m: MeResponse, slot: GearSlot): GearInst[] {
  return m.gear.filter((g) => !g.hero && GEAR_BY_ID[g.def]?.slot === slot);
}
export function gearStatsOf(g: { def: string; level: number }): Stats {
  return gearStats(gearDefOf(g.def), g.level);
}
/** "lực chiến" của riêng món trang bị (dùng so sánh/sắp xếp) */
export function gearPower(g: { def: string; level: number }): number {
  return powerOf(gearStatsOf(g));
}
export type StatKey = 'hp' | 'atk' | 'def' | 'spd';
export const STAT_KEYS: StatKey[] = ['hp', 'atk', 'def', 'spd'];
export const STAT_LABEL: Record<StatKey, string> = { hp: 'Máu', atk: 'Công', def: 'Thủ', spd: 'Tốc' };
/** các chỉ số khác 0 của một bộ chỉ số */
export function statEntries(s: Stats): { k: StatKey; v: number }[] {
  return STAT_KEYS.filter((k) => s[k] !== 0).map((k) => ({ k, v: s[k] }));
}
/** chênh lệch chỉ số b - a */
export function statDiff(b: Stats, a: Stats): Stats {
  return { hp: b.hp - a.hp, atk: b.atk - a.atk, def: b.def - a.def, spd: b.spd - a.spd };
}
/** chỉ số tướng (đã gồm trang bị). `m` mặc định là hồ sơ hiện tại */
export function statsOfOwned(o: OwnedHero, m: MeResponse | null = me.value): Stats {
  const d = HERO_BY_ID[o.id];
  const base = statsAt(d.role, d.rarity, o.level, o.star);
  return m ? addStats(base, gearBonus(m, o.id)) : base;
}
export function powerOfOwned(o: OwnedHero, m: MeResponse | null = me.value): number {
  return powerOf(statsOfOwned(o, m));
}
export function squadPower(m: MeResponse, slots: string[]): number {
  const mp = ownedMap(m);
  let p = 0;
  for (const id of slots) {
    const o = id ? mp.get(id) : undefined;
    if (o) p += powerOfOwned(o, m);
  }
  return p;
}
/** kế hoạch cường hoá: tối đa `times` cấp trong khả năng vàng/đá (khớp công thức server) */
export function gearUpgradePlan(level: number, rarity: Parameters<typeof enhanceCost>[0], gold: number, stones: number, times = 1): { n: number; gold: number; stones: number } {
  let n = 0;
  let g = 0;
  let s = 0;
  while (n < times) {
    const c = enhanceCost(rarity, level + n);
    if (!c || g + c.gold > gold || s + c.stones > stones) break;
    g += c.gold;
    s += c.stones;
    n++;
  }
  return { n, gold: g, stones: s };
}
export { GEAR_SLOTS, ZERO_STATS };
export function starsOfStage(m: MeResponse, id: string): number {
  return m.progress.find((p) => p.stage === id)?.stars ?? 0;
}
export function highestIndex(m: MeResponse): number {
  let hi = -1;
  for (const p of m.progress) {
    if (p.stars <= 0) continue;
    const s = STAGES.find((x) => x.id === p.stage);
    if (s && s.index > hi) hi = s.index;
  }
  return hi;
}
/** quy tắc mở ải: ải đầu luôn mở, các ải sau cần đã qua ải liền trước */
export function stageUnlocked(m: MeResponse, s: StageDef): boolean {
  return s.index === 0 || starsOfStage(m, STAGES[s.index - 1].id) > 0;
}
/** ải nên đánh tiếp: ải đầu tiên chưa qua (hoặc ải cuối) */
export function nextStageOf(m: MeResponse): StageDef {
  return STAGES.find((s) => starsOfStage(m, s.id) === 0) ?? STAGES[STAGES.length - 1];
}
/** thưởng AFK đang tích luỹ theo giờ server ước lượng */
export function afkNow(m: MeResponse): { gold: number; exp: number; elapsed: number } {
  const elapsed = Math.max(0, serverNow() - m.afk.since);
  const r = afkReward(highestIndex(m), elapsed);
  return { gold: Math.max(r.gold, m.afk.pending.gold), exp: Math.max(r.exp, m.afk.pending.exp), elapsed: Math.min(elapsed, AFK_CAP_MS) };
}
/** đội hình đang dùng: id tướng thật (đã lọc ô trống) */
export function activeSquadIds(m: MeResponse): string[] {
  return (m.squads[m.activeSquad] ?? []).filter((id) => id && HERO_BY_ID[id]).slice(0, SQUAD_SIZE);
}

/* ------------------------------ MÔ TẢ KỸ NĂNG ------------------------------ */
const TARGET_TEXT: Record<SkillTarget, string> = {
  enemy: '1 địch hàng trước',
  enemyBack: '1 địch hàng sau',
  enemyLowest: 'địch ít máu nhất',
  enemyAll: 'toàn bộ địch',
  self: 'bản thân',
  allyLowest: 'đồng minh ít máu nhất',
  allyAll: 'toàn đội',
};
const EFFECT_TEXT: Record<EffectType, (v: number) => string> = {
  atkUp: (v) => `Công +${v}%`,
  defUp: (v) => `Thủ +${v}%`,
  defDown: (v) => `Thủ -${v}%`,
  stun: () => 'Choáng',
  shield: (v) => `Khiên ${v}% Công`,
  spdUp: (v) => `Tốc +${v}%`,
};
export function describeSkill(s: SkillDef): string {
  const parts: string[] = [];
  if (s.type === 'dmg') parts.push(`Gây ${s.power}% Công lên ${TARGET_TEXT[s.target]}.`);
  else if (s.type === 'heal') parts.push(`Hồi ${s.power}% Công cho ${TARGET_TEXT[s.target]}.`);
  else parts.push(`Tác dụng lên ${TARGET_TEXT[s.target]}.`);
  for (const e of s.effects) parts.push(`${EFFECT_TEXT[e.type](e.value)} (${(e.dur / BATTLE_HZ).toFixed(0)}s).`);
  if (s.kind === 'active') parts.push(`Hồi chiêu ${(s.cd / BATTLE_HZ).toFixed(0)}s.`);
  if (s.kind === 'ult') parts.push('Cần đầy năng lượng.');
  return parts.join(' ');
}

export function defOf(id: string): HeroDef {
  return HERO_BY_ID[id];
}

/* ------------------------------ THÁP / NHIỆM VỤ / CỬA HÀNG (phòng thủ: server cũ có thể chưa trả các trường này) ------------------------------ */
export function towerOf(m: MeResponse): { floor: number; tries: number } {
  const t = m.tower;
  return { floor: Math.max(0, Math.min(TOWER_MAX_FLOOR, t?.floor ?? 0)), tries: Math.max(0, t?.tries ?? 0) };
}
/** tháp còn đánh được (còn lượt và chưa hết tầng) */
export function towerPlayable(m: MeResponse): boolean {
  const t = towerOf(m);
  return t.tries > 0 && t.floor < TOWER_MAX_FLOOR;
}
/** đấu trường (server cũ chưa có `arena` -> mặc định điểm 1000, 5 lượt, đội phòng thủ 0) */
export function arenaOf(m: MeResponse): ArenaState {
  const a = m.arena as Partial<ArenaState> | undefined;
  return {
    rating: a?.rating ?? ARENA_START_RATING,
    tries: Math.max(0, a?.tries ?? ARENA_TRIES),
    defense: a?.defense ?? 0,
    wins: a?.wins ?? 0,
    losses: a?.losses ?? 0,
  };
}
/** đấu trường còn đánh được: còn lượt và đội đang dùng có ít nhất 1 tướng */
export function arenaPlayable(m: MeResponse): boolean {
  return arenaOf(m).tries > 0 && activeSquadIds(m).length > 0;
}
/** luôn đủ mọi nhiệm vụ trong QUEST_DEFS, theo đúng thứ tự */
export function questList(m: MeResponse): (QuestState & { claimable: boolean })[] {
  const by = new Map((m.quests?.list ?? []).map((q) => [q.id, q]));
  return QUEST_DEFS.map((d) => {
    const q = by.get(d.id);
    const progress = q?.progress ?? 0;
    const claimed = !!q?.claimed;
    return { id: d.id, progress, claimed, claimable: !claimed && progress >= d.target };
  });
}
export function bonusState(m: MeResponse): { claimed: boolean; claimable: boolean } {
  const claimed = !!m.quests?.bonusClaimed;
  return { claimed, claimable: !claimed && questList(m).every((q) => q.claimed) };
}
/** số mục có thể nhận (nhiệm vụ + rương thưởng thêm) */
export function questClaimable(m: MeResponse): number {
  return questList(m).filter((q) => q.claimable).length + (bonusState(m).claimable ? 1 : 0);
}
export function shopBought(m: MeResponse): Record<string, number> {
  return m.shop ?? {};
}
/** số mục sự kiện có thể nhận (server tính sẵn; server cũ chưa có thì 0) */
export function eventsClaimable(m: MeResponse): number {
  return Math.max(0, m.eventsClaimable ?? 0);
}
/** chấm đỏ ở Hub: Tháp còn lượt, nhiệm vụ có thể nhận, sự kiện có thể nhận (cửa hàng/bang không có chấm) */
export function hubBadges(m: MeResponse): { tower: boolean; arena: boolean; quests: number; events: number; total: number } {
  const tower = towerPlayable(m);
  const arena = arenaPlayable(m);
  const quests = questClaimable(m);
  const events = eventsClaimable(m);
  return { tower, arena, quests, events, total: (tower ? 1 : 0) + (arena ? 1 : 0) + quests + events };
}
