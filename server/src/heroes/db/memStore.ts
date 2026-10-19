// HeroStore trong RAM — dùng cho test và khi chạy local không có DATABASE_URL (mất khi khởi động lại).
// Mỗi thao tác chạy đồng bộ trọn vẹn trên BẢN SAO rồi mới ghi đè nên tương đương một giao dịch (ném lỗi = không ghi gì).

import type { EventDef } from '../../../../shared/heroes/events.js';
import { SEED_EVENT } from '../../../../shared/heroes/events.js';
import { GUILD_CHAT_KEEP, type GuildChatMsg } from '../../../../shared/heroes/guild.js';
import { assertWallet, bestStage, eventActive, gainKillRewards, ledgerOf, newState, rollDay, STARTER_WALLET } from '../rules.js';
import {
  StoreError, type ArenaRank, type EventState, type GuildCtx, type GuildListRow, type GuildMemberRow, type GuildRow, type HState, type HeroStore,
  type LeaderEntry, type LedgerRow, type MutateOpts, type RunRow,
} from './store.js';

type Rows = Record<string, { progress: number; claimed: boolean }>;

export class HeroMemStore implements HeroStore {
  readonly kind = 'mem' as const;
  private states = new Map<number, HState>();
  /** bộ đếm uid trang bị (toàn cục như bigserial) */
  private nextGearUid = 1;
  private idem = new Map<string, { tag: string; value: unknown }>();
  /** để test kiểm tra */
  readonly ledger: (LedgerRow & { accountId: number })[] = [];
  readonly runs: (RunRow & { accountId: number })[] = [];

  /* sự kiện */
  private events = new Map<number, EventDef>();
  private nextEventId = 1;
  /** `${accountId}:${eventId}` → tiến trình theo id mục tiêu */
  private progress = new Map<string, Rows>();
  /* bang hội */
  private guilds = new Map<number, GuildRow>();
  private members = new Map<number, GuildMemberRow>();
  private nextGuildId = 1;
  private chat = new Map<number, GuildChatMsg[]>();
  private nextChatId = 1;
  /** accountId → số phần thưởng hạ boss đang chờ */
  private kill = new Map<number, number>();

  constructor() {
    // sự kiện mẫu (như migration PG): bắt đầu ngay, kéo dài SEED_EVENT.days ngày
    const { days, ...rest } = SEED_EVENT;
    const now = Date.now();
    this.putEvent({ ...structuredClone(rest), id: 0, startsAt: now, endsAt: now + days * 86_400_000 });
  }
  private putEvent(ev: Omit<EventDef, 'id'> & { id?: number }): EventDef {
    const id = ev.id || this.nextEventId++;
    if (id >= this.nextEventId) this.nextEventId = id + 1;
    const def: EventDef = { ...structuredClone(ev), id };
    this.events.set(id, def);
    return structuredClone(def);
  }

  async init() {}

  /** sự kiện còn hiệu lực tại `ms` + tiến trình của tài khoản */
  private eventStates(accountId: number, ms: number): EventState[] {
    const out: EventState[] = [];
    for (const def of [...this.events.values()].sort((a, b) => a.id - b.id)) {
      if (!eventActive(def, ms)) continue;
      out.push({ def: structuredClone(def), rows: structuredClone(this.progress.get(`${accountId}:${def.id}`) ?? {}) });
    }
    return out;
  }

  async view<T>(accountId: number, now: Date, fn: (s: Readonly<HState>) => T): Promise<T> {
    const cur = this.states.get(accountId);
    if (cur) {
      const s = structuredClone(cur);
      s.events = this.eventStates(accountId, now.getTime());
      s.guildId = this.members.get(accountId)?.guildId ?? null;
      return fn(s);
    }
    await this.mutate(accountId, now, 'provision', () => 0); // uid trang bị khởi đầu chỉ có sau khi ghi → đọc lại
    return this.view(accountId, now, fn);
  }

  async mutate<T>(accountId: number, now: Date, kind: string, fn: (s: HState) => T, opts?: MutateOpts): Promise<T> {
    return this.run(accountId, now, kind, opts, null, fn);
  }

  async mutateGuild<T>(accountId: number, now: Date, kind: string, target: number | null, fn: (s: HState, g: GuildCtx) => T): Promise<T> {
    return this.run(accountId, now, kind, undefined, { target }, (s, g) => fn(s, g!));
  }

