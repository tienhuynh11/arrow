// Store trong RAM — dùng cho test và khi chạy local không có DATABASE_URL (mất khi khởi động lại).
// Mỗi thao tác chạy đồng bộ trọn vẹn (kiểm tra hết rồi mới ghi) nên tương đương một giao dịch.

import type { EventDef, EventState, LeaderRow, MeResponse, StageProgress } from '../../../../shared/monkey/api.js';
import { loadoutOf, salvageValue, type ItemInst, type Loadout, type Rarity, type Reward, type SkillKey, type Slot, type Stats } from '../../../../shared/monkey/progression.js';
import {
  DEFAULT_CHARS,
  MAX_ITEMS,
  MONEY_CAP,
  NUM_CHARS,
  SKILL_KEYS,
  STARTER_ITEMS,
  applyGain,
  checkClaim,
  checkItemOwned,
  checkSkill,
  checkUnlock,
  checkUpgrade,
  cleanRun,
  eventActive,
  eventAfterRun,
  firstReward,
  isCls,
  isSlot,
  rewardItems,
  seedEvent,
  slotOf,
  type Wallet,
} from './rules.js';
import { StoreError, type AccountRow, type RunResult, type Store, type TeamRun } from './store.js';

interface MItem extends ItemInst {
  owner: number;
  slot: Slot;
}
interface MAccount extends Wallet {
  id: number;
  username: string;
  key: string;
  passHash: string;
  cls: number;
  kills: number;
  chars: Set<number>;
  skills: Map<string, number>; // `${cls}:${skill}`
  stages: Map<string, StageProgress>;
  events: Map<number, { progress: Record<string, number>; claimed: string[] }>;
  createdAt: number;
}

const clone = <T>(v: T): T => structuredClone(v);

export class MemStore implements Store {
  readonly kind = 'mem' as const;
  private accounts = new Map<number, MAccount>();
  private byKey = new Map<string, number>();
  private sessions = new Map<string, { accountId: number; expires: number }>();
  private items = new Map<number, MItem>();
  private events = new Map<number, EventDef>();
  private teamRuns: (TeamRun & { at: number })[] = [];
  private runs: (RunResult & { at: number })[] = [];
  private seq = { acc: 0, item: 0, ev: 0 };

  async init() {
    if (this.events.size === 0) await this.saveEvent(seedEvent(new Date()));
  }

  private acc(id: number): MAccount {
    const a = this.accounts.get(id);
    if (!a) throw new StoreError('Không tìm thấy tài khoản', 404);
    return a;
  }
  private itemsOf(id: number) {
    return [...this.items.values()].filter((i) => i.owner === id).sort((a, b) => a.uid - b.uid);
  }
  private addItem(a: MAccount, itemId: string, rarity: Rarity, subs: Stats, equipped = false): ItemInst {
    const uid = ++this.seq.item;
    const it: MItem = { uid, owner: a.id, itemId, rarity, level: 1, subs: clone(subs), equipped, slot: slotOf(itemId) };
    this.items.set(uid, it);
    return pub(it);
  }
  /** cộng một phần thưởng (đã kiểm tra) — trả đồ đã tạo + số cấp lên */
  private give(a: MAccount, r: Reward & { items?: { itemId: string; rarity: Rarity; subs?: Stats }[] }) {
    const ups = applyGain(a, r);
    const room = Math.max(0, MAX_ITEMS - this.itemsOf(a.id).length);
    const made = rewardItems(r.items)
      .slice(0, room)
      .map((it) => this.addItem(a, it.itemId, it.rarity, it.subs));
    if (r.unlockChar !== undefined && isCls(r.unlockChar)) a.chars.add(r.unlockChar);
    return { made, ups };
  }

