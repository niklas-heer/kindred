-- The Research page: a family's research projects, each bringing together documents, notes, gallery pictures, people and
-- places. A document's file lives in media storage under research/<uuid>.<ext>; its row keeps only the key. Every row keeps
-- who added it: created_by is the account id, which decides who may change it, and created_by_name is the name shown, which
-- outlives the account (accounts are not part of a family's data, so an id means nothing after a transfer to another host).
-- `private` is the rule of a private field: editors and stewards only. A link to a picture or a place has no flag, because
-- the picture and the place are visible to every member anyway. Plain SQL, so D1 and node:sqlite both run it.

CREATE TABLE IF NOT EXISTS research_project (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  private INTEGER NOT NULL DEFAULT 0 CHECK (private IN (0, 1)),
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_document (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL REFERENCES research_project(id) ON DELETE CASCADE,
  key TEXT NOT NULL UNIQUE,                                  -- research/<uuid>.pdf
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  date TEXT,                                                 -- a partial date: 1985, 1985-06, 1985-06-14, ~1985
  source TEXT,
  notes TEXT NOT NULL DEFAULT '',
  private INTEGER NOT NULL DEFAULT 0 CHECK (private IN (0, 1)),
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS research_document_project ON research_document (project);

CREATE TABLE IF NOT EXISTS research_note (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL REFERENCES research_project(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,                                        -- Markdown
  date TEXT,
  private INTEGER NOT NULL DEFAULT 0 CHECK (private IN (0, 1)),
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS research_note_project ON research_note (project);

CREATE TABLE IF NOT EXISTS research_picture (
  project TEXT NOT NULL REFERENCES research_project(id) ON DELETE CASCADE,
  media TEXT NOT NULL REFERENCES media(key) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (project, media)
);
CREATE INDEX IF NOT EXISTS research_picture_media ON research_picture (media);

CREATE TABLE IF NOT EXISTS research_person (
  project TEXT NOT NULL REFERENCES research_project(id) ON DELETE CASCADE,
  person TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  private INTEGER NOT NULL DEFAULT 0 CHECK (private IN (0, 1)),
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (project, person)
);
CREATE INDEX IF NOT EXISTS research_person_person ON research_person (person);

CREATE TABLE IF NOT EXISTS research_place (
  project TEXT NOT NULL REFERENCES research_project(id) ON DELETE CASCADE,
  place TEXT NOT NULL REFERENCES place(name) ON DELETE CASCADE ON UPDATE CASCADE,
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (project, place)
);
