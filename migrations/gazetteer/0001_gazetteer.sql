-- The offline place gazetteer on D1 (GeoNames cities500, CC BY 4.0, https://www.geonames.org): the same tables that
-- scripts/gazetteer.ts builds for Node in data/gazetteer.db. Applied by `mise run cf:migrate` to the GAZETTEER binding;
-- the rows are loaded afterwards by `mise run cf:gazetteer`. The app only reads them. Plain SQL, so D1 and node:sqlite
-- both run it. Keep the names and columns in step with src/lib/gazetteer.server.ts and src/lib/db.server.ts.

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS place (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  cc TEXT,
  admin1 TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  pop INTEGER NOT NULL
);
-- Towns inside a map box (placesIn): a range scan on latitude, then the box's longitudes.
CREATE INDEX IF NOT EXISTS place_by_lat ON place (lat);

-- One row per searchable spelling, folded. A prefix search is a range scan on the key: key >= 'munc' AND key < 'munc' || U+FFFF.
-- alt is the spelling to show when it differs from the place's own name (Munich for München). The primary key is
-- (key, id), so the search and the exact-name lookup both read this table in key order.
CREATE TABLE IF NOT EXISTS name (
  key TEXT NOT NULL,
  id INTEGER NOT NULL,
  alt TEXT,
  PRIMARY KEY (key, id)
) WITHOUT ROWID;
