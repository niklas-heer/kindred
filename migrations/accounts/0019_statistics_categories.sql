-- Usage statistics by who did it (src/lib/stats, docs/roles-and-privacy.md). Each daily counter now also carries the person category
-- at the moment of the event: steward, editor, contributor, viewer or guest, taken by the server from the membership, never from the
-- browser. Counters written before this migration become 'legacy': they are shown as "before categories" and are left out of the
-- family-without-stewards figures, because nobody can say who they were. Still only counters: no row is about one person.
-- A new kind, 'change', counts what members saved (people, photos, stories, research), so changes can be told apart by category.
-- stats_member keeps the category a member was last seen in, so "active in the last 30 days" can be split too. It is still one
-- pseudonymous marker per member with no history.
-- Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE stats_daily_v2 (
  tree TEXT NOT NULL,
  day TEXT NOT NULL,                -- YYYY-MM-DD (UTC)
  kind TEXT NOT NULL CHECK (kind IN ('view', 'visit', 'event', 'active', 'change')),
  cat TEXT NOT NULL DEFAULT 'legacy' CHECK (cat IN ('steward', 'editor', 'contributor', 'viewer', 'guest', 'legacy')),
  name TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0 CHECK (n >= 0),
  PRIMARY KEY (tree, day, kind, cat, name)
) WITHOUT ROWID;
INSERT INTO stats_daily_v2 (tree, day, kind, cat, name, n) SELECT tree, day, kind, 'legacy', name, n FROM stats_daily;
DROP TABLE stats_daily;
ALTER TABLE stats_daily_v2 RENAME TO stats_daily;
CREATE INDEX IF NOT EXISTS stats_daily_day ON stats_daily (day);

ALTER TABLE stats_member ADD COLUMN cat TEXT;
