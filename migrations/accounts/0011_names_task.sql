-- The background task "Collect name meanings" and its route: "names" joins the three lists that name a task or a route. SQLite
-- cannot change a CHECK, so each table is built again with the new list and its rows carried over; nothing else about them
-- changes (run ids stay, and the run log's index comes back). No PRAGMA, no BEGIN: this runs on SQLite and on D1.

CREATE TABLE ai_background_task_new (
  tree TEXT NOT NULL,
  task TEXT NOT NULL CHECK (task IN ('arms', 'occupations', 'chronicle', 'names')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  schedule TEXT NOT NULL DEFAULT 'daily' CHECK (schedule IN ('daily', 'weekly')),
  last_started INTEGER,
  PRIMARY KEY (tree, task)
);
INSERT INTO ai_background_task_new (tree, task, enabled, schedule, last_started)
SELECT tree, task, enabled, schedule, last_started FROM ai_background_task;
DROP TABLE ai_background_task;
ALTER TABLE ai_background_task_new RENAME TO ai_background_task;

CREATE TABLE ai_task_run_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tree TEXT NOT NULL,
  task TEXT NOT NULL CHECK (task IN ('arms', 'occupations', 'chronicle', 'names')),
  source TEXT NOT NULL CHECK (source IN ('schedule', 'manual')),
  started INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('done', 'idle', 'stopped', 'failed', 'skipped')),
  done INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  waiting INTEGER NOT NULL DEFAULT 0,
  micros INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);
INSERT INTO ai_task_run_new (id, tree, task, source, started, status, done, failed, waiting, micros, note)
SELECT id, tree, task, source, started, status, done, failed, waiting, micros, note FROM ai_task_run;
DROP TABLE ai_task_run;
ALTER TABLE ai_task_run_new RENAME TO ai_task_run;
CREATE INDEX IF NOT EXISTS ai_task_run_tree ON ai_task_run (tree, started);

CREATE TABLE ai_route_new (
  tree TEXT NOT NULL,
  route TEXT NOT NULL CHECK (route IN ('assistant', 'arms', 'faces', 'avatar', 'portrait', 'arms-review', 'occupations', 'chronicle', 'names')),
  provider TEXT CHECK (provider IS NULL OR provider IN ('anthropic', 'openai', 'openrouter')),
  model TEXT NOT NULL DEFAULT '',
  updated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tree, route),
  CHECK (route <> 'assistant' OR provider IS NOT NULL),
  CHECK (route <> 'portrait' OR provider IS NULL OR provider = 'openrouter')
);
INSERT INTO ai_route_new (tree, route, provider, model, updated)
SELECT tree, route, provider, model, updated FROM ai_route;
DROP TABLE ai_route;
ALTER TABLE ai_route_new RENAME TO ai_route;
