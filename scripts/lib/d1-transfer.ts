// What moving one family from its local SQLite file to its D1 database and R2 bucket takes, decided without
// Cloudflare: which tables are copied and in what order, which bookkeeping tables are left out, which media files
// go up, the SQL that writes the rows, and how the copied rows are counted afterwards. scripts/import-to-d1.ts
// runs this against wrangler; scripts/import-to-d1.test.ts checks it. Node only (it reads folders).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// Which tables a family's data lives in, and which are left out, are decided in src/lib/store/transfer.ts: the Worker's
// backup and the move into a Durable Object use the same lists.
export { COPIED_TABLES, COPY_ONLY, LEFT_OUT_TABLES, planTables, type TablePlan } from '../../src/lib/store/transfer.ts';

/** Foreign keys that point at a table copied after it: an error in the order. Each key is `table → parent`. */
export function foreignKeyOrderErrors(order: readonly string[], keys: { table: string; parent: string }[]): string[] {
  const at = new Map(order.map((t, i) => [t, i]));
  return keys
    .filter((k) => k.table !== k.parent)
    .filter((k) => at.has(k.table) && at.has(k.parent) && at.get(k.parent)! > at.get(k.table)!)
    .map((k) => `${k.table} refers to ${k.parent}, which is copied after it`);
}

/** One media file to upload: its key under the tree (`gallery/<uuid>.jpg`) and where it is on this machine. */
export interface MediaFile { key: string; file: string }

/** Every file under `root`, as its key (forward slashes, relative to `root`), recursively. A missing folder has none. */
export function listFiles(root: string): MediaFile[] {
  const found: MediaFile[] = [];
  const walk = (dir: string, prefix: string) => {
    let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const key = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), key);
      else if (e.isFile()) found.push({ key, file: join(dir, e.name) });
    }
  };
  walk(root, '');
  return found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * The media files to upload: every file offered (its pictures in folders such as `gallery/` and `photo/` included),
 * once per key. The first file offered for a key wins, so pictures moved out of the database come before the folder.
 * Throws when the family names a picture that no file provides: that picture would be broken on the other side.
 */
export function planMedia(referencedKeys: string[], offered: MediaFile[]): MediaFile[] {
  const byKey = new Map<string, MediaFile>();
  for (const f of offered) if (!byKey.has(f.key)) byKey.set(f.key, f);
  const missing = [...new Set(referencedKeys)].filter((k) => !byKey.has(k));
  if (missing.length) {
    throw new Error(`${missing.length} picture${missing.length > 1 ? 's are' : ' is'} named by the family but has no file: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', …' : ''}`);
  }
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * What a D1 database that already holds data means for the transfer, decided before anything is written. `people` and
 * `meta` are what the target holds now. Setup makes a family's details (its meta rows) on Workers before any copy, so a
 * database can hold a family with no people: the copy would then clash with those rows partway through. Without
 * `--replace` the transfer is refused here, up front; with it, the copied tables are emptied first, meta included.
 * Null when the transfer may go ahead.
 */
export function existingFamilyProblem(held: { people: number; meta: number }, database: string, replace: boolean): string | null {
  if (replace || (held.people === 0 && held.meta === 0)) return null;
  if (held.people > 0) return `${database} already holds ${held.people} people; pass --replace to overwrite it`;
  return `${database} already has a family's details (setup made them) and no people; pass --replace to overwrite them, or the copy's rows would clash with them`;
}

/** An SQL literal for one value of a row. */
export function literal(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString('hex')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** One INSERT per row, with the columns in the order given. */
export function insertSql(table: string, columns: string[], rows: Record<string, unknown>[]): string[] {
  const names = columns.join(', ');
  return rows.map((r) => `INSERT INTO ${table} (${names}) VALUES (${columns.map((c) => literal(r[c])).join(', ')});`);
}

/** Empties the copied tables, children first, so the foreign keys hold. */
export function deleteSql(copy: readonly string[]): string[] {
  return [...copy].reverse().map((t) => `DELETE FROM ${t};`);
}

/** One query that counts every copied table, as one row keyed by table name. */
export function countSql(copy: readonly string[]): string {
  return `SELECT ${copy.map((t) => `(SELECT count(*) FROM ${t}) AS "${t}"`).join(', ')}`;
}

/** The tables whose counts differ, as sentences. Empty when every table has the rows it was sent. */
export function countMismatches(expected: Record<string, number>, actual: Record<string, number>): string[] {
  return Object.keys(expected)
    .filter((t) => Number(actual[t] ?? -1) !== expected[t])
    .map((t) => `${t}: sent ${expected[t]}, the target holds ${actual[t] ?? 'no count for it'}`);
}
