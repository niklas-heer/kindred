-- The console's Update button and Health tab (docs/hosting-many-families.md, "Updates" and "Health";
-- src/lib/operator/self-update.server.ts, src/lib/operator/health.server.ts).
--
--   update_github  one row (id 1): the install's own GitHub repository (`owner/name`) and its default branch, the operator's
--                  fine-grained token for it (Actions: write on that one repository), sealed with KINDRED_SECRET and never
--                  shown again, its last four characters, who stored it and when, and the last update the console started:
--                  the tag, when, GitHub's run id, address, status and conclusion, and when the console last asked about it.
--   job_run        one row per daily job: when it last started and finished, whether it failed and the short reason, and
--                  when it last finished without failing.
--   family_schema  per family (`tree`): the newest family migration it reported having, or the migration that failed,
--                  and when. A family in a Durable Object migrates itself the first time it is used after a deploy, so this
--                  shows which families are behind without opening any. Deleted with the family.
--
-- Additive only, as every release's migrations are (docs/data-model.md, "Rules every change follows"). Written to run on
-- SQLite and on D1: no PRAGMA, no BEGIN, defaults on NOT NULL columns.
CREATE TABLE IF NOT EXISTS update_github (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  repo TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  token TEXT NOT NULL,
  token_tail TEXT NOT NULL DEFAULT '',
  set_at INTEGER NOT NULL DEFAULT 0,
  set_by TEXT NOT NULL DEFAULT '',
  run_tag TEXT,
  run_started_at INTEGER,
  run_id INTEGER,
  run_url TEXT,
  run_status TEXT,
  run_conclusion TEXT,
  run_polled_at INTEGER
);

CREATE TABLE IF NOT EXISTS job_run (
  job TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL DEFAULT 0,
  finished_at INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  last_ok_at INTEGER
);

CREATE TABLE IF NOT EXISTS family_schema (
  tree TEXT PRIMARY KEY,
  migration TEXT,
  error TEXT,
  reported_at INTEGER NOT NULL DEFAULT 0
);
