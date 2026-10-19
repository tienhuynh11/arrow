// Cấp tài khoản: thưởng lên cấp, mua mở sớm ô đội hình; Thành tựu (tiến trình TÍNH từ HState, nhận từng bậc); Hồ sơ công khai.
// Hàm THUẦN trên HState (store gọi trong giao dịch có khoá) — mô hình như Tân thủ (newbie.ts).
// Tài khoản cũ: levelClaimed = 1 nên nhận được thưởng hồi tố cho mọi cấp 2..level hiện tại (chủ ý).

import type { AchievementClaimRes, LevelClaimRes, PublicProfile } from '../../../shared/heroes/api.js';
import { ACHIEVEMENTS, ACH_BY_ID, type AchDef, type AchKind, type AchState } from '../../../shared/heroes/achievements.js';
import { MAX_ACCOUNT_LEVEL, SQUAD_SIZE } from '../../../shared/heroes/config.js';
import { GEAR_BY_ID } from '../../../shared/heroes/gear.js';
import { HERO_BY_ID } from '../../../shared/heroes/heroes.js';
import { SLOT_GEMS, SLOT_LEVEL, levelReward, slotsOpen } from '../../../shared/heroes/progression.js';
import { BOSS_STAGE_NS, stageOf } from '../../../shared/heroes/stages.js';
import type { Wallet } from '../../../shared/heroes/types.js';
import { payReward } from './events.js';
import { highestIndex, openSlotIds, powerOfUnits, spend, squadUnitsOf } from './rules.js';
import { StoreError, type HState } from './db/store.js';

/* ------------------------------ MỞ Ô ĐỘI HÌNH SỚM ------------------------------ */
/** mua mở ô `slot` bằng kim cương: chỉ đúng ô kế tiếp (bằng số ô đang mở) và chưa đủ cấp. Giá SLOT_GEMS[slot]. */
export function opSlotUnlock(s: HState, slot: unknown) {
  if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= SQUAD_SIZE) throw new StoreError('Ô đội hình không hợp lệ', 400);
  const open = slotsOpen(s.level, s.slotsBought);
  if (slot < open) {
    throw new StoreError(s.level >= SLOT_LEVEL[slot] ? 'Đã đủ cấp, ô tự mở' : 'Ô này đã mở rồi', 400);
  }
  if (slot > open) throw new StoreError('Phải mở ô theo thứ tự', 400);
  // slot === open ⇒ chưa đủ cấp (slotsByLevel đã tính mọi ô đủ cấp)
  spend(s, { gems: SLOT_GEMS[slot] });
  s.slotsBought = slot + 1;
}

/* ------------------------------ THƯỞNG LÊN CẤP ------------------------------ */
/** các cấp chưa nhận thưởng: levelClaimed+1 .. min(level, MAX) */
export function claimableLevels(s: Readonly<Pick<HState, 'level' | 'levelClaimed'>>): number[] {
  const out: number[] = [];
  for (let l = s.levelClaimed + 1; l <= Math.min(s.level, MAX_ACCOUNT_LEVEL); l++) out.push(l);
  return out;
}
export function opLevelClaim(s: HState): Omit<LevelClaimRes, 'me'> {
  const levels = claimableLevels(s);
  if (levels.length === 0) throw new StoreError('Chưa có thưởng lên cấp để nhận', 400);
  const total: Partial<Wallet> = {};
  for (const l of levels) {
    const r = levelReward(l);
    for (const k of Object.keys(r) as (keyof Wallet)[]) total[k] = (total[k] ?? 0) + (r[k] ?? 0);
  }
  s.levelClaimed = levels[levels.length - 1];
  return { levels, reward: payReward(s, { wallet: total }).wallet }; // phần thực nhận (đã chặn MONEY_CAP)
}

