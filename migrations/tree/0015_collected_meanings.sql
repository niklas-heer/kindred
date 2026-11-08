-- The background task "Collect name meanings" (src/lib/ai/background-tasks.server.ts) stores what it finds in house_meaning,
-- with every meaning unchosen: a row with no chosen meaning is collected, not saved, and only a steward sees it. This column
-- counts the failed tries for a house whose row has no meanings yet, so a name that keeps failing is given up on after
-- MAX_COLLECT_FAILURES tries instead of being asked again on every run. It stays 0 for every research a steward saves.
-- Plain SQL, no PRAGMA: D1 and node:sqlite both run it.

ALTER TABLE house_meaning ADD COLUMN collect_failures INTEGER NOT NULL DEFAULT 0;
