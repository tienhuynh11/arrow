// Nhiệm vụ hằng ngày + mốc thời gian "ngày" dùng chung (server tính, client hiển thị).
import type { Wallet } from './types.js';

const DAY_MS = 86_400_000;
/** ngày đổi lúc 00:00 giờ Việt Nam (UTC+7) */
const TZ_MS = 7 * 3_600_000;
/** số thứ tự ngày (để so sánh, lưu DB) */
export function dayKey(nowMs: number): number {
  return Math.floor((nowMs + TZ_MS) / DAY_MS);
}
/** thời điểm (ms epoch) bắt đầu ngày kế tiếp, để hiển thị đếm ngược */
export function nextDayStart(nowMs: number): number {
  return (dayKey(nowMs) + 1) * DAY_MS - TZ_MS;
}

/** loại sự kiện tăng tiến trình nhiệm vụ (server gọi khi thao tác thành công) */
export type QuestKind = 'login' | 'win' | 'summon' | 'levelup' | 'tower' | 'gear';
export interface QuestDef {
  id: string;
  kind: QuestKind;
  name: string;
  desc: string;
  target: number;
  reward: Partial<Wallet>;
}
export const QUEST_DEFS: QuestDef[] = [
  { id: 'q_login', kind: 'login', name: 'Điểm danh', desc: 'Đăng nhập hôm nay', target: 1, reward: { gold: 500, tickets: 1 } },
  { id: 'q_win', kind: 'win', name: 'Chinh chiến', desc: 'Thắng 3 trận (chiến dịch hoặc quét ải)', target: 3, reward: { gold: 800, exp: 100 } },
  { id: 'q_summon', kind: 'summon', name: 'Triệu hồi', desc: 'Triệu hồi 1 lần', target: 1, reward: { gold: 600, stones: 3 } },
  { id: 'q_level', kind: 'levelup', name: 'Rèn luyện', desc: 'Nâng cấp tướng 3 cấp', target: 3, reward: { gold: 700, tickets: 1 } },
  { id: 'q_tower', kind: 'tower', name: 'Chinh phục tháp', desc: 'Đánh Tháp 1 lần', target: 1, reward: { gems: 60, stones: 2 } },
  { id: 'q_gear', kind: 'gear', name: 'Thợ rèn', desc: 'Cường hoá trang bị 2 cấp', target: 2, reward: { gold: 600, stones: 2 } },
];
export const QUEST_BY_ID: Record<string, QuestDef> = Object.fromEntries(QUEST_DEFS.map((q) => [q.id, q]));
/** thưởng thêm khi đã nhận hết mọi nhiệm vụ trong ngày */
export const QUEST_BONUS: Partial<Wallet> = { gems: 100, tickets: 2 };

export interface QuestState {
  id: string;
  progress: number;
  /** đã nhận thưởng */
  claimed: boolean;
}
export interface QuestsView {
  /** số ngày (dayKey) mà trạng thái này thuộc về */
  day: number;
  list: QuestState[];
  /** đã nhận thưởng thêm khi xong hết */
  bonusClaimed: boolean;
}
