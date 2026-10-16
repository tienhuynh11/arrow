// Migration cho PgStore. Mỗi phiên bản chạy một lần (bảng schema_version), trong một giao dịch có khoá
// advisory để hai tiến trình khởi động cùng lúc không chạy chồng. `S` = tiền tố schema đã kiểm tra ("public.").

import type { PoolClient } from 'pg';
import { seedEvent } from './rules.js';

export const MIGRATIONS: ((S: string) => string)[] = [
  // v1 — lược đồ đầu tiên
  (S) => `
CREATE TABLE ${S}accounts (
  id          serial PRIMARY KEY,
  username    text NOT NULL,
  ukey        text NOT NULL UNIQUE,
  pass_hash   text NOT NULL,
  level       integer NOT NULL DEFAULT 1,
  xp          integer NOT NULL DEFAULT 0,
  gold        integer NOT NULL DEFAULT 0 CHECK (gold >= 0),
  shards      integer NOT NULL DEFAULT 0 CHECK (shards >= 0),
  books       integer NOT NULL DEFAULT 0 CHECK (books >= 0),
  cls         smallint NOT NULL DEFAULT 0,
  kills       integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ${S}sessions (
  token_hash  text PRIMARY KEY,
  account_id  integer NOT NULL REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL
);
CREATE INDEX ON ${S}sessions (account_id);
CREATE INDEX ON ${S}sessions (expires_at);
CREATE TABLE ${S}items (
  uid         serial PRIMARY KEY,
  account_id  integer NOT NULL REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  item_id     text NOT NULL,
  slot        text NOT NULL,
  rarity      smallint NOT NULL,
  level       smallint NOT NULL DEFAULT 1,
  subs        jsonb NOT NULL DEFAULT '{}'::jsonb,
  equipped    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ${S}items (account_id);
CREATE UNIQUE INDEX items_one_per_slot ON ${S}items (account_id, slot) WHERE equipped;
CREATE TABLE ${S}chars (
  account_id  integer NOT NULL REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  cls         smallint NOT NULL,
  PRIMARY KEY (account_id, cls)
);
CREATE TABLE ${S}skill_levels (
  account_id  integer NOT NULL REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  cls         smallint NOT NULL,
  skill       text NOT NULL,
  level       smallint NOT NULL,
  PRIMARY KEY (account_id, cls, skill)
);
CREATE TABLE ${S}stage_progress (
  account_id  integer NOT NULL REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  stage       text NOT NULL,
  stars       smallint NOT NULL DEFAULT 0,
  best_secs   integer NOT NULL DEFAULT 0,
  clears      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, stage)
);
-- lịch sử trận của từng tài khoản
CREATE TABLE ${S}runs (
  id          bigserial PRIMARY KEY,
  account_id  integer NOT NULL REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  stage       text NOT NULL,
  won         boolean NOT NULL,
  stars       smallint NOT NULL,
  wave        integer NOT NULL,
  kills       integer NOT NULL,
  secs        integer NOT NULL,
  score       integer NOT NULL,
  reward      jsonb NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ${S}runs (account_id, at DESC);
-- bảng xếp hạng: một dòng cho cả đội (kể cả khách)
CREATE TABLE ${S}team_runs (
  id          bigserial PRIMARY KEY,
  stage       text NOT NULL,
  solo        boolean NOT NULL,
  names       jsonb NOT NULL,
  cls         jsonb NOT NULL,
  wave        integer NOT NULL,
  score       integer NOT NULL,
  kills       integer NOT NULL,
  secs        integer NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ${S}team_runs (stage, solo, wave DESC, score DESC, secs, at);
CREATE INDEX ON ${S}team_runs (at);
CREATE TABLE ${S}events (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  icon        text NOT NULL DEFAULT '',
  descr       text NOT NULL DEFAULT '',
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  stage       text,
  objectives  jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE ${S}event_progress (
  account_id  integer NOT NULL REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  event_id    integer NOT NULL REFERENCES ${S}events(id) ON DELETE CASCADE,
  progress    jsonb NOT NULL DEFAULT '{}'::jsonb,
  claimed     jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (account_id, event_id)
);
`,
];

/** chạy các migration còn thiếu; lần migrate đầu tiên (DB trống) tạo sẵn sự kiện đầu tiên nếu chưa có sự kiện nào */
export async function migrate(c: PoolClient, S: string) {
  await c.query('BEGIN');
  try {
    await c.query(`SELECT pg_advisory_xact_lock(7316001)`);
    await c.query(`CREATE TABLE IF NOT EXISTS ${S}schema_version (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await c.query(`SELECT COALESCE(MAX(version), 0) AS v FROM ${S}schema_version`);
    const cur = Number(rows[0].v);
    for (let v = cur + 1; v <= MIGRATIONS.length; v++) {
      await c.query(MIGRATIONS[v - 1](S));
      await c.query(`INSERT INTO ${S}schema_version (version) VALUES ($1)`, [v]);
      console.log(`[monkey-db] đã migrate lên phiên bản ${v}`);
    }
    const ev = await c.query(`SELECT 1 FROM ${S}events LIMIT 1`);
    if (cur === 0 && !ev.rowCount) {
      const e = seedEvent(new Date());
      await c.query(
        `INSERT INTO ${S}events (name, icon, descr, starts_at, ends_at, enabled, stage, objectives) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [e.name, e.icon, e.desc, e.startsAt, e.endsAt, e.enabled, e.stage ?? null, JSON.stringify(e.objectives)],
      );
      console.log('[monkey-db] đã tạo sự kiện đầu tiên');
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  }
}
