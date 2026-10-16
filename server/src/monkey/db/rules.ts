// Luật nghiệp vụ dùng chung cho MemStore và PgStore: kiểm tra + tính toán thuần (không đụng lưu trữ).
// Mỗi hàm check* ném StoreError (thông báo tiếng Việt) nếu thao tác không hợp lệ.

import { randomInt } from 'node:crypto';
import type { EventDef, EventObjective } from '../../../../shared/monkey/api.js';
import {
  CHAR_UNLOCK,
  ITEM_BY_ID,
  ITEM_MAX_LEVEL,
  SKILL_MAX,
  SLOTS,
  STAGE_BY_ID,
  addXp,
  levelUpGold,
  rollSubs,
  skillCost,
  upgradeCost,
  type ItemInst,
  type Rarity,
  type Reward,
  type SkillKey,
  type Slot,
  type Stats,
} from '../../../../shared/monkey/progression.js';
import { StoreError, type RunResult } from './store.js';

export const NUM_CHARS = CHAR_UNLOCK.length;
export const DEFAULT_CHARS = CHAR_UNLOCK.map((r, i) => (r.kind === 'default' ? i : -1)).filter((i) => i >= 0);
export const SKILL_KEYS: SkillKey[] = ['g', 'x', 'q'];
/** trần tiền tệ để không tràn cột integer */
export const MONEY_CAP = 1_000_000_000;
/** số món tối đa trong kho (chặn phình DB) */
export const MAX_ITEMS = 300;

/** rng mật mã ∈ [0,1) */
export const cryptoRng = () => randomInt(0, 2 ** 31) / 2 ** 31;

export const isSlot = (s: unknown): s is Slot => typeof s === 'string' && SLOTS.some((x) => x.id === s);
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

/** đồ trong phần thưởng → danh sách (itemId hợp lệ, độ hiếm trong khoảng cho phép, chỉ số phụ) */
export function rewardItems(items: { itemId: string; rarity: Rarity; subs?: Stats }[] | undefined): { itemId: string; rarity: Rarity; subs: Stats }[] {
  const out: { itemId: string; rarity: Rarity; subs: Stats }[] = [];
  for (const it of items ?? []) {
    const def = ITEM_BY_ID[it?.itemId];
    if (!def) continue;
    const r = Math.min(def.maxR, Math.max(def.minR, nn(it.rarity))) as Rarity;
    out.push({ itemId: def.id, rarity: r, subs: it.subs && typeof it.subs === 'object' ? it.subs : rollSubs(def, r, cryptoRng) });
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

/** chi phí nâng một món (ném lỗi nếu đã tối đa) */
export function checkUpgrade(it: ItemInst, w: Wallet): number {
  if (it.level >= ITEM_MAX_LEVEL) throw new StoreError('Món đồ đã đạt cấp tối đa');
  const cost = upgradeCost(it.rarity, it.level);
  checkGold(w, cost);
  return cost;
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
export function eventAfterRun(e: EventDef, prev: Record<string, number>, r: RunResult): Record<string, number> {
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
export function cleanRun(r: RunResult): RunResult {
  return {
    ...r,
    stage: String(r.stage).slice(0, 40),
    won: !!r.won,
    stars: Math.min(3, nn(r.stars)),
    wave: nn(r.wave),
    kills: nn(r.kills),
    secs: nn(r.secs),
    score: nn(r.score),
    reward: r.reward ?? {},
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
      { id: 'kills', kind: 'kills', target: 300, label: 'Hạ 300 khỉ', reward: { items: [{ itemId: 'h_chuoi', rarity: 2 }] } },
      { id: 'clear', kind: 'clearStage', stage: 'ev-vuonchuoi', target: 1, label: 'Qua ải Vườn Chuối', reward: { gold: 500, books: 1 } },
      { id: 'play', kind: 'playRuns', target: 3, label: 'Chơi 3 trận', reward: { gold: 200 } },
    ],
  };
}

/** đồ khởi đầu của tài khoản mới: Dao Găm (đang mặc) + Nón Lá */
export const STARTER_ITEMS: { itemId: string; rarity: Rarity; equipped: boolean }[] = [
  { itemId: 'k_gam', rarity: 0, equipped: true },
  { itemId: 'h_tre', rarity: 0, equipped: false },
];

/** slot của món đồ theo danh mục */
export const slotOf = (itemId: string): Slot => ITEM_BY_ID[itemId]?.slot ?? 'skin';
