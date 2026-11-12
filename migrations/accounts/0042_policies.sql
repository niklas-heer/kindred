-- The operator's policies for the server's features, operator-funded AI, and announcements (docs/hosting-many-families.md,
-- "Policies"; src/lib/operator/policy.server.ts).
--
--   instance_policy       one row per policy key the operator has set: its scope (`off` for every family, `families` for
--                         each family as its stewards choose, `selected` only for the families granted below) and a JSON value
--                         (for `ai.source`: where the AI's key comes from and the operator's budgets). A key without a row
--                         is `families` with its default value, so an existing install behaves as before.
--   family_policy         the operator's word for one family on one key: granted (1) or withheld (0), and a JSON value that
--                         overrides the server's for it (`ai.source`: its own monthly budget).
--   operator_ai_provider  the operator's own AI provider keys, sealed like a family's (ai_provider), for operator-funded AI.
--   ai_operator_spend     what operator-funded AI has booked per family per UTC month, against the family's budget from the
--                         operator. The server-wide total is in ai_operator_month, which outlives a deleted family.
--   ai_operator_booking   one row per operator-funded call: its reservation, until the call is settled once (settled_at).
--   announcement          a banner from the operator to stewards or to everyone signed in, from `starts_at` until `ends_at`.
--
-- ai_settings gains `funding`: the steward's choice to use the operator's AI (`operator`) instead of the family's own keys
-- (`own`, the default). Operator-funded AI is never on by itself.
--
-- Turning a feature off deletes nothing. Written to run on SQLite and on D1: no PRAGMA, no BEGIN, defaults on NOT NULL columns.
CREATE TABLE IF NOT EXISTS instance_policy (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'families' CHECK (scope IN ('off', 'families', 'selected')),
  value TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS family_policy (
  tree TEXT NOT NULL,
  key TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 1 CHECK (granted IN (0, 1)),
  value TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tree, key)
);

CREATE TABLE IF NOT EXISTS operator_ai_provider (
  provider TEXT PRIMARY KEY CHECK (provider IN ('anthropic', 'openai', 'openrouter')),
  key_sealed TEXT NOT NULL,
  key_tail TEXT NOT NULL DEFAULT '',
  updated INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ai_operator_spend (
  tree TEXT NOT NULL,
  month TEXT NOT NULL,                 -- YYYY-MM (UTC)
  micros INTEGER NOT NULL DEFAULT 0 CHECK (micros >= 0),
  PRIMARY KEY (tree, month)
);

CREATE TABLE IF NOT EXISTS ai_operator_month (
  month TEXT PRIMARY KEY,              -- YYYY-MM (UTC)
  micros INTEGER NOT NULL DEFAULT 0 CHECK (micros >= 0)
);

CREATE TABLE IF NOT EXISTS ai_operator_booking (
  id TEXT PRIMARY KEY,
  tree TEXT NOT NULL,
  month TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  created INTEGER NOT NULL,
  settled_at INTEGER                   -- NULL while the call runs; a booking never settled keeps its reservation
);

CREATE TABLE IF NOT EXISTS announcement (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT 'stewards' CHECK (audience IN ('stewards', 'everyone')),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS announcement_window ON announcement (starts_at, ends_at);

ALTER TABLE ai_settings ADD COLUMN funding TEXT NOT NULL DEFAULT 'own' CHECK (funding IN ('own', 'operator'));
