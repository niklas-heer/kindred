-- Background AI tasks (src/lib/ai/background.server.ts). Per family:
--   ai_background       the steward's settings: how much of the monthly budget background work may use, the languages
--                       the translations go into, and the steward's language (for the texts the arms reviews write).
--   ai_background_task  each task's switch (off by default), its schedule (daily or weekly) and when it last started.
--   ai_background_spend what background work has booked per UTC month, against its share of the budget. The family's
--                       whole monthly spend stays in ai_spend (0007), which background calls book against as well.
--   ai_task_run         one row per run that did something (or failed, or was run by hand), for the AI activity page.
-- Written to run on SQLite and on D1: no PRAGMA, no BEGIN, defaults on new NOT NULL columns.

CREATE TABLE IF NOT EXISTS ai_background (
  tree TEXT PRIMARY KEY,
  cap_share REAL NOT NULL DEFAULT 0.2 CHECK (cap_share > 0 AND cap_share <= 1),
  languages TEXT NOT NULL DEFAULT '["en","de","af"]',   -- JSON array of locales
  locale TEXT NOT NULL DEFAULT 'en',
  updated INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ai_background_task (
  tree TEXT NOT NULL,
  task TEXT NOT NULL CHECK (task IN ('arms', 'occupations', 'chronicle')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  schedule TEXT NOT NULL DEFAULT 'daily' CHECK (schedule IN ('daily', 'weekly')),
  last_started INTEGER,                                  -- ms since the epoch; NULL until the task first runs
  PRIMARY KEY (tree, task)
);

CREATE TABLE IF NOT EXISTS ai_background_spend (
  tree TEXT NOT NULL,
  month TEXT NOT NULL,                                   -- YYYY-MM (UTC)
  micros INTEGER NOT NULL DEFAULT 0 CHECK (micros >= 0),
  PRIMARY KEY (tree, month)
);

CREATE TABLE IF NOT EXISTS ai_task_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tree TEXT NOT NULL,
  task TEXT NOT NULL CHECK (task IN ('arms', 'occupations', 'chronicle')),
  source TEXT NOT NULL CHECK (source IN ('schedule', 'manual')),
  started INTEGER NOT NULL,                              -- ms since the epoch
  status TEXT NOT NULL CHECK (status IN ('done', 'idle', 'stopped', 'failed', 'skipped')),
  done INTEGER NOT NULL DEFAULT 0,                       -- items finished in this run
  failed INTEGER NOT NULL DEFAULT 0,                     -- items that failed in this run (they are tried again later)
  waiting INTEGER NOT NULL DEFAULT 0,                    -- items still to do after this run
  micros INTEGER NOT NULL DEFAULT 0,                     -- what the run cost, in micro-dollars
  note TEXT NOT NULL DEFAULT ''                          -- why it stopped, failed or was skipped; never family text
);
CREATE INDEX IF NOT EXISTS ai_task_run_tree ON ai_task_run (tree, started);
