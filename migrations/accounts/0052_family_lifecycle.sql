-- The lifecycle of abandoned families (src/lib/lifecycle/, docs/hosting-many-families.md "Lifecycle"). Off until the operator
-- turns it on, so an install that runs this migration behaves as before.
--   family_lifecycle     where a quiet family stands: `warned` (its stewards were told), `readonly` (the lifecycle suspended it)
--                        or `due` (due for deletion). `quiet_since` is the last activity the stage was decided on; a later visit
--                        or reactivation is newer and wins. `claim` is set by the batch that claims a deletion, before anything
--                        of the family is deleted. A family with no row is not in the lifecycle.
--   family_admin.active_at  the last activity that is not a member's visit (`family_visit`): a steward turning the family back
--                        on, or the operator letting it be used again. NULL when there has been none.
--   family_admin.status_by  'lifecycle' while the suspension is the lifecycle's (its stewards may lift it themselves); NULL
--                        for the operator's own. The statement of reasons stays in `status_reason` and `status_ground`.
--   steward_notice       what a family's stewards were told in the app (src/lib/notify/stewards.server.ts): a kind, its
--                        values (JSON, never record content) and when. Deleted with the family.
--   steward_notice_dismissal  a steward put a kind of notice away until `until` (30 days); it returns after that.
-- Additive only. Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE family_lifecycle (
  tree TEXT PRIMARY KEY,
  stage TEXT NOT NULL CHECK (stage IN ('warned', 'readonly', 'due')),
  quiet_since INTEGER NOT NULL,
  warned_at INTEGER NOT NULL,
  readonly_at INTEGER,
  due_at INTEGER,
  final_notice_at INTEGER,
  claim TEXT
);

ALTER TABLE family_admin ADD COLUMN active_at INTEGER;
ALTER TABLE family_admin ADD COLUMN status_by TEXT CHECK (status_by IS NULL OR status_by = 'lifecycle');

CREATE TABLE steward_notice (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tree TEXT NOT NULL,
  kind TEXT NOT NULL,
  vars TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX steward_notice_tree ON steward_notice (tree, at);

CREATE TABLE steward_notice_dismissal (
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  tree TEXT NOT NULL,
  kind TEXT NOT NULL,
  until INTEGER NOT NULL,
  PRIMARY KEY (user, tree, kind)
);
