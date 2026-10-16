// Giao diện lưu trữ tiến trình Bầy Khỉ. Hai bản cài đặt: PgStore (Neon Postgres, có DATABASE_URL)
// và MemStore (RAM — test/chạy local). Gameplay chỉ gọi qua interface này, không đụng SQL.

import type { EventDef, EventState, LeaderRow, MeResponse } from '../../../../shared/monkey/api.js';
import type { ItemInst, Loadout, Rarity, Reward, SkillKey, Slot, Stats } from '../../../../shared/monkey/progression.js';

export interface AccountRow {
  id: number;
  username: string;
  passHash: string;
}

/** kết quả một trận của MỘT người có tài khoản, server tính sẵn rồi giao cho store ghi (một giao dịch) */
export interface RunResult {
  accountId: number;
  /** 'endless' hoặc id ải */
  stage: string;
  won: boolean;
  stars: number;
  wave: number;
  kills: number;
  secs: number;
  score: number;
  /** thưởng đã tung (đồ chưa có uid) */
  reward: Reward & { items?: { itemId: string; rarity: Rarity; subs: Stats }[] };
}
/** dòng bảng xếp hạng ghi một lần cho cả đội */
export interface TeamRun {
  stage: string;
  solo: boolean;
  names: string[];
  cls: number[];
  wave: number;
  score: number;
  kills: number;
  secs: number;
}

export interface Store {
  /** chuẩn bị (migrate) — gọi một lần khi khởi động */
  init(): Promise<void>;
  readonly kind: 'pg' | 'mem';

  /* ---- tài khoản ---- */
  createAccount(username: string, passHash: string): Promise<number | null>; // null = trùng tên
  findAccount(username: string): Promise<AccountRow | null>;
  /** tra theo id (WS auth cần tên hiển thị) */
  accountById(id: number): Promise<AccountRow | null>;
  createSession(accountId: number, tokenHash: string, expiresAt: Date): Promise<void>;
  /** trả accountId nếu token còn hạn */
  sessionAccount(tokenHash: string): Promise<number | null>;
  deleteSession(tokenHash: string): Promise<void>;

  /* ---- hồ sơ ---- */
  me(accountId: number, now: Date): Promise<MeResponse>;
  /** dùng lúc vào trận: đồ đang mặc + cấp kỹ năng của nhân vật đó */
  loadout(accountId: number, cls: number): Promise<Loadout>;
  /** tập id ải đã qua (để lọc ải chơi được) */
  clearedStages(accountId: number): Promise<Set<string>>;

  /* ---- thao tác (kiểm tra quyền sở hữu + đủ tiền trong cùng giao dịch; ném StoreError nếu sai) ---- */
  equip(accountId: number, uid: number): Promise<void>;
  unequip(accountId: number, slot: Slot): Promise<void>;
  upgradeItem(accountId: number, uid: number): Promise<void>;
  salvage(accountId: number, uids: number[]): Promise<number>; // vàng nhận
  unlockChar(accountId: number, cls: number): Promise<void>;
  selectChar(accountId: number, cls: number): Promise<void>;
  upgradeSkill(accountId: number, cls: number, skill: SkillKey): Promise<void>;
  claimEvent(accountId: number, eventId: number, objective: string, now: Date): Promise<Reward>;
  /** cộng phần thưởng tuỳ ý (admin / sự kiện) — trả đồ đã tạo */
  grant(accountId: number, reward: Reward): Promise<ItemInst[]>;

  /* ---- kết quả trận ---- */
  /** ghi kết quả + thưởng + tiến trình ải + tiến trình sự kiện đang mở; trả đồ đã tạo (có uid) + lên cấp */
  recordRun(r: RunResult, now: Date): Promise<{ items: ItemInst[]; levelUps: number; newLevel: number; firstClear: boolean }>;
  recordTeamRun(t: TeamRun, now: Date): Promise<void>;
  leaderboard(stage: string, solo: boolean, limit: number): Promise<LeaderRow[]>;

  /* ---- sự kiện ---- */
  listEvents(): Promise<EventDef[]>;
  activeEvents(now: Date): Promise<EventDef[]>;
  saveEvent(e: EventDef): Promise<EventDef>; // id 0 → tạo mới
  deleteEvent(id: number): Promise<void>;
  eventStates(accountId: number, now: Date): Promise<EventState[]>;

  stats(): Promise<{ accounts: number; runs24h: number }>;
}

export class StoreError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
