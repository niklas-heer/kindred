// Reading a database's own schema, so the data-protection work (account deletion and export, erasing a person) covers every
// table that names an account or a person, including tables a later migration adds, without a list to keep up to date. The
// same idea as `forgetInAccounts` in src/lib/families.server.ts, which finds every table with a `tree` column. SQLite keeps each
// table's CREATE statement in sqlite_master and rewrites it on ALTER TABLE ... ADD COLUMN, so the statement is always current.
// No PRAGMA: D1 refuses some, and this reads the same on both drivers.
import type { Db } from '../store/index.ts';

export interface Column {
  name: string;
  /** The declared type, upper case ('TEXT', 'INTEGER' …), '' when none. */
  type: string;
  notNull: boolean;
  /** Part of the table's primary key. */
  key: boolean;
}

export interface Table { name: string; columns: Column[] }

/** Tables a driver or the platform keeps for itself: never touched. */
const INTERNAL = /^(sqlite_|_cf_|d1_migrations$)/;

/** Splits on commas outside parentheses and quotes. */
function topLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0, quote = '', start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
  }
  parts.push(body.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

const unquote = (s: string) => s.replace(/^["`[]|["`\]]$/g, '');

/** The columns of one CREATE TABLE statement. A view, or anything that is not a table, has none. */
export function columnsOf(raw: string): Column[] {
  // Comments first: the migrations write them beside columns, and one may hold a quote or a comma ("St Mary's").
  const sql = raw.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const open = sql.indexOf('(');
  const close = sql.lastIndexOf(')');
  if (!/^\s*CREATE\s+TABLE/i.test(sql) || open < 0 || close < open) return [];
  const parts = topLevel(sql.slice(open + 1, close));
  const tableKey = new Set<string>();
  const cols: Column[] = [];
  for (const part of parts) {
    const pk = /^(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(part);
    if (pk) { for (const c of pk[1]!.split(',')) tableKey.add(unquote(c.trim().split(/\s+/)[0]!)); continue; }
    if (/^(CONSTRAINT|UNIQUE|CHECK|FOREIGN)\b/i.test(part)) continue;
    const m = /^("[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)\s*(\S*)/.exec(part);
    if (!m) continue;
    const type = /^[A-Za-z]+$/.test(m[2] ?? '') && !/^(NOT|PRIMARY|REFERENCES|DEFAULT|CHECK|UNIQUE|COLLATE|GENERATED|CONSTRAINT)$/i.test(m[2]!) ? m[2]!.toUpperCase() : '';
    cols.push({ name: unquote(m[1]!), type, notNull: /\bNOT\s+NULL\b/i.test(part) || /\bPRIMARY\s+KEY\b/i.test(part), key: /\bPRIMARY\s+KEY\b/i.test(part) });
  }
  for (const c of cols) if (tableKey.has(c.name)) c.key = true;
  return cols;
}

/** Every table of a database with its columns, in name order, without the driver's own. */
export async function tablesOf(d: Db): Promise<Table[]> {
  const rows = await d.all<{ name: string; sql: string | null }>("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name");
  return rows
    .filter((r) => !INTERNAL.test(r.name) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(r.name))
    .map((r) => ({ name: r.name, columns: columnsOf(r.sql ?? '') }));
}

/** A column that holds text: declared TEXT (or with no type, which SQLite lets hold anything). */
export const isText = (c: Column) => c.type === '' || c.type === 'TEXT' || c.type.includes('CHAR') || c.type === 'CLOB';

export const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;
