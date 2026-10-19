// HeroStore trên Postgres (Neon), DÙNG CHUNG pool + schema với PgStore của Bầy Khỉ (accounts/sessions là bảng chung).
// Mọi thay đổi: một giao dịch, khoá dòng h_profile (SELECT … FOR UPDATE) trước khi kiểm tra quyền sở hữu / số dư.
// Tên bảng luôn có tiền tố schema (pooler của Neon không giữ SET search_path giữa các giao dịch).

import type pg from 'pg';
import type { PityState } from '../../../../shared/heroes/gacha.js';
import { STAGES_PER_CHAPTER } from '../../../../shared/heroes/stages.js';
import type { Wallet } from '../../../../shared/heroes/types.js';
import { SQUAD_COUNT, SQUAD_SIZE } from '../../../../shared/heroes/config.js';
import { assertWallet, ledgerOf, newState, rollDay, STARTER_WALLET } from '../rules.js';
import { migrateHeroes } from './migrations.js';
import { StoreError, type HState, type HeroStore, type LeaderEntry, type MutateOpts } from './store.js';

type Q = pg.PoolClient;

const msOf = (col: string) => `floor(extract(epoch from ${col}) * 1000)::float8`;

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
  private async load(c: Q, id: number, lock: boolean): Promise<HState | null> {
    const S = this.S;
    const pr = await c.query(
      `SELECT gold, gems, tickets, exp, stones, level, xp, stamina, ${msOf('stamina_at')} AS stamina_at, ${msOf('afk_since')} AS afk_since, active_squad, pity,
              tower_floor, tower_day, tower_tries
       FROM ${S}h_profile WHERE account_id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    if (!pr.rows.length) return null;
    const p = pr.rows[0];
    // tuần tự: một kết nối pg không chạy song song nhiều lệnh
    const hs = await c.query(`SELECT hero_id, level, star, shards FROM ${S}h_heroes WHERE account_id = $1 ORDER BY seq`, [id]);
    const sq = await c.query(`SELECT idx, slots FROM ${S}h_squads WHERE account_id = $1`, [id]);
    const sp = await c.query(`SELECT stage, stars, clears FROM ${S}h_stage_progress WHERE account_id = $1`, [id]);
    const gr = await c.query(`SELECT uid::int AS uid, def_id, level, hero_id FROM ${S}h_gear WHERE account_id = $1 ORDER BY uid`, [id]);
    const qr = await c.query(`SELECT day, quest_id, progress, claimed FROM ${S}h_quest WHERE account_id = $1`, [id]);
    const sh = await c.query(`SELECT day, item_id, count FROM ${S}h_shop_buy WHERE account_id = $1`, [id]);
    const squads: string[][] = Array.from({ length: SQUAD_COUNT }, () => Array<string>(SQUAD_SIZE).fill(''));
    for (const r of sq.rows) if (r.idx >= 0 && r.idx < SQUAD_COUNT) squads[r.idx] = r.slots as string[];
    const s: HState = {
      accountId: id,
      wallet: { gold: p.gold, gems: p.gems, tickets: p.tickets, exp: p.exp, stones: p.stones },
      level: p.level, xp: p.xp, stamina: p.stamina, staminaAt: p.stamina_at, afkSince: p.afk_since,
      activeSquad: p.active_squad, pity: (p.pity ?? {}) as Record<string, PityState>,
      heroes: {}, squads, progress: {}, runs: [], gear: [], newGear: [],
      towerFloor: p.tower_floor, towerDay: p.tower_day, towerTries: p.tower_tries, day: 0, quests: {}, questBonus: false, shop: {},
    };
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

  /** khoá + nạp hồ sơ, tự tạo hồ sơ khởi đầu nếu chưa có (`fresh` = vừa tạo, còn phải ghi tướng/đội/ledger) */
  private async loadLocked(c: Q, id: number, nowMs: number): Promise<{ s: HState; fresh: boolean }> {
    const got = await this.load(c, id, true);
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
    if (inserted) return { s, fresh: true };
    // tiến trình khác vừa tạo xong (giao dịch của nó đã commit vì lệnh INSERT đã chờ) → nạp lại có khoá
    const again = await this.load(c, id, true);
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
         tower_floor=$14, tower_day=$15, tower_tries=$16
       WHERE account_id=$1`,
      [id, s.wallet.gold, s.wallet.gems, s.wallet.tickets, s.wallet.exp, s.wallet.stones, s.level, s.xp, s.stamina, s.staminaAt, s.afkSince, s.activeSquad, JSON.stringify(s.pity), s.towerFloor, s.towerDay, s.towerTries],
    );
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
    const s = await this.tx((c) => this.load(c, accountId, false));
    if (s) return fn(s);
    // chưa có hồ sơ → tạo (một giao dịch có khoá) rồi đọc
    await this.mutate(accountId, now, 'provision', () => 0); // uid trang bị khởi đầu chỉ có sau khi ghi → đọc lại
      return this.view(accountId, now, fn);
  }

  async mutate<T>(accountId: number, now: Date, kind: string, fn: (s: HState) => T, opts?: MutateOpts): Promise<T> {
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
      const before = { ...s.wallet };
      rollDay(s, now.getTime()); // sang ngày mới: reset Tháp/nhiệm vụ/cửa hàng + tính "đăng nhập"
      const out = fn(s);
      assertWallet(s);
      await this.save(c, s, before, kind, fresh);
      if (opts?.idem) {
        await c.query(`DELETE FROM ${this.S}h_idem WHERE account_id=$1 AND created_at < now() - interval '2 days'`, [accountId]);
        await c.query(`INSERT INTO ${this.S}h_idem (account_id, key, response) VALUES ($1,$2,$3::jsonb)`, [accountId, opts.idem.key, JSON.stringify({ tag: opts.idem.tag, value: out })]);
      }
      return out;
    });
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
}
