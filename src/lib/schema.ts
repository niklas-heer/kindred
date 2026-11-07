// One SQLite file per family tree (data/<id>.db). Relationships are rows, not copies: a parent
// link or a union exists once, and both people see it.
export const SCHEMA = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS house (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  motto TEXT,
  arms TEXT NOT NULL,          -- JSON, see SeedHouse.arms
  founder TEXT
);

CREATE TABLE IF NOT EXISTS person (
  id TEXT PRIMARY KEY,
  given TEXT NOT NULL,
  surname TEXT,
  house TEXT REFERENCES house(id),
  sex TEXT CHECK (sex IN ('m', 'f', 'x')),
  born TEXT, born_place TEXT,
  died TEXT, died_place TEXT,
  living INTEGER NOT NULL DEFAULT 0,
  epithet TEXT, title TEXT, occupation TEXT,
  bio TEXT,
  traits TEXT,                 -- JSON array
  look TEXT,                   -- JSON, portrait seed
  nickname TEXT, favourite TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS parent (
  child TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  parent TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'biological',
  confidence TEXT NOT NULL DEFAULT 'certain',
  PRIMARY KEY (child, parent)
);
CREATE INDEX IF NOT EXISTS parent_by_parent ON parent(parent);

CREATE TABLE IF NOT EXISTS partnership (
  id TEXT PRIMARY KEY,
  a TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  b TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'marriage',
  start TEXT, end TEXT, end_reason TEXT, place TEXT
);

-- What relatives contribute: notes, quotes, anecdotes, recipes, memories. Append-mostly, wiki-like.
CREATE TABLE IF NOT EXISTS story (
  id TEXT PRIMARY KEY,
  person TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT,
  body TEXT NOT NULL,
  author TEXT NOT NULL,
  at TEXT NOT NULL,
  context TEXT
);
CREATE INDEX IF NOT EXISTS story_by_person ON story(person);

CREATE TABLE IF NOT EXISTS contact (
  id INTEGER PRIMARY KEY,
  person TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contact_by_person ON contact(person);

-- Where places are, so the Atlas can draw them. Keyed by the name people's records use.
CREATE TABLE IF NOT EXISTS place (
  name TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  country TEXT
);

-- Portraits live in the database too, so one file is the whole family.
CREATE TABLE IF NOT EXISTS photo (
  person TEXT PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  at TEXT NOT NULL
);
`;
