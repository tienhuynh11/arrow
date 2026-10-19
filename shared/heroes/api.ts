// Hợp đồng REST (/heroes/api/*). Client gửi header `Authorization: Bearer <token>` cho mọi route cần đăng nhập.
// Mọi route thay đổi dữ liệu trả `MutateRes` (hồ sơ mới). Server là trọng tài: client chỉ gửi ý định.

import type { BattleInput, BattleEvent } from './battle.js';
import type { PityState, Pull } from './gacha.js';
import type { GearInst } from './gear.js';
import type { ArenaOpponent, ArenaState } from './arena.js';
import type { EventDef, EventView } from './events.js';
import type { NewbieView } from './newbie.js';
import type { GuildBrief, GuildChatMsg, GuildInfo } from './guild.js';
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
  arena: 'arena',
  arenaDefense: 'arena-defense',
  arenaBattle: 'arena-battle',
  arenaTop: 'arena-top',
  events: 'events',
  eventClaim: 'event-claim',
  guild: 'guild',
  guildSearch: 'guild-search',
  guildCreate: 'guild-create',
  guildJoin: 'guild-join',
  guildLeave: 'guild-leave',
  guildKick: 'guild-kick',
  guildTransfer: 'guild-transfer',
  guildNotice: 'guild-notice',
  guildDonate: 'guild-donate',
  guildCheckin: 'guild-checkin',
  guildBoss: 'guild-boss',
  guildChat: 'guild-chat',
  newbie: 'newbie',
  newbieLoginClaim: 'newbie-login-claim',
  newbieMilestoneClaim: 'newbie-milestone-claim',
  newbieStarterSummon: 'newbie-starter-summon',
  adminEvents: 'admin/events',
  adminEventSave: 'admin/event-save',
  adminEventDelete: 'admin/event-delete',
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
  /** đấu trường: điểm, lượt hôm nay, đội phòng thủ (đã tính reset ngày) */
  arena: ArenaState;
  /** id bang đang ở (null = chưa có bang) và số mục sự kiện có thể nhận ngay (để hiện chấm đỏ) */
  guildId: number | null;
  eventsClaimable: number;
  /** số mục Tân thủ có thể nhận ngay (chấm đỏ) và đã xong hết chưa (ẩn nút) */
  newbieBadge: number;
  newbieDone: boolean;
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

/* ------------------------------ ĐẤU TRƯỜNG ------------------------------ */
/** GET arena: danh sách đối thủ vừa sức (đã loại bản thân), thứ hạng hiện tại. Bot được chèn khi không đủ người thật. */
export interface ArenaRes {
  state: ArenaState;
  /** hạng trên bảng (1 = đầu); 0 nếu chưa có hạng */
  rank: number;
  opponents: ArenaOpponent[];
}
/** đặt đội phòng thủ = đội `squad` đã lưu của mình (phải có ít nhất 1 tướng) */
export interface ArenaDefenseReq {
  squad: number;
}
/** tấn công: seed lấy từ battle-start (body `{stage:'arena'}`); server tự dựng cả hai đội, chạy simulate, cập nhật điểm. Hết lượt → 400. */
export interface ArenaBattleReq {
  /** id đối thủ lấy từ GET arena (hoặc `bot:<n>`) */
  opponent: string;
  squad: number;
  seed: number;
  inputs: BattleInput[];
  auto: boolean;
}
export interface ArenaBattleRes extends MutateRes {
  win: boolean;
  ratingDelta: number;
  rating: number;
  reward: { gold: number; gems: number };
  /** người xem lại: các sự kiện trận (để client phát lại nếu muốn; client thường tự chạy lại) */
  opponent: ArenaOpponent;
}
export interface ArenaTopRow {
  rank: number;
  username: string;
  rating: number;
  wins: number;
}
export interface ArenaTopRes {
  rows: ArenaTopRow[];
}

/* ------------------------------ SỰ KIỆN ------------------------------ */
/** GET events: các sự kiện đang diễn ra (enabled và startsAt ≤ now < endsAt) kèm tiến trình của tôi, mới nhất trước */
export interface EventsRes {
  events: EventView[];
  now: number;
}
export interface EventClaimReq {
  event: number;
  objective: string;
}
export interface EventClaimRes extends MutateRes {
  /** mô tả phần thưởng đã nhận (để hiện toast/animation) */
  reward: { wallet: Partial<Wallet>; shards?: { hero: string; n: number }; gear: string[] };
}
/** admin (header x-admin-key = MONKEY_ADMIN_KEY): danh sách TẤT CẢ sự kiện (cả đã tắt/hết hạn), lưu (id bỏ trống = tạo mới), xoá */
export interface AdminEventsRes {
  events: EventDef[];
}
export interface AdminEventSaveReq {
  event: Omit<EventDef, 'id'> & { id?: number };
}
export interface AdminEventDeleteReq {
  id: number;
}

/* ------------------------------ BANG HỘI ------------------------------ */
/** GET guild: thông tin bang của tôi (info = null nếu chưa có bang) */
export interface GuildRes {
  info: GuildInfo | null;
}
/** GET guild-search?q=: tìm bang theo tên (rỗng = bang mới/đông nhất), tối đa 20 */
export interface GuildSearchRes {
  guilds: GuildBrief[];
}
export interface GuildCreateReq {
  name: string;
  notice?: string;
}
export interface GuildJoinReq {
  id: number;
}
export interface GuildKickReq {
  member: number;
}
export interface GuildTransferReq {
  member: number;
}
export interface GuildNoticeReq {
  notice: string;
}
export interface GuildDonateReq {
  /** id trong GUILD_DONATIONS */
  option: string;
}
export interface GuildCheckinRes extends MutateRes {
  reward: Partial<Wallet>;
}
/** đánh boss bang: seed từ battle-start (body {stage:'guildboss'}); server dựng đội từ DB, chạy simulate(bossSetup) và cộng sát thương */
export interface GuildBossReq {
  squad: number;
  seed: number;
  inputs: BattleInput[];
  auto: boolean;
}
export interface GuildBossRes extends MutateRes {
  damage: number;
  reward: Partial<Wallet>;
  boss: GuildInfo['boss'];
  /** boss vừa bị hạ bởi lượt này */
  killed: boolean;
}
export interface GuildChatRes {
  messages: GuildChatMsg[];
}
export interface GuildChatPostReq {
  text: string;
}

/* ------------------------------ TÂN THỦ ------------------------------ */
/** GET newbie: điểm danh 7 ngày + tiến trình các mốc + cờ lượt quay khởi đầu (tính tại thời điểm gọi, đã reset ngày) */
export interface NewbieRes {
  view: NewbieView;
}
/** nhận quà điểm danh của ngày kế tiếp (1 lần/ngày, thứ tự 1→7) */
export interface NewbieLoginClaimRes extends MutateRes {
  day: number;
  reward: { wallet: Partial<Wallet>; shards?: { hero: string; n: number }; gear: string[]; heroGranted?: string };
  view: NewbieView;
}
export interface NewbieMilestoneClaimReq {
  id: string;
}
export interface NewbieMilestoneClaimRes extends MutateRes {
  reward: { wallet: Partial<Wallet>; shards?: { hero: string; n: number }; gear: string[] };
  view: NewbieView;
}
/** quay khởi đầu miễn phí 10 lượt (1 lần/tài khoản), `key` chống gửi trùng như summon */
export interface NewbieStarterSummonReq {
  key: string;
}
export interface NewbieStarterSummonRes extends SummonRes {
  view: NewbieView;
}
