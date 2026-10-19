// Luật nghiệp vụ dùng chung cho MemStore và PgStore: kiểm tra + tính toán thuần (không đụng lưu trữ).
// Mỗi hàm check* ném StoreError (thông báo tiếng Việt) nếu thao tác không hợp lệ.
// `Inv` = bộ lập kế hoạch kho đồ v2: nạp toàn bộ đồ của MỘT tài khoản, thực hiện thao tác trên bản sao, ghi lại
// các thay đổi (thêm / sửa / xoá) để store áp vào lưu trữ trong cùng giao dịch.

import { randomInt } from 'node:crypto';
import type { EventDef, EventObjective } from '../../../../shared/monkey/api.js';
import type { ExtractResult } from '../../../../shared/monkey/gear.js';
import {
  BAG_CAP,
  CHAR_UNLOCK,
  ITEM_BY_ID,
  ITEM_MAX_LEVEL,
  SHOP_STOCK,
  SKILL_MAX,
  SLOT_ACCEPTS,
  STAGE_BY_ID,
  STARTER_KIT,
  STASH_CAP,
  UPGRADE_STONE,
  addXp,
  canClaimStarter,
  fitGrade,
  isEquipSlot,
  itemLevelReq,
  levelUpGold,
  rollAffixes,
  sellPrice,
  skillCost,
  upgradeCost,
  upgradeStones,
  type EquipSlot,
  type Grade,
  type ItemInst,
  type Reward,
  type RewardItem,
  type SkillKey,
  type Stats2,
  type StatKey2,
  STAT2_INFO,
} from '../../../../shared/monkey/progression.js';
import { StoreError, type ExtractRun, type RunResult } from './store.js';

export const NUM_CHARS = CHAR_UNLOCK.length;
export const DEFAULT_CHARS = CHAR_UNLOCK.map((r, i) => (r.kind === 'default' ? i : -1)).filter((i) => i >= 0);
export const SKILL_KEYS: SkillKey[] = ['g', 'x', 'q'];
/** trần tiền tệ để không tràn cột integer */
export const MONEY_CAP = 1_000_000_000;
/** @deprecated v1 — dùng BAG_CAP / STASH_CAP */
export const MAX_ITEMS = BAG_CAP + STASH_CAP;

/** rng mật mã ∈ [0,1) */
export const cryptoRng = () => randomInt(0, 2 ** 31) / 2 ** 31;

export const isSlot = isEquipSlot;
export const isSkill = (s: unknown): s is SkillKey => s === 'g' || s === 'x' || s === 'q';
export const isCls = (c: unknown): c is number => Number.isInteger(c) && (c as number) >= 0 && (c as number) < NUM_CHARS;
const nn = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

export interface Wallet {
  level: number;
  xp: number;
  gold: number;
  shards: number;
  books: number;
}

/** cộng vàng/xp/mảnh/sách vào ví (xp lên cấp → thưởng vàng). Trả số cấp đã lên. */
export function applyGain(w: Wallet, r: Pick<Reward, 'gold' | 'xp' | 'shards' | 'books'>): number {
  w.gold = Math.min(MONEY_CAP, w.gold + nn(r.gold));
  w.shards = Math.min(MONEY_CAP, w.shards + nn(r.shards));
  w.books = Math.min(MONEY_CAP, w.books + nn(r.books));
  const xp = nn(r.xp);
  if (!xp) return 0;
  const before = w.level;
  const res = addXp(w.level, w.xp, xp);
  w.level = res.level;
  w.xp = res.xp;
  for (let lv = before + 1; lv <= res.level; lv++) w.gold = Math.min(MONEY_CAP, w.gold + levelUpGold(lv));
  return res.ups;
}

