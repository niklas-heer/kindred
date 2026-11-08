-- What a house's name means, as the steward researched and chose it, and the steward's check of the house's arms against it.
--
-- house_meaning: one row per house, written when a steward saves the research. `meanings` is JSON: every meaning the research
--   returned, each with "chosen" true for the ones the steward kept. `family_words` is the family's own meaning, in their words.
--   `web_searched` says whether the web was searched (sources are then real pages). `saved_at` (epoch ms) and `saved_by` (the
--   steward's user id) say when and by whom; the research is saved again in place, so each house has one row.
-- house_arms_review: one row per house, the latest check of its arms against the saved meanings. `fingerprint` is a hash of the
--   arms and the chosen meanings the check read: when either changes, the check is out of date. `dismissed_fingerprint` is the
--   fingerprint at the time the steward kept the arms; it counts only while it still matches, so a change brings the check back.
--
-- Plain SQL, no PRAGMA: D1 and node:sqlite run it. Nothing is backfilled: a house has no research until a steward saves some.

CREATE TABLE IF NOT EXISTS house_meaning (
  house TEXT PRIMARY KEY REFERENCES house(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  family_words TEXT NOT NULL DEFAULT '',
  meanings TEXT NOT NULL DEFAULT '[]',
  web_searched INTEGER NOT NULL DEFAULT 0 CHECK (web_searched IN (0, 1)),
  note TEXT NOT NULL DEFAULT '',
  saved_at INTEGER NOT NULL,
  saved_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS house_arms_review (
  house TEXT PRIMARY KEY REFERENCES house(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('fits', 'partly', 'reconsider')),
  reason TEXT NOT NULL DEFAULT '',
  advice TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT 'en',
  checked_at INTEGER NOT NULL,
  checked_by TEXT NOT NULL DEFAULT '',
  dismissed_fingerprint TEXT NOT NULL DEFAULT ''
);
