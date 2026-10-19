// Thành tựu: nhiều bậc (tier) mỗi thành tựu, tiến trình TÍNH từ dữ liệu có sẵn (không cần hook), nhận thưởng từng bậc một lần.
import type { EventReward } from './events.js';

export type AchGroup = 'campaign' | 'collect' | 'growth' | 'battle' | 'social';
export const ACH_GROUP_NAME: Record<AchGroup, string> = {
  campaign: 'Chiến dịch', collect: 'Sưu tầm', growth: 'Trưởng thành', battle: 'Chiến đấu', social: 'Xã hội',
};
/** nguồn số liệu (server tính từ HState) */
export type AchKind =
  | 'stage' // số ải đã qua (index cao nhất + 1)
  | 'stars' // tổng số sao các ải
  | 'bossClear' // số ải boss (5, 10) đã qua
  | 'heroCount' | 'urCount' | 'ssrCount' // số tướng sở hữu / số UR / số SSR+
  | 'heroLevel' | 'heroStar' // cấp / sao cao nhất của một tướng
  | 'level' // cấp tài khoản
  | 'gearCount' | 'gearUR' | 'gearMax' // số món / số món UR / cấp cường hoá cao nhất
  | 'pulls' // tổng lượt triệu hồi
  | 'tower' // tầng tháp cao nhất
  | 'arenaWins' | 'arenaRating' // thắng đấu trường / điểm cao nhất
  | 'bossDamage' // (chưa dùng tính tổng đời) giữ chỗ: tổng sát thương boss bang đã gây
  | 'guild' // đã vào bang
  | 'loginDays'; // số ngày điểm danh 7 ngày đã nhận
export interface AchTier {
  target: number;
  reward: EventReward;
}
export interface AchDef {
  id: string;
  group: AchGroup;
  kind: AchKind;
  name: string;
  desc: string;
  /** các bậc theo target tăng dần */
  tiers: AchTier[];
}
const W = (w: EventReward['wallet']): EventReward => ({ wallet: w });