  /* ---- tài khoản ---- */
  async createAccount(username: string, passHash: string) {
    const key = username.toLowerCase();
    if (this.byKey.has(key)) return null;
    const id = ++this.seq.acc;
    const a: MAccount = {
      id, username, key, passHash, level: 1, xp: 0, gold: 0, shards: 0, books: 0, cls: 0, kills: 0,
      chars: new Set(DEFAULT_CHARS), skills: new Map(), stages: new Map(), events: new Map(), createdAt: Date.now(),
    };
    this.accounts.set(id, a);
    this.byKey.set(key, id);
    for (const s of STARTER_ITEMS) this.addItem(a, s.itemId, s.rarity, {}, s.equipped);
    return id;
  }
  async findAccount(username: string): Promise<AccountRow | null> {
    const id = this.byKey.get(username.toLowerCase());
    return id ? this.accountById(id) : null;
  }
  async accountById(id: number): Promise<AccountRow | null> {
    const a = this.accounts.get(id);
    return a ? { id: a.id, username: a.username, passHash: a.passHash } : null;
  }
  async createSession(accountId: number, tokenHash: string, expiresAt: Date) {
    this.acc(accountId);
    const now = Date.now();
    for (const [k, v] of this.sessions) if (v.expires <= now) this.sessions.delete(k);
    this.sessions.set(tokenHash, { accountId, expires: expiresAt.getTime() });
  }
  async sessionAccount(tokenHash: string) {
    const s = this.sessions.get(tokenHash);
    if (!s) return null;
    if (s.expires <= Date.now()) {
      this.sessions.delete(tokenHash);
      return null;
    }
    return this.accounts.has(s.accountId) ? s.accountId : null;
  }
  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }

  /* ---- hồ sơ ---- */
  async me(accountId: number, now: Date): Promise<MeResponse> {
    const a = this.acc(accountId);
    const skills: Record<number, Record<SkillKey, number>> = {};
    for (let c = 0; c < NUM_CHARS; c++) skills[c] = this.skillsOf(a, c);
    return {
      profile: {
        id: a.id, username: a.username, level: a.level, xp: a.xp, gold: a.gold, shards: a.shards, books: a.books,
        chars: [...a.chars].sort((x, y) => x - y), cls: a.cls, skills, kills: a.kills,
      },
      items: this.itemsOf(a.id).map(pub),
      stages: [...a.stages.values()].map(clone).sort((x, y) => x.stage.localeCompare(y.stage)),
      events: await this.eventStates(accountId, now),
    };
  }
  private skillsOf(a: MAccount, cls: number): Record<SkillKey, number> {
    const o = {} as Record<SkillKey, number>;
    for (const k of SKILL_KEYS) o[k] = a.skills.get(`${cls}:${k}`) ?? 1;
    return o;
  }
  async loadout(accountId: number, cls: number): Promise<Loadout> {
    const a = this.acc(accountId);
    return loadoutOf(this.itemsOf(a.id).filter((i) => i.equipped).map(pub), this.skillsOf(a, isCls(cls) ? cls : 0));
  }
  async clearedStages(accountId: number) {
    const a = this.acc(accountId);
    return new Set([...a.stages.values()].filter((s) => s.clears > 0).map((s) => s.stage));
  }

  /* ---- thao tác ---- */
  private ownItem(accountId: number, uid: number): MItem {
    const it = this.items.get(uid);
    return checkItemOwned(it && it.owner === accountId ? it : null);
  }
  async equip(accountId: number, uid: number) {
    this.acc(accountId);
    const it = this.ownItem(accountId, uid);
    for (const o of this.items.values()) if (o.owner === accountId && o.slot === it.slot) o.equipped = false;
    it.equipped = true;
  }
  async unequip(accountId: number, slot: Slot) {
    this.acc(accountId);
    if (!isSlot(slot)) throw new StoreError('Ô trang bị không hợp lệ');
    for (const o of this.items.values()) if (o.owner === accountId && o.slot === slot) o.equipped = false;
  }
  async upgradeItem(accountId: number, uid: number) {
    const a = this.acc(accountId);
    const it = this.ownItem(accountId, uid);
    const cost = checkUpgrade(it, a);
    a.gold -= cost;
    it.level += 1;
  }
  async salvage(accountId: number, uids: number[]) {
    const a = this.acc(accountId);
    const list = [...new Set(uids)].map((u) => this.ownItem(accountId, u));
    if (!list.length) throw new StoreError('Chưa chọn món đồ nào');
    if (list.some((i) => i.equipped)) throw new StoreError('Không thể phân rã đồ đang mặc');
    let gold = 0;
    for (const it of list) gold += salvageValue(it);
    for (const it of list) this.items.delete(it.uid);
    a.gold = Math.min(MONEY_CAP, a.gold + gold);
    return gold;
  }
  async unlockChar(accountId: number, cls: number) {
    const a = this.acc(accountId);
    const shards = checkUnlock(cls, a, a.chars.has(cls), (st) => (a.stages.get(st)?.clears ?? 0) > 0);
    a.shards -= shards;
    a.chars.add(cls);
  }
  async selectChar(accountId: number, cls: number) {
    const a = this.acc(accountId);
    if (!isCls(cls)) throw new StoreError('Nhân vật không hợp lệ');
    if (!a.chars.has(cls)) throw new StoreError('Chưa mở nhân vật này');
    a.cls = cls;
  }
  async upgradeSkill(accountId: number, cls: number, skill: SkillKey) {
    const a = this.acc(accountId);
    const cur = a.skills.get(`${cls}:${skill}`) ?? 1;
    const c = checkSkill(cls, skill, cur, a.chars.has(cls), a);
    a.gold -= c.gold;
    a.books -= c.books;
    a.skills.set(`${cls}:${skill}`, cur + 1);
  }
  async claimEvent(accountId: number, eventId: number, objective: string, now: Date) {
    const a = this.acc(accountId);
    const st = a.events.get(eventId) ?? { progress: {}, claimed: [] };
    const o = checkClaim(this.events.get(eventId), objective, st.progress, st.claimed, now);
    this.give(a, o.reward);
    st.claimed.push(o.id);
    a.events.set(eventId, st);
    return clone(o.reward);
  }
  async grant(accountId: number, reward: Reward) {
    return this.give(this.acc(accountId), reward).made;
  }

  /* ---- kết quả trận ---- */
  async recordRun(raw: RunResult, now: Date) {
    const r = cleanRun(raw);
    const a = this.acc(r.accountId);
    this.runs.push({ ...clone(r), at: now.getTime() });
    if (this.runs.length > 2000) this.runs.splice(0, this.runs.length - 2000);
    a.kills = Math.min(MONEY_CAP, a.kills + r.kills);
    const g = this.give(a, r.reward);
    const items = [...g.made];
    let ups = g.ups;
    let firstClear = false;
    if (r.won && r.stage !== 'endless') {
      const prev = a.stages.get(r.stage);
      firstClear = !prev || prev.clears === 0;
      a.stages.set(r.stage, {
        stage: r.stage,
        stars: Math.max(prev?.stars ?? 0, r.stars),
        bestSecs: prev && prev.clears > 0 ? Math.min(prev.bestSecs, r.secs) : r.secs,
        clears: (prev?.clears ?? 0) + 1,
      });
      const fr = firstClear ? firstReward(r.stage) : null;
      if (fr) {
        const f = this.give(a, fr);
        items.push(...f.made);
        ups += f.ups;
      }
    }
    for (const e of this.events.values()) {
      if (!eventActive(e, now)) continue;
      const st = a.events.get(e.id) ?? { progress: {}, claimed: [] };
      st.progress = eventAfterRun(e, st.progress, r);
      a.events.set(e.id, st);
    }
    return { items, levelUps: ups, newLevel: a.level, firstClear };
  }
  async recordTeamRun(t: TeamRun, now: Date) {
    this.teamRuns.push({ ...clone(t), at: now.getTime() });
    if (this.teamRuns.length > 5000) this.teamRuns.splice(0, this.teamRuns.length - 5000);
  }
  async leaderboard(stage: string, solo: boolean, limit: number): Promise<LeaderRow[]> {
    return this.teamRuns
      .filter((t) => t.stage === stage && t.solo === solo)
      .sort((x, y) => y.wave - x.wave || y.score - x.score || x.secs - y.secs || x.at - y.at)
      .slice(0, Math.max(1, Math.min(100, limit)))
      .map((t) => ({ names: [...t.names], cls: [...t.cls], stage: t.stage, wave: t.wave, score: t.score, kills: t.kills, secs: t.secs, at: t.at }));
  }

  /* ---- sự kiện ---- */
  async listEvents() {
    return [...this.events.values()].map(clone).sort((x, y) => Date.parse(y.startsAt) - Date.parse(x.startsAt) || y.id - x.id);
  }
  async activeEvents(now: Date) {
    return (await this.listEvents()).filter((e) => eventActive(e, now));
  }
  async saveEvent(e: EventDef) {
    if (e.id && !this.events.has(e.id)) throw new StoreError('Không tìm thấy sự kiện', 404);
    const id = e.id || ++this.seq.ev;
    const ev = { ...clone(e), id };
    this.events.set(id, ev);
    return clone(ev);
  }
  async deleteEvent(id: number) {
    this.events.delete(id);
    for (const a of this.accounts.values()) a.events.delete(id);
  }
  async eventStates(accountId: number, now: Date): Promise<EventState[]> {
    const a = this.acc(accountId);
    return (await this.activeEvents(now)).map((event) => {
      const st = a.events.get(event.id);
      return { event, progress: { ...(st?.progress ?? {}) }, claimed: [...(st?.claimed ?? [])] };
    });
  }

  async stats() {
    const since = Date.now() - 86400_000;
    return { accounts: this.accounts.size, runs24h: this.teamRuns.filter((t) => t.at >= since).length };
  }
}

function pub(it: MItem | ItemInst): ItemInst {
  return { uid: it.uid, itemId: it.itemId, rarity: it.rarity, level: it.level, subs: clone(it.subs), equipped: it.equipped };
}
