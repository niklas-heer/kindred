-- Painted portraits: a stylised portrait a steward or editor makes from one of a person's photos (ai-portrait).
-- Pictures live in media storage under portrait/<uuid>.<ext>; a row keeps the key. A row is a candidate
-- (accepted = 0) until someone chooses it with "Use this portrait"; a person has at most one accepted row.
-- Plain SQL, so D1 and node:sqlite both run it.

CREATE TABLE IF NOT EXISTS portrait (
  key TEXT PRIMARY KEY,                                     -- portrait/<uuid>.<ext>
  person TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  source TEXT NOT NULL,                                     -- the photo it was painted from: gallery/… or photo/…
  source_year INTEGER,                                      -- the year of that photo, when it has a date; else NULL
  model TEXT NOT NULL,                                      -- the OpenRouter model id that painted it
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0 CHECK (accepted IN (0, 1))
);
CREATE INDEX IF NOT EXISTS portrait_person ON portrait (person);
CREATE UNIQUE INDEX IF NOT EXISTS portrait_current ON portrait (person) WHERE accepted = 1;

-- What the person shows: a drawing (the default), the photo, or this painted portrait. prefer_avatar keeps its
-- meaning (migration 0007); prefer_portrait is new and defaults to 0, so every existing choice stays as it was.
ALTER TABLE person ADD COLUMN prefer_portrait INTEGER NOT NULL DEFAULT 0 CHECK (prefer_portrait IN (0, 1));
