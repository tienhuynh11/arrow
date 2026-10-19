// HeroStore trên Postgres (Neon), DÙNG CHUNG pool + schema với PgStore của Bầy Khỉ (accounts/sessions là bảng chung).
// Mọi thay đổi: một giao dịch, khoá dòng h_profile (SELECT … FOR UPDATE) trước khi kiểm tra quyền sở hữu / số dư.
// Tên bảng luôn có tiền tố schema (pooler của Neon không giữ SET search_path giữa các giao dịch).

import type pg from 'pg';
import type { PityState } from '../../../../shared/heroes/gacha.js';
import { STAGES_PER_CHAPTER } from '../../../../shared/heroes/stages.js';
import type { Wallet } from '../../../../shared/heroes/types.js';
import { ARENA_START_RATING } from '../../../../shared/heroes/arena.js';
import { SQUAD_COUNT, SQUAD_SIZE } from '../../../../shared/heroes/config.js';
import type { EventDef } from '../../../../shared/heroes/events.js';
import { GUILD_CHAT_KEEP, type GuildChatMsg } from '../../../../shared/heroes/guild.js';
import { assertWallet, gainKillRewards, ledgerOf, newState, rollDay, STARTER_WALLET } from '../rules.js';
import { migrateHeroes } from './migrations.js';
import {
  StoreError, type ArenaRank, type EventState, type GuildCtx, type GuildListRow, type GuildMemberRow, type GuildRow, type HState, type HeroStore,
  type LeaderEntry, type MutateOpts,
} from './store.js';

type Q = pg.PoolClient;

const msOf = (col: string) => `floor(extract(epoch from ${col}) * 1000)::float8`;

const GUILD_COLS = `id, name, level, exp, notice, leader_id, ${msOf('created_at')} AS created_at, boss_cycle, boss_hp::float8 AS boss_hp, boss_hp_max::float8 AS boss_hp_max, boss_killed`;
const MEMBER_COLS = `account_id, guild_id, role, contribution, boss_damage, ${msOf('joined_at')} AS joined_at, donated_day, donated_n, checkin_day, boss_day, boss_tries_used`;
const EVENT_COLS = 'id, name, descr, starts_at::float8 AS starts_at, ends_at::float8 AS ends_at, enabled, banner, objectives';

const guildOf = (r: any): GuildRow => ({
  id: r.id, name: r.name, level: r.level, exp: r.exp, notice: r.notice, leaderId: r.leader_id, createdAt: r.created_at,
  bossCycle: r.boss_cycle, bossHp: r.boss_hp, bossHpMax: r.boss_hp_max, bossKilled: r.boss_killed,
});
const memberOf = (r: any): GuildMemberRow => ({
  accountId: r.account_id, guildId: r.guild_id, role: r.role, contribution: r.contribution, bossDamage: r.boss_damage, joinedAt: r.joined_at,
  donatedDay: r.donated_day, donatedN: r.donated_n, checkinDay: r.checkin_day, bossDay: r.boss_day, bossTriesUsed: r.boss_tries_used,
});
const eventDefOf = (r: any): EventDef => {
  const d: EventDef = { id: r.id, name: r.name, desc: r.descr, startsAt: r.starts_at, endsAt: r.ends_at, enabled: r.enabled, objectives: r.objectives ?? [] };
  if (r.banner) d.banner = r.banner;
  return d;
};

export class HeroPgStore implements HeroStore {
  readonly kind = 'pg' as const;
  /** `S` = tiền tố schema đã kiểm tra, vd `"public".` (lấy từ PgStore của Bầy Khỉ) */
  constructor(private pool: pg.Pool, private S: string) {}

  async init() {
    const c = await this.pool.connect();
    try {
      await migrateHeroes(c, this.S);
    } finally {
      c.release();
    }
  }

