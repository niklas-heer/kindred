-- The gallery: a family's photographs, the albums they sit in, and who is in each one.
-- Portraits stay in `photo` (migration 0002); these are separate. Pictures live in media storage under
-- gallery/<uuid>.<ext>, and the row keeps only the key. Plain SQL, so D1 and node:sqlite both run it.

CREATE TABLE IF NOT EXISTS album (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
  key TEXT PRIMARY KEY,                                     -- gallery/<uuid>.jpg
  mime TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  taken TEXT,                                               -- a partial date: 1985, 1985-06 or 1985-06-14
  place TEXT,
  caption TEXT,
  album TEXT REFERENCES album(id) ON DELETE SET NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS media_taken ON media (taken);
CREATE INDEX IF NOT EXISTS media_album ON media (album);

-- A face box, normalised to the picture (0–1 from its top-left corner). confirmed = 0 is a suggestion
-- that a person has not yet agreed to; a suggestion is never shown as a tag.
CREATE TABLE IF NOT EXISTS media_person (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media TEXT NOT NULL REFERENCES media(key) ON DELETE CASCADE,
  person TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  x REAL NOT NULL CHECK (x >= 0 AND x <= 1),
  y REAL NOT NULL CHECK (y >= 0 AND y <= 1),
  w REAL NOT NULL CHECK (w > 0 AND w <= 1),
  h REAL NOT NULL CHECK (h > 0 AND h <= 1),
  confirmed INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0, 1)),
  tagged_by TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS media_person_media ON media_person (media);
CREATE INDEX IF NOT EXISTS media_person_person ON media_person (person);
