// Luật chơi Thẻ Tướng phía server: các hàm THUẦN trên HState (đồng bộ, ném StoreError nếu sai).
// Store (Mem/Pg) gọi các hàm này bên trong một giao dịch có khoá hồ sơ nên không có chỗ nào tiêu trùng tiền.

import type { AfkState, ArenaBattleRes, BattleRes, MeResponse, QuestClaimRes, ShopBuyRes, StageProgress, SummonRes, TowerBattleRes } from '../../../shared/heroes/api.js';
import { heroUnit, simulate, type BattleInput, type UnitInit } from '../../../shared/heroes/battle.js';
import {
  MAX_ACCOUNT_LEVEL, MAX_LEVEL, MAX_STAR, SQUAD_COUNT, SQUAD_SIZE, STAMINA_MAX, STAMINA_REGEN_MS, SWEEP_COST,
} from '../../../shared/heroes/config.js';
import { DUPE_SHARDS, accountXpToNext, levelCapOf, levelUpCost, starUpCost } from '../../../shared/heroes/formulas.js';
import {
  BANNER_BY_ID, NEW_PITY, SUMMON10_COST, SUMMON_COST, summon, type Pull, type RandInt,
} from '../../../shared/heroes/gacha.js';
import {
  GEAR_BY_ID, GEAR_CAP, MAX_GEAR_LEVEL, STARTER_GEAR, enhanceCost, gearDefOf, rollGearDrops, salvageStones, sumGear,
  type GearInst, type RandInt as GearRand,
} from '../../../shared/heroes/gear.js';
import { HERO_BY_ID, STARTER_HEROES } from '../../../shared/heroes/heroes.js';
import { STAGES, afkReward, stageOf, stageSetup, staminaNow, starsOf, type StageDef } from '../../../shared/heroes/stages.js';
import type { OwnedHero, Wallet } from '../../../shared/heroes/types.js';
import { QUEST_BONUS, QUEST_BY_ID, QUEST_DEFS, dayKey, type QuestKind } from '../../../shared/heroes/quests.js';
import { SHOP_BY_ID, SHOP_ITEMS } from '../../../shared/heroes/shop.js';
import { TOWER_MAX_FLOOR, TOWER_TRIES, towerReward, towerStage } from '../../../shared/heroes/tower.js';
import {
  ARENA_START_RATING, ARENA_TRIES, BOT_NAMES, arenaReward, arenaSetup, botSquad, ratingDelta, type ArenaOpponent, type ArenaState,
} from '../../../shared/heroes/arena.js';
import { powerOf } from '../../../shared/heroes/formulas.js';
import { BOSS_KILL_REWARD } from '../../../shared/heroes/guild.js';
import type { EventDef, EventKind } from '../../../shared/heroes/events.js';
import { newbieBadge, newbieDone } from '../../../shared/heroes/newbie.js';
import { newbieView } from './newbie.js';
import { slotsOpen, squadsOpen } from '../../../shared/heroes/progression.js';
import { achBadge } from '../../../shared/heroes/achievements.js';
import { achList } from './progress.js';
import { StoreError, newNewbie, type HState, type LedgerRow } from './db/store.js';

export const STARTER_WALLET: Readonly<Wallet> = { gold: 5000, gems: 3000, tickets: 10, exp: 500, stones: 0 };
/** trần mỗi loại tiền (cột integer của Postgres) */
export const MONEY_CAP = 2_000_000_000;
export const SHARD_CAP = 1_000_000_000;
export const MAX_SWEEP = 10;
/** số hành động tối đa trong một trận (engine cũng cắt ở 400) */
export const MAX_BATTLE_INPUTS = 200;

export const WALLET_KEYS = ['gold', 'gems', 'tickets', 'exp', 'stones'] as const;
const WALLET_NAME: Record<keyof Wallet, string> = { gold: 'vàng', gems: 'kim cương', tickets: 'vé triệu hồi', exp: 'EXP bình', stones: 'đá cường hoá' };

/* ------------------------------ KHỞI TẠO / HIỂN THỊ ------------------------------ */
/** hồ sơ khởi đầu của tài khoản mới */
export function newState(accountId: number, nowMs: number): HState {
  const heroes: Record<string, OwnedHero> = {};
  for (const id of STARTER_HEROES) heroes[id] = { id, level: 1, star: 1, shards: 0 };
  const squads: string[][] = Array.from({ length: SQUAD_COUNT }, () => Array<string>(SQUAD_SIZE).fill(''));
  // cấp 1 chỉ mở 3 ô: tướng khởi đầu đứng ô 0..2 (SLOT_LEVEL[2] = 1), còn lại để trống
  STARTER_HEROES.slice(0, slotsOpen(1, 0)).forEach((id, i) => (squads[0][i] = id));
  return {
    accountId, wallet: { ...STARTER_WALLET }, level: 1, xp: 0, stamina: STAMINA_MAX, staminaAt: nowMs, afkSince: nowMs,
    activeSquad: 0, pity: {}, heroes, squads, progress: {}, runs: [], gear: [], newGear: [...STARTER_GEAR],
    towerFloor: 0, towerDay: 0, towerTries: 0, day: 0, quests: {}, questBonus: false, shop: {},
    arenaOn: false, arenaRating: ARENA_START_RATING, arenaDay: 0, arenaTries: 0, arenaDefense: 0, arenaWins: 0, arenaLosses: 0,
    guildLeftAt: 0, guildId: null, events: [], newbie: newNewbie(), levelClaimed: 1, slotsBought: 0, ach: {},
  };
}

