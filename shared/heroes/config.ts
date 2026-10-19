// THẺ TƯỚNG 3D — hằng số dùng chung server + client.
// Đổi đường dẫn gốc / tên game ở MỘT chỗ duy nhất này (vite.config + server đều đọc từ đây).

/** đường dẫn gốc của game (luôn bắt đầu và kết thúc bằng '/') */
export const HEROES_BASE = '/heroes/';
/** REST nằm dưới đường dẫn gốc */
export const HEROES_API = `${HEROES_BASE}api/`;

export const GAME_TITLE = 'THẺ TƯỚNG 3D';

/** số ô đội hình: slot 0-1 hàng trước, 2-4 hàng sau */
export const SQUAD_SIZE = 5;
export const FRONT_SLOTS = 2;
export const SQUAD_COUNT = 3;

/** trận đánh chạy 20Hz */
export const BATTLE_HZ = 20;
/** quá 120 giây không thắng là thua */
export const BATTLE_MAX_TICKS = 120 * BATTLE_HZ;

export const MAX_LEVEL = 60;
export const MAX_STAR = 5;
export const MAX_ACCOUNT_LEVEL = 60;

/** thể lực: hồi 1 điểm mỗi 6 phút, trần 120 */
export const STAMINA_MAX = 120;
export const STAMINA_REGEN_MS = 6 * 60 * 1000;
export const SWEEP_COST = 6;

/** AFK: tích luỹ tối đa 12 giờ */
export const AFK_CAP_MS = 12 * 60 * 60 * 1000;

export const NAME_MAX = 20;
