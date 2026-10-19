// Bang hội: lập/tham gia, quyên góp, điểm danh, cấp bang, boss bang (chung kho máu, đánh bất đồng bộ), chat bang.
// Server là trọng tài: trận boss chạy lại bằng simulate() từ seed; sát thương = tổng sát thương gây lên boss trong cả trận.
import type { BattleEvent, BattleSetup, UnitInit } from './battle.js';
import { dayKey } from './quests.js';
import type { Wallet } from './types.js';

export const GUILD_MAX_MEMBERS = 30;
export const GUILD_MAX_LEVEL = 10;
export const GUILD_NAME_MIN = 3;
export const GUILD_NAME_MAX = 16;
export const GUILD_NOTICE_MAX = 120;
export const GUILD_CREATE_COST: Partial<Wallet> = { gold: 5000 };
/** cấp tài khoản tối thiểu để lập/vào bang */
export const GUILD_MIN_ACCOUNT_LEVEL = 5;
/** sau khi rời bang phải chờ trước khi vào bang khác (ms) */
export const GUILD_REJOIN_COOLDOWN_MS = 6 * 3_600_000;

/** quyên góp: tốn tiền, cộng EXP bang + điểm cống hiến cá nhân; giới hạn lượt mỗi ngày */
export const GUILD_DONATIONS = [
  { id: 'd1', cost: { gold: 2000 } as Partial<Wallet>, gexp: 20, contribution: 20, reward: { gold: 0, tickets: 0 } },
  { id: 'd2', cost: { gems: 50 } as Partial<Wallet>, gexp: 60, contribution: 60, reward: { gold: 0, tickets: 0 } },
] as const;
export const GUILD_DONATE_PER_DAY = 3;

export function guildXpToNext(level: number): number {
  return 300 + 200 * level;
}
/** thưởng điểm danh bang mỗi ngày theo cấp bang */
export function guildCheckinReward(level: number): Partial<Wallet> {
  return { gold: 500 + 250 * level, stones: level >= 3 ? 2 + level : 0, tickets: level >= 5 ? 1 : 0 };
}

/* ------------------------------ BOSS BANG ------------------------------ */
export const BOSS_ATTACKS_PER_DAY = 3;
/** chu kỳ 7 ngày (theo dayKey): hết chu kỳ boss hồi đầy máu, cấp boss theo cấp bang */
export const BOSS_CYCLE_DAYS = 7;
export function bossCycle(nowMs: number): number {
  return Math.floor(dayKey(nowMs) / BOSS_CYCLE_DAYS);
}
export const BOSS_NAMES = ['Khỉ Chúa Rừng Sâu', 'Ma Vương Núi Đá', 'Hải Quái Sông Xanh'];
export function bossName(cycle: number): string {
  return BOSS_NAMES[cycle % BOSS_NAMES.length];
}
/** tổng máu boss của cả bang trong một chu kỳ */
export function bossHpMax(guildLevel: number): number {
  // đã chỉnh lại cho engine có vị trí/tốc đánh (trận dài tới 180 giây => sát thương mỗi lượt tăng ~1.7x): MỘT người cấp 60 mất ~6 ngày
  return 5_000_000 * (1 + 0.6 * (guildLevel - 1));
}
/** cấp tương đương của boss dùng cho chỉ số (chặn 60 như tướng) */
export function bossLevel(guildLevel: number): number {
  return Math.min(60, 20 + guildLevel * 4);
}
/** thưởng mỗi lượt đánh theo sát thương gây ra */
export function bossAttackReward(damage: number): Partial<Wallet> {
  return { gold: 300 + Math.min(3000, Math.floor(damage / 100)), stones: damage >= 20_000 ? 2 : 0 };
}
/** thưởng cả bang khi hạ boss: phát cho MỌI thành viên đã đánh ít nhất 1 lượt trong chu kỳ */
export const BOSS_KILL_REWARD: Partial<Wallet> = { gems: 100, tickets: 2 };

/** dựng trận đánh boss: boss một mình ở ô 0, chỉ số lớn, uid boss cố định để tính sát thương */
export const BOSS_UID = 10;
export function bossSetup(guildLevel: number, cycle: number, seed: number, player: UnitInit[]): BattleSetup {
  const lv = bossLevel(guildLevel);
  const boss: UnitInit = {
    key: 'mk_chua', name: bossName(cycle), side: 1, slot: 0,
    element: (['forest', 'water', 'earth'] as const)[cycle % 3], role: 'tank',
    // hp đủ lớn để không chết trong một trận: tổng máu bang nằm ở server, không phải trong trận
    stats: { hp: 50_000_000, atk: 60 + lv * 9, def: 40 + lv * 2, spd: 90 },
    skills: ['m_basic', 'm_a2', 'm_boss_u'], boss: true,
  };
  return { seed, player, waves: [[boss]] };
}
/** sát thương người chơi gây lên boss trong cả trận (cộng sự kiện dmg có tg = BOSS_UID) */
export function bossDamage(events: readonly BattleEvent[]): number {
  let d = 0;
  for (const e of events) if (e.k === 'dmg' && e.tg === BOSS_UID) d += e.n;
  return d;
}

/* ------------------------------ KIỂU DỮ LIỆU ------------------------------ */
export type GuildRole = 'leader' | 'member';
export interface GuildBrief {
  id: number;
  name: string;
  level: number;
  members: number;
  max: number;
  leader: string;
  notice: string;
}
export interface GuildMember {
  /** id tài khoản */
  id: number;
  username: string;
  role: GuildRole;
  /** điểm cống hiến tích luỹ */
  contribution: number;
  /** sát thương boss tích luỹ trong chu kỳ hiện tại */
  bossDamage: number;
  joinedAt: number;
}
export interface GuildBossState {
  cycle: number;
  name: string;
  hp: number;
  hpMax: number;
  level: number;
  killed: boolean;
}
export interface GuildMine {
  role: GuildRole;
  /** số lần đã quyên góp hôm nay */
  donated: number;
  checkedIn: boolean;
  /** lượt đánh boss còn lại hôm nay */
  bossTries: number;
}
export interface GuildInfo {
  guild: GuildBrief & { exp: number; expNext: number };
  members: GuildMember[];
  mine: GuildMine;
  boss: GuildBossState;
}
export interface GuildChatMsg {
  id: number;
  username: string;
  text: string;
  at: number;
}
export const GUILD_CHAT_MAX = 200;
export const GUILD_CHAT_KEEP = 100;