/** chỉ số ải cao nhất đã qua (-1 = chưa qua ải nào) */
export function highestIndex(s: Readonly<HState>): number {
  let best = -1;
  for (const p of Object.values(s.progress)) {
    if (p.stars <= 0) continue;
    const st = stageOf(p.stage);
    if (st && st.index > best) best = st.index;
  }
  return best;
}
export function afkOf(s: Readonly<HState>, nowMs: number): AfkState {
  return { since: s.afkSince, pending: afkReward(highestIndex(s), nowMs - s.afkSince) };
}

/**
 * Chuyển sang ngày mới (lười, không timer): reset lượt Tháp, xoá nhiệm vụ/mua hàng của ngày cũ, và tính "đăng nhập" cho hôm nay.
 * Store gọi TRƯỚC mỗi `fn` trong mutate (cùng giao dịch); buildMe áp dụng cùng quy tắc nhưng chỉ để hiển thị (không ghi).
 */
export function rollDay(s: HState, nowMs: number) {
  const today = dayKey(nowMs);
  if (s.towerDay !== today) {
    s.towerDay = today;
    s.towerTries = TOWER_TRIES;
  }
  if (s.arenaDay !== today) {
    s.arenaDay = today;
    s.arenaTries = ARENA_TRIES;
  }
  if (s.day !== today) {
    s.day = today;
    s.quests = {};
    s.questBonus = false;
    s.shop = {};
    bumpEvents(s, 'login', 1); // sự kiện: +1 ở lần chạm đầu tiên trong ngày
  }
  bumpQuest(s, 'login', 1);
}
/** tăng tiến trình mọi nhiệm vụ loại `kind` thêm `n`, chặn ở target */
export function bumpQuest(s: HState, kind: QuestKind, n: number) {
  if (!(n > 0)) return;
  for (const q of QUEST_DEFS) {
    if (q.kind !== kind) continue;
    const row = (s.quests[q.id] ??= { progress: 0, claimed: false });
    row.progress = Math.min(q.target, row.progress + n);
  }
}

/** sự kiện còn hiệu lực tại `ms` */
export function eventActive(d: Pick<EventDef, 'enabled' | 'startsAt' | 'endsAt'>, ms: number): boolean {
  return d.enabled && d.startsAt <= ms && ms < d.endsAt;
}
/**
 * tăng tiến trình mọi mục tiêu sự kiện loại `kind` thêm `n`, chặn ở target.
 * s.events chỉ chứa sự kiện đang hiệu lực tại thời điểm giao dịch (store nạp theo `now`) nên không cần kiểm tra giờ ở đây.
 */
export function bumpEvents(s: HState, kind: EventKind, n: number) {
  if (!(n > 0)) return;
  for (const ev of s.events) {
    for (const o of ev.def.objectives) {
      if (o.kind !== kind) continue;
      const row = (ev.rows[o.id] ??= { progress: 0, claimed: false });
      row.progress = Math.min(o.target, row.progress + n);
    }
  }
}
/** số mục sự kiện nhận được ngay (đủ tiến trình, chưa nhận) trong các sự kiện còn hiệu lực tại `ms` */
export function eventsClaimable(s: Readonly<HState>, ms: number): number {
  let n = 0;
  for (const ev of s.events) {
    if (!eventActive(ev.def, ms)) continue;
    for (const o of ev.def.objectives) {
      const row = ev.rows[o.id];
      if (row && !row.claimed && row.progress >= o.target) n++;
    }
  }
  return n;
}
/** nhận `n` phần thưởng hạ boss bang đang chờ (store gọi một lần mỗi giao dịch, sau khi đã xoá hàng chờ) */
export function gainKillRewards(s: HState, n: number) {
  for (let i = 0; i < n; i++) gain(s, BOSS_KILL_REWARD);
}

/** trạng thái đấu trường để hiển thị (lượt hôm nay đã tính reset ngày; chưa có hàng → giá trị mặc định) */
export function arenaStateOf(s: Readonly<HState>, today: number): ArenaState {
  return {
    rating: s.arenaRating, tries: s.arenaDay === today ? s.arenaTries : ARENA_TRIES, defense: s.arenaDefense, wins: s.arenaWins, losses: s.arenaLosses,
  };
}

/** số cấp có thưởng lên cấp nhận được ngay (claimedUpTo+1 .. level), không âm */
export function levelClaimable(s: Readonly<Pick<HState, 'level' | 'levelClaimed'>>): number {
  return Math.max(0, Math.min(s.level, MAX_ACCOUNT_LEVEL) - s.levelClaimed);
}
/** đệm '' cho đội ngắn hơn SQUAD_SIZE (dữ liệu cũ 5 ô) — bản sao, không sửa gốc */
export function padSquad(q: readonly string[] | undefined): string[] {
  const out = [...(q ?? [])];
  while (out.length < SQUAD_SIZE) out.push('');
  return out;
}
/**
 * Đội `squadIdx` chỉ giữ các ô ĐANG MỞ (slot < slotsOpen(level, đã mua)); ô đóng → ''. LUÔN dùng hàm này khi biến đội thành đơn vị/lực chiến
 * (ải, Tháp, đấu trường tấn công + phòng thủ, boss bang, hồ sơ công khai). Dữ liệu lưu giữ nguyên, kể cả tướng đứng ô đóng (tài khoản cũ).
 */
