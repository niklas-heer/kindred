-- Automatic backups (docs/hosting-many-families.md, "Backups"; src/lib/backup/).
--
--   family_backup   one row per encrypted backup file: its scope (`family`: a family id, or `_accounts` for this database) and
--                   name (the UTC time it was made), its size, its format (`sqlite` on Node, `dump` from a Durable Object), the
--                   newest migration it holds, its rows per table (JSON), the SHA-256 of the database inside, the id of the
--                   key that sealed it, and `gone_at`: when its family was deleted. The column is `family`, not `tree`, on
--                   purpose: deleting a family does not delete these rows (src/lib/families.server.ts forgetInAccounts finds
--                   tables by a `tree` column); the backups are deleted after the operator's grace period instead.
--   backup_status   one row per scope: when a backup was last tried and last made, the last failure's short reason, and the
--                   last restore drill (when, which backup, whether it passed, and what did not match).
--   recovery_point  per family (`tree`, deleted with it): the point-in-time-recovery bookmark its Durable Object recorded before
--                   it applied new migrations (or before a rollback), when, the first migration it was about to apply and the
--                   newest it held. `_accounts` for the accounts database's own.
--
-- The retention (`backup_keep`, "7,4,12": daily, weekly, monthly) and the grace period after a family is deleted
-- (`backup_grace_days`, 30) are rows of `instance_setting`; missing means the default.
-- Additive only. Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE IF NOT EXISTS family_backup (
  family TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  format TEXT NOT NULL DEFAULT 'sqlite',
  schema TEXT,
  counts TEXT NOT NULL DEFAULT '{}',
  sha256 TEXT NOT NULL DEFAULT '',
  key_id TEXT NOT NULL DEFAULT '',
  gone_at INTEGER,
  PRIMARY KEY (family, name)
);

CREATE TABLE IF NOT EXISTS backup_status (
  family TEXT PRIMARY KEY,
  tried_at INTEGER,
  ok_at INTEGER,
  error TEXT,
  drill_at INTEGER,
  drill_backup TEXT,
  drill_ok INTEGER,
  drill_problem TEXT
);

CREATE TABLE IF NOT EXISTS recovery_point (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tree TEXT NOT NULL,
  bookmark TEXT NOT NULL,
  at INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT 'migration',
  before_migration TEXT,
  held_migration TEXT,
  UNIQUE (tree, bookmark)
);
