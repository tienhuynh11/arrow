// Gói Tân thủ phía server: điểm danh 7 ngày, mốc Hành trình, lượt quay khởi đầu. Hàm THUẦN trên HState (store gọi trong giao dịch có khoá).
// Tiến trình mốc được TÍNH từ hồ sơ (không hook); riêng 'pulls' dùng bộ đếm newbie.pullsTotal (tài khoản cũ bắt đầu từ 0).

import type { NewbieLoginClaimRes, NewbieMilestoneClaimRes, SummonRes } from '../../../shared/heroes/api.js';
import { BANNER_BY_ID, NEW_PITY, summon, type Pull, type RandInt } from '../../../shared/heroes/gacha.js';
import { HERO_BY_ID, poolOf } from '../../../shared/heroes/heroes.js';
import { LOGIN7, LOGIN7_GRANT_HERO_DAY, MILESTONES, MILESTONE_BY_ID, STARTER_SUMMON, type MilestoneKind, type NewbieView } from '../../../shared/heroes/newbie.js';
import { dayKey } from '../../../shared/heroes/quests.js';
import { payReward } from './events.js';
import { applyPulls, bumpEvents, bumpQuest, highestIndex, type SummonPulls } from './rules.js';
import { StoreError, type HState } from './db/store.js';

/** tiến trình hiện tại của một loại mốc, tính từ hồ sơ */
export function milestoneProgress(s: Readonly<HState>, kind: MilestoneKind): number {
  const heroes = Object.values(s.heroes);
  switch (kind) {
    case 'stage': return highestIndex(s) + 1; // -1 (chưa qua ải nào) → 0
    case 'heroLevel': return heroes.reduce((m, h) => Math.max(m, h.level), 0);
    case 'heroCount': return heroes.length;
    case 'heroStar': return heroes.reduce((m, h) => Math.max(m, h.star), 0);
    case 'gearWorn': return s.gear.filter((g) => g.hero !== null).length;
    case 'tower': return s.towerFloor;
    case 'arenaWins': return s.arenaWins;
    case 'guild': return s.guildId !== null ? 1 : 0;
    case 'pulls': return s.newbie.pullsTotal;
  }
}

/** góc nhìn Tân thủ tại thời điểm `ms` (đã tính reset ngày, không ghi gì) */
export function newbieView(s: Readonly<HState>, ms: number): NewbieView {
  const n = s.newbie;
  return {
    login: { claimed: n.loginClaimed, canClaim: n.loginClaimed < LOGIN7.length && n.loginDay !== dayKey(ms), next: n.loginClaimed + 1 },
    milestones: MILESTONES.map((m) => ({ id: m.id, progress: milestoneProgress(s, m.kind), claimed: n.milestones.includes(m.id) })),
    starterUsed: n.starterUsed,
  };
}

/** nhận quà điểm danh ngày kế tiếp (1 lần/ngày; bỏ lỡ ngày vẫn nhận tiếp). Ngày 7: chưa có Hầu Vương → tặng tướng, có rồi → +mảnh */
export function opNewbieLoginClaim(s: HState, nowMs: number): Omit<NewbieLoginClaimRes, 'me' | 'view'> {
  const n = s.newbie;
  if (n.loginClaimed >= LOGIN7.length) throw new StoreError('Bạn đã nhận hết quà điểm danh 7 ngày', 400);
  const today = dayKey(nowMs);
  if (n.loginDay === today) throw new StoreError('Hôm nay bạn đã nhận quà điểm danh, hãy quay lại vào ngày mai', 400);
  const day = n.loginClaimed + 1;
  const def = LOGIN7[day - 1];
  n.loginClaimed = day;
  n.loginDay = today;
  const sh = def.reward.shards;
  if (day === LOGIN7_GRANT_HERO_DAY && sh && HERO_BY_ID[sh.hero] && !s.heroes[sh.hero]) {
    // chưa sở hữu → tặng NGUYÊN tướng (cấp 1, 1 sao, 0 mảnh); phần còn lại của quà (nếu có) vẫn trả bình thường
    s.heroes[sh.hero] = { id: sh.hero, level: 1, star: 1, shards: 0 };
    const { shards: _omit, ...rest } = def.reward;
    const r = payReward(s, rest);
    return { day, reward: { wallet: r.wallet, gear: r.gear, heroGranted: sh.hero } };
  }
  return { day, reward: payReward(s, def.reward) };
}

/** nhận thưởng một mốc Hành trình: tồn tại, đủ tiến trình, chưa nhận → trả thưởng + đánh dấu (không bao giờ trả hai lần) */
export function opNewbieMilestoneClaim(s: HState, id: unknown): Omit<NewbieMilestoneClaimRes, 'me' | 'view'> {
  const def = typeof id === 'string' ? MILESTONE_BY_ID[id] : undefined;
  if (!def) throw new StoreError('Mốc Tân thủ không tồn tại', 400);
  if (s.newbie.milestones.includes(def.id)) throw new StoreError('Bạn đã nhận thưởng mốc này rồi', 400);
  if (milestoneProgress(s, def.kind) < def.target) throw new StoreError('Mốc này chưa hoàn thành', 400);
  s.newbie.milestones.push(def.id);
  return { reward: payReward(s, def.reward) };
}

/**
 * Lượt quay khởi đầu: miễn phí (không đụng ví), 10 lượt banner thường, một lần/tài khoản, đảm bảo ≥1 SSR trở lên.
 * Quay 9 lượt đơn rồi lượt 10 (để biết trạng thái pity trước lượt cuối); nếu 10 lượt chưa có SSR+, thay lượt cuối bằng
 * một SSR ngẫu nhiên và chỉnh pity như đã ra SSR (sinceSSR về 0, sinceUR +1, giữ cờ guaranteed).
 */
export function opNewbieStarterSummon(s: HState, rand: RandInt): SummonPulls {
  if (s.newbie.starterUsed) throw new StoreError('Đã dùng lượt quay khởi đầu', 400);
  const banner = BANNER_BY_ID[STARTER_SUMMON.banner];
  if (!banner) throw new StoreError('Banner không tồn tại', 404);
  let st = s.pity[banner.id] ?? NEW_PITY;
  const pulls: Pull[] = [];
  for (let i = 0; i < STARTER_SUMMON.count - 1; i++) {
    const r = summon(st, banner, 1, rand);
    pulls.push(...r.pulls);
    st = r.state;
  }
  const last = summon(st, banner, 1, rand);
  let lastPull = last.pulls[0];
  let after = last.state;
  const hasSSR = [...pulls, lastPull].some((p) => p.rarity === 'SSR' || p.rarity === 'UR');
  if (!hasSSR) {
    const pool = poolOf('SSR');
    if (pool.length === 0) throw new StoreError('Không có tướng SSR để quay', 500);
    lastPull = { heroId: pool[rand(pool.length)].id, rarity: 'SSR' };
    after = { sinceSSR: 0, sinceUR: st.sinceUR + 1, guaranteed: st.guaranteed };
  }
  pulls.push(lastPull);
  s.pity[banner.id] = after;
  s.newbie.starterUsed = true;
  s.newbie.pullsTotal += STARTER_SUMMON.count;
  bumpQuest(s, 'summon', STARTER_SUMMON.count);
  bumpEvents(s, 'summon', STARTER_SUMMON.count);
  return applyPulls(s, pulls);
}

export type StarterOutcome = Pick<SummonRes, 'pulls'>;