export function openSlotIds(s: Readonly<HState>, squadIdx: number): string[] {
  const open = slotsOpen(s.level, s.slotsBought);
  return padSquad(s.squads[squadIdx]).map((id, slot) => (slot < open ? id : ''));
}

export function buildMe(s: Readonly<HState>, username: string, now: Date): MeResponse {
  const ms = now.getTime();
  const today = dayKey(ms);
  const stale = s.day !== today; // chưa mutate hôm nay: hiển thị như đã reset
  const shop: Record<string, number> = {};
  for (const it of SHOP_ITEMS) shop[it.id] = stale ? 0 : (s.shop[it.id] ?? 0);
  return {
    tower: { floor: s.towerFloor, tries: s.towerDay === today ? s.towerTries : TOWER_TRIES },
    quests: {
      day: today,
      list: QUEST_DEFS.map((q) => {
        const row = stale ? undefined : s.quests[q.id];
        // "đăng nhập" tính ngay khi xem hồ sơ hôm nay (được ghi ở thao tác đầu tiên trong ngày)
        return { id: q.id, progress: q.kind === 'login' ? q.target : (row?.progress ?? 0), claimed: row?.claimed ?? false };
      }),
      bonusClaimed: stale ? false : s.questBonus,
    },
    shop,
    arena: arenaStateOf(s, today),
    guildId: s.guildId,
    eventsClaimable: eventsClaimable(s, ms),
    newbieBadge: newbieBadge(newbieView(s, ms)),
    newbieDone: newbieDone(newbieView(s, ms)),
    levels: { level: s.level, claimedUpTo: s.levelClaimed, slotsBought: s.slotsBought },
    levelBadge: levelClaimable(s),
    achBadge: achBadge(achList(s)),
    profile: { id: s.accountId, username, level: s.level, xp: s.xp, stamina: staminaNow(s.stamina, s.staminaAt, ms) },
    wallet: { ...s.wallet },
    heroes: Object.values(s.heroes).map((h) => ({ ...h })),
    gear: [...s.gear].sort((a, b) => a.uid - b.uid).map((g) => ({ ...g })),
    squads: s.squads.map((q) => padSquad(q)),
    activeSquad: s.activeSquad,
    pity: structuredClone(s.pity),
    progress: Object.values(s.progress).map((p) => ({ ...p })),
    afk: afkOf(s, ms),
    now: ms,
  };
}

/* ------------------------------ TIỀN / THỂ LỰC ------------------------------ */
export function gain(s: HState, g: Partial<Wallet>) {
  for (const k of WALLET_KEYS) if (g[k]) s.wallet[k] = Math.min(MONEY_CAP, s.wallet[k] + (g[k] as number));
}
/** trừ tiền; thiếu → ném lỗi, không trừ gì */
export function spend(s: HState, cost: Partial<Wallet>) {
  for (const k of WALLET_KEYS) if ((cost[k] ?? 0) > s.wallet[k]) throw new StoreError(`Không đủ ${WALLET_NAME[k]}`, 400);
  for (const k of WALLET_KEYS) if (cost[k]) s.wallet[k] -= cost[k] as number;
}
/** an toàn cuối giao dịch: ví không bao giờ âm */
export function assertWallet(s: Readonly<HState>) {
  for (const k of WALLET_KEYS) if (!Number.isInteger(s.wallet[k]) || s.wallet[k] < 0) throw new StoreError('Số dư không hợp lệ', 500);
}
/** chênh lệch ví → dòng ledger (null nếu không đổi) */
export function ledgerOf(before: Readonly<Wallet>, after: Readonly<Wallet>, kind: string): LedgerRow | null {
  const delta: Partial<Wallet> = {};
  let any = false;
  for (const k of WALLET_KEYS) if (after[k] !== before[k]) (delta[k] = after[k] - before[k]), (any = true);
  return any ? { kind, delta } : null;
}

export function spendStamina(s: HState, nowMs: number, cost: number) {
  const cur = staminaNow(s.stamina, s.staminaAt, nowMs);
  if (cur < cost) throw new StoreError('Không đủ thể lực', 400);
  // đầy → mốc hồi bắt đầu từ bây giờ; chưa đầy → giữ phần lẻ của lần hồi hiện tại
  if (cur >= STAMINA_MAX) s.staminaAt = nowMs;
  else s.staminaAt += (cur - s.stamina) * STAMINA_REGEN_MS;
  s.stamina = cur - cost;
}

