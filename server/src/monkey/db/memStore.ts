// Store trong RAM — dùng cho test và khi chạy local không có DATABASE_URL (mất khi khởi động lại).
// Mỗi thao tác chạy đồng bộ trọn vẹn (kiểm tra hết rồi mới ghi) nên tương đương một giao dịch.

import type { EventDef, EventState, LeaderRow, MeResponse, StageProgress } from '../../../../shared/monkey/api.js';
import { STARTER_KIT, loadoutOf2, type EquipSlot, type ItemInst, type Loadout2, type Reward, type SkillKey } from '../../../../shared/monkey/progression.js';
import {
  DEFAULT_CHARS,
  Inv,
  MONEY_CAP,
  NUM_CHARS,
  SKILL_KEYS,
  applyGain,
  checkClaim,
  checkSkill,
  checkUnlock,
  cleanRun,
  eventActive,
  eventAfterRun,
  firstReward,
  grantedOf,
  isCls,
  isSlot,
  rewardItems,
  seedEvent,
  type Wallet,
} from './rules.js';
import { StoreError, type AccountRow, type ExtractOutcome, type ExtractRun, type RunResult, type Store, type TeamRun } from './store.js';

interface MItem extends ItemInst {
  owner: number;
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
  /** chạy thao tác kho đồ trên bản sao rồi ghi lại (đồng bộ trọn vẹn = một giao dịch); trả kết quả + món mới/đổi */
  private withInv<T>(a: MAccount, fn: (inv: Inv) => T): { out: T; touched: ItemInst[] } {
    const w: Wallet = { level: a.level, xp: a.xp, gold: a.gold, shards: a.shards, books: a.books };
    const inv = new Inv(this.itemsOf(a.id).map(pub), w);
    const out = fn(inv); // ném lỗi → không ghi gì
    const ch = inv.changes();
    for (const u of ch.removed) this.items.delete(u);
    for (const it of ch.updated) {
      const m = this.items.get(it.uid);
      if (m) Object.assign(m, pub(it));
    }
    const real = new Map<number, number>();
    for (const it of ch.added) {
      const uid = ++this.seq.item;
      real.set(it.uid, uid);
      this.items.set(uid, { ...pub(it), uid, owner: a.id });
    }
    Object.assign(a, w);
    const touched = [...inv.touched].map((u) => this.items.get(real.get(u) ?? u)).filter((x): x is MItem => !!x).map(pub);
    return { out, touched };
  }
  /** cộng một phần thưởng (đã kiểm tra) — trả đồ đã tạo/đổi + số cấp lên */
  private give(a: MAccount, r: Reward) {
    const ups = applyGain(a, r);
    const { touched } = this.withInv(a, (inv) => inv.give(rewardItems(r.items)));
    if (r.unlockChar !== undefined && isCls(r.unlockChar)) a.chars.add(r.unlockChar);
    return { made: touched, ups };
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
    for (const s of STARTER_KIT) {
      const uid = ++this.seq.item;
      this.items.set(uid, { uid, owner: id, itemId: s.itemId, grade: s.grade, level: 1, affixes: {}, count: s.count, slot: s.slot, stash: false });
    }
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
  async loadout(accountId: number, cls: number): Promise<Loadout2> {
    const a = this.acc(accountId);
    const k = isCls(cls) ? cls : 0;
    return loadoutOf2(this.itemsOf(a.id).filter((i) => i.slot).map(pub), k, this.skillsOf(a, k));
  }
  async clearedStages(accountId: number) {
    const a = this.acc(accountId);
    return new Set([...a.stages.values()].filter((s) => s.clears > 0).map((s) => s.stage));
  }

  /* ---- thao tác ---- */
  async equip(accountId: number, uid: number, slot: EquipSlot) {
    this.withInv(this.acc(accountId), (inv) => inv.equip(uid, slot));
  }
  async unequip(accountId: number, slot: EquipSlot) {
    if (!isSlot(slot)) throw new StoreError('Ô trang bị không hợp lệ');
    this.withInv(this.acc(accountId), (inv) => inv.unequip(slot));
  }
  async moveToStash(accountId: number, uid: number) {
    this.withInv(this.acc(accountId), (inv) => inv.move(uid, true));
  }
  async moveToBag(accountId: number, uid: number) {
    this.withInv(this.acc(accountId), (inv) => inv.move(uid, false));
  }
  async sell(accountId: number, uids: number[]) {
    return this.withInv(this.acc(accountId), (inv) => inv.sell(uids)).out;
  }
  async salvage(accountId: number, uids: number[]) {
    return this.sell(accountId, uids);
  }
  async buy(accountId: number, idx: number, qty: number) {
    return this.withInv(this.acc(accountId), (inv) => inv.buy(idx, qty)).out;
  }
  async claimStarter(accountId: number) {
    this.withInv(this.acc(accountId), (inv) => inv.claimStarter());
  }
  async upgradeItem(accountId: number, uid: number) {
    this.withInv(this.acc(accountId), (inv) => inv.upgrade(uid));
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
  async recordExtract(raw: ExtractRun, now: Date): Promise<ExtractOutcome> {
    const r = cleanRun(raw);
    const a = this.acc(r.accountId);
    const x = r.extract ?? { survived: false, kept: [], lost: [], looted: [], usedConsumables: {} };
    const chest: Reward = x.survived ? r.chest ?? {} : { xp: Math.round((r.chest?.xp ?? 0) * 0.3) };
    let ups = applyGain(a, chest);
    const prev = a.stages.get(r.stage);
    const cleared = r.won && r.stage !== 'endless';
    const firstClear = cleared && (!prev || prev.clears === 0);
    const fr = firstClear ? firstReward(r.stage) : null;
    if (fr) ups += applyGain(a, fr);
    if (fr?.unlockChar !== undefined && isCls(fr.unlockChar)) a.chars.add(fr.unlockChar);
    const res = this.withInv(a, (inv) => {
      const e = inv.extract(x);
      const g1 = inv.give(rewardItems(chest.items));
      const g2 = fr ? inv.give(rewardItems(fr.items)) : { gold: 0 };
      return { lost: e.lost, overflow: e.loot.gold + g1.gold + g2.gold };
    });
    a.kills = Math.min(MONEY_CAP, a.kills + r.kills);
    if (cleared) {
      a.stages.set(r.stage, {
        stage: r.stage,
        stars: Math.max(prev?.stars ?? 0, r.stars),
        bestSecs: prev && prev.clears > 0 ? Math.min(prev.bestSecs, r.secs) : r.secs,
        clears: (prev?.clears ?? 0) + 1,
      });
    }
    for (const e of this.events.values()) {
      if (!eventActive(e, now)) continue;
      const st = a.events.get(e.id) ?? { progress: {}, claimed: [] };
      st.progress = eventAfterRun(e, st.progress, r);
      a.events.set(e.id, st);
    }
    const granted = grantedOf(chest, fr);
    this.runs.push({ accountId: a.id, stage: r.stage, won: r.won, stars: r.stars, wave: r.wave, kills: r.kills, secs: r.secs, score: r.score, reward: granted, at: now.getTime() });
    if (this.runs.length > 2000) this.runs.splice(0, this.runs.length - 2000);
    return { items: res.touched, lost: res.out.lost, overflowGold: res.out.overflow, granted, levelUps: ups, newLevel: a.level, firstClear };
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
  return { uid: it.uid, itemId: it.itemId, grade: it.grade, level: it.level, affixes: clone(it.affixes), count: it.count, slot: it.slot, stash: it.stash };
}
