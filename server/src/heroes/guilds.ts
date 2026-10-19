// Luật bang hội: hàm đồng bộ trên (HState, GuildCtx), ném StoreError để huỷ giao dịch. Store giữ khoá hồ sơ + hàng bang.

import type { BattleInput } from '../../../shared/heroes/battle.js';
import { simulate } from '../../../shared/heroes/battle.js';
import { dayKey } from '../../../shared/heroes/quests.js';
import {
  BOSS_ATTACKS_PER_DAY, BOSS_KILL_REWARD, GUILD_CREATE_COST, GUILD_DONATE_PER_DAY, GUILD_DONATIONS, GUILD_MAX_LEVEL, GUILD_MAX_MEMBERS,
  GUILD_MIN_ACCOUNT_LEVEL, GUILD_NAME_MAX, GUILD_NAME_MIN, GUILD_NOTICE_MAX, GUILD_REJOIN_COOLDOWN_MS, bossAttackReward, bossCycle,
  bossDamage, bossHpMax, bossLevel, bossName, bossSetup, guildCheckinReward, guildXpToNext,
  type GuildBossState, type GuildBrief, type GuildInfo,
} from '../../../shared/heroes/guild.js';
import type { Wallet } from '../../../shared/heroes/types.js';
import { bumpEvents, gain, spend, squadUnits } from './rules.js';
import { StoreError, type GuildCtx, type GuildMemberRow, type GuildRow, type HState } from './db/store.js';

/** exp bang cộng thêm cho mỗi lần điểm danh */
export const CHECKIN_GEXP = 5;

/* ------------------------------ TIỆN ÍCH ------------------------------ */
/** bỏ ký tự điều khiển / dấu phân dòng; ký tự thay thế UTF-16 lẻ → khoảng trắng (đảm bảo JSON + Postgres an toàn) */
export function cleanText(v: string): string {
  return v
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, ' ')
    .trim();
}
/** gập hoa/thường + dấu tiếng Việt để tìm kiếm */
export function foldName(v: string): string {
  return v.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
}
const NAME_RE = /^[\p{L}\p{M}\p{Nd}]+(?: [\p{L}\p{M}\p{Nd}]+)*$/u;
export function validGuildName(raw: unknown): string {
  if (typeof raw !== 'string') throw new StoreError('Tên bang không hợp lệ', 400);
  const name = raw.trim().normalize('NFC');
  if (name.length < GUILD_NAME_MIN || name.length > GUILD_NAME_MAX) throw new StoreError(`Tên bang từ ${GUILD_NAME_MIN} đến ${GUILD_NAME_MAX} ký tự`, 400);
  if (!NAME_RE.test(name)) throw new StoreError('Tên bang chỉ gồm chữ, số và khoảng trắng đơn giữa các từ', 400);
  return name;
}
export function validNotice(raw: unknown): string {
  if (typeof raw !== 'string') throw new StoreError('Thông báo không hợp lệ', 400);
  const n = cleanText(raw);
  if (n.length > GUILD_NOTICE_MAX) throw new StoreError(`Thông báo tối đa ${GUILD_NOTICE_MAX} ký tự`, 400);
  return n;
}

const memberOf = (g: Readonly<GuildCtx>, accountId: number) => g.members.find((m) => m.accountId === accountId) ?? null;
function mustMember(g: GuildCtx, accountId: number): { guild: GuildRow; me: GuildMemberRow } {
  const me = g.guild ? memberOf(g, accountId) : null;
  if (!g.guild || !me) throw new StoreError('Bạn chưa vào bang nào', 400);
  return { guild: g.guild, me };
}
function mustLeader(g: GuildCtx, accountId: number) {
  const r = mustMember(g, accountId);
  if (r.me.role !== 'leader') throw new StoreError('Chỉ bang chủ mới làm được việc này', 403);
  return r;
}
function newMember(accountId: number, guildId: number, role: 'leader' | 'member', nowMs: number): GuildMemberRow {
  return {
    accountId, guildId, role, contribution: 0, bossDamage: 0, joinedAt: nowMs,
    donatedDay: 0, donatedN: 0, checkinDay: 0, bossDay: 0, bossTriesUsed: 0,
  };
}
function checkEligible(s: Readonly<HState>, g: Readonly<GuildCtx>, nowMs: number) {
  if (s.level < GUILD_MIN_ACCOUNT_LEVEL) throw new StoreError(`Cần đạt cấp tài khoản ${GUILD_MIN_ACCOUNT_LEVEL} để vào bang`, 400);
  if (g.myGuildId !== null) throw new StoreError('Bạn đã ở trong một bang', 400);
  if (s.guildLeftAt > 0 && nowMs - s.guildLeftAt < GUILD_REJOIN_COOLDOWN_MS) {
    const min = Math.ceil((GUILD_REJOIN_COOLDOWN_MS - (nowMs - s.guildLeftAt)) / 60_000);
    throw new StoreError(`Vừa rời bang, hãy chờ thêm ${min} phút để vào bang khác`, 400);
  }
}