/** cộng thể lực (được vượt trần STAMINA_MAX; phần vượt không hồi thêm cũng không bị cắt — xem staminaNow) */
function addStamina(s: HState, nowMs: number, amount: number) {
  const cur = staminaNow(s.stamina, s.staminaAt, nowMs);
  if (cur < STAMINA_MAX) s.staminaAt += (cur - s.stamina) * STAMINA_REGEN_MS; // giữ phần lẻ của lần hồi hiện tại
  s.stamina = cur + amount;
  if (s.stamina >= STAMINA_MAX) s.staminaAt = nowMs;
}

export function addShards(h: OwnedHero, n: number) {
  h.shards = Math.min(SHARD_CAP, h.shards + n);
}
function ownedHero(s: HState, id: unknown): OwnedHero {
  const h = typeof id === 'string' ? s.heroes[id] : undefined;
  if (!h) throw new StoreError('Bạn chưa có tướng này', 400);
  return h;
}

/* ------------------------------ TRIỆU HỒI ------------------------------ */
export type SummonPulls = SummonRes['pulls'];
/** áp các lượt quay vào hồ sơ: tướng mới thêm vào, trùng → mảnh (dùng chung cho triệu hồi thường và lượt quay khởi đầu) */
export function applyPulls(s: HState, pulls: Pull[]): SummonPulls {
  return pulls.map((p) => {
    const own = s.heroes[p.heroId];
    if (own) {
      const shards = DUPE_SHARDS[p.rarity];
      addShards(own, shards);
      return { ...p, isNew: false, shards };
    }
    s.heroes[p.heroId] = { id: p.heroId, level: 1, star: 1, shards: 0 };
    return { ...p, isNew: true, shards: 0 };
  });
}
export function opSummon(s: HState, bannerId: string, count: 1 | 10, pay: 'tickets' | 'gems', rand: RandInt): SummonPulls {
  const banner = BANNER_BY_ID[bannerId];
  if (!banner) throw new StoreError('Banner không tồn tại', 404);
  spend(s, { [pay]: (count === 10 ? SUMMON10_COST : SUMMON_COST)[pay] });
  const r = summon(s.pity[banner.id] ?? NEW_PITY, banner, count, rand);
  s.pity[banner.id] = r.state;
  s.newbie.pullsTotal += count; // mốc Tân thủ 'pulls'
  bumpQuest(s, 'summon', count);
  bumpEvents(s, 'summon', count);
  return applyPulls(s, r.pulls);
}

/* ------------------------------ NÂNG CẤP ------------------------------ */
/** nâng tối đa `times` cấp; dừng êm khi hết tiền hoặc chạm trần. Trả số cấp đã nâng (≥1, nếu không đủ cả cấp đầu thì báo lỗi). */
export function opLevelUp(s: HState, heroId: unknown, times = 1): number {
  const h = ownedHero(s, heroId);
  if (!Number.isInteger(times) || times < 1 || times > MAX_LEVEL) throw new StoreError('Số cấp không hợp lệ', 400);
  if (h.level >= MAX_LEVEL || h.level >= levelCapOf(h.star)) throw new StoreError('Tướng đã đạt cấp tối đa của sao hiện tại — hãy lên sao', 400);
  let gained = 0;
  while (gained < times && h.level < MAX_LEVEL && h.level < levelCapOf(h.star)) {
    const c = levelUpCost(h.level);
    if (gained > 0 && (c.gold > s.wallet.gold || c.exp > s.wallet.exp)) break;
    spend(s, { gold: c.gold, exp: c.exp }); // cấp đầu không đủ tiền thì ném lỗi như cũ
    h.level += 1;
    gained++;
  }
  bumpQuest(s, 'levelup', gained);
  bumpEvents(s, 'levelup', gained);
  return gained;
}
export function opStarUp(s: HState, heroId: unknown) {
  const h = ownedHero(s, heroId);
  const need = h.star >= MAX_STAR ? null : starUpCost(h.star);
  if (need === null) throw new StoreError('Tướng đã đạt sao tối đa', 400);
  if (h.shards < need) throw new StoreError(`Cần ${need} mảnh tướng để lên sao`, 400);
  h.shards -= need;
  h.star += 1;
}

/* ------------------------------ ĐỘI HÌNH ------------------------------ */
export function opSetSquad(s: HState, idx: number, slots: string[], active: boolean) {
  if (!Number.isInteger(idx) || idx < 0 || idx >= SQUAD_COUNT) throw new StoreError('Đội không hợp lệ', 400);
  if (idx >= squadsOpen(s.level)) throw new StoreError('Đội hình chưa mở', 400);
  if (slots.length !== SQUAD_SIZE) throw new StoreError(`Đội hình gồm ${SQUAD_SIZE} ô`, 400);
  const open = slotsOpen(s.level, s.slotsBought);
  for (let i = open; i < SQUAD_SIZE; i++) if (slots[i]) throw new StoreError('Ô đội hình chưa mở', 400);
  const seen = new Set<string>();
  for (const id of slots) {
    if (!id) continue;
    if (!s.heroes[id]) throw new StoreError('Đội hình có tướng bạn chưa sở hữu', 400);
    if (seen.has(id)) throw new StoreError('Một tướng chỉ đứng được một ô', 400);
    seen.add(id);
  }
  if (active && seen.size === 0) throw new StoreError('Đội đang dùng phải có ít nhất một tướng', 400);
  s.squads[idx] = [...slots];
  if (active) s.activeSquad = idx;
}

