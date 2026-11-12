// What importing a family into its Durable Object takes, decided without a Worker: the order the tables go in, and each
// table's rows as data (src/lib/store/transfer.ts), cut into requests. scripts/import-to-do.ts sends them;
// scripts/lib/do-transfer.test.ts checks them.
import type { DatabaseSync } from 'node:sqlite';
import { NOT_IMPORTED, rowBatches, toCell, type TableRows } from '../../src/lib/store/transfer.ts';

/** Tables that are the target's own, never sent: SQLite's, Cloudflare's and wrangler's migration record. */
export const NEVER_SENT = NOT_IMPORTED;

/**
 * The tables in an order their foreign keys allow: a table goes after every table it refers to. Each key is
 * `table → parent`; a key to itself or to a table not in the list is ignored. A cycle (none today) keeps its given order.
 */
export function tableOrder(tables: string[], keys: { table: string; parent: string }[]): string[] {
  const left = [...tables].sort();
  const needs = new Map(left.map((t) => [t, new Set(keys.filter((k) => k.table === t && k.parent !== t && left.includes(k.parent)).map((k) => k.parent))]));
  const order: string[] = [];
  while (left.length) {
    const i = left.findIndex((t) => [...needs.get(t)!].every((p) => order.includes(p)));
    order.push(...left.splice(i < 0 ? 0 : i, 1));
  }
  return order;
}

/** The last tree migration a database has: the schema its rows are read under. */
export const schemaOf = (d: DatabaseSync) => (d.prepare('SELECT max(name) AS name FROM d1_migrations').get() as { name: string | null }).name ?? '';

/** Every row of `table` (those matching `where`, a condition of our own), as data in requests of a few hundred rows. */
export function tableRows(d: DatabaseSync, table: string, columns: string[], where?: string): { count: number; batches: TableRows[] } {
  const rows = d.prepare(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${table}"${where ? ` WHERE ${where}` : ''}`).all() as Record<string, unknown>[];
  return { count: rows.length, batches: rowBatches(table, columns, rows.map((r) => columns.map((c) => toCell(r[c])))) };
}
