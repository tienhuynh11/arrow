// Giao diện lưu trữ tiến trình game Thẻ Tướng. Hai bản cài đặt: HeroPgStore (Neon Postgres, dùng chung pool với Bầy Khỉ)
// và HeroMemStore (RAM — test/chạy local). Toàn bộ luật chơi nằm ở rules.ts (hàm thuần trên HState), store chỉ lo
// "khoá tài khoản → nạp HState → chạy hàm → ghi lại" trong MỘT giao dịch. Tài khoản/phiên dùng chung bảng của Bầy Khỉ.

import type { PityState } from '../../../../shared/heroes/gacha.js';
import type { GearInst } from '../../../../shared/heroes/gear.js';
import type { OwnedHero, Wallet } from '../../../../shared/heroes/types.js';
import type { StageProgress } from '../../../../shared/heroes/api.js';

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
}
