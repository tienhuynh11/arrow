// HeroStore trong RAM — dùng cho test và khi chạy local không có DATABASE_URL (mất khi khởi động lại).
// Mỗi thao tác chạy đồng bộ trọn vẹn trên BẢN SAO rồi mới ghi đè nên tương đương một giao dịch (ném lỗi = không ghi gì).

import { assertWallet, bestStage, ledgerOf, newState, rollDay, STARTER_WALLET } from '../rules.js';
import { StoreError, type HState, type HeroStore, type LeaderEntry, type LedgerRow, type MutateOpts, type RunRow } from './store.js';

export class HeroMemStore implements HeroStore {
  readonly kind = 'mem' as const;
  private states = new Map<number, HState>();
  /** bộ đếm uid trang bị (toàn cục như bigserial) */
  private nextGearUid = 1;
  private idem = new Map<string, { tag: string; value: unknown }>();
  /** để test kiểm tra */
  readonly ledger: (LedgerRow & { accountId: number })[] = [];
  readonly runs: (RunRow & { accountId: number })[] = [];

  async init() {}

  async view<T>(accountId: number, now: Date, fn: (s: Readonly<HState>) => T): Promise<T> {
    const cur = this.states.get(accountId);
    if (cur) return fn(structuredClone(cur));
    await this.mutate(accountId, now, 'provision', () => 0); // uid trang bị khởi đầu chỉ có sau khi ghi → đọc lại
    return this.view(accountId, now, fn);
  }

  async mutate<T>(accountId: number, now: Date, kind: string, fn: (s: HState) => T, opts?: MutateOpts): Promise<T> {
    const cur = this.states.get(accountId);
    const fresh = !cur;
    const s = cur ? structuredClone(cur) : newState(accountId, now.getTime());
    const ik = opts?.idem ? `${accountId}:${opts.idem.key}` : null;
    if (ik) {
      const old = this.idem.get(ik);
      if (old) {
        if (old.tag !== opts!.idem!.tag) throw new StoreError('Khoá yêu cầu đã dùng cho thao tác khác', 409);
        return structuredClone(old.value) as T;
      }
    }
    const before = { ...s.wallet };
    rollDay(s, now.getTime()); // sang ngày mới: reset Tháp/nhiệm vụ/cửa hàng + tính "đăng nhập"
    const out = fn(s);
    assertWallet(s);
    for (const def of s.newGear) s.gear.push({ uid: this.nextGearUid++, def, level: 0, hero: null });
    s.newGear = [];
    // --- ghi (sau khi mọi kiểm tra đã qua) ---
    if (fresh) this.ledger.push({ accountId, kind: 'starter', delta: { ...STARTER_WALLET } });
    const l = ledgerOf(before, s.wallet, kind);
    if (l) this.ledger.push({ accountId, ...l });
    for (const r of s.runs) this.runs.push({ accountId, ...r });
    s.runs = [];
    this.states.set(accountId, s);
    if (ik) this.idem.set(ik, { tag: opts!.idem!.tag, value: structuredClone(out) });
    return out;
  }

  async leaderboard(limit: number): Promise<LeaderEntry[]> {
    const rows: LeaderEntry[] = [];
    for (const [accountId, s] of this.states) {
      const b = bestStage(s);
      if (b) rows.push({ accountId, ...b });
    }
    rows.sort((a, b) => b.stage - a.stage || b.stars - a.stars || a.accountId - b.accountId);
    return rows.slice(0, limit);
  }
}