/** cộng exp bang, lên cấp liên tiếp; ở cấp tối đa phần dư bị bỏ */
export function addGuildExp(g: GuildRow, gexp: number) {
  g.exp += gexp;
  while (g.level < GUILD_MAX_LEVEL && g.exp >= guildXpToNext(g.level)) {
    g.exp -= guildXpToNext(g.level);
    g.level += 1;
  }
  if (g.level >= GUILD_MAX_LEVEL) g.exp = 0;
}

/* ------------------------------ BOSS: CHU KỲ ------------------------------ */
export const bossHpFor = (level: number) => Math.round(bossHpMax(level));
/** reset lười: sang chu kỳ mới → boss đầy máu theo cấp bang hiện tại, sát thương của mọi thành viên về 0. Trả true nếu có đổi. */
export function settleBoss(g: GuildRow, members: GuildMemberRow[], nowMs: number): boolean {
  const cycle = bossCycle(nowMs);
  if (g.bossCycle === cycle) return false;
  g.bossCycle = cycle;
  g.bossHpMax = bossHpFor(g.level);
  g.bossHp = g.bossHpMax;
  g.bossKilled = false;
  for (const m of members) m.bossDamage = 0;
  return true;
}
export function bossStateOf(g: Readonly<GuildRow>): GuildBossState {
  return { cycle: g.bossCycle, name: bossName(g.bossCycle), hp: g.bossHp, hpMax: g.bossHpMax, level: bossLevel(g.level), killed: g.bossKilled };
}
export const bossTriesLeft = (m: Readonly<GuildMemberRow>, today: number) => Math.max(0, BOSS_ATTACKS_PER_DAY - (m.bossDay === today ? m.bossTriesUsed : 0));

/* ------------------------------ HIỂN THỊ ------------------------------ */
export function briefOf(g: Readonly<GuildRow>, members: number, leaderName: string): GuildBrief {
  return { id: g.id, name: g.name, level: g.level, members, max: GUILD_MAX_MEMBERS, leader: leaderName, notice: g.notice };
}
/** GuildInfo của bang `ctx.guild` cho `accountId` (áp reset boss lười trên BẢN SAO, không ghi) */
export function guildInfoOf(ctx: Readonly<GuildCtx>, accountId: number, nowMs: number, nameOf: (id: number) => string): GuildInfo | null {
  if (!ctx.guild) return null;
  const g = structuredClone(ctx.guild);
  const members = structuredClone(ctx.members);
  const mine = members.find((m) => m.accountId === accountId);
  if (!mine) return null;
  settleBoss(g, members, nowMs);
  const today = dayKey(nowMs);
  return {
    guild: { ...briefOf(g, members.length, nameOf(g.leaderId)), exp: g.exp, expNext: guildXpToNext(g.level) },
    members: members
      .sort((a, b) => Number(b.role === 'leader') - Number(a.role === 'leader') || b.contribution - a.contribution || a.joinedAt - b.joinedAt || a.accountId - b.accountId)
      .map((m) => ({ id: m.accountId, username: nameOf(m.accountId), role: m.role, contribution: m.contribution, bossDamage: m.bossDamage, joinedAt: m.joinedAt })),
    mine: { role: mine.role, donated: mine.donatedDay === today ? mine.donatedN : 0, checkedIn: mine.checkinDay === today, bossTries: bossTriesLeft(mine, today) },
    boss: bossStateOf(g),
  };
}

/* ------------------------------ THAO TÁC ------------------------------ */
export function opGuildCreate(s: HState, g: GuildCtx, nowMs: number, nameRaw: unknown, noticeRaw?: unknown) {
  const name = validGuildName(nameRaw);
  const notice = noticeRaw === undefined ? '' : validNotice(noticeRaw);
  checkEligible(s, g, nowMs);
  spend(s, GUILD_CREATE_COST);
  const hp = bossHpFor(1);
  g.guild = { id: 0, name, level: 1, exp: 0, notice, leaderId: s.accountId, createdAt: nowMs, bossCycle: bossCycle(nowMs), bossHp: hp, bossHpMax: hp, bossKilled: false };
  g.members = [newMember(s.accountId, 0, 'leader', nowMs)];
}

export function opGuildJoin(s: HState, g: GuildCtx, nowMs: number) {
  if (!g.guild) throw new StoreError('Không tìm thấy bang', 404);
  checkEligible(s, g, nowMs);
  if (g.members.length >= GUILD_MAX_MEMBERS) throw new StoreError('Bang đã đủ thành viên', 409);
  settleBoss(g.guild, g.members, nowMs);
  g.members.push(newMember(s.accountId, g.guild.id, 'member', nowMs));
}

export function opGuildLeave(s: HState, g: GuildCtx, nowMs: number) {
  const { me } = mustMember(g, s.accountId);
  if (me.role === 'leader') {
    if (g.members.length > 1) throw new StoreError('Hãy chuyển quyền bang chủ trước khi rời bang', 400);
    g.deleted = true; // bang chỉ còn mình tôi → giải tán
  }
  g.members = g.members.filter((m) => m !== me);
  s.guildLeftAt = nowMs;
}

