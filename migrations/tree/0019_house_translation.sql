-- AI translations of a house's researched name meanings and of its arms check (src/lib/ai/house-translation.server.ts): one
-- row per house, kind and language, kept beside the original, which is never changed. `source_hash` is a hash of the text it
-- was made from: a translation that no longer matches is not shown and is made again, so editing or researching a name
-- replaces its translations. `same` is 1 when the text was already in that language. `content` is JSON, the translated text
-- with what each piece was made from. Plain SQL, no PRAGMA: D1 and node:sqlite both run it.

CREATE TABLE IF NOT EXISTS house_translation (
  house TEXT NOT NULL REFERENCES house(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('meanings', 'review')),
  locale TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '{}',
  same INTEGER NOT NULL DEFAULT 0 CHECK (same IN (0, 1)),
  translated_at TEXT NOT NULL,
  PRIMARY KEY (house, kind, locale)
);
