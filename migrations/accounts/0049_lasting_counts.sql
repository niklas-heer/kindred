-- Counts that outlive what they count, and the bookkeeping that makes erasure and account deletion complete
-- (docs/data-model.md; docs/gdpr.md; docs/ai.md, "Operator-funded AI"):
--   ai_operator_family_month  what operator-funded AI has booked per family per UTC month, keyed by the family's id in a column
--                             deliberately not named `tree`, so deleting a family keeps it: a family deleted and made again
--                             under the same id within the month does not start again at 0. Replaces ai_operator_spend (whose
--                             `tree` column made it go with the family); its rows are copied, and the old table stays, unused,
--                             so the previous release still runs on this schema.
--   ai_operator_overage       a call the provider billed above what was reserved for it: the reservation is the most a family's
--                             budget and the server's ceiling are booked, and the difference is kept here (family, month,
--                             micro-dollars, when) for the operator's Health tab. No `tree`: it outlives the family.
--   signup_tally              one row per sign-up (`id`, the network's short hash, when), with no account and no family, so
--                             deleting either never lowers the limits per day and per network. Rows older than two days are
--                             removed by the sign-up that adds one. The existing sign-ups are copied.
--   family_left               an account that left a family (or was removed from it): `user`, the family (`tree`) and when.
--                             Deleting the account then finds the family to give what the account wrote there a pseudonym.
--                             Deleted with the account (its `user`) and with the family (its `tree`).
--   subject_action.pending    the person an erasure is about while it is unfinished (an id, never a name); NULL once both
--                             databases are done. A retry after a failure part-way finds it and finishes.
--   job_run.code              a failed daily job's operational code (`network`, `timeout`, `database`, an error's own code);
--                             `error` now holds a sanitised message (no addresses, quoted text or family ids).
-- Additive only. Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE IF NOT EXISTS ai_operator_family_month (
  family TEXT NOT NULL,
  month TEXT NOT NULL,                 -- YYYY-MM (UTC)
  micros INTEGER NOT NULL DEFAULT 0 CHECK (micros >= 0),
  PRIMARY KEY (family, month)
);
INSERT OR IGNORE INTO ai_operator_family_month (family, month, micros) SELECT tree, month, micros FROM ai_operator_spend;

CREATE TABLE IF NOT EXISTS ai_operator_overage (
  id TEXT PRIMARY KEY,
  family TEXT NOT NULL,
  month TEXT NOT NULL,
  micros INTEGER NOT NULL CHECK (micros > 0),
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_operator_overage_month ON ai_operator_overage (month);

CREATE TABLE IF NOT EXISTS signup_tally (
  id TEXT PRIMARY KEY,
  network TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS signup_tally_network ON signup_tally (network, created);
CREATE INDEX IF NOT EXISTS signup_tally_created ON signup_tally (created);
INSERT OR IGNORE INTO signup_tally (id, network, created) SELECT id, network, created FROM signup;

CREATE TABLE IF NOT EXISTS family_left (
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  tree TEXT NOT NULL,
  left_at INTEGER NOT NULL,
  PRIMARY KEY (user, tree)
);

ALTER TABLE subject_action ADD COLUMN pending TEXT;

ALTER TABLE job_run ADD COLUMN code TEXT;