/* ------------------------------ ẢI ------------------------------ */
export function isUnlocked(s: Readonly<HState>, stage: StageDef): boolean {
  return stage.index === 0 || (s.progress[STAGES[stage.index - 1].id]?.stars ?? 0) > 0;
}
function stageOrThrow(id: unknown): StageDef {
  const st = typeof id === 'string' ? stageOf(id) : undefined;
  if (!st) throw new StoreError('Ải không tồn tại', 404);
  return st;
}
/** cộng EXP tài khoản, trả true nếu lên cấp */
function addAccountXp(s: HState, xp: number): boolean {
  if (s.level >= MAX_ACCOUNT_LEVEL) return false;
  s.xp += xp;
  let up = false;
  while (s.level < MAX_ACCOUNT_LEVEL && s.xp >= accountXpToNext(s.level)) {
    s.xp -= accountXpToNext(s.level);
    s.level += 1;
    up = true;
  }
  if (s.level >= MAX_ACCOUNT_LEVEL) s.xp = 0;
  return up;
}
function progressOf(s: HState, stage: string): StageProgress {
  return (s.progress[stage] ??= { stage, stars: 0, clears: 0 });
}

/** dựng đội ra trận từ DB (tướng + trang bị đang mặc), bỏ qua mọi chỉ số client; dùng chung cho ải và Tháp */
function liveUnits(s: Readonly<HState>, squad: readonly string[]): UnitInit[] {
  const out: UnitInit[] = [];
  squad.forEach((id, slot) => {
    if (id && s.heroes[id]) out.push(heroUnit(s.heroes[id], slot, sumGear(s.gear.filter((g) => g.hero === id))));
  });
  return out;
}
/** đơn vị từ danh sách id ô ĐÃ lọc ô mở (openSlotIds) — dùng cho hồ sơ công khai */
export const squadUnitsOf = (s: Readonly<HState>, ids: readonly string[]): UnitInit[] => liveUnits(s, ids);
export function squadUnits(s: Readonly<HState>, squadIdx: number): UnitInit[] {
  if (!s.squads[squadIdx]) throw new StoreError('Đội không hợp lệ', 400);
  const player = liveUnits(s, openSlotIds(s, squadIdx));
  if (player.length === 0) throw new StoreError('Đội hình đang trống', 400);
  return player;
}

export type BattleOutcome = Omit<BattleRes, 'me'>;
/**
 * Chấm một trận: dựng đội từ DB (bỏ qua mọi chỉ số client), chạy lại cả trận bằng simulate() với đúng seed server đã cấp.
 * Thưởng chỉ phát khi thắng; sao chỉ tăng, không giảm.
 */
export function opBattle(s: HState, stageId: unknown, squadIdx: number, seed: number, inputs: BattleInput[], auto: boolean, rand: GearRand = () => 0): BattleOutcome {
  const stage = stageOrThrow(stageId);
  if (!isUnlocked(s, stage)) throw new StoreError('Ải chưa mở — hãy qua ải trước đó', 403);
  const player = squadUnits(s, squadIdx);

  const result = simulate(stageSetup(stage, player, seed), inputs, auto);
  const stars = starsOf(result, stage);
  const prog = progressOf(s, stage.id);
  const first = result.win && prog.stars === 0;
  const reward = { gold: 0, exp: 0, xp: 0, gems: 0, firstClear: first };
  let levelUp = false;
  let drops: string[] = [];
  if (result.win) {
    reward.gold = stage.reward.gold;
    reward.exp = stage.reward.exp;
    reward.xp = stage.reward.xp;
    reward.gems = first ? stage.reward.gems : 0;
    gain(s, reward);
    levelUp = addAccountXp(s, reward.xp);
    prog.stars = Math.max(prog.stars, stars);
    prog.clears += 1;
    bumpQuest(s, 'win', 1);
    bumpEvents(s, 'win', 1);
    drops = addDrops(s, rollGearDrops(stage.chapter, stage.boss, rand));
  }
  s.runs.push({ stage: stage.id, win: result.win, stars, ticks: result.ticks });
  return { win: result.win, stars, reward, levelUp, drops };
}

export function opSweep(s: HState, nowMs: number, stageId: unknown, times: number, rand: GearRand = () => 0) {
  const stage = stageOrThrow(stageId);
  const prog = s.progress[stage.id];
  if (!prog || prog.stars < 3) throw new StoreError('Chỉ quét được ải đã đạt 3 sao', 400);
  if (!Number.isInteger(times) || times < 1 || times > MAX_SWEEP) throw new StoreError(`Số lần quét từ 1 đến ${MAX_SWEEP}`, 400);
  spendStamina(s, nowMs, SWEEP_COST * times);
  const reward = { gold: stage.reward.gold * times, exp: stage.reward.exp * times, xp: stage.reward.xp * times };
  gain(s, reward);
  addAccountXp(s, reward.xp);
  prog.clears += times;
  bumpQuest(s, 'win', times);
  bumpEvents(s, 'win', times);
  const drops: string[] = [];
  for (let i = 0; i < times; i++) drops.push(...addDrops(s, rollGearDrops(stage.chapter, stage.boss, rand)));
  return { reward, drops };
}

