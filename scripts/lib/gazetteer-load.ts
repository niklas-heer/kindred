// The SQL that copies data/gazetteer.db (built by scripts/gazetteer.ts) into the GAZETTEER D1 database, in files of a fixed
// number of rows. Pure: no wrangler and no files here. scripts/gazetteer-to-d1.ts writes and runs the files;
// scripts/lib/gazetteer-load.test.ts runs them against a fresh SQLite database with the same migration.

export interface PlaceRow { id: number; name: string; cc: string | null; admin1: string | null; lat: number; lng: number; pop: number }
export interface NameRow { key: string; id: number; alt: string | null }
export type Value = string | number | null;

/** An SQL literal: NULL, a number, or a quoted string with its quotes doubled. */
export function literal(v: Value): string {
  if (v === null) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`a gazetteer value is not a finite number: ${v}`);
    return String(v);
  }
  return `'${v.replace(/'/g, "''")}'`;
}

/** One INSERT with several rows: `INSERT INTO t (cols) VALUES (...), (...);`. */
export function insertStatement(table: string, columns: string[], rows: Value[][]): string {
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${rows.map((r) => `(${r.map(literal).join(', ')})`).join(', ')};`;
}

/** The statements that empty the three tables, children first. They come first in every load, so a load can be run again. */
export const CLEAR_STATEMENTS = ['DELETE FROM name;', 'DELETE FROM place;', 'DELETE FROM meta;'];

const PLACE_COLUMNS = ['id', 'name', 'cc', 'admin1', 'lat', 'lng', 'pop'];
const NAME_COLUMNS = ['key', 'id', 'alt'];
/** Rows per INSERT statement: well under D1's statement size limit, and few enough statements per file. */
export const ROWS_PER_STATEMENT = 100;

function* groups<T>(rows: Iterable<T>, size: number): Generator<T[]> {
  let batch: T[] = [];
  for (const r of rows) {
    batch.push(r);
    if (batch.length === size) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length) yield batch;
}

export interface GazetteerSource {
  /** The source's meta rows (source, built), written last so an unfinished load is never mistaken for a finished one. */
  meta: { key: string; value: string }[];
  places: Iterable<PlaceRow>;
  names: Iterable<NameRow>;
}

/**
 * The load as files of SQL: the first clears the tables, then places, then names, then meta. Each file holds about
 * `rowsPerFile` rows (a multiple of ROWS_PER_STATEMENT). Nothing is held in memory beyond one file.
 */
export function* gazetteerFiles(source: GazetteerSource, rowsPerFile = 5000): Generator<string[]> {
  const perFile = Math.max(1, Math.ceil(rowsPerFile / ROWS_PER_STATEMENT));
  yield CLEAR_STATEMENTS;
  const stream = function* <T>(rows: Iterable<T>, toRow: (r: T) => Value[], table: string, columns: string[]) {
    let file: string[] = [];
    for (const batch of groups(rows, ROWS_PER_STATEMENT)) {
      file.push(insertStatement(table, columns, batch.map(toRow)));
      if (file.length === perFile) {
        yield file;
        file = [];
      }
    }
    if (file.length) yield file;
  };
  yield* stream(source.places, (p) => [p.id, p.name, p.cc, p.admin1, p.lat, p.lng, p.pop], 'place', PLACE_COLUMNS);
  yield* stream(source.names, (n) => [n.key, n.id, n.alt], 'name', NAME_COLUMNS);
  yield source.meta.map((m) => `INSERT INTO meta (key, value) VALUES (${literal(m.key)}, ${literal(m.value)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`);
}
