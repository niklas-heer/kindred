-- "Since your last visit" and the weekly push (src/lib/history.server.ts, docs/roles-and-privacy.md).
--
--   family_visit   one row per member and family. `last_seen` is when they last opened the family (milliseconds). A gap of
--                  more than VISIT_GAP (two hours) starts a new visit. `shown` is when "What's new" or the History page last
--                  showed them the family's news. `since` is where "What's new" counts from: at the start of a visit it moves
--                  up to `shown`, never further, so news that arrived after they last looked is never skipped, and it does not
--                  move during a visit, so opening the page twice shows the same news. Deleted with the account or when the
--                  member leaves the family.
--   push_subscription.weekly           1 when this device wants "This week in <family>" (off by default)
--   push_subscription.weekly_sent_day  the UTC day (YYYY-MM-DD) that push was last claimed for, at most once in seven days
-- Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE family_visit (
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  tree TEXT NOT NULL,
  since INTEGER NOT NULL,
  shown INTEGER,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (user, tree)
);

ALTER TABLE push_subscription ADD COLUMN weekly INTEGER NOT NULL DEFAULT 0 CHECK (weekly IN (0, 1));
ALTER TABLE push_subscription ADD COLUMN weekly_sent_day TEXT;