export const ACHIEVEMENTS: AchDef[] = [
  { id: 'a_stage', group: 'campaign', kind: 'stage', name: 'Lữ khách', desc: 'Vượt các ải chiến dịch',
    tiers: [{ target: 5, reward: W({ gold: 2000 }) }, { target: 10, reward: W({ gems: 100 }) }, { target: 20, reward: W({ gems: 200, tickets: 2 }) }, { target: 30, reward: W({ gems: 400, tickets: 5 }) }] },
  { id: 'a_stars', group: 'campaign', kind: 'stars', name: 'Ngôi sao chiến trường', desc: 'Tích luỹ sao ở các ải',
    tiers: [{ target: 15, reward: W({ gold: 3000 }) }, { target: 45, reward: W({ gems: 150 }) }, { target: 90, reward: W({ gems: 300, stones: 20 }) }] },
  { id: 'a_boss', group: 'campaign', kind: 'bossClear', name: 'Sát thủ boss', desc: 'Hạ boss ở ải 5 và ải 10',
    tiers: [{ target: 1, reward: W({ gold: 3000, stones: 5 }) }, { target: 3, reward: W({ gems: 200 }) }, { target: 6, reward: W({ gems: 400, tickets: 3 }) }] },

  { id: 'a_heroes', group: 'collect', kind: 'heroCount', name: 'Nhà sưu tầm', desc: 'Sở hữu nhiều tướng',
    tiers: [{ target: 6, reward: W({ gold: 3000 }) }, { target: 9, reward: W({ gems: 150 }) }, { target: 12, reward: W({ gems: 400, tickets: 3 }) }] },
  { id: 'a_ssr', group: 'collect', kind: 'ssrCount', name: 'Tinh anh', desc: 'Sở hữu tướng SSR trở lên',
    tiers: [{ target: 1, reward: W({ gems: 100 }) }, { target: 3, reward: W({ gems: 250, tickets: 2 }) }] },
  { id: 'a_ur', group: 'collect', kind: 'urCount', name: 'Huyền thoại', desc: 'Sở hữu tướng UR',
    tiers: [{ target: 1, reward: W({ gems: 300, tickets: 3 }) }, { target: 2, reward: W({ gems: 600, tickets: 5 }) }] },
  { id: 'a_gear', group: 'collect', kind: 'gearCount', name: 'Thợ săn đồ', desc: 'Sở hữu nhiều trang bị',
    tiers: [{ target: 10, reward: W({ stones: 10 }) }, { target: 30, reward: W({ gems: 150, stones: 20 }) }, { target: 80, reward: W({ gems: 300, stones: 40 }) }] },
  { id: 'a_gearur', group: 'collect', kind: 'gearUR', name: 'Thần khí', desc: 'Sở hữu trang bị UR',
    tiers: [{ target: 1, reward: W({ gems: 300 }) }, { target: 4, reward: W({ gems: 600, tickets: 3 }) }] },

  { id: 'a_level', group: 'growth', kind: 'level', name: 'Lão luyện', desc: 'Nâng cấp tài khoản',
    tiers: [{ target: 10, reward: W({ gems: 100 }) }, { target: 25, reward: W({ gems: 250, tickets: 3 }) }, { target: 40, reward: W({ gems: 400, tickets: 5 }) }, { target: 60, reward: W({ gems: 800, tickets: 10 }) }] },
  { id: 'a_herolv', group: 'growth', kind: 'heroLevel', name: 'Tướng cứng cựa', desc: 'Nâng một tướng lên cấp cao',
    tiers: [{ target: 10, reward: W({ gold: 3000 }) }, { target: 30, reward: W({ gems: 150 }) }, { target: 60, reward: W({ gems: 500, stones: 30 }) }] },
  { id: 'a_herostar', group: 'growth', kind: 'heroStar', name: 'Thăng tiến', desc: 'Nâng sao một tướng',
    tiers: [{ target: 2, reward: W({ gold: 4000 }) }, { target: 3, reward: W({ gems: 150 }) }, { target: 5, reward: W({ gems: 500, tickets: 5 }) }] },
  { id: 'a_gearmax', group: 'growth', kind: 'gearMax', name: 'Rèn đúc', desc: 'Cường hoá một trang bị',
    tiers: [{ target: 3, reward: W({ stones: 8 }) }, { target: 6, reward: W({ gems: 100, stones: 15 }) }, { target: 10, reward: W({ gems: 300, stones: 30 }) }] },
  { id: 'a_pulls', group: 'growth', kind: 'pulls', name: 'Triệu hồi sư', desc: 'Triệu hồi nhiều lượt',
    tiers: [{ target: 30, reward: W({ gems: 100 }) }, { target: 100, reward: W({ gems: 250, tickets: 3 }) }, { target: 300, reward: W({ gems: 500, tickets: 6 }) }] },

  { id: 'a_tower', group: 'battle', kind: 'tower', name: 'Chinh phục tháp', desc: 'Lên cao trong Tháp',
    tiers: [{ target: 10, reward: W({ gems: 100 }) }, { target: 30, reward: W({ gems: 250, stones: 15 }) }, { target: 60, reward: W({ gems: 400, tickets: 4 }) }, { target: 100, reward: W({ gems: 800, tickets: 8 }) }] },
  { id: 'a_arena', group: 'battle', kind: 'arenaWins', name: 'Đấu sĩ', desc: 'Thắng đấu trường',
    tiers: [{ target: 5, reward: W({ gold: 3000 }) }, { target: 25, reward: W({ gems: 200 }) }, { target: 100, reward: W({ gems: 500, tickets: 5 }) }] },
  { id: 'a_rating', group: 'battle', kind: 'arenaRating', name: 'Hạng cao', desc: 'Đạt điểm đấu trường cao',
    tiers: [{ target: 1200, reward: W({ gems: 150 }) }, { target: 1500, reward: W({ gems: 300, tickets: 3 }) }, { target: 2000, reward: W({ gems: 700, tickets: 6 }) }] },

  { id: 'a_guild', group: 'social', kind: 'guild', name: 'Có bang, có bạn', desc: 'Tham gia một bang hội',
    tiers: [{ target: 1, reward: W({ gems: 100, tickets: 1 }) }] },
  { id: 'a_login', group: 'social', kind: 'loginDays', name: 'Chuyên cần', desc: 'Nhận quà điểm danh 7 ngày',
    tiers: [{ target: 3, reward: W({ gold: 3000 }) }, { target: 7, reward: W({ gems: 150 }) }] },
];
export const ACH_BY_ID: Record<string, AchDef> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

export interface AchState {
  id: string;
  progress: number;
  /** số bậc đã nhận (0..tiers.length) */
  claimed: number;
}
/** bậc nhận được ngay (chỉ số bậc tiếp theo nếu đủ tiến trình), -1 nếu không */
export function achClaimable(def: AchDef, st: AchState): number {
  const t = def.tiers[st.claimed];
  return t && st.progress >= t.target ? st.claimed : -1;
}
/** số thành tựu có bậc nhận được ngay (chấm đỏ) */
export function achBadge(list: readonly AchState[]): number {
  let n = 0;
  for (const st of list) {
    const d = ACH_BY_ID[st.id];
    if (d && achClaimable(d, st) >= 0) n++;
  }
  return n;
}