  /** lõi giao dịch dùng chung (không có await → nguyên tử) */
  private run<T>(accountId: number, now: Date, kind: string, opts: MutateOpts | undefined, guild: { target: number | null } | null, fn: (s: HState, g: GuildCtx | null) => T): T {
    const nowMs = now.getTime();
    const cur = this.states.get(accountId);
    const fresh = !cur;
    const s = cur ? structuredClone(cur) : newState(accountId, nowMs);
    const ik = opts?.idem ? `${accountId}:${opts.idem.key}` : null;
    if (ik) {
      const old = this.idem.get(ik);
      if (old) {
        if (old.tag !== opts!.idem!.tag) throw new StoreError('Khoá yêu cầu đã dùng cho thao tác khác', 409);
        return structuredClone(old.value) as T;
      }
    }
    s.events = this.eventStates(accountId, nowMs);
    s.guildId = this.members.get(accountId)?.guildId ?? null;
    // phần thưởng hạ boss đang chờ: nhận đúng một lần (sổ cái riêng)
    const pending = this.kill.get(accountId) ?? 0;
    const w0 = { ...s.wallet };
    if (pending > 0) gainKillRewards(s, pending);
    const killLedger = pending > 0 ? ledgerOf(w0, s.wallet, 'guild-boss-kill') : null;
    const before = { ...s.wallet };
    rollDay(s, nowMs); // sang ngày mới: reset Tháp/nhiệm vụ/cửa hàng + tính "đăng nhập"
    let ctx: GuildCtx | null = null;
    let origIds: number[] = [];
    if (guild) {
      const myGuildId = this.members.get(accountId)?.guildId ?? null;
      const gid = guild.target ?? myGuildId;
      const row = gid !== null ? this.guilds.get(gid) : undefined;
      const mem = row ? [...this.members.values()].filter((m) => m.guildId === row.id).sort((a, b) => a.joinedAt - b.joinedAt || a.accountId - b.accountId) : [];
      ctx = { guild: row ? { ...row } : null, members: mem.map((m) => ({ ...m })), myGuildId, deleted: false, killRewards: [] };
      origIds = mem.map((m) => m.accountId);
    }
    const out = fn(s, ctx);
    assertWallet(s);
    if (ctx) this.commitGuild(ctx, origIds, accountId);
    for (const def of s.newGear) s.gear.push({ uid: this.nextGearUid++, def, level: 0, hero: null });
    s.newGear = [];
    // --- ghi (sau khi mọi kiểm tra đã qua) ---
    if (pending > 0) this.kill.delete(accountId);
    for (const ev of s.events) this.progress.set(`${accountId}:${ev.def.id}`, ev.rows);
    s.events = [];
    s.guildId = null;
    if (fresh) this.ledger.push({ accountId, kind: 'starter', delta: { ...STARTER_WALLET } });
    if (killLedger) this.ledger.push({ accountId, ...killLedger });
    const l = ledgerOf(before, s.wallet, kind);
    if (l) this.ledger.push({ accountId, ...l });
    for (const r of s.runs) this.runs.push({ accountId, ...r });
    s.runs = [];
    this.states.set(accountId, s);
    if (ik) this.idem.set(ik, { tag: opts!.idem!.tag, value: structuredClone(out) });
    return out;
  }

  /** ghi bang + thành viên (đã qua mọi kiểm tra); kiểm tra trùng tên TRƯỚC khi ghi bất cứ thứ gì */
  private commitGuild(ctx: GuildCtx, origIds: number[], accountId: number) {
    const g = ctx.guild;
    if (g && g.id === 0) {
      const low = g.name.toLowerCase();
      for (const o of this.guilds.values()) if (o.name.toLowerCase() === low) throw new StoreError('Tên bang đã tồn tại', 409);
    }
    if (ctx.deleted && g) {
      this.guilds.delete(g.id);
      this.chat.delete(g.id);
      for (const id of origIds) this.members.delete(id);
      return;
    }
    if (!g) return;
    if (g.id === 0) {
      g.id = this.nextGuildId++;
      for (const m of ctx.members) m.guildId = g.id;
    }
    this.guilds.set(g.id, { ...g });
    const keep = new Set(ctx.members.map((m) => m.accountId));
    for (const id of origIds) if (!keep.has(id)) this.members.delete(id);
    for (const m of ctx.members) this.members.set(m.accountId, { ...m, guildId: g.id });
    for (const id of new Set(ctx.killRewards)) {
      if (id !== accountId) this.kill.set(id, (this.kill.get(id) ?? 0) + 1);
    }
  }

