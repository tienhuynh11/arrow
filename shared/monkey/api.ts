// Hợp đồng REST (/monkey/api/*) + phần mở rộng WebSocket cho tài khoản, kho đồ, ải, sự kiện.
// Client gửi header `Authorization: Bearer <token>` cho mọi route cần đăng nhập.

import type { ItemInst, Rarity, Reward, SkillKey, Slot, Stats } from './progression.js';

/* ======================= HỒ SƠ ======================= */
export interface Profile {
  id: number;
  username: string;
  level: number;
  xp: number;
  gold: number;
  /** mảnh nhân vật (Pháo Thủ) */
  shards: number;
  /** sách kỹ năng */
  books: number;
  /** nhân vật đã mở (chỉ số CLASSES) */
  chars: number[];
  /** nhân vật đang chọn */
  cls: number;
  /** cấp kỹ năng theo nhân vật: skills[cls] = {g,x,q} (thiếu = 1) */
  skills: Record<number, Record<SkillKey, number>>;
  /** tổng số khỉ đã hạ (mọi trận) */
  kills: number;
}
export interface StageProgress {
  stage: string;
  stars: number;
  bestSecs: number;
  clears: number;
}
export interface EventObjective {
  id: string;
  kind: 'kills' | 'clearStage' | 'reachWave' | 'playRuns';
  /** clearStage: id ải (có thể là ải sự kiện) */
  stage?: string;
  target: number;
  label: string;
  reward: Reward;
}
export interface EventDef {
  id: number;
  name: string;
  /** emoji / chữ ngắn hiển thị cạnh tên */
  icon: string;
  desc: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  enabled: boolean;
  /** ải sự kiện (id trong EVENT_STAGES) — tuỳ chọn */
  stage?: string;
  objectives: EventObjective[];
}
export interface EventState {
  event: EventDef;
  /** tiến trình theo objective id */
  progress: Record<string, number>;
  /** objective id đã nhận thưởng */
  claimed: string[];
}
export interface MeResponse {
  profile: Profile;
  items: ItemInst[];
  stages: StageProgress[];
  events: EventState[];
}

/* ======================= REST ======================= */
export interface AuthReq { username: string; password: string }
export interface AuthRes { token: string; me: MeResponse }
export interface EquipReq { uid: number }
export interface UnequipReq { slot: Slot }
export interface UpgradeItemReq { uid: number }
export interface SalvageReq { uids: number[] }
export interface UnlockCharReq { cls: number }
export interface SelectCharReq { cls: number }
export interface UpgradeSkillReq { cls: number; skill: SkillKey }
export interface ClaimEventReq { eventId: number; objective: string }
/** mọi route thay đổi trả về hồ sơ mới nhất (+ thông tin thêm nếu có) */
export interface MutateRes { me: MeResponse; granted?: Reward }
export interface ApiError { error: string }

/** GET leaderboard */
export interface LeaderboardRes { rows: LeaderRow[] }
/** GET admin/events */
export interface AdminEventsRes { events: EventDef[] }
/** POST admin/events */
export interface AdminEventRes { event: EventDef }
/** POST admin/grant */
export interface AdminGrantReq { username: string; reward: Reward }
export interface AdminGrantRes { items: ItemInst[] }
/** GET admin/stats */
export interface AdminStatsRes { accounts: number; online: number; runs24h: number }

export interface LeaderRow { names: string[]; cls: number[]; stage?: string; wave: number; score: number; kills: number; secs: number; at: number }

/** đường dẫn */
export const API = {
  register: 'api/register',
  login: 'api/login',
  logout: 'api/logout',
  me: 'api/me',
  equip: 'api/equip',
  unequip: 'api/unequip',
  upgradeItem: 'api/upgrade-item',
  salvage: 'api/salvage',
  unlockChar: 'api/unlock-char',
  selectChar: 'api/select-char',
  upgradeSkill: 'api/upgrade-skill',
  claimEvent: 'api/claim-event',
  leaderboard: 'api/leaderboard', // GET ?stage=<id>|endless&solo=1
  // admin (header x-admin-key)
  adminEvents: 'api/admin/events', // GET list, POST create/update (body EventDef, id=0 → tạo mới)
  adminEventDelete: 'api/admin/events/delete', // POST {id}
  adminGrant: 'api/admin/grant', // POST {username, reward: Reward}
  adminStats: 'api/admin/stats', // GET {accounts, online, runs24h}
} as const;

/* ======================= WS mở rộng ======================= */
/** gửi ngay sau khi kết nối nếu đã đăng nhập: {t:'auth', token} → server trả {t:'authed', username} hoặc {t:'err'} */
export interface WsAuth { t: 'auth'; token: string }

/** kết quả trận cho từng người (tin 'victory' và 'over' mang theo khi chơi có tài khoản) */
export interface RunReward {
  idx: number;
  /** null = khách, không có thưởng */
  reward: (Reward & { items?: { uid: number; itemId: string; rarity: Rarity; subs: Stats }[] }) | null;
  levelUps: number;
  newLevel: number;
  firstClear: boolean;
}
