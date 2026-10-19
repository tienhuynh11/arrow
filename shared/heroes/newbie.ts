// Gói giữ chân người mới: điểm danh 7 ngày (ngày 7 tặng UR Hầu Vương), lượt quay khởi đầu miễn phí (chắc chắn có SSR),
// và "Hành trình tân thủ" — các mốc dễ đạt, mỗi mốc một phần thưởng. Tiến trình mốc được TÍNH từ dữ liệu có sẵn, không cần hook.
import type { EventReward } from './events.js';

/* ------------------------------ ĐIỂM DANH 7 NGÀY ------------------------------ */
/** mỗi ngày nhận 1 lần, theo thứ tự ngày 1→7; bỏ lỡ ngày nào vẫn nhận tiếp ngày kế (không mất tiến trình) */
export interface Login7Day {
  day: number;
  name: string;
  reward: EventReward;
  /** ngày đặc biệt (hiển thị nổi bật) */
  big?: boolean;
}
export const LOGIN7: Login7Day[] = [
  { day: 1, name: 'Quà chào mừng', reward: { wallet: { gold: 2000, tickets: 2 } } },
  { day: 2, name: 'Đá cường hoá', reward: { wallet: { stones: 10, exp: 500 } } },
  { day: 3, name: 'Mảnh Sát Thủ Bóng Đêm', reward: { shards: { hero: 'sat_thu_bong_dem', n: 40 } }, big: true },
  { day: 4, name: 'Kim cương + Vũ khí SR', reward: { wallet: { gems: 300 }, gear: ['weapon_forest_SR'] } },
  { day: 5, name: 'Vé triệu hồi', reward: { wallet: { tickets: 5, gold: 5000 } } },
  { day: 6, name: 'Giáp SSR + Đá', reward: { wallet: { stones: 20 }, gear: ['armor_water_SSR'] } },
  // ngày 7: tướng UR đặc trưng của game. Chưa sở hữu → nhận tướng (cấp 1, 1 sao); đã sở hữu → cộng 80 mảnh
  { day: 7, name: 'Đại Thánh Hầu Vương (UR)', reward: { shards: { hero: 'hau_vuong', n: 80 } }, big: true },
];
/** ngày 7 tặng NGUYÊN tướng nếu chưa có (khác với `shards` thường): server xử lý riêng theo cờ này */
export const LOGIN7_GRANT_HERO_DAY = 7;

/* ------------------------------ LƯỢT QUAY KHỞI ĐẦU ------------------------------ */
/** một lần duy nhất mỗi tài khoản, miễn phí, 10 lượt banner thường, chắc chắn có ít nhất 1 SSR trở lên */
export const STARTER_SUMMON = { count: 10 as const, banner: 'standard', guaranteeMin: 'SSR' as const };

/* ------------------------------ HÀNH TRÌNH TÂN THỦ ------------------------------ */
export type MilestoneKind =
  | 'stage' // số ải đã qua trong chiến dịch (index cao nhất + 1)
  | 'heroLevel' // cấp cao nhất của một tướng
  | 'heroCount' // số tướng sở hữu
  | 'heroStar' // sao cao nhất của một tướng
  | 'gearWorn' // số món trang bị đang mặc (tổng các tướng)
  | 'tower' // tầng tháp cao nhất đã qua
  | 'arenaWins' // số trận thắng đấu trường
  | 'guild' // đã vào bang (target 1)
  | 'pulls'; // tổng số lượt triệu hồi
