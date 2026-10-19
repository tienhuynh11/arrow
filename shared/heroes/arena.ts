// Đấu trường PvP bất đồng bộ: đánh đội hình PHÒNG THỦ của người chơi khác (hoặc bot). Server chạy lại cả trận để chấm.
// Đội phòng thủ lấy từ dữ liệu SỐNG của chủ tài khoản (cấp/sao/trang bị hiện tại), do AI điều khiển (tự dùng tuyệt kỹ).
import type { BattleSetup, UnitInit } from './battle.js';
import { heroUnit } from './battle.js';
import { poolOf } from './heroes.js';
import { RARITIES, type OwnedHero } from './types.js';

export const ARENA_TRIES = 5;
export const ARENA_START_RATING = 1000;
export const ARENA_OPPONENTS = 5;
export const ARENA_TOP_N = 50;

/** điểm xếp hạng thay đổi sau trận (thắng đối thủ mạnh hơn được nhiều hơn, thua đối thủ yếu hơn mất nhiều hơn) */
export function ratingDelta(win: boolean, mine: number, theirs: number): number {
  const diff = Math.max(-400, Math.min(400, theirs - mine));
  if (win) return Math.max(10, Math.min(50, 25 + Math.round(diff / 16)));
  return -Math.max(5, Math.min(30, 15 - Math.round(diff / 16)));
}
export function arenaReward(win: boolean): { gold: number; gems: number } {
  return win ? { gold: 400, gems: 20 } : { gold: 100, gems: 0 };
}

export interface ArenaOpponent {
  /** id tài khoản dạng chuỗi, hoặc `bot:<n>` */
  id: string;
  name: string;
  rating: number;
  /** lực chiến đội phòng thủ */
  power: number;
  /** các tướng phòng thủ theo ô (slot 0-4), '' = trống — để hiển thị */
  heroes: { id: string; level: number; star: number }[];
  bot: boolean;
}
export interface ArenaState {
  rating: number;
  /** lượt tấn công còn lại hôm nay (đã tính reset ngày) */
  tries: number;
  /** chỉ số đội (0..SQUAD_COUNT-1) dùng làm đội phòng thủ */
  defense: number;
  wins: number;
  losses: number;
}

/* ------------------------------ BOT ------------------------------ */
/** bot `n` (0..): đội phòng thủ sinh theo công thức (deterministic) và theo điểm của người xem để luôn vừa sức */
export function botSquad(n: number, rating: number): OwnedHero[] {
  // điểm khởi đầu (1000) ứng với bot cấp 1 chỉ có tướng R (ngang đội khởi đầu) để người mới thắng được; cấp tăng ~1 mỗi 9 điểm (1500 điểm ≈ cấp 55)
  const lvl = Math.max(1, Math.min(60, Math.round((rating - 1000) / 9) + (n % 3) - 1));
  const star = Math.max(1, Math.min(5, 1 + Math.floor(lvl / 14)));
  const out: OwnedHero[] = [];
  // tướng lấy tuần tự trong danh sách, ưu tiên phẩm cao dần theo điểm
  const rar = RARITIES.filter((_r, i) => i <= Math.max(0, Math.min(3, Math.floor((rating - 1000) / 250) + 0))); // luôn có ít nhất phẩm R (điểm < 550 trước đây ra đội rỗng)
  const pool = rar.flatMap((r) => poolOf(r));
  for (let i = 0; i < 5 && pool.length; i++) {
    const h = pool[(n * 7 + i * 3 + Math.floor(rating / 50)) % pool.length];
    if (out.some((o) => o.id === h.id)) continue;
    out.push({ id: h.id, level: lvl, star, shards: 0 });
  }
  return out;
}
export const BOT_NAMES = ['Khỉ Con Tinh Nghịch', 'Thợ Săn Bí Ẩn', 'Hiệp Sĩ Vô Danh', 'Pháp Sư Lang Thang', 'Lữ Khách Rừng Xanh', 'Cao Thủ Ẩn Danh', 'Chiến Binh Núi Đá', 'Nữ Thần Sông Xanh'];

/** dựng trận đấu trường: người tấn công = side 0, đội phòng thủ = một đợt duy nhất side 1 (AI tự dùng tuyệt kỹ) */
export function arenaSetup(attacker: UnitInit[], defender: UnitInit[], seed: number): BattleSetup {
  return { seed, player: attacker, waves: [defender.map((u) => ({ ...u, side: 1 as const }))] };
}
export { heroUnit };