/* ------------------------------ THÁP ------------------------------ */
export type TowerOutcome = Omit<TowerBattleRes, 'me'>;
/** đánh tầng kế tiếp; tốn 1 lượt dù thắng hay thua. Seed đã được api kiểm tra + huỷ (cùng cơ chế /battle). */
export function opTowerBattle(s: HState, squadIdx: number, seed: number, inputs: BattleInput[], auto: boolean, rand: GearRand = () => 0): TowerOutcome {
  const floor = s.towerFloor + 1;
  if (floor > TOWER_MAX_FLOOR) throw new StoreError('Đã chinh phục hết tháp', 400);
  if (s.towerTries < 1) throw new StoreError('Hết lượt thử Tháp hôm nay', 400);
  const stage = towerStage(floor);
  const player = squadUnits(s, squadIdx);
  const result = simulate(stageSetup(stage, player, seed), inputs, auto);
  s.towerTries -= 1;
  bumpQuest(s, 'tower', 1);
  bumpEvents(s, 'tower', 1);
  const reward = { gold: 0, exp: 0, xp: 0, gems: 0, stones: 0 };
  let levelUp = false;
  const drops: string[] = [];
  if (result.win) {
    const r = towerReward(floor);
    reward.gold = r.gold;
    reward.exp = r.exp;
    reward.xp = r.xp;
    reward.gems = r.gems;
    reward.stones = r.stones;
    gain(s, reward);
    levelUp = addAccountXp(s, r.xp);
    s.towerFloor = floor;
    for (let i = 0; i < r.gearRolls; i++) drops.push(...addDrops(s, rollGearDrops(stage.chapter, stage.boss, rand)));
  }
  s.runs.push({ stage: stage.id, win: result.win, stars: 0, ticks: result.ticks });
  return { win: result.win, floor, reward, drops, levelUp };
}

/* ------------------------------ ĐẤU TRƯỜNG ------------------------------ */
export const BOT_COUNT = 100;
/**
 * BOT DETERMINISTIC: bot `n` (0..BOT_COUNT-1) chỉ phụ thuộc (n, điểm của NGƯỜI XEM). Đội = botSquad(n, điểm người xem),
 * điểm bot = max(0, điểm người xem + botOffset(n)). Danh sách (GET arena) và trận (arena-battle) cùng dùng botTarget()
 * với điểm hiện tại của người tấn công nên "thấy gì đánh nấy" miễn là điểm chưa đổi giữa hai lần (đổi điểm → client tải lại danh sách).
 */
export const botOffset = (n: number) => ((n * 37 + 11) % 201) - 100;
export interface ArenaTarget {
  opp: ArenaOpponent;
  units: UnitInit[];
}
export const powerOfUnits = (units: readonly UnitInit[]) => units.reduce((a, u) => a + powerOf(u.stats), 0);
/** hiển thị theo ô (SQUAD_SIZE phần tử, '' = trống) */
function slotView(units: readonly UnitInit[], level: (key: string) => { level: number; star: number }): ArenaOpponent['heroes'] {
  const out: ArenaOpponent['heroes'] = Array.from({ length: SQUAD_SIZE }, () => ({ id: '', level: 0, star: 0 }));
  for (const u of units) if (u.slot >= 0 && u.slot < SQUAD_SIZE) out[u.slot] = { id: u.key, ...level(u.key) };
  return out;
}
export function botTarget(n: number, myRating: number): ArenaTarget {
  const squad = botSquad(n, myRating);
  const units = squad.map((h, i) => heroUnit(h, i));
  const by = new Map(squad.map((h) => [h.id, h]));
  return {
    opp: {
      id: `bot:${n}`, name: BOT_NAMES[n % BOT_NAMES.length], rating: Math.max(0, myRating + botOffset(n)), power: powerOfUnits(units),
      heroes: slotView(units, (k) => ({ level: by.get(k)!.level, star: by.get(k)!.star })), bot: true,
    },
    units,
  };
}
/** đội phòng thủ SỐNG của một tài khoản (cấp/sao/trang bị hiện tại); null nếu chưa có hàng đấu trường hoặc đội rỗng */
export function defenseTarget(s: Readonly<HState>, username: string): ArenaTarget | null {
  if (!s.arenaOn) return null;
  const units = liveUnits(s, openSlotIds(s, s.arenaDefense)); // ô ĐANG MỞ của CHÍNH người phòng thủ
  if (units.length === 0) return null;
  return {
    opp: {
      id: String(s.accountId), name: username, rating: s.arenaRating, power: powerOfUnits(units),
      heroes: slotView(units, (k) => ({ level: s.heroes[k].level, star: s.heroes[k].star })), bot: false,
    },
    units,
  };
}
export function opArenaDefense(s: HState, squadIdx: unknown) {
  if (typeof squadIdx !== 'number' || !Number.isInteger(squadIdx) || squadIdx < 0 || squadIdx >= SQUAD_COUNT) throw new StoreError('Đội không hợp lệ', 400);
  if (liveUnits(s, openSlotIds(s, squadIdx)).length === 0) throw new StoreError('Đội phòng thủ phải có ít nhất một tướng', 400);
  s.arenaOn = true;
  s.arenaDefense = squadIdx;
}
export type ArenaOutcome = Omit<ArenaBattleRes, 'me'>;
/**
 * Một trận đấu trường (seed đã được api kiểm tra + huỷ). Tốn 1 lượt dù thắng/thua (hết giờ = thua). Chỉ ĐIỂM CỦA NGƯỜI TẤN CÔNG đổi;
 * điểm đội phòng thủ giữ nguyên. Không tính nhiệm vụ. `resolve` dựng đối thủ từ điểm hiện tại của người tấn công (bot) hoặc trả đối thủ thật đã nạp.
 */
