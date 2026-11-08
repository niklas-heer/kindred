-- Usage statistics, for a family's stewards (src/lib/stats, docs/roles-and-privacy.md). Everything stays in this database.
-- There is no table of raw events: the browser batches what happened and the server adds it to one counter per family, day and name.
--
-- stats_setting   a steward's off switch; no row means collection is on.
-- stats_daily     the counters, kept for three years. `name` comes from a fixed list in src/lib/stats/shared.ts, so it can never hold a
--                 person's id or anything a reader typed.
-- stats_member    the day a member was last seen, under a one-way pseudonym, so "active in the last 30 days" needs no history. Dropped
--                 100 days after the member was last seen, and at once when collection is turned off.
-- stats_once      what a member has already been counted for (finishing the tour), so it counts once per member across devices. Same retention.
-- Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE IF NOT EXISTS stats_setting (
  tree TEXT PRIMARY KEY,
  collect INTEGER NOT NULL DEFAULT 1 CHECK (collect IN (0, 1)),
  changed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stats_daily (
  tree TEXT NOT NULL,
  day TEXT NOT NULL,                -- YYYY-MM-DD (UTC)
  kind TEXT NOT NULL CHECK (kind IN ('view', 'visit', 'event', 'active')),
  name TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0 CHECK (n >= 0),
  PRIMARY KEY (tree, day, kind, name)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS stats_daily_day ON stats_daily (day);

CREATE TABLE IF NOT EXISTS stats_member (
  tree TEXT NOT NULL,
  actor TEXT NOT NULL,              -- a one-way hash; never an account id
  last_day TEXT NOT NULL,
  PRIMARY KEY (tree, actor)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS stats_once (
  tree TEXT NOT NULL,
  actor TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (tree, actor, name)
) WITHOUT ROWID;
