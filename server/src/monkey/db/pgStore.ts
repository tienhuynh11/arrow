// Store trên Postgres (Neon). Pool nhỏ (tối đa 3 kết nối) cho gói RAM 512 MB.
// Mọi thao tác thay đổi: một giao dịch, khoá dòng tài khoản (SELECT … FOR UPDATE) trước khi kiểm tra
// quyền sở hữu / số dư, nên hai yêu cầu song song của cùng tài khoản không thể tiêu trùng tiền.
// Tên bảng luôn có tiền tố schema (không dựa vào search_path — pooler của Neon không giữ SET giữa giao dịch).

import pg from 'pg';
import type { EventDef, EventObjective, EventState, LeaderRow, MeResponse, StageProgress } from '../../../../shared/monkey/api.js';
import { CHAR_UNLOCK, STARTER_KIT, loadoutOf2, type EquipSlot, type ItemInst, type Loadout2, type Reward, type SkillKey } from '../../../../shared/monkey/progression.js';
import { migrate } from './migrations.js';
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
  kindOf,
  rewardItems,
  type Wallet,
} from './rules.js';
import { StoreError, type AccountRow, type ExtractOutcome, type ExtractRun, type RunResult, type Store, type TeamRun } from './store.js';

type Q = pg.PoolClient;
interface AccRow extends Wallet {
  id: number;
  cls: number;
  kills: number;
}

export interface PgOptions {
  connectionString: string;
  /** schema chứa bảng (mặc định public) — test dùng schema tạm */
  schema?: string;
  max?: number;
}

export class PgStore implements Store {
  readonly kind = 'pg' as const;
  readonly pool: pg.Pool;
  /** tiền tố schema đã kiểm tra, vd `"public".` */
  private S: string;

  constructor(opts: PgOptions) {
    const schema = opts.schema ?? 'public';
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error('schema không hợp lệ');
    this.S = `"${schema}".`;
    this.pool = new pg.Pool({
      connectionString: opts.connectionString,
      max: opts.max ?? 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    });
    // lỗi trên kết nối rảnh (Neon ngủ / cắt kết nối) không được làm sập tiến trình
    this.pool.on('error', (e) => console.warn('[monkey-db] lỗi kết nối rảnh:', e.message));
  }

  async init() {
    const c = await this.pool.connect();
    try {
      await migrate(c, this.S);
    } finally {
      c.release();
    }
  }