export interface Milestone {
  id: string;
  kind: MilestoneKind;
  target: number;
  name: string;
  desc: string;
  reward: EventReward;
}
export const MILESTONES: Milestone[] = [
  { id: 'm_pull10', kind: 'pulls', target: 10, name: 'Làm quen triệu hồi', desc: 'Triệu hồi 10 lượt', reward: { wallet: { gold: 2000, tickets: 1 } } },
  { id: 'm_stage1', kind: 'stage', target: 1, name: 'Bước chân đầu tiên', desc: 'Qua ải 1-1', reward: { wallet: { gold: 1500, exp: 200 } } },
  { id: 'm_lv10', kind: 'heroLevel', target: 10, name: 'Tướng đầu tiên lên cấp 10', desc: 'Nâng một tướng lên cấp 10', reward: { wallet: { gold: 3000, stones: 5 } } },
  { id: 'm_stage5', kind: 'stage', target: 5, name: 'Xuyên rừng', desc: 'Qua ải 1-5', reward: { wallet: { gems: 100 } } },
  { id: 'm_gear4', kind: 'gearWorn', target: 4, name: 'Trang bị đủ bộ', desc: 'Mặc 4 món trang bị', reward: { wallet: { stones: 10, tickets: 1 } } },
  { id: 'm_heroes6', kind: 'heroCount', target: 6, name: 'Đội hình đa dạng', desc: 'Sở hữu 6 tướng', reward: { wallet: { gems: 150 } } },
  { id: 'm_star2', kind: 'heroStar', target: 2, name: 'Thăng sao', desc: 'Lên 2 sao cho một tướng', reward: { wallet: { gold: 4000, exp: 400 } } },
  { id: 'm_stage10', kind: 'stage', target: 10, name: 'Hạ Khỉ Chúa', desc: 'Qua ải 1-10 (hết chương 1)', reward: { wallet: { gems: 200, tickets: 2 } } },
  { id: 'm_tower5', kind: 'tower', target: 5, name: 'Leo tháp', desc: 'Lên tầng 5 của Tháp', reward: { wallet: { gems: 100, stones: 10 } } },
  { id: 'm_arena1', kind: 'arenaWins', target: 1, name: 'Đấu sĩ', desc: 'Thắng 1 trận đấu trường', reward: { wallet: { gems: 100, gold: 2000 } } },
  { id: 'm_lv20', kind: 'heroLevel', target: 20, name: 'Tinh anh', desc: 'Nâng một tướng lên cấp 20', reward: { wallet: { gems: 150, stones: 10 } } },
  { id: 'm_guild', kind: 'guild', target: 1, name: 'Có bang, có bạn', desc: 'Vào hoặc lập một bang hội', reward: { wallet: { tickets: 2, gold: 3000 } } },
];
export const MILESTONE_BY_ID: Record<string, Milestone> = Object.fromEntries(MILESTONES.map((m) => [m.id, m]));

/* ------------------------------ KIỂU API ------------------------------ */
export interface NewbieLoginState {
  /** số ngày đã nhận (0..7) */
  claimed: number;
  /** hôm nay còn nhận được không (đã tính reset ngày) */
  canClaim: boolean;
  /** ngày sẽ nhận kế tiếp (1..7), 8 = đã nhận hết */
  next: number;
}
export interface NewbieView {
  login: NewbieLoginState;
  milestones: { id: string; progress: number; claimed: boolean }[];
  /** đã dùng lượt quay khởi đầu chưa */
  starterUsed: boolean;
}
/** tổng số mục có thể nhận ngay (điểm danh + mốc đủ điều kiện + lượt quay khởi đầu chưa dùng) — để hiện chấm đỏ */
export function newbieBadge(v: NewbieView): number {
  let n = v.login.canClaim && v.login.next <= 7 ? 1 : 0;
  for (const m of v.milestones) {
    const def = MILESTONE_BY_ID[m.id];
    if (def && !m.claimed && m.progress >= def.target) n++;
  }
  if (!v.starterUsed) n++;
  return n;
}
/** còn mục nào chưa xong để hiện nút Tân thủ không (ẩn hẳn khi đã nhận hết mọi thứ) */
export function newbieDone(v: NewbieView): boolean {
  return v.login.next > 7 && v.starterUsed && v.milestones.every((m) => m.claimed);
}
