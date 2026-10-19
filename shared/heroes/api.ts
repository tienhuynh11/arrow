// Hợp đồng REST (/heroes/api/*). Client gửi header `Authorization: Bearer <token>` cho mọi route cần đăng nhập.
// Mọi route thay đổi dữ liệu trả `MutateRes` (hồ sơ mới). Server là trọng tài: client chỉ gửi ý định.

import type { BattleInput, BattleEvent } from './battle.js';
import type { PityState, Pull } from './gacha.js';
import type { GearInst } from './gear.js';
import type { QuestsView } from './quests.js';
import type { TowerState } from './tower.js';
import type { OwnedHero, Wallet } from './types.js';

export const ROUTES = {
  register: 'register',
  login: 'login',
  logout: 'logout',
  me: 'me',
  summon: 'summon',
  levelUp: 'level-up',
  starUp: 'star-up',
  setSquad: 'set-squad',
  battleStart: 'battle-start',
  battle: 'battle',
  sweep: 'sweep',
  afkClaim: 'afk-claim',
  gearEquip: 'gear-equip',
  gearUnequip: 'gear-unequip',
  gearUpgrade: 'gear-upgrade',
  gearSalvage: 'gear-salvage',
  towerBattle: 'tower-battle',
  questClaim: 'quest-claim',
  shopBuy: 'shop-buy',
  leaderboard: 'leaderboard',
} as const;

/* ------------------------------ HỒ SƠ ------------------------------ */
export interface Profile {
  id: number;
  username: string;
  level: number;
  xp: number;
  /** thể lực đã tính tới `now` */
  stamina: number;
}
export interface StageProgress {
  stage: string;
  stars: number;
  clears: number;
}
export interface AfkState {
  /** mốc bắt đầu tích luỹ (ms epoch) */
  since: number;
  /** thưởng đang chờ nhận (đã chặn 12 giờ) */
  pending: { gold: number; exp: number };
}
export interface MeResponse {
  profile: Profile;
  wallet: Wallet;
  heroes: OwnedHero[];
  /** kho trang bị (kể cả món đang mặc: `hero` ≠ null) */
  gear: GearInst[];
  /** Tháp: tầng cao nhất đã qua + lượt thử còn lại hôm nay (đã tính reset ngày) */
  tower: TowerState;
  /** nhiệm vụ hôm nay (đã tính reset ngày; luôn đủ mọi QUEST_DEFS) */
  quests: QuestsView;
  /** số lần đã mua hôm nay theo id mặt hàng (đã tính reset ngày) */
  shop: Record<string, number>;
  /** SQUAD_COUNT đội, mỗi đội SQUAD_SIZE ô chứa id tướng ('' = trống) */
  squads: string[][];
  activeSquad: number;
  pity: Record<string, PityState>;
  progress: StageProgress[];
  afk: AfkState;
  /** giờ server (ms epoch) để client đồng bộ đồng hồ */
  now: number;
}
export interface MutateRes {
  me: MeResponse;
}

/* ------------------------------ TÀI KHOẢN ------------------------------ */
export interface AuthReq {
  username: string;
  password: string;
}
export interface AuthRes {
  token: string;
  me: MeResponse;
}

