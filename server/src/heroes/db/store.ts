// Giao diện lưu trữ tiến trình game Thẻ Tướng. Hai bản cài đặt: HeroPgStore (Neon Postgres, dùng chung pool với Bầy Khỉ)
// và HeroMemStore (RAM — test/chạy local). Toàn bộ luật chơi nằm ở rules.ts (hàm thuần trên HState), store chỉ lo
// "khoá tài khoản → nạp HState → chạy hàm → ghi lại" trong MỘT giao dịch. Tài khoản/phiên dùng chung bảng của Bầy Khỉ.

import type { PityState } from '../../../../shared/heroes/gacha.js';
import type { GearInst } from '../../../../shared/heroes/gear.js';
import type { OwnedHero, Wallet } from '../../../../shared/heroes/types.js';
import type { StageProgress } from '../../../../shared/heroes/api.js';
import type { EventDef } from '../../../../shared/heroes/events.js';
import type { GuildChatMsg, GuildRole } from '../../../../shared/heroes/guild.js';

/** dùng lại lỗi của Bầy Khỉ để accounts.ts và hero cùng một lớp lỗi (api bắt một chỗ) */
export { StoreError } from '../../monkey/db/store.js';

/** một trận đã chấm, chờ ghi vào h_runs */
export interface RunRow {
  stage: string;
  win: boolean;
  stars: number;
  ticks: number;
}

/** toàn bộ trạng thái một tài khoản (nhỏ: vài chục dòng) — nạp, sửa bằng hàm thuần, ghi lại */
export interface HState {
  accountId: number;
  wallet: Wallet;
  level: number;
  xp: number;
  /** thể lực đã lưu + mốc (ms) tính hồi; dùng staminaNow() để biết giá trị hiện tại */
  stamina: number;
  staminaAt: number;
  /** mốc bắt đầu tích AFK (ms) */
  afkSince: number;
  activeSquad: number;
  pity: Record<string, PityState>;
  /** theo thứ tự nhận */
  heroes: Record<string, OwnedHero>;
  squads: string[][];
  progress: Record<string, StageProgress>;
  /** các trận mới, store ghi vào h_runs */
  runs: RunRow[];
  /** kho trang bị, theo uid tăng dần */
  gear: GearInst[];
  /**
   * Món MỚI tạo trong thao tác này (id GearDef), chưa có uid. Quy ước: rules.ts chỉ việc `s.newGear.push(defId)`;
   * store, sau khi `fn` chạy xong và ví hợp lệ, cấp uid (bigserial ở PG, bộ đếm ở RAM), chuyển chúng vào `gear`
   * (cấp 0, chưa mặc) rồi xoá `newGear`. Vì uid chỉ có SAU giao dịch nên hồ sơ trả về client phải dựng SAU `mutate`.
   */
  newGear: string[];
  /** Tháp: tầng cao nhất đã qua */
  towerFloor: number;
  /** dayKey của lần cấp lượt thử gần nhất; khác hôm nay → reset lượt (xem rollDay) */
  towerDay: number;
  towerTries: number;
  /** dayKey mà `quests`, `questBonus`, `shop` thuộc về (hàng ngày cũ bị xoá khi ghi) */
  day: number;
  quests: Record<string, { progress: number; claimed: boolean }>;
  /** đã nhận thưởng thêm khi xong hết nhiệm vụ (PG: hàng quest_id='bonus' trong h_quest) */
  questBonus: boolean;
  /** số lần đã mua hôm nay theo id mặt hàng */
  shop: Record<string, number>;
  /** đã có hàng h_arena (tạo lười ở lần đầu chạm đấu trường); false → store không ghi hàng arena */
  arenaOn: boolean;
  arenaRating: number;
  /** dayKey của lần cấp lượt đấu trường gần nhất (xem rollDay) */
  arenaDay: number;
  arenaTries: number;
  /** chỉ số đội dùng làm đội phòng thủ */
  arenaDefense: number;
  arenaWins: number;
  arenaLosses: number;
  /** mốc (ms) lần rời bang gần nhất, tính thời gian chờ vào bang khác (0 = chưa từng) */
  guildLeftAt: number;
  /** bang đang ở — CHỈ ĐỌC, store nạp từ bảng thành viên (ghi bằng mutateGuild, không qua đây) */
  guildId: number | null;
  /** các sự kiện đang diễn ra tại thời điểm giao dịch + tiến trình của tài khoản (chỉ nạp sự kiện còn hiệu lực) */
  events: EventState[];
}

/** một sự kiện đang hiệu lực + tiến trình theo id mục tiêu */
export interface EventState {
  def: EventDef;
  rows: Record<string, { progress: number; claimed: boolean }>;
}

/** một bang (id = 0: chưa lưu, store sẽ cấp id khi ghi) */
export interface GuildRow {
  id: number;
  name: string;
  level: number;
  exp: number;
  notice: string;
  leaderId: number;
  createdAt: number;
  /** chu kỳ boss mà bossHp thuộc về (xem bossCycle) */
  bossCycle: number;
  bossHp: number;
  bossHpMax: number;
  bossKilled: boolean;
}
export interface GuildMemberRow {
  accountId: number;
  guildId: number;
  role: GuildRole;
  contribution: number;
  bossDamage: number;
  joinedAt: number;
  /** dayKey + số lượt quyên góp trong ngày đó */
  donatedDay: number;
  donatedN: number;
  checkinDay: number;
  /** dayKey + số lượt đánh boss đã dùng trong ngày đó */
  bossDay: number;
  bossTriesUsed: number;
}
/**
 * Ngữ cảnh bang trong một giao dịch mutateGuild (đã khoá hàng bang FOR UPDATE). Hàm luật sửa trực tiếp `guild`/`members`:
 * bỏ một phần tử khỏi `members` = xoá thành viên; đặt `deleted` = giải tán bang; tạo bang = đặt `guild` với id 0.
 */