export function opArenaBattle(s: HState, squadIdx: number, seed: number, inputs: BattleInput[], auto: boolean, resolve: (myRating: number) => ArenaTarget): ArenaOutcome {
  if (s.arenaTries < 1) throw new StoreError('Hết lượt đấu trường hôm nay', 400);
  const player = squadUnits(s, squadIdx);
  const target = resolve(s.arenaRating);
  const result = simulate(arenaSetup(player, target.units, seed), inputs, auto);
  const win = result.win;
  s.arenaOn = true;
  s.arenaTries -= 1;
  const before = s.arenaRating;
  s.arenaRating = Math.max(0, before + ratingDelta(win, before, target.opp.rating));
  if (win) {
    s.arenaWins += 1;
    bumpEvents(s, 'arena', 1);
  }
  else s.arenaLosses += 1;
  const reward = arenaReward(win);
  gain(s, reward);
  s.runs.push({ stage: 'arena', win, stars: 0, ticks: result.ticks });
  return { win, ratingDelta: s.arenaRating - before, rating: s.arenaRating, reward, opponent: target.opp };
}

/* ------------------------------ NHIỆM VỤ ------------------------------ */
/** nhận thưởng một nhiệm vụ (hoặc 'bonus' khi đã nhận hết) */
export function opQuestClaim(s: HState, id: unknown): QuestClaimRes['reward'] {
  if (id === 'bonus') {
    if (s.questBonus) throw new StoreError('Đã nhận thưởng thêm rồi', 400);
    if (!QUEST_DEFS.every((q) => s.quests[q.id]?.claimed)) throw new StoreError('Hãy nhận hết nhiệm vụ trong ngày trước', 400);
    s.questBonus = true;
    gain(s, QUEST_BONUS);
    return { ...QUEST_BONUS };
  }
  const def = typeof id === 'string' ? QUEST_BY_ID[id] : undefined;
  if (!def) throw new StoreError('Nhiệm vụ không tồn tại', 404);
  const row = s.quests[def.id];
  if (!row || row.progress < def.target) throw new StoreError('Nhiệm vụ chưa hoàn thành', 400);
  if (row.claimed) throw new StoreError('Đã nhận thưởng nhiệm vụ này rồi', 400);
  row.claimed = true;
  gain(s, def.reward);
  return { ...def.reward };
}

/* ------------------------------ CỬA HÀNG ------------------------------ */
export type ShopOutcome = Omit<ShopBuyRes, 'me'>;
/** mua `times` lần; vượt giới hạn ngày hoặc thiếu tiền thì mua được bao nhiêu hay bấy nhiêu, lỗi chỉ khi được 0 lần */
export function opShopBuy(s: HState, nowMs: number, itemId: unknown, times: number, heroId: unknown, rand: GearRand = () => 0): ShopOutcome {
  const item = typeof itemId === 'string' ? SHOP_BY_ID[itemId] : undefined;
  if (!item) throw new StoreError('Mặt hàng không tồn tại', 404);
  if (!Number.isInteger(times) || times < 1) throw new StoreError('Số lần mua không hợp lệ', 400);
  const hero = item.give.kind === 'shards' ? ownedHero(s, heroId) : null;
  const left = item.limit - (s.shop[item.id] ?? 0);
  if (left < 1) throw new StoreError('Đã hết lượt mua hôm nay', 400);
  let n = Math.min(times, left);
  for (const k of WALLET_KEYS) {
    const c = item.cost[k] ?? 0;
    if (c > 0) n = Math.min(n, Math.floor(s.wallet[k] / c));
  }
  if (n < 1) {
    spend(s, item.cost); // thiếu tiền → ném đúng thông báo loại tiền thiếu
    throw new StoreError('Không đủ tiền', 400);
  }
  const total: Partial<Wallet> = {};
  for (const k of WALLET_KEYS) if (item.cost[k]) total[k] = (item.cost[k] as number) * n;
  spend(s, total);
  s.shop[item.id] = (s.shop[item.id] ?? 0) + n;
  const drops: string[] = [];
  const g = item.give;
  if (g.kind === 'wallet') {
    const give: Partial<Wallet> = {};
    for (const k of WALLET_KEYS) if (g.give[k]) give[k] = (g.give[k] as number) * n;
    gain(s, give);
  } else if (g.kind === 'stamina') addStamina(s, nowMs, g.amount * n);
  else if (g.kind === 'shards') addShards(hero!, g.amount * n);
  else for (let i = 0; i < n; i++) drops.push(...addDrops(s, rollGearDrops(g.chapter, false, rand).slice(0, 1))); // 1 món mỗi lần mua
  return { bought: n, drops };
}

