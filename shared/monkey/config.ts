// SINH TỒN BẦY KHỈ — hằng số dùng chung server + client.
// Đổi đường dẫn gốc của game ở MỘT chỗ duy nhất này (vite.config + server đều đọc từ đây).

/** đường dẫn gốc của game (luôn bắt đầu và kết thúc bằng '/') */
export const MONKEY_BASE = '/monkey/';
/** WebSocket của game nằm dưới đường dẫn gốc */
export const MONKEY_WS_PATH = `${MONKEY_BASE}ws`;

export const GAME_TITLE = 'SINH TỒN BẦY KHỈ';

export const MAX_PLAYERS = 4;
export const NAME_MAX = 14;
export const CODE_LEN = 5;
/** chữ cái dùng cho mã phòng (bỏ I O 0 1 cho dễ đọc) */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** mô phỏng nhân vật (dự đoán phía client) chạy 60Hz */
export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
/** AI khỉ + snapshot chạy 20Hz */
export const AI_HZ = 20;
export const AI_DT = 1 / AI_HZ;
export const AI_MS = 1000 / AI_HZ;
/** số tick người chơi trong một tick AI */
export const TICKS_PER_AI = TICK_HZ / AI_HZ;

/** trần số khỉ còn sống cùng lúc (cũng là số slot trong snapshot) */
export const MAX_MONKEYS = 160;
/** bù trễ khi bắn: tua ngược tối đa bao nhiêu tick AI (7 × 50ms = 350ms = đệm nội suy ~100ms + ~250ms trễ mạng) */
export const LAG_COMP_TICKS = 7;
/** độ dài vòng lịch sử vị trí khỉ (luỹ thừa 2, > LAG_COMP_TICKS + 1) */
export const HIST = 16;
