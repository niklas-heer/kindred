// A database as data, for a backup of a Durable Object (./kbak.ts format `dump`): a Durable Object has no file to copy, so it
// reads its own SQLite in one synchronous pass, inside one storage transaction, and nothing else runs in between: every table's
// schema and rows, indexes, views and triggers, BLOBs as base64 (../store/transfer.ts cells). `loadDump` writes it back into an
// empty database: the tables, then their rows (foreign keys checked at the end), then indexes, views and triggers, so no
// trigger fires on a restored row. Runs wherever a synchronous `exec` is: in workerd, and in node:sqlite for the tests.
import { fromCell, toCell, type Cell } from '../store/transfer.ts';

export interface Dump {
  /** `CREATE` statements from sqlite_master, tables first. */
  objects: { type: 'table' | 'index' | 'view' | 'trigger'; name: string; sql: string }[];
  tables: { name: string; columns: string[]; rows: Cell[][] }[];
}

/** A synchronous statement runner: workerd's `ctx.storage.sql.exec(...).toArray()`, or node:sqlite's prepare/all. */
export type Exec = (sql: string, ...params: unknown[]) => Record<string, unknown>[];
/** Its column names for a table, without reading its rows. */
export type Columns = (table: string) => string[];

/** Tables that are the engine's or Cloudflare's own: never dumped, never written. */
const INTERNAL = /^(sqlite_|_cf_)/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function dumpDatabase(exec: Exec, columns: Columns): Dump {
  const master = exec("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, rowid") as { type: Dump['objects'][number]['type']; name: string; sql: string }[];
  const objects = master.filter((o) => !INTERNAL.test(o.name) && !(o.type === 'table' && !NAME.test(o.name)));
  const tables = objects.filter((o) => o.type === 'table').map((t) => {
    const cols = columns(t.name);
    const rows = exec(`SELECT * FROM "${t.name}"`).map((r) => cols.map((c) => toCell(r[c])));
    return { name: t.name, columns: cols, rows };
  });
  return { objects, tables };
}

/** Rows per table of a dump, for its manifest. */
export const dumpCounts = (d: Dump) => Object.fromEntries(d.tables.map((t) => [t.name, t.rows.length]));

/** The newest migration a dump records (its `d1_migrations` rows), or null. */
export function dumpSchema(d: Dump): string | null {
  const t = d.tables.find((x) => x.name === 'd1_migrations');
  const i = t ? t.columns.indexOf('name') : -1;
  if (!t || i < 0) return null;
  const names = t.rows.map((r) => r[i]).filter((v): v is string => typeof v === 'string').sort();
  return names.at(-1) ?? null;
}

/** Rows per table of a live database (its own tables only), for a manifest or a drill. */
export function tableCounts(exec: Exec): Record<string, number> {
  const tables = (exec("SELECT name FROM sqlite_master WHERE type = 'table'") as { name: string }[]).map((t) => t.name).filter((n) => !INTERNAL.test(n) && NAME.test(n));
  return Object.fromEntries(tables.sort().map((n) => [n, Number((exec(`SELECT count(*) AS n FROM "${n}"`)[0] as { n: number }).n)]));
}

/** The newest migration a database records, or null. */
export function schemaOf(exec: Exec): string | null {
  try {
    return ((exec('SELECT max(name) AS name FROM d1_migrations')[0] as { name: string | null } | undefined)?.name) ?? null;
  } catch {
    return null;
  }
}

/** Writes a dump into an empty database. The caller runs it inside one transaction. */
export function loadDump(exec: Exec, dump: Dump): void {
  // Rows are written in the dump's order, which is not their foreign keys' order: checked once, at the end of the transaction.
  exec('PRAGMA defer_foreign_keys = ON');
  const later = dump.objects.filter((o) => o.type !== 'table');
  for (const t of dump.objects.filter((o) => o.type === 'table')) exec(t.sql);
  for (const t of dump.tables) {
    if (!NAME.test(t.name) || !t.columns.every((c) => NAME.test(c))) throw new Error(`a table or column name that is not plain: ${String(t.name).slice(0, 64)}`);
    if (!t.rows.length) continue;
    const statement = `INSERT INTO "${t.name}" (${t.columns.map((c) => `"${c}"`).join(', ')}) VALUES (${t.columns.map(() => '?').join(', ')})`;
    for (const r of t.rows) exec(statement, ...r.map(fromCell));
  }
  for (const o of later) exec(o.sql);
}

export const encodeDump = (d: Dump) => new TextEncoder().encode(JSON.stringify(d));
export function decodeDump(bytes: Uint8Array): Dump {
  const d = JSON.parse(new TextDecoder().decode(bytes)) as Dump;
  if (!d || !Array.isArray(d.objects) || !Array.isArray(d.tables)) throw new Error('backup: no database in the file');
  return d;
}

/** Why a restored database does not match its manifest, or null when it does. */
export function compare(expected: Record<string, number>, schema: string | null, found: Record<string, number>, foundSchema: string | null): string | null {
  if (schema !== foundSchema) return `schema ${foundSchema ?? 'none'}, expected ${schema ?? 'none'}`;
  for (const [t, n] of Object.entries(expected)) if (found[t] !== n) return `${t}: ${found[t] ?? 'missing'} rows, expected ${n}`;
  return null;
}
