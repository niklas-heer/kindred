// What moving one family from its local SQLite file to its D1 database and R2 bucket takes, decided without
// Cloudflare: which tables are copied and in what order, which bookkeeping tables are left out, which media files
// go up, the SQL that writes the rows, and how the copied rows are counted afterwards. scripts/import-to-d1.ts
// runs this against wrangler; scripts/import-to-d1.test.ts checks it. Node only (it reads folders).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every table a family's data lives in, in the order its foreign keys need: a row is only written after the row it
 * refers to. A table added by a migration must be listed here, or the transfer refuses (see `planTables`).
 */
export const COPIED_TABLES: readonly string[] = [
  'meta', // the family's name, theme and starting point
  'house', // houses: person.house refers to them
  'person', // people: nearly every other table refers to them
  'parent', // parent links
  'partnership', // marriages and other unions
  'story', // memories, notes, quotes and recipes
  'story_translation', // chronicle translations, kept beside each story (migration 0014): asked for once, so copied after their story
  'place', // map pins for the atlas
  'photo', // portraits: the row keeps a media key, the picture itself is in R2
  'person_field', // the Edit tab's fields: contacts, medical and private notes, in their order
  'house_succession', // who heads each house, its heir and its country
  'house_meaning', // what each house's name means, as the steward researched and chose it (migration 0012)
  'house_arms_review', // the steward's latest check of each house's arms against its name (migration 0012)
  'album', // gallery albums
  'media', // gallery pictures: the row keeps a media key, the picture is in R2
  'media_person', // face boxes and the people tagged in gallery pictures
  'portrait', // painted portraits (migration 0013): candidates and each person's accepted one; the picture is in media (portrait/)
  'occupation_translation', // cached translations of occupations, per text and locale (asked for once, so copied)
];

/**
 * Tables left out on purpose. They are bookkeeping about the copy, not the family, and the target keeps its own.
 * `op` holds the retry keys of changes already sent, which expire after 30 days and mean nothing on another database.
 * `d1_migrations` is wrangler's record of the schema the target already has from `migrations apply`.
 */
export const LEFT_OUT_TABLES: Record<string, string> = {
  op: 'retry keys of changes already sent; they expire after 30 days',
  d1_migrations: "wrangler's record of the migrations applied to the target",
  // The ancestry revision (migration 0011) counts changes to parent links on whichever database holds them. The copy's
  // parent rows bump the target's own counter as they are written, and the import guards only that the number it read
  // is still the one in the batch, so the target keeps its own (seeded at 0) rather than receiving the source's.
  ancestry_rev: 'the ancestry revision counts changes on the database that holds the links; the target keeps its own',
};

export interface TablePlan {
  /** The tables whose rows are copied, in order. */
  copy: string[];
  /** The tables present in the copy and left out on purpose. */
  leftOut: string[];
}

/**
 * Decides which of a migrated copy's tables are copied. Refuses (throws) when a table has no decision, or when a
 * table the transfer copies is missing, so a new migration cannot be left behind silently.
 */
export function planTables(present: string[]): TablePlan {
  const names = new Set(present);
  const unknown = present.filter((t) => !t.startsWith('sqlite_') && !COPIED_TABLES.includes(t) && !Object.hasOwn(LEFT_OUT_TABLES, t));
  if (unknown.length) {
    throw new Error(`No decision for the table${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}: add ${unknown.length > 1 ? 'them' : 'it'} to COPIED_TABLES or LEFT_OUT_TABLES in scripts/lib/d1-transfer.ts.`);
  }
  const missing = COPIED_TABLES.filter((t) => !names.has(t));
  if (missing.length) throw new Error(`The copy has no ${missing.join(', ')} table: is it migrated to the current schema?`);
  return {
    copy: [...COPIED_TABLES],
    leftOut: present.filter((t) => Object.hasOwn(LEFT_OUT_TABLES, t)).sort(),
  };
}

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
