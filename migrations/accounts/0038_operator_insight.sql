-- What the operator sees of the server as a whole, and what is new in Kindred (docs/hosting-many-families.md,
-- src/lib/operator/stats.server.ts, src/lib/operator/updates.server.ts, src/lib/releases/):
--   instance_daily   one row per UTC day: aggregates of the whole server, never a record and never a person. Counts of
--                    families (all, new that day, suspended, closed) and accounts (all, new), members per family (median,
--                    largest), accounts active in the last day, 7 and 30 days (from user.last_seen), families with a
--                    member's visit in the last 30 days (from family_visit), storage (bytes, from
--                    media_usage), page views (from stats_daily, so a family with statistics off adds nothing), sign-ins
--                    that day by method, and the open requests. `backfilled` 1 for a day reconstructed after the fact from
--                    what the accounts database still holds; what could not be reconstructed (who was active) is NULL.
--                    Written by the daily job; rows older than three years are deleted.
--   update_check     one row: the last answer from the releases of the repository Kindred checks for updates (at most one
--                    call a day, only once an operator has agreed to it): when, which repository, GitHub's ETag for the
--                    next call, the latest version, the releases newer than this one (JSON: their
--                    version, date, address and notes as GitHub returned them, shown as text through the safe Markdown
--                    renderer), and the error of a failed check.
--   release_seen     the newest Kindred minor version ("2.4") whose highlights an account has seen or dismissed ("New in
--                    Kindred"), so the card shows once per minor version. Goes with the account.
--   release_running  when this server first ran each minor version, so the card is shown only to accounts made before.
-- Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE instance_daily (
  day TEXT PRIMARY KEY,
  families INTEGER NOT NULL,
  families_new INTEGER,
  families_suspended INTEGER,
  families_closed INTEGER,
  accounts INTEGER NOT NULL,
  accounts_new INTEGER,
  members_median REAL,
  members_max INTEGER,
  active_day INTEGER,
  active_week INTEGER,
  active_month INTEGER,
  active_families INTEGER,
  storage_bytes INTEGER,
  page_views INTEGER,
  sign_ins TEXT,
  requests_open INTEGER,
  data_requests_open INTEGER,
  backfilled INTEGER NOT NULL DEFAULT 0 CHECK (backfilled IN (0, 1)),
  at INTEGER NOT NULL
);

CREATE TABLE update_check (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  repo TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  etag TEXT,
  latest TEXT,
  releases TEXT NOT NULL DEFAULT '[]',
  error TEXT
);

CREATE TABLE release_seen (
  user TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE release_running (
  version TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
