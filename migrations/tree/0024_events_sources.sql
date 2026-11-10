-- Life events and sources. A person's life beyond birth and death: baptisms, schooling, moves, service, burial, each with a
-- type from a fixed list (or `custom` with its own label), a partial date and an optional end, a place (a name, as people's
-- places are, which the Atlas pins from `place`), a note and an order. And the family's sources (a register, a letter, a
-- book), with citations that tie one source to one fact: a person's birth, death or name, an event, a partnership or a
-- parent link.
--
-- A citation points at its fact by what survives an edit: the person for birth, death and name, the event's id, the
-- partnership's id, or the parent link's pair. Each of those is a foreign key that cascades, so a citation goes with the fact
-- it is about (a person removed takes their events and every citation of them). A source does not cascade: the database
-- refuses to drop a source a citation still uses, and Kindred deletes the citations first, in the same batch, only when the
-- editor confirmed it (src/lib/sources.server.ts).
--
-- Every row keeps who added it: created_by is the account id, created_by_name the name shown, as research does (0017).
-- Plain SQL, so D1 and node:sqlite both run it.

CREATE TABLE IF NOT EXISTS life_event (
  id TEXT PRIMARY KEY,
  person TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'baptism', 'christening', 'confirmation', 'bar-bat-mitzvah', 'education', 'graduation', 'military', 'occupation',
    'residence', 'emigration', 'immigration', 'naturalisation', 'engagement', 'retirement', 'burial', 'cremation', 'census',
    'award', 'custom'
  )),
  label TEXT,                                                -- what it was ("Teacher", "St Mary's"); required for custom
  date TEXT,                                                 -- a partial date: 1985, 1985-06, 1985-06-14, ~1985
  end_date TEXT,                                             -- for a span (schooling, service, a residence)
  place TEXT,                                                -- a place name, pinned through `place` like born_place
  note TEXT NOT NULL DEFAULT '',
  ord INTEGER NOT NULL DEFAULT 0,                            -- the editor's order among events of the same (or no) date
  created_by TEXT,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  CHECK (type <> 'custom' OR (label IS NOT NULL AND label <> ''))
);
CREATE INDEX IF NOT EXISTS life_event_person ON life_event (person);

CREATE TABLE IF NOT EXISTS source (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (title <> ''),
  author TEXT,
  publication TEXT,                                          -- the publication or the archive that holds it
  reference TEXT,                                            -- a call number or a URL
  date TEXT,                                                 -- a partial date
  note TEXT NOT NULL DEFAULT '',
  document TEXT REFERENCES research_document(id) ON DELETE SET NULL,
  media TEXT REFERENCES media(key) ON DELETE SET NULL,
  created_by TEXT,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS citation (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL REFERENCES source(id),
  fact TEXT NOT NULL CHECK (fact IN ('birth', 'death', 'name', 'event', 'partnership', 'parent')),
  person TEXT REFERENCES person(id) ON DELETE CASCADE,      -- birth, death, name; the child of a parent link
  parent TEXT,                                               -- the parent of a parent link
  event TEXT REFERENCES life_event(id) ON DELETE CASCADE,
  partnership TEXT REFERENCES partnership(id) ON DELETE CASCADE,
  page TEXT,                                                 -- the page, entry or detail within the source
  quality TEXT CHECK (quality IN ('original', 'derivative', 'unsure')),
  transcription TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person, parent) REFERENCES parent(child, parent) ON DELETE CASCADE ON UPDATE CASCADE,
  CHECK (
    (fact IN ('birth', 'death', 'name') AND person IS NOT NULL AND parent IS NULL AND event IS NULL AND partnership IS NULL)
    OR (fact = 'event' AND event IS NOT NULL AND person IS NULL AND parent IS NULL AND partnership IS NULL)
    OR (fact = 'partnership' AND partnership IS NOT NULL AND person IS NULL AND parent IS NULL AND event IS NULL)
    OR (fact = 'parent' AND person IS NOT NULL AND parent IS NOT NULL AND event IS NULL AND partnership IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS citation_source ON citation (source);
CREATE INDEX IF NOT EXISTS citation_person ON citation (person);
CREATE INDEX IF NOT EXISTS citation_event ON citation (event);
CREATE INDEX IF NOT EXISTS citation_partnership ON citation (partnership);
