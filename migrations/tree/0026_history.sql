-- The family's change history: one row for each change to the family's records (a person, a link, a partnership, an
-- event, a source, a story, a photo, a house, a place, research …), written in the same batch as the change itself
-- (src/lib/history.server.ts, through `once` in src/lib/db.server.ts), so a change cannot be stored without its row.
--
--   at           when (ISO 8601, UTC)
--   account      who: the account id, NULL for Kindred itself (a daily job, a script)
--   name         the name that account had then, kept when the account goes
--   kind         what sort of record: person, field, link, partnership, event, source, citation, story, photo, album,
--                tag, portrait, house, place, research, family, import
--   record       which record (its id; a parent link is "child>parent")
--   person       the person the change is about, if any. No foreign key: the row outlives the person
--   person_name  that person's name then, so a removed person is still named
--   label        what the record was called then (a story's title, a source's title, a field's type)
--   action       added, changed or removed
--   level        who may read the row: family (every member), editors (editors and stewards), personal (`owner` only).
--                A guest reads none. A personal field's row never carries its content
--   owner        the account a personal row belongs to
--   fields       JSON, for a change: {"f": {name: [before, after]}} with the changed fields only, in compact form,
--                "t" names values cut short, "o" fields whose content is not kept (a picture, the arms), "e" fields whose
--                values only editors may read. Capped in size; never a picture or a document
--   count        how many records one row stands for (an import is one row)
--   fn           the change that wrote it, for whoever reads the database
--
-- Kept three years by default, pruned by the daily job. Not in GEDCOM or the Markdown archive, and not copied to D1 by the
-- transfer script (it names accounts, which are not copied). Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  account TEXT,
  name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN (
    'person', 'field', 'link', 'partnership', 'event', 'source', 'citation', 'story', 'photo', 'album', 'tag', 'portrait',
    'house', 'place', 'research', 'family', 'import'
  )),
  record TEXT NOT NULL,
  person TEXT,
  person_name TEXT,
  label TEXT,
  action TEXT NOT NULL CHECK (action IN ('added', 'changed', 'removed')),
  level TEXT NOT NULL DEFAULT 'family' CHECK (level IN ('family', 'editors', 'personal')),
  owner TEXT,
  fields TEXT,
  count INTEGER NOT NULL DEFAULT 1,
  fn TEXT NOT NULL DEFAULT '',
  CHECK ((level = 'personal') = (owner IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS history_at ON history (at);
CREATE INDEX IF NOT EXISTS history_person ON history (person, id);
CREATE INDEX IF NOT EXISTS history_record ON history (kind, record, id);
CREATE INDEX IF NOT EXISTS history_account ON history (account, id);
