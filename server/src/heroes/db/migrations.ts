// Migration của Thẻ Tướng: bảng phiên bản riêng `h_schema_version` (không lẫn với schema_version của Bầy Khỉ).
// Bảng tài khoản/phiên (accounts, sessions) DÙNG CHUNG với Bầy Khỉ nên phải chạy migrate của Bầy Khỉ trước.
// `S` = tiền tố schema đã kiểm tra ("public.").

import type { PoolClient } from 'pg';
import { SEED_EVENT } from '../../../../shared/heroes/events.js';

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
  // v4 — Đấu trường PvP bất đồng bộ. Hàng tạo lười ở lần đầu chạm đấu trường. `day` = dayKey của lần cấp lượt gần nhất.
  (S) => `
CREATE TABLE ${S}h_arena (
  account_id    integer PRIMARY KEY REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  rating        integer NOT NULL DEFAULT 1000 CHECK (rating >= 0),
  day           integer NOT NULL DEFAULT 0,
  tries         integer NOT NULL DEFAULT 0 CHECK (tries >= 0),
  defense_squad integer NOT NULL DEFAULT 0,
  wins          integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses        integer NOT NULL DEFAULT 0 CHECK (losses >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ${S}h_arena (rating DESC, wins DESC, account_id);
`,
  // v5 — Sự kiện (admin tạo) + Bang hội. Thời gian sự kiện là ms epoch (bigint). Sự kiện mẫu chỉ được gieo đúng một lần (migration chạy một lần).
  (S) => {
    const { days, name, desc, banner, enabled, objectives } = SEED_EVENT;
    const seed = JSON.stringify(objectives);
    return `
CREATE TABLE ${S}h_event (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  descr       text NOT NULL DEFAULT '',
  starts_at   bigint NOT NULL,
  ends_at     bigint NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  banner      text,
  objectives  jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE ${S}h_event_progress (
  account_id  integer NOT NULL REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  event_id    integer NOT NULL REFERENCES ${S}h_event(id) ON DELETE CASCADE,
  obj_id      text NOT NULL,
  progress    integer NOT NULL DEFAULT 0 CHECK (progress >= 0),
  claimed     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (account_id, event_id, obj_id)
);
INSERT INTO ${S}h_event (name, descr, starts_at, ends_at, enabled, banner, objectives)
VALUES ($sn$${name}$sn$, $sd$${desc}$sd$, (extract(epoch from now()) * 1000)::bigint,
        (extract(epoch from now()) * 1000)::bigint + ${days} * 86400000, ${enabled}, ${banner ? `$sb$${banner}$sb$` : 'NULL'}, $so$${seed}$so$::jsonb);

ALTER TABLE ${S}h_profile ADD COLUMN guild_left_at bigint NOT NULL DEFAULT 0;
CREATE TABLE ${S}h_guild (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  level        integer NOT NULL DEFAULT 1,
  exp          integer NOT NULL DEFAULT 0,
  notice       text NOT NULL DEFAULT '',
  leader_id    integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  boss_cycle   integer NOT NULL DEFAULT 0,
  boss_hp      bigint NOT NULL DEFAULT 0 CHECK (boss_hp >= 0),
  boss_hp_max  bigint NOT NULL DEFAULT 0,
  boss_killed  boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX ON ${S}h_guild (lower(name));
-- một tài khoản một bang (PK account_id)
CREATE TABLE ${S}h_guild_member (
  account_id      integer PRIMARY KEY REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  guild_id        integer NOT NULL REFERENCES ${S}h_guild(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member',
  contribution    integer NOT NULL DEFAULT 0,
  boss_damage     integer NOT NULL DEFAULT 0,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  donated_day     integer NOT NULL DEFAULT 0,
  donated_n       integer NOT NULL DEFAULT 0,
  checkin_day     integer NOT NULL DEFAULT 0,
  boss_day        integer NOT NULL DEFAULT 0,
  boss_tries_used integer NOT NULL DEFAULT 0
);
CREATE INDEX ON ${S}h_guild_member (guild_id);
CREATE TABLE ${S}h_guild_chat (
  id          bigserial PRIMARY KEY,
  guild_id    integer NOT NULL REFERENCES ${S}h_guild(id) ON DELETE CASCADE,
  account_id  integer NOT NULL,
  username    text NOT NULL,
  text        text NOT NULL,
  at          bigint NOT NULL
);
CREATE INDEX ON ${S}h_guild_chat (guild_id, id DESC);
-- thưởng hạ boss chờ nhận (chỉ INSERT từ giao dịch của người hạ boss → không khoá hồ sơ người khác); người nhận DELETE trong giao dịch của mình
CREATE TABLE ${S}h_guild_reward (
  id          bigserial PRIMARY KEY,
  account_id  integer NOT NULL REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  guild_id    integer NOT NULL,
  cycle       integer NOT NULL,
  UNIQUE (account_id, guild_id, cycle)
);
`;
  },
  // v6 — Gói Tân thủ: điểm danh 7 ngày, lượt quay khởi đầu, mốc hành trình, tổng lượt quay. Hàng tạo lười (thiếu hàng = mặc định).
  (S) => `
CREATE TABLE ${S}h_newbie (
  account_id      integer PRIMARY KEY REFERENCES ${S}accounts(id) ON DELETE CASCADE,
  login_claimed   integer NOT NULL DEFAULT 0 CHECK (login_claimed BETWEEN 0 AND 7),
  login_day       integer NOT NULL DEFAULT 0,
  starter_used    boolean NOT NULL DEFAULT false,
  milestones      text[] NOT NULL DEFAULT '{}',
  pulls_total     integer NOT NULL DEFAULT 0 CHECK (pulls_total >= 0)
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
