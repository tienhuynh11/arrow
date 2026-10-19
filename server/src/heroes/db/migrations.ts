// Migration của Thẻ Tướng: bảng phiên bản riêng `h_schema_version` (không lẫn với schema_version của Bầy Khỉ).
// Bảng tài khoản/phiên (accounts, sessions) DÙNG CHUNG với Bầy Khỉ nên phải chạy migrate của Bầy Khỉ trước.
// `S` = tiền tố schema đã kiểm tra ("public.").

import type { PoolClient } from 'pg';

export const HERO_MIGRATIONS: ((S: string) => string)[] = [
  // v1 — lược đồ đầu tiên
  (S) => `
CREATE TABLE ${S}h_profile (
  account_id   integer PRIMARY KEY REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  gold         integer NOT NULL DEFAULT 0 CHECK (gold >= 0),
  gems         integer NOT NULL DEFAULT 0 CHECK (gems >= 0),
  tickets      integer NOT NULL DEFAULT 0 CHECK (tickets >= 0),
  exp          integer NOT NULL DEFAULT 0 CHECK (exp >= 0),
  stones       integer NOT NULL DEFAULT 0 CHECK (stones >= 0),
  level        integer NOT NULL DEFAULT 1,
  xp           integer NOT NULL DEFAULT 0,
  stamina      integer NOT NULL DEFAULT 0 CHECK (stamina >= 0),
  stamina_at   timestamptz NOT NULL DEFAULT now(),
  afk_since    timestamptz NOT NULL DEFAULT now(),
  active_squad smallint NOT NULL DEFAULT 0,
  pity         jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE ${S}h_heroes (
  account_id  integer NOT NULL REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  hero_id     text NOT NULL,
  level       smallint NOT NULL DEFAULT 1,
  star        smallint NOT NULL DEFAULT 1,
  shards      integer NOT NULL DEFAULT 0 CHECK (shards >= 0),
  seq         bigserial,
  PRIMARY KEY (account_id, hero_id)
);
CREATE TABLE ${S}h_squads (
  account_id  integer NOT NULL REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  idx         smallint NOT NULL,
  slots       jsonb NOT NULL,
  PRIMARY KEY (account_id, idx)
);
CREATE TABLE ${S}h_stage_progress (
  account_id  integer NOT NULL REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  stage       text NOT NULL,
  stars       smallint NOT NULL DEFAULT 0,
  clears      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, stage)
);
CREATE TABLE ${S}h_runs (
  id          bigserial PRIMARY KEY,
  account_id  integer NOT NULL REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  stage       text NOT NULL,
  win         boolean NOT NULL,
  stars       smallint NOT NULL,
  ticks       integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ${S}h_runs (account_id, created_at DESC);
-- sổ cái: mỗi lần ví đổi là một dòng (delta = chênh lệch từng loại tiền)
CREATE TABLE ${S}h_ledger (
  id          bigserial PRIMARY KEY,
  account_id  integer NOT NULL REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  delta       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ${S}h_ledger (account_id, created_at DESC);
-- chống gửi trùng (chạm đúp) cho triệu hồi
CREATE TABLE ${S}h_idem (
  account_id  integer NOT NULL REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  key         text NOT NULL,
  response    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, key)
);
`,
  // v2 — trang bị
  (S) => `
CREATE TABLE ${S}h_gear (
  uid         bigserial PRIMARY KEY,
  account_id  integer NOT NULL REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  def_id      text NOT NULL,
  level       smallint NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 10),
  hero_id     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ${S}h_gear (account_id);
`,
  // v3 — Tháp, nhiệm vụ hằng ngày, cửa hàng. `day` = dayKey (ngày VN); chỉ giữ hàng của ngày hiện tại, ngày cũ bị xoá khi ghi.
  (S) => `
ALTER TABLE ${S}h_profile
  ADD COLUMN tower_floor integer NOT NULL DEFAULT 0 CHECK (tower_floor >= 0),
  ADD COLUMN tower_day   integer NOT NULL DEFAULT 0,
  ADD COLUMN tower_tries integer NOT NULL DEFAULT 0 CHECK (tower_tries >= 0);
-- quest_id = id nhiệm vụ; hàng đặc biệt quest_id = 'bonus' (claimed = đã nhận thưởng thêm)
CREATE TABLE ${S}h_quest (
  account_id  integer NOT NULL REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  day         integer NOT NULL,
  quest_id    text NOT NULL,
  progress    integer NOT NULL DEFAULT 0 CHECK (progress >= 0),
  claimed     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (account_id, day, quest_id)
);
CREATE TABLE ${S}h_shop_buy (
  account_id  integer NOT NULL REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  day         integer NOT NULL,
  item_id     text NOT NULL,
  count       integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (account_id, day, item_id)
);
`,
];

/** chạy các migration còn thiếu, một giao dịch có khoá advisory (khác khoá của Bầy Khỉ) */
export async function migrateHeroes(c: PoolClient, S: string) {
  await c.query('BEGIN');
  try {
    await c.query(`SELECT pg_advisory_xact_lock(7316002)`);
    await c.query(`CREATE TABLE IF NOT EXISTS ${S}h_schema_version (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await c.query(`SELECT COALESCE(MAX(version), 0) AS v FROM ${S}h_schema_version`);
    const cur = Number(rows[0].v);
    for (let v = cur + 1; v <= HERO_MIGRATIONS.length; v++) {
      await c.query(HERO_MIGRATIONS[v - 1](S));
      await c.query(`INSERT INTO ${S}h_schema_version (version) VALUES ($1)`, [v]);
      console.log(`[heroes-db] đã migrate lên phiên bản ${v}`);
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  }
}