/* ------------------------------ THAO TÁC ------------------------------ */
export interface SummonReq {
  banner: string;
  count: 1 | 10;
  pay: 'tickets' | 'gems';
  /** khoá chống gửi trùng (chạm đúp): cùng key chỉ trừ tiền một lần */
  key: string;
}
export interface SummonRes extends MutateRes {
  pulls: (Pull & { isNew: boolean; shards: number })[];
}
export interface HeroReq {
  hero: string;
}
/** nâng cấp tướng; `times` (mặc định 1) = số cấp nâng liên tiếp tối đa, dừng êm khi hết tiền/chạm trần */
export interface LevelUpReq extends HeroReq {
  times?: number;
}
export interface LevelUpRes extends MutateRes {
  /** số cấp thực sự đã nâng */
  gained: number;
}
export interface SetSquadReq {
  squad: number;
  /** SQUAD_SIZE id tướng, '' = trống */
  slots: string[];
  /** đặt làm đội đang dùng */
  active?: boolean;
}
export interface BattleReq {
  stage: string;
  /** đội hình client đã dùng (server bỏ qua, tự dựng lại từ DB; chỉ để đối chiếu) */
  squad: number;
  seed: number;
  inputs: BattleInput[];
  auto: boolean;
}
export interface BattleRes extends MutateRes {
  win: boolean;
  stars: number;
  /** thưởng thực nhận (0 nếu thua) */
  reward: { gold: number; exp: number; xp: number; gems: number; firstClear: boolean };
  levelUp: boolean;
  /** id GearDef các món rớt (đã thêm vào kho; rỗng nếu thua hoặc kho đầy) */
  drops: string[];
}
/** xin hạt giống trước trận: body { stage } */
export interface BattleStartReq {
  stage: string;
}
/** xin hạt giống trước trận (server cấp, chống chọn seed có lợi) */
export interface BattleStartRes {
  seed: number;
  /** thời hạn nộp kết quả (ms epoch) */
  expires: number;
}
export interface SweepReq {
  stage: string;
  times: number;
}
export interface SweepRes extends MutateRes {
  reward: { gold: number; exp: number; xp: number };
  drops: string[];
}
export interface AfkClaimRes extends MutateRes {
  reward: { gold: number; exp: number };
}

export interface LeaderRow {
  username: string;
  /** ải cao nhất đã qua (index) */
  stage: number;
  stars: number;
}

/** sự kiện phát lại (client dùng khi xem lại trận do server chạy, ví dụ PvP sau này) */
export type ReplayEvents = BattleEvent[];

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/* ------------------------------ TRANG BỊ ------------------------------ */
/** mặc món `uid` cho tướng `hero` (món đang ở tướng khác thì chuyển sang; ô cũ của tướng này được trả về kho) */
export interface GearEquipReq {
  uid: number;
  hero: string;
}
export interface GearUnequipReq {
  uid: number;
}
/** cường hoá món `uid` thêm tối đa `times` cấp (mặc định 1), dừng êm khi hết vàng/đá hoặc chạm cấp 10 */
export interface GearUpgradeReq {
  uid: number;
  times?: number;
}
export interface GearUpgradeRes extends MutateRes {
  gained: number;
}
/** phân rã các món không đang mặc → đá cường hoá */
export interface GearSalvageReq {
  uids: number[];
}
export interface GearSalvageRes extends MutateRes {
  stones: number;
}

/* ------------------------------ THÁP / NHIỆM VỤ / CỬA HÀNG ------------------------------ */
/** đánh tầng kế tiếp (tower.floor + 1). Dùng seed từ battle-start (body `{stage:'tower'}`), server chạy lại trận như /battle.
 *  Thua cũng tốn 1 lượt. Hết lượt → 400. */
export interface TowerBattleReq {
  squad: number;
  seed: number;
  inputs: BattleInput[];
  auto: boolean;
}
export interface TowerBattleRes extends MutateRes {
  win: boolean;
  /** tầng vừa đánh */
  floor: number;
  /** thưởng thực nhận (0 nếu thua) */
  reward: { gold: number; exp: number; xp: number; gems: number; stones: number };
  /** id GearDef rớt (đã vào kho) */
  drops: string[];
  levelUp: boolean;
}
/** nhận thưởng một nhiệm vụ đã đủ tiến trình; id = 'bonus' để nhận thưởng thêm khi đã nhận hết */
export interface QuestClaimReq {
  id: string;
}
export interface QuestClaimRes extends MutateRes {
  reward: Partial<Wallet>;
}
/** mua hàng; `hero` bắt buộc với mặt hàng mảnh tướng; `times` mặc định 1 (dừng khi chạm giới hạn ngày/hết tiền → lỗi nếu 0 lần) */
export interface ShopBuyReq {
  item: string;
  times?: number;
  hero?: string;
}
export interface ShopBuyRes extends MutateRes {
  bought: number;
  /** id GearDef nhận được (rương trang bị) */
  drops: string[];
}