export function opGuildKick(s: HState, g: GuildCtx, targetId: number) {
  mustLeader(g, s.accountId);
  if (targetId === s.accountId) throw new StoreError('Không thể tự đuổi chính mình', 400);
  const t = memberOf(g, targetId);
  if (!t) throw new StoreError('Người này không ở trong bang', 404);
  g.members = g.members.filter((m) => m !== t);
}

export function opGuildTransfer(s: HState, g: GuildCtx, targetId: number) {
  const { guild, me } = mustLeader(g, s.accountId);
  if (targetId === s.accountId) throw new StoreError('Bạn đã là bang chủ', 400);
  const t = memberOf(g, targetId);
  if (!t) throw new StoreError('Người này không ở trong bang', 404);
  me.role = 'member';
  t.role = 'leader';
  guild.leaderId = t.accountId;
}

export function opGuildNotice(s: HState, g: GuildCtx, noticeRaw: unknown) {
  const { guild } = mustLeader(g, s.accountId);
  guild.notice = validNotice(noticeRaw);
}

export function opGuildDonate(s: HState, g: GuildCtx, nowMs: number, option: unknown) {
  const { guild, me } = mustMember(g, s.accountId);
  const opt = GUILD_DONATIONS.find((d) => d.id === option);
  if (!opt) throw new StoreError('Mức quyên góp không tồn tại', 404);
  const today = dayKey(nowMs);
  if (me.donatedDay !== today) {
    me.donatedDay = today;
    me.donatedN = 0;
  }
  if (me.donatedN >= GUILD_DONATE_PER_DAY) throw new StoreError('Hôm nay bạn đã quyên góp đủ lượt', 400);
  spend(s, opt.cost);
  gain(s, opt.reward);
  me.donatedN += 1;
  me.contribution += opt.contribution;
  settleBoss(guild, g.members, nowMs);
  addGuildExp(guild, opt.gexp);
}

export function opGuildCheckin(s: HState, g: GuildCtx, nowMs: number): Partial<Wallet> {
  const { guild, me } = mustMember(g, s.accountId);
  const today = dayKey(nowMs);
  if (me.checkinDay === today) throw new StoreError('Hôm nay bạn đã điểm danh rồi', 400);
  me.checkinDay = today;
  const reward = guildCheckinReward(guild.level);
  gain(s, reward);
  settleBoss(guild, g.members, nowMs);
  addGuildExp(guild, CHECKIN_GEXP);
  return reward;
}

export interface BossOutcome {
  damage: number;
  reward: Partial<Wallet>;
  boss: GuildBossState;
  killed: boolean;
}
/**
 * Một lượt đánh boss. Seed đã được api kiểm tra + huỷ. Mọi trận đã chạy đều tốn 1 lượt.
 * Hạ boss: người tấn công nhận BOSS_KILL_REWARD ngay; các thành viên khác đã gây sát thương trong chu kỳ được xếp hàng (g.killRewards),
 * store ghi vào hàng chờ và họ nhận ở lần chạm kế tiếp (đúng một lần) — không đụng ví người khác nên không khoá chéo.
 */
export function opGuildBoss(s: HState, g: GuildCtx, nowMs: number, squadIdx: number, seed: number, inputs: BattleInput[], auto: boolean): BossOutcome {
  const { guild, me } = mustMember(g, s.accountId);
  settleBoss(guild, g.members, nowMs);
  if (guild.bossKilled || guild.bossHp <= 0) throw new StoreError('Boss đã bị hạ, hãy chờ chu kỳ mới', 400);
  const today = dayKey(nowMs);
  if (me.bossDay !== today) {
    me.bossDay = today;
    me.bossTriesUsed = 0;
  }
  if (me.bossTriesUsed >= BOSS_ATTACKS_PER_DAY) throw new StoreError('Hết lượt đánh boss hôm nay', 400);
  const units = squadUnits(s, squadIdx);
  const result = simulate(bossSetup(guild.level, guild.bossCycle, seed, units), inputs, auto);
  const damage = Math.min(Math.max(0, Math.floor(bossDamage(result.events))), guild.bossHp);
  me.bossTriesUsed += 1;
  me.bossDamage += damage;
  guild.bossHp -= damage;
  const reward = bossAttackReward(damage);
  gain(s, reward);
  bumpEvents(s, 'guildboss', 1);
  let killed = false;
  if (guild.bossHp <= 0) {
    guild.bossHp = 0;
    guild.bossKilled = true;
    killed = true;
    gain(s, BOSS_KILL_REWARD);
    for (const m of g.members) if (m !== me && m.bossDamage > 0) g.killRewards.push(m.accountId);
  }
  s.runs.push({ stage: 'guildboss', win: killed, stars: 0, ticks: result.ticks });
  return { damage, reward, boss: bossStateOf(guild), killed };
}