  async viewGuild<T>(accountId: number, now: Date, fn: (s: Readonly<HState>, g: Readonly<GuildCtx>) => T): Promise<T> {
    return this.view(accountId, now, (s) => {
      const myGuildId = this.members.get(accountId)?.guildId ?? null;
      const row = myGuildId !== null ? this.guilds.get(myGuildId) : undefined;
      const mem = row ? [...this.members.values()].filter((m) => m.guildId === row.id).sort((a, b) => a.joinedAt - b.joinedAt || a.accountId - b.accountId) : [];
      return fn(s, { guild: row ? { ...row } : null, members: mem.map((m) => ({ ...m })), myGuildId, deleted: false, killRewards: [] });
    });
  }

  async guildList(limit: number): Promise<GuildListRow[]> {
    const count = new Map<number, number>();
    for (const m of this.members.values()) count.set(m.guildId, (count.get(m.guildId) ?? 0) + 1);
    return [...this.guilds.values()]
      .map((g) => ({ guild: { ...g }, members: count.get(g.id) ?? 0 }))
      .sort((a, b) => b.members - a.members || a.guild.id - b.guild.id)
      .slice(0, limit);
  }

  async guildChat(accountId: number, limit: number): Promise<GuildChatMsg[] | null> {
    const m = this.members.get(accountId);
    if (!m) return null;
    return (this.chat.get(m.guildId) ?? []).slice(-limit).map((x) => ({ ...x }));
  }
  async guildChatPost(accountId: number, username: string, text: string, nowMs: number): Promise<GuildChatMsg> {
    const m = this.members.get(accountId);
    if (!m) throw new StoreError('Bạn chưa vào bang nào', 400);
    const msg: GuildChatMsg = { id: this.nextChatId++, username, text, at: nowMs };
    const list = this.chat.get(m.guildId) ?? [];
    list.push(msg);
    if (list.length > GUILD_CHAT_KEEP) list.splice(0, list.length - GUILD_CHAT_KEEP);
    this.chat.set(m.guildId, list);
    return { ...msg };
  }
  async pendingKill(accountId: number): Promise<number> {
    return this.kill.get(accountId) ?? 0;
  }

  /* ---- sự kiện (admin) ---- */
  async adminEvents(): Promise<EventDef[]> {
    return [...this.events.values()].sort((a, b) => a.id - b.id).map((e) => structuredClone(e));
  }
  async adminEventSave(ev: Omit<EventDef, 'id'> & { id?: number }): Promise<EventDef> {
    if (ev.id !== undefined) {
      if (!this.events.has(ev.id)) throw new StoreError('Không tìm thấy sự kiện', 404);
      const keep = new Set(ev.objectives.map((o) => o.id));
      for (const [k, rows] of this.progress) {
        if (!k.endsWith(`:${ev.id}`)) continue;
        for (const o of Object.keys(rows)) if (!keep.has(o)) delete rows[o];
      }
    }
    return this.putEvent(ev.id === undefined ? { ...ev, id: undefined } : ev);
  }
  async adminEventDelete(id: number): Promise<void> {
    if (!this.events.delete(id)) throw new StoreError('Không tìm thấy sự kiện', 404);
    for (const k of [...this.progress.keys()]) if (k.endsWith(`:${id}`)) this.progress.delete(k);
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

  async peek<T>(accountId: number, fn: (s: Readonly<HState>) => T): Promise<T | null> {
    const cur = this.states.get(accountId);
    return cur ? fn(structuredClone(cur)) : null;
  }

  private arenaRows(): ArenaRank[] {
    const rows: ArenaRank[] = [];
    for (const [accountId, s] of this.states) if (s.arenaOn) rows.push({ accountId, rating: s.arenaRating, wins: s.arenaWins });
    return rows;
  }
  private static byRank = (a: ArenaRank, b: ArenaRank) => b.rating - a.rating || b.wins - a.wins || a.accountId - b.accountId;

  async arenaNear(selfId: number, rating: number, limit: number): Promise<ArenaRank[]> {
    return this.arenaRows()
      .filter((r) => {
        const s = this.states.get(r.accountId)!;
        return r.accountId !== selfId && (s.squads[s.arenaDefense] ?? []).some((id) => id && s.heroes[id]);
      })
      .sort((a, b) => Math.abs(a.rating - rating) - Math.abs(b.rating - rating) || a.accountId - b.accountId)
      .slice(0, limit);
  }
  async arenaRank(accountId: number): Promise<number> {
    const rows = this.arenaRows().sort(HeroMemStore.byRank);
    const i = rows.findIndex((r) => r.accountId === accountId);
    return i + 1;
  }
  async arenaTop(limit: number): Promise<ArenaRank[]> {
    return this.arenaRows().sort(HeroMemStore.byRank).slice(0, limit);
  }
}