/** dòng phụ hợp lệ (khoá có thật, số hữu hạn, kẹp trần ×1 — chống dữ liệu bẩn) */
export function cleanAffixes(a: unknown): Stats2 {
  const out: Stats2 = {};
  if (!a || typeof a !== 'object') return out;
  for (const [k, v] of Object.entries(a as Record<string, unknown>)) {
    if (!(k in STAT2_INFO) || typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[k as StatKey2] = Math.min(STAT2_INFO[k as StatKey2].cap, Math.max(0, v));
  }
  return out;
}

/** đồ trong phần thưởng → danh sách hợp lệ (itemId có thật, phẩm trong khoảng, dòng phụ; nhận cả `rarity` của v1) */
export function rewardItems(items: readonly (RewardItem & { rarity?: number })[] | undefined): Required<RewardItem>[] {
  const out: Required<RewardItem>[] = [];
  for (const it of items ?? []) {
    const def = ITEM_BY_ID[it?.itemId];
    if (!def) continue;
    const g = fitGrade(def, it.grade ?? it.rarity ?? 0);
    const count = def.stack ? Math.max(1, Math.min(MONEY_CAP, nn(it.count) || 1)) : 1;
    out.push({ itemId: def.id, grade: g, subs: it.subs && typeof it.subs === 'object' ? cleanAffixes(it.subs) : rollAffixes(def, g, cryptoRng), count });
    if (!def.stack && nn(it.count) > 1) for (let i = 1; i < Math.min(20, nn(it.count)); i++) out.push({ itemId: def.id, grade: g, subs: rollAffixes(def, g, cryptoRng), count: 1 });
  }
  return out;
}

export function checkGold(w: Wallet, gold: number) {
  if (w.gold < gold) throw new StoreError(`Không đủ vàng (cần ${gold})`);
}

export function checkItemOwned<T>(it: T | null | undefined): T {
  if (!it) throw new StoreError('Không tìm thấy món đồ', 404);
  return it;
}

/** kiểm tra mở nhân vật; trả số mảnh phải tiêu */
export function checkUnlock(cls: number, w: Wallet, owned: boolean, cleared: (stage: string) => boolean): number {
  if (!isCls(cls)) throw new StoreError('Nhân vật không hợp lệ');
  if (owned) throw new StoreError('Nhân vật đã mở rồi');
  const r = CHAR_UNLOCK[cls];
  switch (r.kind) {
    case 'default':
      return 0;
    case 'level':
      if (w.level < r.level) throw new StoreError(`Cần đạt cấp ${r.level}`);
      return 0;
    case 'stage':
      if (!cleared(r.stage)) throw new StoreError(`Cần qua ải ${r.stage}`);
      return 0;
    case 'shards':
      if (w.shards < r.shards) throw new StoreError(`Cần ${r.shards} mảnh nhân vật`);
      return r.shards;
    case 'event':
      throw new StoreError('Nhân vật này chỉ mở bằng phần thưởng sự kiện');
  }
}

/** chi phí nâng kỹ năng từ `cur` lên cur+1 */
export function checkSkill(cls: number, skill: SkillKey, cur: number, owned: boolean, w: Wallet) {
  if (!isCls(cls)) throw new StoreError('Nhân vật không hợp lệ');
  if (!isSkill(skill)) throw new StoreError('Kỹ năng không hợp lệ');
  if (!owned) throw new StoreError('Chưa mở nhân vật này');
  if (cur >= SKILL_MAX) throw new StoreError('Kỹ năng đã đạt cấp tối đa');
  const c = skillCost(cur + 1);
  if (w.gold < c.gold) throw new StoreError(`Không đủ vàng (cần ${c.gold})`);
  if (w.books < c.books) throw new StoreError(`Không đủ sách kỹ năng (cần ${c.books})`);
  return c;
}

export const eventActive = (e: EventDef, now: Date) => e.enabled && Date.parse(e.startsAt) <= now.getTime() && now.getTime() < Date.parse(e.endsAt);

/** tiến trình mới của một sự kiện sau một trận */
export function eventAfterRun(e: EventDef, prev: Record<string, number>, r: Pick<RunResult, 'kills' | 'won' | 'stage' | 'wave'>): Record<string, number> {
  const p = { ...prev };
  for (const o of e.objectives) {
    const cur = p[o.id] ?? 0;
    let v = cur;
    if (o.kind === 'kills') v = cur + nn(r.kills);
    else if (o.kind === 'playRuns') v = cur + 1;
    else if (o.kind === 'clearStage') v = r.won && r.stage === o.stage ? cur + 1 : cur;
    else if (o.kind === 'reachWave') v = Math.max(cur, nn(r.wave));
    p[o.id] = Math.min(v, Math.max(o.target, 0), MONEY_CAP);
  }
  return p;
}

/** kiểm tra nhận thưởng một mục tiêu sự kiện */
export function checkClaim(e: EventDef | null | undefined, objective: string, progress: Record<string, number>, claimed: string[], now: Date): EventObjective {
  if (!e) throw new StoreError('Không tìm thấy sự kiện', 404);
  if (!eventActive(e, now)) throw new StoreError('Sự kiện không còn mở');
  const o = e.objectives.find((x) => x.id === objective);
  if (!o) throw new StoreError('Không có mục tiêu này');
  if (claimed.includes(o.id)) throw new StoreError('Đã nhận thưởng mục tiêu này rồi');
  if ((progress[o.id] ?? 0) < o.target) throw new StoreError('Chưa hoàn thành mục tiêu');
  return o;
}

/** chuẩn hoá kết quả trận (số nguyên không âm, sao 0..3) */
export function cleanRun<T extends RunResult | ExtractRun>(r: T): T {
  return {
    ...r,
    stage: String(r.stage).slice(0, 40),
    won: !!r.won,
    stars: Math.min(3, nn(r.stars)),
    wave: nn(r.wave),
    kills: nn(r.kills),
    secs: nn(r.secs),
    score: nn(r.score),
  };
}

/** thưởng lần đầu qua ải (ải phải có trong danh mục) */
export function firstReward(stage: string): Reward | null {
  return STAGE_BY_ID[stage]?.first ?? null;
}

/** sự kiện đầu tiên tạo sẵn lúc migrate (khi chưa có sự kiện nào) */
export function seedEvent(now: Date): EventDef {
  return {
    id: 0,
    name: 'Tuần Lễ Chuối Vàng',
    icon: '🍌',
    desc: 'Cả bầy khỉ kéo về vườn chuối! Hạ khỉ, qua ải Vườn Chuối để nhận Mũ Chuối Vàng và nhiều quà.',
    startsAt: now.toISOString(),
    endsAt: new Date(now.getTime() + 7 * 86400_000).toISOString(),
    enabled: true,
    stage: 'ev-vuonchuoi',
    objectives: [
      { id: 'kills', kind: 'kills', target: 300, label: 'Hạ 300 khỉ', reward: { items: [{ itemId: 'h_chuoi', grade: 2 }] } },
      { id: 'clear', kind: 'clearStage', stage: 'ev-vuonchuoi', target: 1, label: 'Qua ải Vườn Chuối', reward: { gold: 500, books: 1 } },
      { id: 'play', kind: 'playRuns', target: 3, label: 'Chơi 3 trận', reward: { gold: 200 } },
    ],
  };
}

/** loại đồ theo danh mục (món lạ coi như nguyên liệu) */
export const kindOf = (itemId: string) => ITEM_BY_ID[itemId]?.kind ?? 'material';

/* ======================= BỘ LẬP KẾ HOẠCH KHO ĐỒ ======================= */
/** kết quả cất đồ vào kho */
export interface PlaceResult {
  /** số lượng không còn chỗ (đã đổi ra vàng nếu overflowGold) */
  left: number;
  gold: number;
}
/** thay đổi cần ghi: uid âm = món mới (store cấp uid thật) */
export interface InvChanges {
  added: ItemInst[];
  updated: ItemInst[];
  removed: number[];
}

const placeOf = (it: ItemInst) => (it.slot ? 'equip' : it.stash ? 'stash' : 'bag');

export class Inv {
  readonly items: ItemInst[];
  private tmp = 0;
  private added = new Set<number>();
  private dirty = new Set<number>();
  private gone = new Set<number>();
  /** món mới / thay đổi do thưởng (để báo client) */
  readonly touched = new Set<number>();

  constructor(items: readonly ItemInst[], readonly w: Wallet) {
    this.items = items.map((i) => ({ ...i, affixes: { ...i.affixes } }));
  }

  get(uid: number): ItemInst {
    return checkItemOwned(Number.isInteger(uid) ? this.items.find((i) => i.uid === uid) : undefined);
  }
  bagCount() {
    return this.items.reduce((n, i) => n + (!i.slot && !i.stash ? 1 : 0), 0);
  }
  stashCount() {
    return this.items.reduce((n, i) => n + (!i.slot && i.stash ? 1 : 0), 0);
  }
  inSlot(s: EquipSlot) {
    return this.items.find((i) => i.slot === s);
  }
  equipped() {
    return this.items.filter((i) => i.slot);
  }
  private mark(it: ItemInst) {
    if (!this.added.has(it.uid)) this.dirty.add(it.uid);
  }
  private remove(it: ItemInst) {
    const k = this.items.indexOf(it);
    if (k >= 0) this.items.splice(k, 1);
    if (this.added.has(it.uid)) this.added.delete(it.uid);
    else {
      this.dirty.delete(it.uid);
      this.gone.add(it.uid);
    }
    this.touched.delete(it.uid);
  }
  private create(itemId: string, grade: Grade, affixes: Stats2, count: number, slot: EquipSlot | null, stash: boolean): ItemInst {
    const it: ItemInst = { uid: --this.tmp, itemId, grade, level: 1, affixes, count, slot, stash };
    this.items.push(it);
    this.added.add(it.uid);
    this.touched.add(it.uid);
    return it;
  }
  changes(): InvChanges {
    return {
      added: this.items.filter((i) => this.added.has(i.uid)),
      updated: this.items.filter((i) => this.dirty.has(i.uid)),
      removed: [...this.gone],
    };
  }

  /** cất `count` món vào túi (gộp chồng trước), rồi kho; trả phần còn thừa */
  place(itemId: string, grade: Grade, affixes: Stats2, count: number, where: 'auto' | 'bag' | 'stash' = 'auto'): number {
    const def = ITEM_BY_ID[itemId];
    if (!def || count <= 0) return 0;
    let left = count;
    const spots: ('bag' | 'stash')[] = where === 'auto' ? ['bag', 'stash'] : [where];
    for (const sp of spots) {
      if (def.stack) {
        for (const s of this.items) {
          if (left <= 0) break;
          if (s.itemId !== itemId || s.grade !== grade || placeOf(s) !== sp || s.count >= def.stack) continue;
          const n = Math.min(left, def.stack - s.count);
          s.count += n;
          left -= n;
          this.mark(s);
          this.touched.add(s.uid);
        }
      }
      const capN = sp === 'bag' ? BAG_CAP : STASH_CAP;
      while (left > 0 && (sp === 'bag' ? this.bagCount() : this.stashCount()) < capN) {
        const n = def.stack ? Math.min(left, def.stack) : 1;
        this.create(itemId, grade, def.stack ? {} : affixes, n, null, sp === 'stash');
        left -= n;
      }
      if (left <= 0) break;
    }
    return left;
  }
  /** cất đồ thưởng; tiền tệ đổi thẳng; hết chỗ → đổi vàng theo giá bán */
  give(list: readonly Required<RewardItem>[] | readonly { itemId: string; grade: Grade; subs?: Stats2; count?: number }[]): PlaceResult {
    let gold = 0;
    let leftAll = 0;
    for (const it of list) {
      const def = ITEM_BY_ID[it.itemId];
      if (!def) continue;
      const g = fitGrade(def, it.grade);
      const count = Math.max(1, Math.min(MONEY_CAP, nn(it.count) || 1));
      if (def.currency) {
        if (def.currency === 'gold') this.w.gold = Math.min(MONEY_CAP, this.w.gold + count);
        else if (def.currency === 'shards') this.w.shards = Math.min(MONEY_CAP, this.w.shards + count);
        else this.w.books = Math.min(MONEY_CAP, this.w.books + count);
        continue;
      }
      const n = def.stack ? count : 1;
      for (let k = 0; k < (def.stack ? 1 : Math.min(20, count)); k++) {
        const left = this.place(def.id, g, cleanAffixes(it.subs ?? {}), n);
        if (left > 0) {
          leftAll += left;
          gold += sellPrice({ itemId: def.id, grade: g, level: 1, count: left });
        }
      }
    }
    this.w.gold = Math.min(MONEY_CAP, this.w.gold + gold);
    return { left: leftAll, gold };
  }

  /** mặc món `uid` vào ô `slot`; món đang ở ô đó chuyển về chỗ cũ của món mới (hoặc túi) */
  equip(uid: number, slot: EquipSlot) {
    if (!isEquipSlot(slot)) throw new StoreError('Ô trang bị không hợp lệ');
    const it = this.get(uid);
    const def = ITEM_BY_ID[it.itemId];
    if (!def || !SLOT_ACCEPTS[slot].includes(def.kind)) throw new StoreError('Món này không mặc được vào ô đó');
    if (slot !== 'secure' && this.w.level < itemLevelReq(def, it.grade)) throw new StoreError(`Cần đạt cấp ${itemLevelReq(def, it.grade)}`);
    if (it.slot === slot) return;
    const from = { slot: it.slot, stash: it.stash };
    const cur = this.inSlot(slot);
    it.slot = slot;
    it.stash = false;
    this.mark(it);
    if (!cur) return;
    const cdef = ITEM_BY_ID[cur.itemId];
    if (from.slot && cdef && SLOT_ACCEPTS[from.slot].includes(cdef.kind)) {
      cur.slot = from.slot; // đổi chỗ 2 ô (vd súng chính ↔ súng phụ)
    } else {
      cur.slot = null;
      cur.stash = from.stash && !from.slot; // món mới lấy từ kho → món cũ vào kho
      if (!cur.stash && this.bagCount() > BAG_CAP) throw new StoreError('Túi đồ đã đầy');
      if (cur.stash && this.stashCount() > STASH_CAP) throw new StoreError('Kho đã đầy');
    }
    this.mark(cur);
  }
  unequip(slot: EquipSlot) {
    if (!isEquipSlot(slot)) throw new StoreError('Ô trang bị không hợp lệ');
    const cur = this.inSlot(slot);
    if (!cur) return;
    if (this.bagCount() >= BAG_CAP) throw new StoreError('Túi đồ đã đầy');
    cur.slot = null;
    cur.stash = false;
    this.mark(cur);
  }
  /** chuyển món sang kho (stash=true) hoặc túi (false); món đang mặc được tháo ra */
  move(uid: number, toStash: boolean) {
    const it = this.get(uid);
    if (!it.slot && it.stash === toStash) return;
    if (toStash ? this.stashCount() >= STASH_CAP : this.bagCount() >= BAG_CAP) throw new StoreError(toStash ? 'Kho đã đầy' : 'Túi đồ đã đầy');
    it.slot = null;
    it.stash = toStash;
    this.mark(it);
    // gộp chồng
    const def = ITEM_BY_ID[it.itemId];
    if (def?.stack) {
      for (const s of this.items) {
        if (s === it || s.itemId !== it.itemId || s.grade !== it.grade || placeOf(s) !== placeOf(it) || s.count >= def.stack) continue;
        const n = Math.min(it.count, def.stack - s.count);
        s.count += n;
        it.count -= n;
        this.mark(s);
        if (it.count <= 0) {
          this.remove(it);
          break;
        }
      }
    }
  }
  /** bán cho thương nhân — trả vàng nhận */
  sell(uids: readonly number[]): number {
    const list = [...new Set(uids)].map((u) => this.get(u));
    if (!list.length) throw new StoreError('Chưa chọn món đồ nào');
    if (list.some((i) => i.slot)) throw new StoreError('Không thể bán đồ đang mặc');
    let gold = 0;
    for (const it of list) {
      gold += sellPrice(it);
      this.remove(it);
    }
    this.w.gold = Math.min(MONEY_CAP, this.w.gold + gold);
    return gold;
  }
  /** mua hàng thứ `idx` của thương nhân × qty (vào túi; túi đầy → lỗi) */
  buy(idx: number, qty: number): number {
    const e = Number.isInteger(idx) ? SHOP_STOCK[idx] : undefined;
    if (!e) throw new StoreError('Không có món hàng này', 404);
    const def = ITEM_BY_ID[e.itemId];
    const max = def.stack ? 99 : 10;
    if (!Number.isInteger(qty) || qty < 1 || qty > max) throw new StoreError(`Số lượng phải từ 1 đến ${max}`);
    const cost = e.price * qty;
    checkGold(this.w, cost);
    const g = fitGrade(def, e.grade);
    const need = def.stack ? qty : 1;
    for (let k = 0; k < (def.stack ? 1 : qty); k++) {
      if (this.place(def.id, g, def.stack ? {} : rollAffixes(def, g, cryptoRng), need, 'bag') > 0) throw new StoreError('Túi đồ đã đầy');
    }
    this.w.gold -= cost;
    return cost;
  }
  /** nhận bộ tân binh: mặc thẳng vào ô trống, ô đã có đồ thì vào túi */
  claimStarter() {
    if (!canClaimStarter(this.items)) throw new StoreError('Bạn vẫn còn súng — chỉ nhận bộ tân binh khi không còn khẩu nào');
    for (const s of STARTER_KIT) {
      const def = ITEM_BY_ID[s.itemId];
      if (!this.inSlot(s.slot)) this.create(def.id, s.grade, {}, s.count, s.slot, false);
      else if (this.place(def.id, s.grade, {}, s.count, 'bag') > 0) throw new StoreError('Túi đồ đã đầy');
    }
  }
  /** cường hoá: tốn vàng + Đá Cường Hoá (lấy từ túi trước rồi kho) */
  upgrade(uid: number) {
    const it = this.get(uid);
    const def = ITEM_BY_ID[it.itemId];
    if (!def || def.stack || def.kind === 'consumable' || def.kind === 'material' || def.kind === 'skin') throw new StoreError('Món này không cường hoá được');
    if (it.level >= ITEM_MAX_LEVEL) throw new StoreError('Món đồ đã đạt cấp tối đa');
    const cost = upgradeCost(it.grade, it.level);
    checkGold(this.w, cost);
    let need = upgradeStones(it.level);
    const stones = this.items.filter((s) => s.itemId === UPGRADE_STONE && !s.slot).sort((a, b) => Number(a.stash) - Number(b.stash));
    const have = stones.reduce((n, s) => n + s.count, 0) + (this.inSlot('secure')?.itemId === UPGRADE_STONE ? this.inSlot('secure')!.count : 0);
    if (have < need) throw new StoreError(`Không đủ Đá Cường Hoá (cần ${need})`);
    const sec = this.inSlot('secure');
    if (sec?.itemId === UPGRADE_STONE) stones.push(sec);
    for (const s of stones) {
      if (need <= 0) break;
      const n = Math.min(need, s.count);
      s.count -= n;
      need -= n;
      if (s.count <= 0) this.remove(s);
      else this.mark(s);
    }
    this.w.gold -= cost;
    it.level += 1;
    this.mark(it);
    return cost;
  }
  /**
   * Áp kết quả ải: xoá đồ mất (chỉ khi VẪN đang mặc, không phải ô an toàn), trừ tiêu hao đã dùng (ở ô quick còn mặc),
   * cất đồ nhặt nếu sống sót. Trả uid đã thực sự mất.
   */
  extract(x: ExtractResult): { lost: number[]; loot: PlaceResult } {
    const lost: number[] = [];
    const lostSet = new Set((x.lost ?? []).filter((u) => Number.isInteger(u)));
    for (const u of lostSet) {
      const it = this.items.find((i) => i.uid === u);
      if (!it || !it.slot || it.slot === 'secure') continue;
      this.remove(it);
      lost.push(u);
    }
    for (const [itemId, nUsed] of Object.entries(x.usedConsumables ?? {})) {
      let n = nn(nUsed);
      for (const s of ['quick1', 'quick2'] as const) {
        const it = this.inSlot(s);
        if (n <= 0 || !it || it.itemId !== itemId) continue;
        const k = Math.min(n, it.count);
        it.count -= k;
        n -= k;
        if (it.count <= 0) this.remove(it);
        else this.mark(it);
      }
    }
    const loot = x.survived ? this.give((x.looted ?? []).map((d) => ({ itemId: d.itemId, grade: d.grade, subs: d.subs, count: d.count }))) : { left: 0, gold: 0 };
    return { lost, loot };
  }
}

/** phần thưởng thực nhận của một trận ải (rương + thưởng lần đầu) */
export function grantedOf(chest: Reward, fr: Reward | null): Reward {
  const out: Reward = {};
  for (const k of ['gold', 'xp', 'shards', 'books'] as const) {
    const v = (chest[k] ?? 0) + (fr?.[k] ?? 0);
    if (v) out[k] = v;
  }
  const items = [...(chest.items ?? []), ...(fr?.items ?? [])];
  if (items.length) out.items = items;
  if (fr?.unlockChar !== undefined) out.unlockChar = fr.unlockChar;
  return out;
}