export interface GuildCtx {
  /** bang đích: bang của tôi, hoặc bang được chỉ định khi xin vào (null = không có) */
  guild: GuildRow | null;
  /** thành viên của `guild` */
  members: GuildMemberRow[];
  /** bang tôi đang ở (độc lập với `guild`) */
  myGuildId: number | null;
  deleted: boolean;
  /** tài khoản KHÁC được xếp hàng nhận thưởng hạ boss (nhận ở lần chạm kế tiếp, đúng một lần) */
  killRewards: number[];
}
export interface GuildListRow {
  guild: GuildRow;
  members: number;
}

export interface LedgerRow {
  kind: string;
  delta: Partial<Wallet>;
}

export interface MutateOpts {
  /** chống gửi trùng: cùng key → trả lại kết quả cũ, không chạy lại. `tag` = dấu vân tay tham số (khác tag → 409) */
  idem?: { key: string; tag: string };
}

export interface LeaderEntry {
  accountId: number;
  /** ải cao nhất đã qua (index) */
  stage: number;
  stars: number;
}

/** một hàng xếp hạng đấu trường (tên tài khoản do api tra) */
export interface ArenaRank {
  accountId: number;
  rating: number;
  wins: number;
}

export interface HeroStore {
  readonly kind: 'pg' | 'mem';
  /** chuẩn bị (migrate) — gọi một lần */
  init(): Promise<void>;
  /** đọc (tự tạo hồ sơ khởi đầu nếu chưa có). `fn` KHÔNG được sửa state */
  view<T>(accountId: number, now: Date, fn: (s: Readonly<HState>) => T): Promise<T>;
  /**
   * Một giao dịch: khoá hồ sơ (FOR UPDATE) → chạy `fn` (đồng bộ, được ném StoreError để huỷ) → kiểm tra ví không âm →
   * ghi hồ sơ + ghi h_ledger (chênh lệch ví, nhãn `kind`) + h_runs. Trả kết quả của `fn` (hoặc kết quả cũ nếu trùng idem).
   * T phải là JSON thuần (được lưu cho idempotency).
   */
  mutate<T>(accountId: number, now: Date, kind: string, fn: (s: HState) => T, opts?: MutateOpts): Promise<T>;
  /** top theo ải cao nhất đã qua, rồi số sao ở ải đó */
  leaderboard(limit: number): Promise<LeaderEntry[]>;
  /**
   * Ứng viên đối thủ: tài khoản KHÁC `selfId` đã có hàng đấu trường và đội phòng thủ có ít nhất 1 tướng (theo dữ liệu hiện tại),
   * gần điểm `rating` nhất (|Δ| tăng dần, rồi id). Chỉ đọc, không khoá ai.
   */
  arenaNear(selfId: number, rating: number, limit: number): Promise<ArenaRank[]>;
  /** đọc (không khoá, không tạo hồ sơ) trạng thái SỐNG của một tài khoản khác; null nếu chưa có hồ sơ */
  peek<T>(accountId: number, fn: (s: Readonly<HState>) => T): Promise<T | null>;
  /** hạng 1-based theo (điểm ↓, thắng ↓, id ↑) trong mọi hàng đấu trường; 0 nếu chưa có hàng */
  arenaRank(accountId: number): Promise<number>;
  /** top theo (điểm ↓, thắng ↓, id ↑) */
  arenaTop(limit: number): Promise<ArenaRank[]>;

  /* ---- sự kiện (admin) ---- */
  adminEvents(): Promise<EventDef[]>;
  /** tạo (id bỏ trống) hoặc sửa; sửa giữ tiến trình, mục tiêu bị bỏ thì xoá hàng tiến trình. Không có id → 404 */
  adminEventSave(ev: Omit<EventDef, 'id'> & { id?: number }): Promise<EventDef>;
  adminEventDelete(id: number): Promise<void>;

  /* ---- bang hội ---- */
  /**
   * Giao dịch có bang: khoá hồ sơ → khoá hàng bang (bang `target`, hoặc bang của tôi nếu null) → fn(state, ctx) → ghi cả hai.
   * Thứ tự khoá luôn là hồ sơ rồi bang nên không có khoá chéo.
   */
  mutateGuild<T>(accountId: number, now: Date, kind: string, target: number | null, fn: (s: HState, g: GuildCtx) => T): Promise<T>;
  /** đọc bang của tôi (không khoá) */
  viewGuild<T>(accountId: number, now: Date, fn: (s: Readonly<HState>, g: Readonly<GuildCtx>) => T): Promise<T>;
  /** mọi bang kèm số thành viên (đông nhất trước, rồi id) — api lọc theo tên */
  guildList(limit: number): Promise<GuildListRow[]>;
  /** tin nhắn mới nhất (cũ → mới); null nếu không thuộc bang nào */
  guildChat(accountId: number, limit: number): Promise<GuildChatMsg[] | null>;
  /** đăng tin vào bang của tài khoản, giữ GUILD_CHAT_KEEP tin cuối; không thuộc bang → StoreError */
  guildChatPost(accountId: number, username: string, text: string, nowMs: number): Promise<GuildChatMsg>;
  /** số phần thưởng hạ boss đang chờ (đọc rẻ, không khoá) */
  pendingKill(accountId: number): Promise<number>;
}