  private async tx<T>(fn: (c: Q) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  /* ---- nạp ---- */
  /** nạp hồ sơ; `lock` = khoá dòng h_profile. Trả null nếu chưa có hồ sơ */
  private async load(c: Q, id: number, lock: boolean, light = false, nowMs = 0): Promise<HState | null> {
    const S = this.S;
    const pr = await c.query(
      `SELECT gold, gems, tickets, exp, stones, level, xp, stamina, ${msOf('stamina_at')} AS stamina_at, ${msOf('afk_since')} AS afk_since, active_squad, pity,
              tower_floor, tower_day, tower_tries, guild_left_at::float8 AS guild_left_at,
              (SELECT m.guild_id FROM ${S}h_guild_member m WHERE m.account_id = $1) AS guild_id
       FROM ${S}h_profile WHERE account_id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    if (!pr.rows.length) return null;
    const p = pr.rows[0];
    // tuần tự: một kết nối pg không chạy song song nhiều lệnh
    const hs = await c.query(`SELECT hero_id, level, star, shards FROM ${S}h_heroes WHERE account_id = $1 ORDER BY seq`, [id]);
    const sq = await c.query(`SELECT idx, slots FROM ${S}h_squads WHERE account_id = $1`, [id]);
    const none = { rows: [] as any[] };
    // light (đọc đội phòng thủ của người khác): bỏ qua tiến trình ải / nhiệm vụ / cửa hàng
    const sp = light ? none : await c.query(`SELECT stage, stars, clears FROM ${S}h_stage_progress WHERE account_id = $1`, [id]);
    const gr = await c.query(`SELECT uid::int AS uid, def_id, level, hero_id FROM ${S}h_gear WHERE account_id = $1 ORDER BY uid`, [id]);
    const qr = light ? none : await c.query(`SELECT day, quest_id, progress, claimed FROM ${S}h_quest WHERE account_id = $1`, [id]);
    const sh = light ? none : await c.query(`SELECT day, item_id, count FROM ${S}h_shop_buy WHERE account_id = $1`, [id]);
    const ar = await c.query(`SELECT rating, day, tries, defense_squad, wins, losses FROM ${S}h_arena WHERE account_id = $1`, [id]);
    const squads: string[][] = Array.from({ length: SQUAD_COUNT }, () => Array<string>(SQUAD_SIZE).fill(''));
    for (const r of sq.rows) if (r.idx >= 0 && r.idx < SQUAD_COUNT) squads[r.idx] = r.slots as string[];
    const s: HState = {
      accountId: id,
      wallet: { gold: p.gold, gems: p.gems, tickets: p.tickets, exp: p.exp, stones: p.stones },
      level: p.level, xp: p.xp, stamina: p.stamina, staminaAt: p.stamina_at, afkSince: p.afk_since,
      activeSquad: p.active_squad, pity: (p.pity ?? {}) as Record<string, PityState>,
      heroes: {}, squads, progress: {}, runs: [], gear: [], newGear: [],
      towerFloor: p.tower_floor, towerDay: p.tower_day, towerTries: p.tower_tries, day: 0, quests: {}, questBonus: false, shop: {},
      arenaOn: false, arenaRating: ARENA_START_RATING, arenaDay: 0, arenaTries: 0, arenaDefense: 0, arenaWins: 0, arenaLosses: 0,
      guildLeftAt: p.guild_left_at, guildId: p.guild_id ?? null, events: light ? [] : await this.loadEvents(c, id, nowMs),
    };
    if (ar.rows.length) {
      const a = ar.rows[0];
      Object.assign(s, { arenaOn: true, arenaRating: a.rating, arenaDay: a.day, arenaTries: a.tries, arenaDefense: a.defense_squad, arenaWins: a.wins, arenaLosses: a.losses });
    }
    // nhiệm vụ/cửa hàng: chỉ lấy ngày mới nhất (hàng cũ hơn sẽ bị xoá khi ghi)
    s.day = Math.max(0, ...qr.rows.map((r) => r.day as number), ...sh.rows.map((r) => r.day as number));
    for (const r of qr.rows) {
      if (r.day !== s.day) continue;
      if (r.quest_id === 'bonus') s.questBonus = r.claimed;
      else s.quests[r.quest_id] = { progress: r.progress, claimed: r.claimed };
    }
    for (const r of sh.rows) if (r.day === s.day) s.shop[r.item_id] = r.count;
    for (const r of gr.rows) s.gear.push({ uid: r.uid, def: r.def_id, level: r.level, hero: r.hero_id ?? null });
    for (const r of hs.rows) s.heroes[r.hero_id] = { id: r.hero_id, level: r.level, star: r.star, shards: r.shards };
    for (const r of sp.rows) s.progress[r.stage] = { stage: r.stage, stars: r.stars, clears: r.clears };
    return s;
  }

  /** sự kiện còn hiệu lực tại nowMs + tiến trình của tài khoản (một truy vấn) */
  private async loadEvents(c: Q, id: number, nowMs: number): Promise<EventState[]> {
    const S = this.S;
    const r = await c.query(
      `SELECT e.id, e.name, e.descr, e.starts_at::float8 AS starts_at, e.ends_at::float8 AS ends_at, e.enabled, e.banner, e.objectives,
              p.obj_id, p.progress, p.claimed
       FROM ${S}h_event e LEFT JOIN ${S}h_event_progress p ON p.event_id = e.id AND p.account_id = $1
       WHERE e.enabled AND e.starts_at <= $2::bigint AND e.ends_at > $2::bigint ORDER BY e.id`,
      [id, nowMs],
    );
    const by = new Map<number, EventState>();
    for (const row of r.rows) {
      let ev = by.get(row.id);
      if (!ev) by.set(row.id, (ev = { def: eventDefOf(row), rows: {} }));
      if (row.obj_id) ev.rows[row.obj_id] = { progress: row.progress, claimed: row.claimed };
    }
    return [...by.values()];
  }

  /** khoá + nạp hồ sơ, tự tạo hồ sơ khởi đầu nếu chưa có (`fresh` = vừa tạo, còn phải ghi tướng/đội/ledger) */
  private async loadLocked(c: Q, id: number, nowMs: number): Promise<{ s: HState; fresh: boolean }> {
    const got = await this.load(c, id, true, false, nowMs);
    if (got) return { s: got, fresh: false };
    const s = newState(id, nowMs);
    let inserted: number | null;
    try {
      const r = await c.query(
        `INSERT INTO ${this.S}h_profile (account_id, gold, gems, tickets, exp, stones, stamina, stamina_at, afk_since)
         VALUES ($1,$2,$3,$4,$5,$6,$7, to_timestamp($8::float8 / 1000.0), to_timestamp($8::float8 / 1000.0))
         ON CONFLICT (account_id) DO NOTHING`,
        [id, s.wallet.gold, s.wallet.gems, s.wallet.tickets, s.wallet.exp, s.wallet.stones, s.stamina, nowMs],
      );
      inserted = r.rowCount;
    } catch (e: any) {
      if (e?.code === '23503') throw new StoreError('Không tìm thấy tài khoản', 404);
      throw e;
    }
    if (inserted) {
      s.events = await this.loadEvents(c, id, nowMs); // hồ sơ mới: vẫn tính sự kiện đang diễn ra (đăng nhập...)
      return { s, fresh: true };
    }
    // tiến trình khác vừa tạo xong (giao dịch của nó đã commit vì lệnh INSERT đã chờ) → nạp lại có khoá
    const again = await this.load(c, id, true, false, nowMs);
    if (!again) throw new StoreError('Không tạo được hồ sơ', 500);
    return { s: again, fresh: false };
  }

  /* ---- ghi ---- */
  private async save(c: Q, s: HState, before: Wallet, kind: string, fresh: boolean) {
    const S = this.S;
    const id = s.accountId;
    await c.query(
      `UPDATE ${S}h_profile SET gold=$2, gems=$3, tickets=$4, exp=$5, stones=$6, level=$7, xp=$8, stamina=$9,
         stamina_at=to_timestamp($10::float8 / 1000.0), afk_since=to_timestamp($11::float8 / 1000.0), active_squad=$12, pity=$13::jsonb,
         tower_floor=$14, tower_day=$15, tower_tries=$16, guild_left_at=$17
       WHERE account_id=$1`,
      [id, s.wallet.gold, s.wallet.gems, s.wallet.tickets, s.wallet.exp, s.wallet.stones, s.level, s.xp, s.stamina, s.staminaAt, s.afkSince, s.activeSquad, JSON.stringify(s.pity), s.towerFloor, s.towerDay, s.towerTries, s.guildLeftAt],
    );
    // đấu trường: chỉ ghi khi đã có hàng (tạo lười ở lần đầu chạm đấu trường)
    if (s.arenaOn) {
      await c.query(
        `INSERT INTO ${S}h_arena (account_id, rating, day, tries, defense_squad, wins, losses, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (account_id) DO UPDATE SET rating = EXCLUDED.rating, day = EXCLUDED.day, tries = EXCLUDED.tries,
           defense_squad = EXCLUDED.defense_squad, wins = EXCLUDED.wins, losses = EXCLUDED.losses, updated_at = now()`,
        [id, s.arenaRating, s.arenaDay, s.arenaTries, s.arenaDefense, s.arenaWins, s.arenaLosses],
      );
    }
    // nhiệm vụ + mua hàng: xoá ngày cũ, ghi ngày hiện tại (hàng 'bonus' = thưởng thêm)
    await c.query(`DELETE FROM ${S}h_quest WHERE account_id = $1 AND day <> $2`, [id, s.day]);
    await c.query(`DELETE FROM ${S}h_shop_buy WHERE account_id = $1 AND day <> $2`, [id, s.day]);
    const qs = Object.entries(s.quests).map(([q, v]) => ({ q, progress: v.progress, claimed: v.claimed }));
    if (s.questBonus) qs.push({ q: 'bonus', progress: 0, claimed: true });
    if (qs.length) {
      await c.query(
        `INSERT INTO ${S}h_quest (account_id, day, quest_id, progress, claimed)
         SELECT $1, $2, t.q, t.p, t.c FROM unnest($3::text[], $4::int[], $5::boolean[]) AS t(q, p, c)
         ON CONFLICT (account_id, day, quest_id) DO UPDATE SET progress = EXCLUDED.progress, claimed = EXCLUDED.claimed`,
        [id, s.day, qs.map((x) => x.q), qs.map((x) => x.progress), qs.map((x) => x.claimed)],
      );
    }
    const bought = Object.entries(s.shop);
    if (bought.length) {
      await c.query(
        `INSERT INTO ${S}h_shop_buy (account_id, day, item_id, count)
         SELECT $1, $2, t.i, t.n FROM unnest($3::text[], $4::int[]) AS t(i, n)
         ON CONFLICT (account_id, day, item_id) DO UPDATE SET count = EXCLUDED.count`,
        [id, s.day, bought.map(([i]) => i), bought.map(([, n]) => n)],
      );
    }
    // sự kiện: ghi tiến trình (bỏ qua sự kiện vừa bị admin xoá giữa chừng)
    const er: { e: number; o: string; p: number; c: boolean }[] = [];
    for (const ev of s.events) for (const [o, v] of Object.entries(ev.rows)) er.push({ e: ev.def.id, o, p: v.progress, c: v.claimed });
    if (er.length) {
      await c.query(
        `INSERT INTO ${S}h_event_progress (account_id, event_id, obj_id, progress, claimed)
         SELECT $1, t.e, t.o, t.p, t.c FROM unnest($2::int[], $3::text[], $4::int[], $5::boolean[]) AS t(e, o, p, c)
         WHERE EXISTS (SELECT 1 FROM ${S}h_event x WHERE x.id = t.e)
         ON CONFLICT (account_id, event_id, obj_id) DO UPDATE SET progress = EXCLUDED.progress, claimed = EXCLUDED.claimed`,
        [id, er.map((x) => x.e), er.map((x) => x.o), er.map((x) => x.p), er.map((x) => x.c)],
      );
    }
    const hs = Object.values(s.heroes);
    if (hs.length) {
      await c.query(
        `INSERT INTO ${S}h_heroes (account_id, hero_id, level, star, shards)
         SELECT $1, t.h, t.l, t.st, t.sh FROM unnest($2::text[], $3::int[], $4::int[], $5::int[]) AS t(h, l, st, sh)
         ON CONFLICT (account_id, hero_id) DO UPDATE SET level = EXCLUDED.level, star = EXCLUDED.star, shards = EXCLUDED.shards`,
        [id, hs.map((h) => h.id), hs.map((h) => h.level), hs.map((h) => h.star), hs.map((h) => h.shards)],
      );
    }
    await c.query(
      `INSERT INTO ${S}h_squads (account_id, idx, slots)
       SELECT $1, t.i, t.v::jsonb FROM unnest($2::int[], $3::text[]) AS t(i, v)
       ON CONFLICT (account_id, idx) DO UPDATE SET slots = EXCLUDED.slots`,
      [id, s.squads.map((_, i) => i), s.squads.map((q) => JSON.stringify(q))],
    );
    const ps = Object.values(s.progress);
    if (ps.length) {
      await c.query(
        `INSERT INTO ${S}h_stage_progress (account_id, stage, stars, clears)
         SELECT $1, t.g, t.st, t.cl FROM unnest($2::text[], $3::int[], $4::int[]) AS t(g, st, cl)
         ON CONFLICT (account_id, stage) DO UPDATE SET stars = EXCLUDED.stars, clears = EXCLUDED.clears`,
        [id, ps.map((p) => p.stage), ps.map((p) => p.stars), ps.map((p) => p.clears)],
      );
    }
    // trang bị: xoá món đã phân rã, cập nhật cấp/tướng đang mặc, rồi thêm món mới (uid do bigserial cấp)
    await c.query(`DELETE FROM ${S}h_gear WHERE account_id = $1 AND uid <> ALL($2::bigint[])`, [id, s.gear.map((g) => g.uid)]);
    if (s.gear.length) {
      await c.query(
        `UPDATE ${S}h_gear g SET level = t.l, hero_id = NULLIF(t.h, '')
         FROM unnest($2::bigint[], $3::int[], $4::text[]) AS t(u, l, h)
         WHERE g.uid = t.u AND g.account_id = $1`,
        [id, s.gear.map((g) => g.uid), s.gear.map((g) => g.level), s.gear.map((g) => g.hero ?? '')],
      );
    }
    if (s.newGear.length) {
      const ins = await c.query(
        `INSERT INTO ${S}h_gear (account_id, def_id) SELECT $1, t.d FROM unnest($2::text[]) WITH ORDINALITY AS t(d, n) ORDER BY t.n RETURNING uid::int AS uid, def_id`,
        [id, s.newGear],
      );
      for (const r of ins.rows) s.gear.push({ uid: r.uid, def: r.def_id, level: 0, hero: null });
      s.newGear = [];
    }
    for (const r of s.runs) {
      await c.query(`INSERT INTO ${S}h_runs (account_id, stage, win, stars, ticks) VALUES ($1,$2,$3,$4,$5)`, [id, r.stage, r.win, r.stars, r.ticks]);
    }
    if (fresh) {
      await c.query(`INSERT INTO ${S}h_ledger (account_id, kind, delta) VALUES ($1,$2,$3::jsonb)`, [id, 'starter', JSON.stringify(STARTER_WALLET)]);
    }
    const l = ledgerOf(before, s.wallet, kind);
    if (l) await c.query(`INSERT INTO ${S}h_ledger (account_id, kind, delta) VALUES ($1,$2,$3::jsonb)`, [id, l.kind, JSON.stringify(l.delta)]);
  }

  /* ---- HeroStore ---- */
  async view<T>(accountId: number, now: Date, fn: (s: Readonly<HState>) => T): Promise<T> {
    const s = await this.tx((c) => this.load(c, accountId, false, false, now.getTime()));
    if (s) return fn(s);
    // chưa có hồ sơ → tạo (một giao dịch có khoá) rồi đọc
    await this.mutate(accountId, now, 'provision', () => 0); // uid trang bị khởi đầu chỉ có sau khi ghi → đọc lại
      return this.view(accountId, now, fn);
  }

  async mutate<T>(accountId: number, now: Date, kind: string, fn: (s: HState) => T, opts?: MutateOpts): Promise<T> {
    return this.run(accountId, now, kind, opts, null, (s) => fn(s));
  }

  async mutateGuild<T>(accountId: number, now: Date, kind: string, target: number | null, fn: (s: HState, g: GuildCtx) => T): Promise<T> {
    return this.run(accountId, now, kind, undefined, { target }, (s, g) => fn(s, g!));
  }

  /** lõi giao dịch: khoá hồ sơ → nhận thưởng chờ → rollDay → (khoá bang) → fn → ghi */
  private async run<T>(
    accountId: number, now: Date, kind: string, opts: MutateOpts | undefined, guild: { target: number | null } | null,
    fn: (s: HState, g: GuildCtx | null) => T,
  ): Promise<T> {
    return this.tx(async (c) => {
      const { s, fresh } = await this.loadLocked(c, accountId, now.getTime());
      if (opts?.idem) {
        // đã khoá hồ sơ nên hai yêu cầu cùng key không thể chạy song song
        const { rows } = await c.query(`SELECT response FROM ${this.S}h_idem WHERE account_id=$1 AND key=$2`, [accountId, opts.idem.key]);
        if (rows.length) {
          if (rows[0].response.tag !== opts.idem.tag) throw new StoreError('Khoá yêu cầu đã dùng cho thao tác khác', 409);
          return rows[0].response.value as T;
        }
      }
      // phần thưởng hạ boss bang đang chờ: xoá + cộng trong cùng giao dịch → đúng một lần (sổ cái riêng)
      const w0 = { ...s.wallet };
      const claimed = await c.query(`DELETE FROM ${this.S}h_guild_reward WHERE account_id = $1`, [accountId]);
      const pending = claimed.rowCount ?? 0;
      if (pending > 0) gainKillRewards(s, pending);
      const killLedger = pending > 0 ? ledgerOf(w0, s.wallet, 'guild-boss-kill') : null;
      const before = { ...s.wallet };
      rollDay(s, now.getTime()); // sang ngày mới: reset Tháp/nhiệm vụ/cửa hàng + tính "đăng nhập"
      let ctx: GuildCtx | null = null;
      let orig: number[] = [];
      if (guild) {
        ctx = await this.loadGuild(c, accountId, guild.target, true);
        orig = ctx.members.map((m) => m.accountId);
      }
      const out = fn(s, ctx);
      assertWallet(s);
      if (ctx) await this.saveGuild(c, ctx, orig, accountId);
      await this.save(c, s, before, kind, fresh);
      if (killLedger) await c.query(`INSERT INTO ${this.S}h_ledger (account_id, kind, delta) VALUES ($1,$2,$3::jsonb)`, [accountId, killLedger.kind, JSON.stringify(killLedger.delta)]);
      if (opts?.idem) {
        await c.query(`DELETE FROM ${this.S}h_idem WHERE account_id=$1 AND created_at < now() - interval '2 days'`, [accountId]);
        await c.query(`INSERT INTO ${this.S}h_idem (account_id, key, response) VALUES ($1,$2,$3::jsonb)`, [accountId, opts.idem.key, JSON.stringify({ tag: opts.idem.tag, value: out })]);
      }
      return out;
    });
  }

  /* ---- bang hội ---- */
  private async loadGuild(c: Q, accountId: number, target: number | null, lock: boolean): Promise<GuildCtx> {
    const S = this.S;
    const mine = await c.query(`SELECT guild_id FROM ${S}h_guild_member WHERE account_id = $1`, [accountId]);
    const myGuildId: number | null = mine.rows.length ? mine.rows[0].guild_id : null;
    const gid = target ?? myGuildId;
    const none: GuildCtx = { guild: null, members: [], myGuildId, deleted: false, killRewards: [] };
    if (gid === null) return none;
    const gr = await c.query(`SELECT ${GUILD_COLS} FROM ${S}h_guild WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [gid]);
    if (!gr.rows.length) return none;
    const mr = await c.query(`SELECT ${MEMBER_COLS} FROM ${S}h_guild_member WHERE guild_id = $1 ORDER BY joined_at, account_id`, [gid]);
    return { guild: guildOf(gr.rows[0]), members: mr.rows.map(memberOf), myGuildId, deleted: false, killRewards: [] };
  }

  private async saveGuild(c: Q, ctx: GuildCtx, orig: number[], accountId: number) {
    const S = this.S;
    const g = ctx.guild;
    if (!g) return;
    if (ctx.deleted) {
      if (g.id > 0) await c.query(`DELETE FROM ${S}h_guild WHERE id = $1`, [g.id]); // thành viên + chat xoá theo (ON DELETE CASCADE)
      return;
    }
    if (g.id === 0) {
      try {
        const r = await c.query(
          `INSERT INTO ${S}h_guild (name, level, exp, notice, leader_id, created_at, boss_cycle, boss_hp, boss_hp_max, boss_killed)
           VALUES ($1,$2,$3,$4,$5, to_timestamp($6::float8 / 1000.0), $7,$8,$9,$10) RETURNING id`,
          [g.name, g.level, g.exp, g.notice, g.leaderId, g.createdAt, g.bossCycle, g.bossHp, g.bossHpMax, g.bossKilled],
        );
        g.id = r.rows[0].id;
      } catch (e: any) {
        if (e?.code === '23505') throw new StoreError('Tên bang đã tồn tại', 409);
        throw e;
      }
      for (const m of ctx.members) m.guildId = g.id;
    } else {
      await c.query(
        `UPDATE ${S}h_guild SET level=$2, exp=$3, notice=$4, leader_id=$5, boss_cycle=$6, boss_hp=$7, boss_hp_max=$8, boss_killed=$9 WHERE id=$1`,
        [g.id, g.level, g.exp, g.notice, g.leaderId, g.bossCycle, g.bossHp, g.bossHpMax, g.bossKilled],
      );
    }
    const keep = ctx.members.map((m) => m.accountId);
    if (orig.some((id) => !keep.includes(id))) {
      await c.query(`DELETE FROM ${S}h_guild_member WHERE guild_id = $1 AND account_id <> ALL($2::int[])`, [g.id, keep]);
    }
    const ms = ctx.members;
    if (ms.length) {
      await c.query(
        `INSERT INTO ${S}h_guild_member (account_id, guild_id, role, contribution, boss_damage, joined_at, donated_day, donated_n, checkin_day, boss_day, boss_tries_used)
         SELECT t.a, $1, t.r, t.c, t.d, to_timestamp(t.j / 1000.0), t.dd, t.dn, t.cd, t.bd, t.bu
         FROM unnest($2::int[], $3::text[], $4::int[], $5::int[], $6::float8[], $7::int[], $8::int[], $9::int[], $10::int[], $11::int[]) AS t(a, r, c, d, j, dd, dn, cd, bd, bu)
         ON CONFLICT (account_id) DO UPDATE SET guild_id = EXCLUDED.guild_id, role = EXCLUDED.role, contribution = EXCLUDED.contribution,
           boss_damage = EXCLUDED.boss_damage, donated_day = EXCLUDED.donated_day, donated_n = EXCLUDED.donated_n, checkin_day = EXCLUDED.checkin_day,
           boss_day = EXCLUDED.boss_day, boss_tries_used = EXCLUDED.boss_tries_used`,
        [g.id, ms.map((m) => m.accountId), ms.map((m) => m.role), ms.map((m) => m.contribution), ms.map((m) => m.bossDamage), ms.map((m) => m.joinedAt),
         ms.map((m) => m.donatedDay), ms.map((m) => m.donatedN), ms.map((m) => m.checkinDay), ms.map((m) => m.bossDay), ms.map((m) => m.bossTriesUsed)],
      );
    }
    const kr = [...new Set(ctx.killRewards)].filter((id) => id !== accountId);
    if (kr.length) {
      // chỉ INSERT (không khoá hồ sơ người khác) → không có khoá chéo; UNIQUE chặn xếp hàng trùng
      await c.query(
        `INSERT INTO ${S}h_guild_reward (account_id, guild_id, cycle) SELECT t.a, $1, $2 FROM unnest($3::int[]) AS t(a) ON CONFLICT DO NOTHING`,
        [g.id, g.bossCycle, kr],
      );
    }
  }

  async viewGuild<T>(accountId: number, now: Date, fn: (s: Readonly<HState>, g: Readonly<GuildCtx>) => T): Promise<T> {
    const got = await this.tx(async (c) => {
      const s = await this.load(c, accountId, false, false, now.getTime());
      if (!s) return null;
      return { s, g: await this.loadGuild(c, accountId, null, false) };
    });
    if (got) return fn(got.s, got.g);
    await this.mutate(accountId, now, 'provision', () => 0);
    return this.viewGuild(accountId, now, fn);
  }

  async guildList(limit: number): Promise<GuildListRow[]> {
    const { rows } = await this.pool.query(
      `SELECT ${GUILD_COLS}, (SELECT count(*)::int FROM ${this.S}h_guild_member m WHERE m.guild_id = h_guild.id) AS n
       FROM ${this.S}h_guild h_guild ORDER BY n DESC, id LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({ guild: guildOf(r), members: r.n as number }));
  }

  async guildChat(accountId: number, limit: number): Promise<GuildChatMsg[] | null> {
    const S = this.S;
    const mine = await this.pool.query(`SELECT guild_id FROM ${S}h_guild_member WHERE account_id = $1`, [accountId]);
    if (!mine.rows.length) return null;
    const { rows } = await this.pool.query(
      `SELECT id::float8 AS id, username, text, at::float8 AS at FROM ${S}h_guild_chat WHERE guild_id = $1 ORDER BY id DESC LIMIT $2`,
      [mine.rows[0].guild_id, limit],
    );
    return rows.reverse().map((r) => ({ id: r.id as number, username: r.username as string, text: r.text as string, at: r.at as number }));
  }
  async guildChatPost(accountId: number, username: string, text: string, nowMs: number): Promise<GuildChatMsg> {
    const S = this.S;
    return this.tx(async (c) => {
      const mine = await c.query(`SELECT guild_id FROM ${S}h_guild_member WHERE account_id = $1`, [accountId]);
      if (!mine.rows.length) throw new StoreError('Bạn chưa vào bang nào', 400);
      const gid = mine.rows[0].guild_id as number;
      let ins;
      try {
        ins = await c.query(`INSERT INTO ${S}h_guild_chat (guild_id, account_id, username, text, at) VALUES ($1,$2,$3,$4,$5) RETURNING id::float8 AS id`, [gid, accountId, username, text, nowMs]);
      } catch (e: any) {
        if (e?.code === '23503') throw new StoreError('Bạn chưa vào bang nào', 400);
        throw e;
      }
      // chỉ giữ GUILD_CHAT_KEEP tin cuối
      await c.query(
        `DELETE FROM ${S}h_guild_chat WHERE guild_id = $1 AND id < (SELECT id FROM ${S}h_guild_chat WHERE guild_id = $1 ORDER BY id DESC OFFSET $2 LIMIT 1)`,
        [gid, GUILD_CHAT_KEEP - 1],
      );
      return { id: ins.rows[0].id as number, username, text, at: nowMs };
    });
  }
  async pendingKill(accountId: number): Promise<number> {
    const { rows } = await this.pool.query(`SELECT count(*)::int AS n FROM ${this.S}h_guild_reward WHERE account_id = $1`, [accountId]);
    return rows[0].n as number;
  }

  /* ---- sự kiện (admin) ---- */
  async adminEvents(): Promise<EventDef[]> {
    const { rows } = await this.pool.query(`SELECT ${EVENT_COLS} FROM ${this.S}h_event ORDER BY id`);
    return rows.map(eventDefOf);
  }
  async adminEventSave(ev: Omit<EventDef, 'id'> & { id?: number }): Promise<EventDef> {
    const S = this.S;
    return this.tx(async (c) => {
      const args = [ev.name, ev.desc, ev.startsAt, ev.endsAt, ev.enabled, ev.banner ?? null, JSON.stringify(ev.objectives)];
      let id: number;
      if (ev.id !== undefined) {
        const r = await c.query(
          `UPDATE ${S}h_event SET name=$2, descr=$3, starts_at=$4, ends_at=$5, enabled=$6, banner=$7, objectives=$8::jsonb WHERE id=$1 RETURNING id`,
          [ev.id, ...args],
        );
        if (!r.rows.length) throw new StoreError('Không tìm thấy sự kiện', 404);
        id = ev.id;
        // bỏ mục tiêu → xoá tiến trình của nó; mục còn lại giữ nguyên
        await c.query(`DELETE FROM ${S}h_event_progress WHERE event_id = $1 AND obj_id <> ALL($2::text[])`, [id, ev.objectives.map((o) => o.id)]);
      } else {
        const r = await c.query(
          `INSERT INTO ${S}h_event (name, descr, starts_at, ends_at, enabled, banner, objectives) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id`,
          args,
        );
        id = r.rows[0].id;
      }
      return { ...structuredClone(ev), id };
    });
  }
  async adminEventDelete(id: number): Promise<void> {
    const r = await this.pool.query(`DELETE FROM ${this.S}h_event WHERE id = $1`, [id]);
    if (!r.rowCount) throw new StoreError('Không tìm thấy sự kiện', 404);
  }

  async leaderboard(limit: number): Promise<LeaderEntry[]> {
    // index ải = (chương-1)*số ải mỗi chương + (số thứ tự-1), suy ra từ id dạng "c-n"
    const { rows } = await this.pool.query(
      `SELECT account_id, idx, stars FROM (
         SELECT DISTINCT ON (account_id) account_id, idx, stars FROM (
           SELECT account_id, stars, (split_part(stage, '-', 1)::int - 1) * $2 + split_part(stage, '-', 2)::int - 1 AS idx
           FROM ${this.S}h_stage_progress WHERE stars > 0
         ) p ORDER BY account_id, idx DESC
       ) best ORDER BY idx DESC, stars DESC, account_id LIMIT $1`,
      [limit, STAGES_PER_CHAPTER],
    );
    return rows.map((r) => ({ accountId: r.account_id as number, stage: r.idx as number, stars: r.stars as number }));
  }

  async peek<T>(accountId: number, fn: (s: Readonly<HState>) => T): Promise<T | null> {
    const c = await this.pool.connect();
    try {
      const s = await this.load(c, accountId, false, true); // đọc không khoá, không đụng hàng của người ấy
      return s ? fn(s) : null;
    } finally {
      c.release();
    }
  }

  async arenaNear(selfId: number, rating: number, limit: number): Promise<ArenaRank[]> {
    // đội phòng thủ có ít nhất 1 ô khác rỗng (tướng bị xoá không xảy ra: không có API bỏ tướng)
    const { rows } = await this.pool.query(
      `SELECT a.account_id, a.rating, a.wins FROM ${this.S}h_arena a
       JOIN ${this.S}h_squads q ON q.account_id = a.account_id AND q.idx = a.defense_squad
       WHERE a.account_id <> $1 AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(q.slots) e WHERE e <> '')
       ORDER BY abs(a.rating - $2), a.account_id LIMIT $3`,
      [selfId, rating, limit],
    );
    return rows.map((r) => ({ accountId: r.account_id as number, rating: r.rating as number, wins: r.wins as number }));
  }
  async arenaRank(accountId: number): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT 1 + (SELECT count(*) FROM ${this.S}h_arena o WHERE o.rating > me.rating
                     OR (o.rating = me.rating AND o.wins > me.wins)
                     OR (o.rating = me.rating AND o.wins = me.wins AND o.account_id < me.account_id))::int AS rank
       FROM ${this.S}h_arena me WHERE me.account_id = $1`,
      [accountId],
    );
    return rows.length ? (rows[0].rank as number) : 0;
  }
  async arenaTop(limit: number): Promise<ArenaRank[]> {
    const { rows } = await this.pool.query(
      `SELECT account_id, rating, wins FROM ${this.S}h_arena ORDER BY rating DESC, wins DESC, account_id LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({ accountId: r.account_id as number, rating: r.rating as number, wins: r.wins as number }));
  }
}