  async close() {
    await this.pool.end();
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

  /** khoá dòng tài khoản cho đến hết giao dịch */
  private async lock(c: Q, id: number): Promise<AccRow> {
    const { rows } = await c.query(`SELECT id, level, xp, gold, shards, books, cls, kills FROM ${this.S}accounts WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows.length) throw new StoreError('Không tìm thấy tài khoản', 404);
    return rows[0] as AccRow;
  }
  private async saveWallet(c: Q, a: AccRow) {
    await c.query(`UPDATE ${this.S}accounts SET level=$2, xp=$3, gold=$4, shards=$5, books=$6, cls=$7, kills=$8 WHERE id=$1`, [a.id, a.level, a.xp, a.gold, a.shards, a.books, a.cls, a.kills]);
  }
  /**
   * Thao tác kho đồ: nạp mọi món của tài khoản (khoá dòng), chạy `fn` trên bộ lập kế hoạch, ghi thay đổi.
   * Gọi SAU lock(); ví `a` được Inv sửa trực tiếp (người gọi tự saveWallet).
   */
  private async withInv<T>(c: Q, a: AccRow, fn: (inv: Inv) => T): Promise<{ out: T; touched: ItemInst[] }> {
    const S = this.S;
    const { rows } = await c.query(`SELECT ${ITEM_COLS} FROM ${S}items WHERE account_id=$1 ORDER BY uid FOR UPDATE`, [a.id]);
    const inv = new Inv(rows.map(itemOf), a);
    const out = fn(inv);
    const ch = inv.changes();
    if (ch.removed.length) await c.query(`DELETE FROM ${S}items WHERE account_id=$1 AND uid = ANY($2::int[])`, [a.id, ch.removed]);
    if (ch.updated.length) {
      const u = ch.updated;
      // gỡ ô trước để đổi chỗ 2 ô không vướng chỉ mục duy nhất (account_id, slot)
      await c.query(`UPDATE ${S}items SET slot=NULL WHERE account_id=$1 AND uid = ANY($2::int[]) AND slot IS NOT NULL`, [a.id, u.map((i) => i.uid)]);
      await c.query(
        `UPDATE ${S}items i SET slot=v.slot, stash=v.stash, count=v.count, level=v.level
         FROM unnest($2::int[], $3::text[], $4::bool[], $5::int[], $6::int[]) AS v(uid, slot, stash, count, level)
         WHERE i.uid=v.uid AND i.account_id=$1`,
        [a.id, u.map((i) => i.uid), u.map((i) => i.slot), u.map((i) => i.stash), u.map((i) => i.count), u.map((i) => i.level)],
      );
    }
    const real = new Map<number, ItemInst>();
    for (const it of ch.added) {
      const r = await c.query(
        `INSERT INTO ${S}items (account_id, item_id, kind, grade, level, affixes, count, slot, stash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${ITEM_COLS}`,
        [a.id, it.itemId, kindOf(it.itemId), it.grade, it.level, JSON.stringify(it.affixes), it.count, it.slot, it.stash],
      );
      real.set(it.uid, itemOf(r.rows[0]));
    }
    const touched: ItemInst[] = [];
    for (const u of inv.touched) {
      const it = real.get(u) ?? inv.items.find((i) => i.uid === u);
      if (it) touched.push(it);
    }
    return { out, touched };
  }
  /** cộng phần thưởng vào ví `a` (chưa lưu ví) + tạo đồ + mở nhân vật */
  private async give(c: Q, a: AccRow, r: Reward) {
    const ups = applyGain(a, r);
    const list = rewardItems(r.items);
    let made: ItemInst[] = [];
    if (list.length) made = (await this.withInv(c, a, (inv) => inv.give(list))).touched;
    if (r.unlockChar !== undefined && isCls(r.unlockChar)) await c.query(`INSERT INTO ${this.S}chars (account_id, cls) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [a.id, r.unlockChar]);
    return { made, ups };
  }
  /** thao tác kho đồ trọn gói: khoá tài khoản → kế hoạch → ghi → lưu ví */
  private invOp<T>(accountId: number, fn: (inv: Inv) => T): Promise<T> {
    return this.tx(async (c) => {
      const a = await this.lock(c, accountId);
      const { out } = await this.withInv(c, a, fn);
      await this.saveWallet(c, a);
      return out;
    });
  }
  private async skillLevel(c: Q, accountId: number, cls: number, skill: SkillKey) {
    const { rows } = await c.query(`SELECT level FROM ${this.S}skill_levels WHERE account_id=$1 AND cls=$2 AND skill=$3`, [accountId, cls, skill]);
    return rows.length ? Number(rows[0].level) : 1;
  }
  private async hasChar(c: Q | pg.Pool, accountId: number, cls: number) {
    const { rowCount } = await c.query(`SELECT 1 FROM ${this.S}chars WHERE account_id=$1 AND cls=$2`, [accountId, cls]);
    return !!rowCount;
  }

  /* ---- tài khoản ---- */
  async createAccount(username: string, passHash: string) {
    try {
      return await this.tx(async (c) => {
        const { rows } = await c.query(`INSERT INTO ${this.S}accounts (username, ukey, pass_hash) VALUES ($1,$2,$3) RETURNING id`, [username, username.toLowerCase(), passHash]);
        const id = rows[0].id as number;
        await c.query(`INSERT INTO ${this.S}chars (account_id, cls) SELECT $1, unnest($2::smallint[])`, [id, DEFAULT_CHARS]);
        for (const s of STARTER_KIT) {
          await c.query(`INSERT INTO ${this.S}items (account_id, item_id, kind, grade, count, slot) VALUES ($1,$2,$3,$4,$5,$6)`, [id, s.itemId, kindOf(s.itemId), s.grade, s.count, s.slot]);
        }
        return id;
      });
    } catch (e: any) {
      if (e?.code === '23505') return null; // trùng ukey
      throw e;
    }
  }
  async findAccount(username: string): Promise<AccountRow | null> {
    const { rows } = await this.pool.query(`SELECT id, username, pass_hash FROM ${this.S}accounts WHERE ukey=$1`, [username.toLowerCase()]);
    return rows.length ? { id: rows[0].id, username: rows[0].username, passHash: rows[0].pass_hash } : null;
  }
  async accountById(id: number): Promise<AccountRow | null> {
    if (!Number.isInteger(id)) return null;
    const { rows } = await this.pool.query(`SELECT id, username, pass_hash FROM ${this.S}accounts WHERE id=$1`, [id]);
    return rows.length ? { id: rows[0].id, username: rows[0].username, passHash: rows[0].pass_hash } : null;
  }
  async createSession(accountId: number, tokenHash: string, expiresAt: Date) {
    await this.pool.query(`INSERT INTO ${this.S}sessions (token_hash, account_id, expires_at) VALUES ($1,$2,$3)`, [tokenHash, accountId, expiresAt]);
    // dọn phiên hết hạn thỉnh thoảng
    if (Math.random() < 0.05) await this.pool.query(`DELETE FROM ${this.S}sessions WHERE expires_at <= now()`);
  }
  async sessionAccount(tokenHash: string) {
    const { rows } = await this.pool.query(`SELECT account_id FROM ${this.S}sessions WHERE token_hash=$1 AND expires_at > now()`, [tokenHash]);
    return rows.length ? (rows[0].account_id as number) : null;
  }
  async deleteSession(tokenHash: string) {
    await this.pool.query(`DELETE FROM ${this.S}sessions WHERE token_hash=$1`, [tokenHash]);
  }

  /* ---- hồ sơ ---- */
  async me(accountId: number, now: Date): Promise<MeResponse> {
    const S = this.S;
    const c = await this.pool.connect();
    try {
      const acc = await c.query(`SELECT id, username, level, xp, gold, shards, books, cls, kills FROM ${S}accounts WHERE id=$1`, [accountId]);
      if (!acc.rows.length) throw new StoreError('Không tìm thấy tài khoản', 404);
      const a = acc.rows[0];
      const chars = await c.query(`SELECT cls FROM ${S}chars WHERE account_id=$1 ORDER BY cls`, [accountId]);
      const sk = await c.query(`SELECT cls, skill, level FROM ${S}skill_levels WHERE account_id=$1`, [accountId]);
      const items = await c.query(`SELECT ${ITEM_COLS} FROM ${S}items WHERE account_id=$1 ORDER BY uid`, [accountId]);
      const st = await c.query(`SELECT stage, stars, best_secs, clears FROM ${S}stage_progress WHERE account_id=$1 ORDER BY stage`, [accountId]);
      const skills: Record<number, Record<SkillKey, number>> = {};
      for (let i = 0; i < NUM_CHARS; i++) skills[i] = { g: 1, x: 1, q: 1 };
      for (const r of sk.rows) if (skills[r.cls] && SKILL_KEYS.includes(r.skill)) skills[r.cls][r.skill as SkillKey] = r.level;
      return {
        profile: {
          id: a.id, username: a.username, level: a.level, xp: a.xp, gold: a.gold, shards: a.shards, books: a.books,
          chars: chars.rows.map((r) => Number(r.cls)), cls: a.cls, skills, kills: a.kills,
        },
        items: items.rows.map(itemOf),
        stages: st.rows.map(stageOf),
        events: await this.eventStatesOn(c, accountId, now),
      };
    } finally {
      c.release();
    }
  }
  async loadout(accountId: number, cls: number): Promise<Loadout2> {
    const k = isCls(cls) ? cls : 0;
    const items = await this.pool.query(`SELECT ${ITEM_COLS} FROM ${this.S}items WHERE account_id=$1 AND slot IS NOT NULL`, [accountId]);
    const sk = await this.pool.query(`SELECT skill, level FROM ${this.S}skill_levels WHERE account_id=$1 AND cls=$2`, [accountId, k]);
    const skills: Record<SkillKey, number> = { g: 1, x: 1, q: 1 };
    for (const r of sk.rows) if (SKILL_KEYS.includes(r.skill)) skills[r.skill as SkillKey] = r.level;
    return loadoutOf2(items.rows.map(itemOf), k, skills);
  }
  async clearedStages(accountId: number) {
    const { rows } = await this.pool.query(`SELECT stage FROM ${this.S}stage_progress WHERE account_id=$1 AND clears > 0`, [accountId]);
    return new Set(rows.map((r) => r.stage as string));
  }

  /* ---- thao tác ---- */
  async equip(accountId: number, uid: number, slot: EquipSlot) {
    await this.invOp(accountId, (inv) => inv.equip(uid, slot));
  }
  async unequip(accountId: number, slot: EquipSlot) {
    if (!isSlot(slot)) throw new StoreError('Ô trang bị không hợp lệ');
    await this.invOp(accountId, (inv) => inv.unequip(slot));
  }
  async moveToStash(accountId: number, uid: number) {
    await this.invOp(accountId, (inv) => inv.move(uid, true));
  }
  async moveToBag(accountId: number, uid: number) {
    await this.invOp(accountId, (inv) => inv.move(uid, false));
  }
  async sell(accountId: number, uids: number[]) {
    return this.invOp(accountId, (inv) => inv.sell(uids));
  }
  async salvage(accountId: number, uids: number[]) {
    return this.sell(accountId, uids);
  }
  async buy(accountId: number, idx: number, qty: number) {
    return this.invOp(accountId, (inv) => inv.buy(idx, qty));
  }
  async claimStarter(accountId: number) {
    await this.invOp(accountId, (inv) => inv.claimStarter());
  }
  async upgradeItem(accountId: number, uid: number) {
    await this.invOp(accountId, (inv) => inv.upgrade(uid));
  }
  async unlockChar(accountId: number, cls: number) {
    await this.tx(async (c) => {
      const a = await this.lock(c, accountId);
      const owned = isCls(cls) && (await this.hasChar(c, accountId, cls));
      let cleared = false;
      const rule = isCls(cls) ? CHAR_UNLOCK[cls] : null;
      if (rule?.kind === 'stage') {
        const { rowCount } = await c.query(`SELECT 1 FROM ${this.S}stage_progress WHERE account_id=$1 AND stage=$2 AND clears > 0`, [accountId, rule.stage]);
        cleared = !!rowCount;
      }
      const shards = checkUnlock(cls, a, owned, () => cleared);
      a.shards -= shards;
      await this.saveWallet(c, a);
      await c.query(`INSERT INTO ${this.S}chars (account_id, cls) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [accountId, cls]);
    });
  }
  async selectChar(accountId: number, cls: number) {
    if (!isCls(cls)) throw new StoreError('Nhân vật không hợp lệ');
    await this.tx(async (c) => {
      const a = await this.lock(c, accountId);
      if (!(await this.hasChar(c, accountId, cls))) throw new StoreError('Chưa mở nhân vật này');
      a.cls = cls;
      await this.saveWallet(c, a);
    });
  }
  async upgradeSkill(accountId: number, cls: number, skill: SkillKey) {
    await this.tx(async (c) => {
      const a = await this.lock(c, accountId);
      const valid = isCls(cls) && SKILL_KEYS.includes(skill);
      const cur = valid ? await this.skillLevel(c, accountId, cls, skill) : 1;
      const owned = valid && (await this.hasChar(c, accountId, cls));
      const cost = checkSkill(cls, skill, cur, owned, a);
      a.gold -= cost.gold;
      a.books -= cost.books;
      await this.saveWallet(c, a);
      await c.query(
        `INSERT INTO ${this.S}skill_levels (account_id, cls, skill, level) VALUES ($1,$2,$3,$4) ON CONFLICT (account_id, cls, skill) DO UPDATE SET level = EXCLUDED.level`,
        [accountId, cls, skill, cur + 1],
      );
    });
  }
  async claimEvent(accountId: number, eventId: number, objective: string, now: Date) {
    return this.tx(async (c) => {
      const a = await this.lock(c, accountId);
      const ev = Number.isInteger(eventId) && eventId > 0 && eventId < 2 ** 31 ? await this.eventById(c, eventId) : null;
      const { rows } = await c.query(`SELECT progress, claimed FROM ${this.S}event_progress WHERE account_id=$1 AND event_id=$2 FOR UPDATE`, [accountId, eventId]);
      const progress: Record<string, number> = rows[0]?.progress ?? {};
      const claimed: string[] = rows[0]?.claimed ?? [];
      const o = checkClaim(ev, String(objective), progress, claimed, now);
      await this.give(c, a, o.reward);
      await this.saveWallet(c, a);
      await c.query(
        `INSERT INTO ${this.S}event_progress (account_id, event_id, progress, claimed) VALUES ($1,$2,$3,$4)
         ON CONFLICT (account_id, event_id) DO UPDATE SET claimed = EXCLUDED.claimed`,
        [accountId, eventId, JSON.stringify(progress), JSON.stringify([...claimed, o.id])],
      );
      return o.reward;
    });
  }
  async grant(accountId: number, reward: Reward) {
    return this.tx(async (c) => {
      const a = await this.lock(c, accountId);
      const g = await this.give(c, a, reward);
      await this.saveWallet(c, a);
      return g.made;
    });
  }

  /* ---- kết quả trận ---- */
  async recordRun(raw: RunResult, now: Date) {
    const r = cleanRun(raw);
    const S = this.S;
    return this.tx(async (c) => {
      const a = await this.lock(c, r.accountId);
      await c.query(`INSERT INTO ${S}runs (account_id, stage, won, stars, wave, kills, secs, score, reward, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
        a.id, r.stage, r.won, r.stars, r.wave, r.kills, r.secs, r.score, JSON.stringify(r.reward), now,
      ]);
      a.kills = Math.min(MONEY_CAP, a.kills + r.kills);
      const g = await this.give(c, a, r.reward);
      const items = [...g.made];
      let ups = g.ups;
      let firstClear = false;
      if (r.won && r.stage !== 'endless') {
        const { rows } = await c.query(`SELECT stage, stars, best_secs, clears FROM ${S}stage_progress WHERE account_id=$1 AND stage=$2 FOR UPDATE`, [a.id, r.stage]);
        const prev: StageProgress | undefined = rows[0] ? stageOf(rows[0]) : undefined;
        firstClear = !prev || prev.clears === 0;
        const next: StageProgress = {
          stage: r.stage,
          stars: Math.max(prev?.stars ?? 0, r.stars),
          bestSecs: prev && prev.clears > 0 ? Math.min(prev.bestSecs, r.secs) : r.secs,
          clears: (prev?.clears ?? 0) + 1,
        };
        await c.query(
          `INSERT INTO ${S}stage_progress (account_id, stage, stars, best_secs, clears) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (account_id, stage) DO UPDATE SET stars=EXCLUDED.stars, best_secs=EXCLUDED.best_secs, clears=EXCLUDED.clears`,
          [a.id, next.stage, next.stars, next.bestSecs, next.clears],
        );
        const fr = firstClear ? firstReward(r.stage) : null;
        if (fr) {
          const f = await this.give(c, a, fr);
          items.push(...f.made);
          ups += f.ups;
        }
      }
      for (const e of await this.eventsOn(c, true, now)) {
        const { rows } = await c.query(`SELECT progress FROM ${S}event_progress WHERE account_id=$1 AND event_id=$2 FOR UPDATE`, [a.id, e.id]);
        const p = eventAfterRun(e, rows[0]?.progress ?? {}, r);
        await c.query(
          `INSERT INTO ${S}event_progress (account_id, event_id, progress) VALUES ($1,$2,$3)
           ON CONFLICT (account_id, event_id) DO UPDATE SET progress = EXCLUDED.progress`,
          [a.id, e.id, JSON.stringify(p)],
        );
      }
      await this.saveWallet(c, a);
      return { items, levelUps: ups, newLevel: a.level, firstClear };
    });
  }
  async recordExtract(raw: ExtractRun, now: Date): Promise<ExtractOutcome> {
    const r = cleanRun(raw);
    const S = this.S;
    const x = r.extract ?? { survived: false, kept: [], lost: [], looted: [], usedConsumables: {} };
    const chest: Reward = x.survived ? r.chest ?? {} : { xp: Math.round((r.chest?.xp ?? 0) * 0.3) };
    return this.tx(async (c) => {
      const a = await this.lock(c, r.accountId);
      let ups = applyGain(a, chest);
      const cleared = r.won && r.stage !== 'endless';
      let firstClear = false;
      let fr: Reward | null = null;
      if (cleared) {
        const { rows } = await c.query(`SELECT stage, stars, best_secs, clears FROM ${S}stage_progress WHERE account_id=$1 AND stage=$2 FOR UPDATE`, [a.id, r.stage]);
        const prev: StageProgress | undefined = rows[0] ? stageOf(rows[0]) : undefined;
        firstClear = !prev || prev.clears === 0;
        const next: StageProgress = {
          stage: r.stage,
          stars: Math.max(prev?.stars ?? 0, r.stars),
          bestSecs: prev && prev.clears > 0 ? Math.min(prev.bestSecs, r.secs) : r.secs,
          clears: (prev?.clears ?? 0) + 1,
        };
        await c.query(
          `INSERT INTO ${S}stage_progress (account_id, stage, stars, best_secs, clears) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (account_id, stage) DO UPDATE SET stars=EXCLUDED.stars, best_secs=EXCLUDED.best_secs, clears=EXCLUDED.clears`,
          [a.id, next.stage, next.stars, next.bestSecs, next.clears],
        );
        fr = firstClear ? firstReward(r.stage) : null;
        if (fr) ups += applyGain(a, fr);
        if (fr?.unlockChar !== undefined && isCls(fr.unlockChar)) await c.query(`INSERT INTO ${S}chars (account_id, cls) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [a.id, fr.unlockChar]);
      }
      const frItems = fr?.items;
      const res = await this.withInv(c, a, (inv) => {
        const e = inv.extract(x);
        const g1 = inv.give(rewardItems(chest.items));
        const g2 = frItems ? inv.give(rewardItems(frItems)) : { gold: 0 };
        return { lost: e.lost, overflow: e.loot.gold + g1.gold + g2.gold };
      });
      a.kills = Math.min(MONEY_CAP, a.kills + r.kills);
      for (const e of await this.eventsOn(c, true, now)) {
        const { rows } = await c.query(`SELECT progress FROM ${S}event_progress WHERE account_id=$1 AND event_id=$2 FOR UPDATE`, [a.id, e.id]);
        const p = eventAfterRun(e, rows[0]?.progress ?? {}, r);
        await c.query(
          `INSERT INTO ${S}event_progress (account_id, event_id, progress) VALUES ($1,$2,$3)
           ON CONFLICT (account_id, event_id) DO UPDATE SET progress = EXCLUDED.progress`,
          [a.id, e.id, JSON.stringify(p)],
        );
      }
      const granted = grantedOf(chest, fr);
      await c.query(`INSERT INTO ${S}runs (account_id, stage, won, stars, wave, kills, secs, score, reward, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
        a.id, r.stage, r.won, r.stars, r.wave, r.kills, r.secs, r.score,
        JSON.stringify({ ...granted, survived: !!x.survived, lost: res.out.lost.length, looted: (x.looted ?? []).length }), now,
      ]);
      await this.saveWallet(c, a);
      return { items: res.touched, lost: res.out.lost, overflowGold: res.out.overflow, granted, levelUps: ups, newLevel: a.level, firstClear };
    });
  }
  async recordTeamRun(t: TeamRun, now: Date) {
    await this.pool.query(`INSERT INTO ${this.S}team_runs (stage, solo, names, cls, wave, score, kills, secs, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
      String(t.stage).slice(0, 40), !!t.solo, JSON.stringify(t.names), JSON.stringify(t.cls), t.wave | 0, t.score | 0, t.kills | 0, t.secs | 0, now,
    ]);
  }
  async leaderboard(stage: string, solo: boolean, limit: number): Promise<LeaderRow[]> {
    const { rows } = await this.pool.query(
      `SELECT names, cls, stage, wave, score, kills, secs, at FROM ${this.S}team_runs WHERE stage=$1 AND solo=$2
       ORDER BY wave DESC, score DESC, secs ASC, at ASC LIMIT $3`,
      [stage, !!solo, Math.max(1, Math.min(100, limit | 0))],
    );
    return rows.map((r) => ({ names: r.names, cls: r.cls, stage: r.stage, wave: r.wave, score: r.score, kills: r.kills, secs: r.secs, at: new Date(r.at).getTime() }));
  }

  /* ---- sự kiện ---- */
  private async eventsOn(c: Q | pg.Pool, activeOnly: boolean, now: Date): Promise<EventDef[]> {
    const { rows } = await c.query(`SELECT * FROM ${this.S}events ORDER BY starts_at DESC, id DESC`);
    const all = rows.map(eventOf);
    return activeOnly ? all.filter((e) => eventActive(e, now)) : all;
  }
  private async eventById(c: Q | pg.Pool, id: number): Promise<EventDef | null> {
    const { rows } = await c.query(`SELECT * FROM ${this.S}events WHERE id=$1`, [id]);
    return rows.length ? eventOf(rows[0]) : null;
  }
  async listEvents() {
    return this.eventsOn(this.pool, false, new Date());
  }
  async activeEvents(now: Date) {
    return this.eventsOn(this.pool, true, now);
  }
  async saveEvent(e: EventDef) {
    const vals = [e.name, e.icon, e.desc, e.startsAt, e.endsAt, !!e.enabled, e.stage ?? null, JSON.stringify(e.objectives)];
    if (!e.id) {
      const { rows } = await this.pool.query(
        `INSERT INTO ${this.S}events (name, icon, descr, starts_at, ends_at, enabled, stage, objectives) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        vals,
      );
      return eventOf(rows[0]);
    }
    const { rows } = await this.pool.query(
      `UPDATE ${this.S}events SET name=$1, icon=$2, descr=$3, starts_at=$4, ends_at=$5, enabled=$6, stage=$7, objectives=$8 WHERE id=$9 RETURNING *`,
      [...vals, e.id],
    );
    if (!rows.length) throw new StoreError('Không tìm thấy sự kiện', 404);
    return eventOf(rows[0]);
  }
  async deleteEvent(id: number) {
    await this.pool.query(`DELETE FROM ${this.S}events WHERE id=$1`, [id]);
  }
  private async eventStatesOn(c: Q | pg.Pool, accountId: number, now: Date): Promise<EventState[]> {
    const evs = await this.eventsOn(c, true, now);
    if (!evs.length) return [];
    const { rows } = await c.query(`SELECT event_id, progress, claimed FROM ${this.S}event_progress WHERE account_id=$1 AND event_id = ANY($2::int[])`, [accountId, evs.map((e) => e.id)]);
    const by = new Map(rows.map((r) => [r.event_id as number, r]));
    return evs.map((event) => ({ event, progress: by.get(event.id)?.progress ?? {}, claimed: by.get(event.id)?.claimed ?? [] }));
  }
  async eventStates(accountId: number, now: Date) {
    return this.eventStatesOn(this.pool, accountId, now);
  }

  async stats() {
    const a = await this.pool.query(`SELECT COUNT(*)::int AS n FROM ${this.S}accounts`);
    const r = await this.pool.query(`SELECT COUNT(*)::int AS n FROM ${this.S}team_runs WHERE at > now() - interval '24 hours'`);
    return { accounts: a.rows[0].n as number, runs24h: r.rows[0].n as number };
  }
}

const ITEM_COLS = 'uid, item_id, grade, level, affixes, count, slot, stash';
function itemOf(r: any): ItemInst {
  return { uid: r.uid, itemId: r.item_id, grade: r.grade, level: r.level, affixes: r.affixes ?? {}, count: r.count, slot: r.slot ?? null, stash: !!r.stash };
}
function stageOf(r: any): StageProgress {
  return { stage: r.stage, stars: r.stars, bestSecs: r.best_secs, clears: r.clears };
}
function eventOf(r: any): EventDef {
  const e: EventDef = {
    id: r.id,
    name: r.name,
    icon: r.icon,
    desc: r.descr,
    startsAt: new Date(r.starts_at).toISOString(),
    endsAt: new Date(r.ends_at).toISOString(),
    enabled: r.enabled,
    objectives: (r.objectives ?? []) as EventObjective[],
  };
  if (r.stage) e.stage = r.stage;
  return e;
}
