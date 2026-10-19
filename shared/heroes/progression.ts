// Tiến trình cấp tài khoản: mở ô đội hình, mở đội 2/3, thưởng lên cấp, lộ trình mở khoá. Dữ liệu + công thức thuần.
import { MAX_ACCOUNT_LEVEL, SQUAD_COUNT, SQUAD_SIZE } from './config.js';
import type { Wallet } from './types.js';

/* ------------------------------ Ô ĐỘI HÌNH ------------------------------ */
/** cấp tài khoản tối thiểu để ô i được mở miễn phí (ô 0-2 mở sẵn) */
export const SLOT_LEVEL: readonly number[] = [1, 1, 1, 5, 10, 18];
/** giá mở SỚM ô i bằng kim cương (ô mở sẵn = 0). Chỉ mua được ô kế tiếp (đúng thứ tự). */
export const SLOT_GEMS: readonly number[] = [0, 0, 0, 200, 450, 900];
/** số ô mở theo cấp (không tính ô đã mua) */
export function slotsByLevel(level: number): number {
  let n = 0;
  for (let i = 0; i < SQUAD_SIZE; i++) if (level >= SLOT_LEVEL[i]) n = i + 1;
  return Math.max(3, n);
}
/** số ô thực sự mở = max(theo cấp, đã mua); `bought` = số ô đã mua thêm (chỉ số ô cao nhất đã mua + 1) */
export function slotsOpen(level: number, bought: number): number {
  return Math.min(SQUAD_SIZE, Math.max(slotsByLevel(level), bought));
}

/* ------------------------------ ĐỘI LƯU ------------------------------ */
/** cấp để mở đội thứ i (đội 1 mở sẵn) */
export const SQUAD_LEVEL: readonly number[] = [1, 8, 15];
export function squadsOpen(level: number): number {
  let n = 0;
  for (let i = 0; i < SQUAD_COUNT; i++) if (level >= SQUAD_LEVEL[i]) n = i + 1;
  return Math.max(1, n);
}

/* ------------------------------ THƯỞNG LÊN CẤP ------------------------------ */
/** thưởng nhận (một lần) khi đạt cấp `level` (2..MAX): hằng cấp có vàng+EXP bình, mỗi 5 cấp thêm kim cương/vé, mỗi 10 cấp lớn hơn */
export function levelReward(level: number): Partial<Wallet> {
  const r: Partial<Wallet> = { gold: 400 + 120 * level, exp: 60 + 15 * level };
  if (level % 5 === 0) {
    r.gems = 100 + 10 * level;
    r.tickets = 1;
  }
  if (level % 10 === 0) {
    r.tickets = 3;
    r.stones = 20;
  }
  return r;
}

/** mốc mở khoá hiển thị trên lộ trình cấp (chỉ để thông tin + popup lên cấp; ô/đội là luật thật ở trên) */
export interface LevelUnlock {
  level: number;
  title: string;
  desc: string;
}
export const LEVEL_UNLOCKS: LevelUnlock[] = [
  { level: 1, title: '3 ô đội hình', desc: 'Bắt đầu với 3 tướng ra trận.' },
  { level: 5, title: 'Ô đội hình thứ 4 + Bang hội', desc: 'Thêm một tướng ra trận và được lập/vào bang.' },
  { level: 8, title: 'Đội hình thứ 2', desc: 'Lưu thêm một đội để đổi nhanh giữa các chế độ.' },
  { level: 10, title: 'Ô đội hình thứ 5', desc: 'Thêm một tướng ra trận.' },
  { level: 15, title: 'Đội hình thứ 3', desc: 'Lưu thêm đội thứ ba.' },
  { level: 18, title: 'Ô đội hình thứ 6', desc: 'Đủ 6 tướng ra trận.' },
  { level: 30, title: 'Cao thủ', desc: 'Nửa chặng đường đến cấp tối đa.' },
  { level: MAX_ACCOUNT_LEVEL, title: 'Đỉnh cao', desc: 'Cấp tối đa của tài khoản.' },
];
/** các mở khoá xảy ra khi lên từ cấp `from` tới `to` (để popup lên cấp) */
export function unlocksBetween(from: number, to: number): LevelUnlock[] {
  return LEVEL_UNLOCKS.filter((u) => u.level > from && u.level <= to);
}

/* ------------------------------ KIỂU API ------------------------------ */
export interface LevelView {
  level: number;
  /** cấp cao nhất đã nhận thưởng (thưởng các cấp ≤ giá trị này đã nhận; cấp 1 không có thưởng) */
  claimedUpTo: number;
  /** số ô đã mua thêm (xem slotsOpen) */
  slotsBought: number;
}
