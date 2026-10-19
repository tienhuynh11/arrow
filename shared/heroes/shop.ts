// Cửa hàng: mặt hàng cố định, mỗi mặt hàng có giới hạn mua mỗi ngày (reset 00:00 giờ VN, xem quests.ts dayKey).
import type { Wallet } from './types.js';

export type ShopGive =
  | { kind: 'wallet'; give: Partial<Wallet> }
  | { kind: 'stamina'; amount: number }
  /** mảnh tướng cho một tướng ĐÃ SỞ HỮU (client gửi kèm id tướng) */
  | { kind: 'shards'; amount: number }
  /** một lần rớt trang bị theo bảng của chương `chapter` (rollGearDrops) */
  | { kind: 'gear'; chapter: number };

export interface ShopItem {
  id: string;
  name: string;
  desc: string;
  cost: Partial<Wallet>;
  /** số lần mua tối đa mỗi ngày */
  limit: number;
  give: ShopGive;
}
export const SHOP_ITEMS: ShopItem[] = [
  { id: 'exp_pack', name: 'Bình EXP', desc: '+200 EXP bình để nâng cấp tướng', cost: { gold: 600 }, limit: 10, give: { kind: 'wallet', give: { exp: 200 } } },
  { id: 'stone_pack', name: 'Đá cường hoá x10', desc: 'Dùng cường hoá trang bị', cost: { gold: 1500 }, limit: 10, give: { kind: 'wallet', give: { stones: 10 } } },
  { id: 'stamina_pack', name: 'Thể lực +60', desc: 'Hồi ngay 60 thể lực (có thể vượt trần)', cost: { gems: 60 }, limit: 3, give: { kind: 'stamina', amount: 60 } },
  { id: 'shard_pack', name: 'Mảnh tướng x10', desc: 'Chọn một tướng bạn đang có', cost: { gold: 2500 }, limit: 5, give: { kind: 'shards', amount: 10 } },
  { id: 'gear_chest', name: 'Rương trang bị', desc: 'Nhận 1 món trang bị ngẫu nhiên (bảng rớt chương 2)', cost: { gems: 200 }, limit: 5, give: { kind: 'gear', chapter: 2 } },
  { id: 'ticket_pack', name: 'Vé triệu hồi', desc: '1 vé triệu hồi', cost: { gold: 8000 }, limit: 3, give: { kind: 'wallet', give: { tickets: 1 } } },
];
export const SHOP_BY_ID: Record<string, ShopItem> = Object.fromEntries(SHOP_ITEMS.map((s) => [s.id, s]));