export function opAfkClaim(s: HState, nowMs: number) {
  const reward = afkReward(highestIndex(s), nowMs - s.afkSince);
  gain(s, reward);
  s.afkSince = nowMs;
  return reward;
}

/** admin tặng tiền / tướng (tướng đã có → đổi thành mảnh như quay trùng) */
export function opGrant(s: HState, g: Partial<Wallet>, heroId?: string) {
  gain(s, g);
  if (heroId) {
    const def = HERO_BY_ID[heroId];
    if (!def) throw new StoreError('Không có tướng này', 400);
    const own = s.heroes[heroId];
    if (own) addShards(own, DUPE_SHARDS[def.rarity]);
    else s.heroes[heroId] = { id: heroId, level: 1, star: 1, shards: 0 };
  }
}

/* ------------------------------ TRANG BỊ ------------------------------ */
/**
 * Thêm món rớt vào kho (qua s.newGear, uid do store cấp). Kho đầy (GEAR_CAP, tính cả món chờ cấp uid) thì phần dư
 * được đổi âm thầm thành đá cường hoá = salvageStones(phẩm, 0). Trả về CHỈ những món thực sự vào kho.
 */
export function addDrops(s: HState, ids: string[]): string[] {
  const added: string[] = [];
  for (const id of ids) {
    if (s.gear.length + s.newGear.length < GEAR_CAP) {
      s.newGear.push(id);
      added.push(id);
    } else gain(s, { stones: salvageStones(gearDefOf(id).rarity, 0) });
  }
  return added;
}
function ownedGear(s: HState, uid: unknown): GearInst {
  const g = typeof uid === 'number' ? s.gear.find((x) => x.uid === uid) : undefined;
  if (!g) throw new StoreError('Không tìm thấy trang bị', 404);
  return g;
}
/** mặc món cho tướng: mỗi tướng một món mỗi ô; món cũ cùng ô về kho, món đang ở tướng khác thì chuyển sang */
export function opGearEquip(s: HState, uid: unknown, heroId: unknown) {
  const g = ownedGear(s, uid);
  const h = ownedHero(s, heroId);
  const slot = GEAR_BY_ID[g.def]?.slot;
  for (const o of s.gear) if (o !== g && o.hero === h.id && GEAR_BY_ID[o.def]?.slot === slot) o.hero = null;
  g.hero = h.id;
}
export function opGearUnequip(s: HState, uid: unknown) {
  ownedGear(s, uid).hero = null;
}
/** cường hoá tối đa `times` cấp bằng vàng + đá; dừng êm khi hết tiền (lỗi nếu không đủ cho cấp đầu). Trả số cấp đã nâng. */
export function opGearUpgrade(s: HState, uid: unknown, times = 1): number {
  const g = ownedGear(s, uid);
  if (!Number.isInteger(times) || times < 1 || times > MAX_GEAR_LEVEL) throw new StoreError('Số cấp không hợp lệ', 400);
  if (g.level >= MAX_GEAR_LEVEL) throw new StoreError('Trang bị đã đạt cấp tối đa', 400);
  const rarity = gearDefOf(g.def).rarity;
  let gained = 0;
  while (gained < times && g.level < MAX_GEAR_LEVEL) {
    const c = enhanceCost(rarity, g.level)!;
    if (gained > 0 && (c.gold > s.wallet.gold || c.stones > s.wallet.stones)) break;
    spend(s, c); // cấp đầu không đủ tiền thì ném lỗi
    g.level += 1;
    gained++;
  }
  bumpQuest(s, 'gear', gained);
  bumpEvents(s, 'gear', gained);
  return gained;
}
/** phân rã các món trong kho (không đang mặc) → đá cường hoá. Trả tổng đá nhận được. */
export function opGearSalvage(s: HState, uids: unknown): number {
  if (!Array.isArray(uids) || uids.length < 1 || uids.length > 50) throw new StoreError('Chọn từ 1 đến 50 món', 400);
  if (new Set(uids).size !== uids.length) throw new StoreError('Danh sách có món trùng', 400);
  let stones = 0;
  for (const u of uids) {
    const g = ownedGear(s, u);
    if (g.hero) throw new StoreError('Không phân rã được trang bị đang mặc', 400);
    stones += salvageStones(gearDefOf(g.def).rarity, g.level);
  }
  const drop = new Set<number>(uids);
  s.gear = s.gear.filter((g) => !drop.has(g.uid));
  gain(s, { stones });
  return stones;
}

/** ải cao nhất đã qua + sao ở ải đó (cho bảng xếp hạng bản RAM) */
export function bestStage(s: Readonly<HState>): { stage: number; stars: number } | null {
  let best: { stage: number; stars: number } | null = null;
  for (const p of Object.values(s.progress)) {
    if (p.stars <= 0) continue;
    const st = stageOf(p.stage);
    if (st && (!best || st.index > best.stage)) best = { stage: st.index, stars: p.stars };
  }
  return best;
}
