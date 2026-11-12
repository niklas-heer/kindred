// What moving a family into its Durable Object takes, decided without a Worker: the order the tables go in, the statements,
// and how they are cut into requests. scripts/import-to-do.ts sends them; scripts/lib/do-transfer.test.ts checks them.
import { literal } from './d1-transfer.ts';

/** Tables that are the target's own, never sent: SQLite's, Cloudflare's and wrangler's migration record. */
export const NEVER_SENT = /^(sqlite_|_cf_|d1_migrations$)/;

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

/**
 * One statement per row, as `INSERT OR REPLACE`: a table a migration seeds with a starting row (`ancestry_rev`) then takes
 * the source's row instead of clashing with its own.
 */
export function upsertSql(table: string, columns: string[], rows: Record<string, unknown>[]): string[] {
  const names = columns.map((c) => `"${c}"`).join(', ');
  return rows.map((r) => `INSERT OR REPLACE INTO ${table} (${names}) VALUES (${columns.map((c) => literal(r[c])).join(', ')})`);
}

/** Cuts statements into requests of at most `count` statements and about `bytes` of SQL each, in order. */
export function chunks(statements: string[], count = 500, bytes = 2_000_000): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const s of statements) {
    if (current.length && (current.length >= count || size + s.length > bytes)) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(s);
    size += s.length;
  }
  if (current.length) out.push(current);
  return out;
}
