// Hằng số + hàm thuần của lớp "vị trí / tầm đánh / di chuyển / tốc đánh".
// MỌI thứ ở đây là SỐ NGUYÊN (milli-đơn vị) để server (Node) và client (trình duyệt) tính giống hệt nhau.
import { rowOfSlot } from './config.js';
import type { Role, Stats } from './types.js';

/* ------------------------------ TRỤC TRẬN ĐÁNH 1-D ------------------------------ */
/** chiều dài sân (đơn vị): người chơi bên TRÁI (x nhỏ), quái bên PHẢI (x lớn) */
export const ARENA_LEN = 12000;
/** x của hàng trước phe người chơi; phe quái đối xứng (ARENA_LEN - x) => khoảng cách ban đầu giữa hai hàng trước = ARENA_LEN - 2*FRONT_X = 4800 */
export const FRONT_X = 3600;
/** khoảng cách giữa các hàng (trước/giữa/sau) */
export const ROW_GAP = 900;
/** hai đơn vị PHE ĐỊCH NHAU không bao giờ lại gần hơn mức này (đồng minh được chồng lên nhau) */
export const MIN_SEP = 350;
/** hai đồng minh không đứng gần nhau hơn mức này trên trục x (khi đã vào tầm: kẻ đến sau bị đẩy lên trước, một chiều nên không dao động) */
export const ALLY_SEP = 450;
/** lệch x theo chẵn/lẻ của ô trong cùng một hàng: ô chẵn +, ô lẻ - (hai đơn vị một hàng so le nhau 2*SLOT_STAGGER = 450) */
export const SLOT_STAGGER = 225;
/** đơn vị đánh xa đứng sau tuyến cận chiến của phe mình ít nhất bấy nhiêu */
export const BACK_MARGIN = 300;
/** tầm ≤ mức này coi là cận chiến (không bị chặn "đứng sau tuyến trước") */
export const MELEE_MAX_RANGE = 1500;
/** phát sự kiện 'move' tối đa mỗi bấy nhiêu tick cho một đơn vị đang đi */
export const MOVE_EVENT_EVERY = 5;

/** tầm đánh theo vai trò (đơn vị) */
export const ROLE_RANGE: Record<Role, number> = {
  tank: 900, warrior: 900, healer: 3200, support: 3200, mage: 3600, archer: 4200,
};
/** tốc độ đi theo vai trò (đơn vị / tick). Hai hàng trước đối đầu: 4800 - 900 = 3900 đơn vị, khép lại ~72-80/tick (x1.8 so với bản cũ) => đụng độ sau ~2.3 giây */
export const ROLE_MOVE: Record<Role, number> = {
  tank: 32, warrior: 40, healer: 32, support: 36, mage: 32, archer: 36,
};
/** boss: tầm như tank nhưng bước chậm */
export const BOSS_RANGE = 1100;
export const BOSS_MOVE = 22;

export const rangeOf = (role: Role, boss?: boolean, override?: number): number =>
  override ?? (boss ? BOSS_RANGE : ROLE_RANGE[role]);
export const moveOf = (role: Role, boss?: boolean, override?: number): number =>
  override ?? (boss ? BOSS_MOVE : ROLE_MOVE[role]);

/** vị trí xuất phát của một ô: hàng trước ở FRONT_X, mỗi hàng sau lùi ROW_GAP, ô chẵn lên trước / ô lẻ lùi SLOT_STAGGER; phe quái đối xứng */
export function startX(side: 0 | 1, slot: number): number {
  const x = FRONT_X - rowOfSlot(slot) * ROW_GAP + (slot % 2 === 0 ? SLOT_STAGGER : -SLOT_STAGGER);
  return side === 0 ? x : ARENA_LEN - x;
}

/* ------------------------------ CHỈ SỐ MỚI (tuỳ chọn) ------------------------------ */
/** tốc đánh %, bạo kích %, sát thương bạo kích %, hút máu % — thiếu thì dùng mặc định này */
export const STAT_DEFAULTS = { aspd: 100, crit: 10, critDmg: 150, lifesteal: 0 } as const;
export type ExtraStat = keyof typeof STAT_DEFAULTS;
export const EXTRA_STATS: readonly ExtraStat[] = ['aspd', 'crit', 'critDmg', 'lifesteal'];
/** đọc một chỉ số mới kèm giá trị mặc định */
export function statOf(s: Stats, k: ExtraStat): number {
  return s[k] ?? STAT_DEFAULTS[k];
}

/** chỉ số chiến đấu mặc định theo vai trò ở 1 sao: [tốc đánh %, bạo kích %, sát thương bạo kích %] */
export const ROLE_COMBAT: Record<Role, { aspd: number; crit: number; critDmg: number }> = {
  tank: { aspd: 90, crit: 5, critDmg: 150 },
  warrior: { aspd: 100, crit: 10, critDmg: 150 },
  mage: { aspd: 105, crit: 12, critDmg: 150 },
  archer: { aspd: 115, crit: 15, critDmg: 160 },
  healer: { aspd: 100, crit: 5, critDmg: 150 },
  support: { aspd: 105, crit: 8, critDmg: 150 },
};
/** mỗi sao cộng thêm (từ sao thứ 2) */
export const STAR_COMBAT = { aspd: 3, crit: 2, critDmg: 5 } as const;
