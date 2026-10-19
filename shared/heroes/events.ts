// Sự kiện theo thời gian do admin tạo (x-admin-key). Tiến trình cộng dồn theo từng tài khoản; người chơi tự bấm nhận mỗi mục 1 lần.
import type { QuestKind } from './quests.js';
import type { Wallet } from './types.js';

/** loại tiến trình: dùng lại các loại của nhiệm vụ + thắng đấu trường */
export type EventKind = QuestKind | 'arena' | 'guildboss';
export const EVENT_KINDS: readonly EventKind[] = ['login', 'win', 'summon', 'levelup', 'tower', 'gear', 'arena', 'guildboss'];
export const EVENT_KIND_NAME: Record<EventKind, string> = {
  login: 'Đăng nhập', win: 'Thắng ải', summon: 'Triệu hồi', levelup: 'Nâng cấp tướng', tower: 'Đánh Tháp',
  gear: 'Cường hoá trang bị', arena: 'Thắng đấu trường', guildboss: 'Đánh boss bang',
};

export interface EventReward {
  wallet?: Partial<Wallet>;
  /** mảnh một tướng cụ thể */
  shards?: { hero: string; n: number };
  /** id GearDef (xem gear.ts) — thêm vào kho, vượt GEAR_CAP thì đổi ra đá */
  gear?: string[];
}
export interface EventObjective {
  /** duy nhất trong sự kiện, ví dụ 'o1' */
  id: string;
  kind: EventKind;
  name: string;
  target: number;
  reward: EventReward;
}
export interface EventDef {
  id: number;
  name: string;
  desc: string;
  /** ms epoch */
  startsAt: number;
  endsAt: number;
  enabled: boolean;
  /** id tướng làm hình đại diện (tuỳ chọn) */
  banner?: string;
  objectives: EventObjective[];
}
export interface EventView {
  event: EventDef;
  /** tiến trình theo id mục tiêu (đã chặn tối đa = target) */
  progress: Record<string, number>;
  /** id mục tiêu đã nhận */
  claimed: string[];
}

export const EVENT_NAME_MAX = 40;
export const EVENT_MAX_OBJECTIVES = 12;
/** thưởng tối đa một mục (chống nhập nhầm khi tạo sự kiện) */
export const EVENT_WALLET_CAP = 100_000;

/** sự kiện mẫu tạo sẵn khi migrate (tắt đi/sửa được trong trang admin) */
export const SEED_EVENT: Omit<EventDef, 'id' | 'startsAt' | 'endsAt'> & { days: number } = {
  name: 'Tuần Lễ Hầu Vương',
  desc: 'Hoàn thành thử thách trong tuần để nhận mảnh Đại Thánh Hầu Vương và quà hấp dẫn!',
  enabled: true,
  banner: 'hau_vuong',
  days: 7,
  objectives: [
    { id: 'o1', kind: 'win', name: 'Thắng 10 trận chiến dịch', target: 10, reward: { wallet: { gold: 3000, exp: 300 } } },
    { id: 'o2', kind: 'summon', name: 'Triệu hồi 20 lượt', target: 20, reward: { shards: { hero: 'hau_vuong', n: 40 } } },
    { id: 'o3', kind: 'arena', name: 'Thắng 5 trận đấu trường', target: 5, reward: { wallet: { gems: 150 } } },
    { id: 'o4', kind: 'tower', name: 'Đánh Tháp 3 lần', target: 3, reward: { wallet: { stones: 15 }, gear: ['weapon_forest_SR'] } },
  ],
};
