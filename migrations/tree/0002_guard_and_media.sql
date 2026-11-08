-- Guards, and portraits out of the database.

-- A guard aborts the batch it is in unless its condition holds (src/lib/store/db.ts):
--   INSERT INTO guard (ok) SELECT <condition>
-- D1 has no interactive transactions, so a change is decided on reads and then written in one batch that
-- restates what the decision relied on. Inserting into the view writes nothing.
CREATE VIEW IF NOT EXISTS guard AS SELECT 1 AS ok;
CREATE TRIGGER IF NOT EXISTS guard_check INSTEAD OF INSERT ON guard
WHEN NEW.ok IS NOT 1
BEGIN
  SELECT RAISE(ABORT, 'kindred:guard');
END;

-- Portraits now live in media storage (data/media/<tree>/ on Node, R2 on Cloudflare); `key` points there.
-- `data` stays only for pictures saved before this migration: the app copies them out the next time it
-- opens the file (scripts/import-to-d1.ts does the same before an upload) and clears them.
CREATE TABLE photo_next (
  person TEXT PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  key TEXT,          -- media key, e.g. photo/<uuid>.jpg
  data BLOB,         -- the picture itself, only until it has been copied out
  at TEXT NOT NULL,
  CHECK (key IS NOT NULL OR data IS NOT NULL)
);
INSERT INTO photo_next (person, mime, data, at) SELECT person, mime, data, at FROM photo;
DROP TABLE photo;
ALTER TABLE photo_next RENAME TO photo;