/* ------------------------------ THÀNH TỰU ------------------------------ */
/** tiến trình hiện tại của một loại thành tựu, tính từ hồ sơ */
export function achProgress(s: Readonly<HState>, kind: AchKind): number {
  const heroes = Object.values(s.heroes);
  const rar = (id: string) => HERO_BY_ID[id]?.rarity;
  switch (kind) {
    case 'stage': return highestIndex(s) + 1;
    case 'stars': return Object.values(s.progress).reduce((a, p) => a + Math.max(0, p.stars), 0);
    case 'bossClear': return Object.values(s.progress).filter((p) => p.stars > 0 && BOSS_STAGE_NS.includes(stageOf(p.stage)?.n ?? 0)).length;
    case 'heroCount': return heroes.length;
    case 'urCount': return heroes.filter((h) => rar(h.id) === 'UR').length;
    case 'ssrCount': return heroes.filter((h) => rar(h.id) === 'SSR' || rar(h.id) === 'UR').length;
    case 'heroLevel': return heroes.reduce((m, h) => Math.max(m, h.level), 0);
    case 'heroStar': return heroes.reduce((m, h) => Math.max(m, h.star), 0);
    case 'level': return s.level;
    case 'gearCount': return s.gear.length;
    case 'gearUR': return s.gear.filter((g) => GEAR_BY_ID[g.def]?.rarity === 'UR').length;
    case 'gearMax': return s.gear.reduce((m, g) => Math.max(m, g.level), 0);
    case 'pulls': return s.newbie.pullsTotal;
    case 'tower': return s.towerFloor;
    case 'arenaWins': return s.arenaWins;
    case 'arenaRating': return s.arenaRating; // điểm HIỆN TẠI (chưa lưu điểm cao nhất mọi thời đại)
    case 'bossDamage': return 0; // giữ chỗ (chưa dùng)
    case 'guild': return s.guildId !== null ? 1 : 0;
    case 'loginDays': return s.newbie.loginClaimed;
  }
}
export function achList(s: Readonly<HState>): AchState[] {
  return ACHIEVEMENTS.map((d) => ({ id: d.id, progress: achProgress(s, d.kind), claimed: Math.min(d.tiers.length, s.ach[d.id] ?? 0) }));
}
/** nhận BẬC kế tiếp (chỉ số 0-based của bậc vừa nhận); không bao giờ trả hai lần */
export function opAchClaim(s: HState, id: unknown): Omit<AchievementClaimRes, 'me' | 'list'> {
  const def: AchDef | undefined = typeof id === 'string' && Object.hasOwn(ACH_BY_ID, id) ? ACH_BY_ID[id] : undefined;
  if (!def) throw new StoreError('Thành tựu không tồn tại', 400);
  const tier = s.ach[def.id] ?? 0;
  const t = def.tiers[tier];
  if (!t) throw new StoreError('Đã nhận hết các bậc thành tựu này', 400);
  if (achProgress(s, def.kind) < t.target) throw new StoreError('Thành tựu chưa đạt', 400);
  s.ach[def.id] = tier + 1;
  return { tier, reward: payReward(s, t.reward) };
}

/* ------------------------------ HỒ SƠ CÔNG KHAI ------------------------------ */
/** guildName do api tra (store chỉ cho id bang); KHÔNG đưa ví/kho đồ/tiến trình chi tiết ra ngoài */
export function publicProfile(s: Readonly<HState>, username: string, guildName: string | null): PublicProfile {
  const ids = openSlotIds(s, s.activeSquad);
  const units = squadUnitsOf(s, ids);
  return {
    username, level: s.level, power: powerOfUnits(units),
    squad: ids.map((id) => {
      const h = id ? s.heroes[id] : undefined;
      return h ? { id, level: h.level, star: h.star } : { id: '', level: 0, star: 0 };
    }),
    stage: highestIndex(s) + 1, tower: s.towerFloor, arenaRating: s.arenaRating, arenaWins: s.arenaWins,
    guild: guildName, heroCount: Object.keys(s.heroes).length,
    achDone: ACHIEVEMENTS.filter((d) => (s.ach[d.id] ?? 0) >= d.tiers.length).length,
  };
}
