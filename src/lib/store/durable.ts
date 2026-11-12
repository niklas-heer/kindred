// A database in a Durable Object: one family's tree, or the accounts, each in its own SQLite-backed Durable Object of the
// FAMILIES namespace (wrangler.jsonc, `new_sqlite_classes`). ./cf.ts reaches it over RPC and serves it as a `Db`; nothing
// else talks to it. Cloudflare makes one on demand, keeps it anywhere it likes (or in the EU, KINDRED_JURISDICTION=eu),
// and allows up to 10 GB in each.
//
// A Durable Object starts empty. `create(kind)` makes it a family's or the accounts database: it applies every file of
// migrations/<kind>/ (bundled at build time, ./migrations-bundle.ts) in order, each in its own transaction, and records
// each in `d1_migrations` as `wrangler d1 migrations apply` and the Node driver do, so all three end with the same schema
// and the same record. Every time the object starts again (after a deploy, or after it was idle) it applies the files it
// has not had yet, before it answers anything. An object nobody created answers every query with NOT_MADE, so asking for
// a family that does not exist never makes one.
//
// SQL runs on the object's own thread, one call at a time: `batch` is one `transactionSync` (all or nothing), and the
// reads of `readBatch` run back to back with nothing in between, so they see one moment. A BLOB comes out as an
// ArrayBuffer and is handed back as a Uint8Array, as the D1 and Node drivers do. D1's limits on a statement and the
// read-only rule of `readBatch` hold here too (./db.ts), checked before anything runs.
//
// An import (a family moved or restored into its object, ./move.server.ts) writes into a STAGED object: `stage` empties it
// and makes it a family database that answers every ordinary query with NOT_MADE, as if it did not exist, so nothing serves
// a family half-imported. Only `stagedRows`, `stagedCounts` and `stagedSchema` reach it, and they take values, never SQL.
// `publish` ends the staging; from then on the object is an ordinary family. Making a family (`create`) over a staged
// object empties it first.
import { DurableObject } from 'cloudflare:workers';
import migrations from 'virtual:kindred/migrations';
import { checkReads, checkStatement, isReadSql, type Param, type Query, type Result } from './db.ts';
import { fromCell, importStatement, NAME, NOT_IMPORTED, type Schema } from './transfer.ts';

export type StoreKind = 'tree' | 'accounts';
type Row = Record<string, unknown>;

/** What an object nobody created answers with; ./cf.ts turns it into "no tree <id>". */
export const NOT_MADE = 'kindred:not-made';
/** What an import step into an object that is not staged (any more) answers with. */
export const NOT_STAGED = 'kindred:not-staged';

/** What an object holds, for the move (./move.server.ts). */
export interface StoreState { kind: StoreKind | null; staged: boolean; holds: boolean; migrations: string[] }

/** Wrangler's bookkeeping table, the same as on D1 and in node.ts. */
const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS d1_migrations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;

/** A write that `changes()` counts. A read, and anything else (CREATE, DROP), changes nothing. */
const isWrite = (sql: string) => !isReadSql(sql) && /^\s*(INSERT|UPDATE|DELETE|REPLACE|WITH)\b/i.test(sql);

/**
 * Refuses SQL with a second statement after the first. The Durable Object's `exec` would run them all, where D1 and
 * node:sqlite run one statement per query; a value that ended up in the SQL text must never become a statement of its own.
 * Strings, quoted names and comments are skipped; a trailing `;` is fine.
 */
export function checkOneStatement(sql: string) {
  let ended = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!;
    if (c === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl < 0 ? sql.length : nl;
    } else if (c === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2);
      i = close < 0 ? sql.length : close + 1;
    } else if (/\s/.test(c) || c === ';') {
      if (c === ';') ended = true;
    } else if (ended) {
      throw new Error(`One statement at a time: ${sql.slice(0, 120)}`);
    } else if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = sql.indexOf(close, i + 1);
      // A quote is escaped by doubling it.
      while (j >= 0 && close !== ']' && sql[j + 1] === close) j = sql.indexOf(close, j + 2);
      i = j < 0 ? sql.length : j;
    }
  }
}

function row(r: Row): Row {
  for (const k in r) if (r[k] instanceof ArrayBuffer) r[k] = new Uint8Array(r[k] as ArrayBuffer);
  return r;
}

export class FamilyStore extends DurableObject {
  #kind: StoreKind | undefined;
  #staged = false;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    // Before the first call is let in: bring a database made earlier up to date with the files this deploy carries.
    void ctx.blockConcurrencyWhile(async () => {
      const kind = await ctx.storage.get<StoreKind>('kind');
      if (kind) {
        this.#migrate(kind);
        this.#kind = kind;
        this.#staged = (await ctx.storage.get<boolean>('staged')) === true;
      }
    });
  }

  #migrate(kind: StoreKind) {
    const sql = this.ctx.storage.sql;
    sql.exec(MIGRATIONS_TABLE);
    const applied = new Set(sql.exec<{ name: string }>('SELECT name FROM d1_migrations').toArray().map((r) => r.name));
    for (const m of migrations[kind]) {
      if (applied.has(m.name)) continue;
      try {
        this.ctx.storage.transactionSync(() => {
          sql.exec(m.sql);
          sql.exec('INSERT INTO d1_migrations (name) VALUES (?)', m.name);
        });
      } catch (e) {
        throw new Error(`migration ${kind}/${m.name} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  #sql() {
    if (!this.#kind || this.#staged) throw new Error(NOT_MADE);
    return this.ctx.storage.sql;
  }

  #stagedSql() {
    if (this.#kind !== 'tree' || !this.#staged) throw new Error(NOT_STAGED);
    return this.ctx.storage.sql;
  }

  #migrations(): string[] {
    return this.ctx.storage.sql.exec<{ name: string }>('SELECT name FROM d1_migrations ORDER BY id').toArray().map((r) => r.name);
  }

  #exec(sql: string, params: Param[]): Result {
    const s = this.#sql();
    checkStatement(sql, params);
    checkOneStatement(sql);
    const rows = s.exec<Row>(sql, ...params).toArray().map(row);
    const after = s.exec<{ c: number; id: number }>('SELECT changes() AS c, last_insert_rowid() AS id').one();
    return { rows, changes: isWrite(sql) ? after.c : 0, lastRowId: after.id };
  }

  /** Makes this object a database of `kind` and brings it up to date; does nothing more for one already made. Returns the migrations it holds. */
  async create(kind: StoreKind): Promise<string[]> {
    if (this.#kind && this.#kind !== kind) throw new Error(`This store holds the ${this.#kind} database, not a ${kind} one`);
    // A family made where an import stopped half-way starts empty, not with the import's rows.
    if (this.#staged) await this.drop();
    if (!this.#kind) {
      this.#migrate(kind);
      await this.ctx.storage.put('kind', kind);
      this.#kind = kind;
    }
    return this.#migrations();
  }

  /** Whether this object holds a database (a staged one does not count: it serves nothing). */
  made(): StoreKind | null {
    return this.#staged ? null : (this.#kind ?? null);
  }

  /** What this object holds: its kind, whether it is staged, whether it has a family's details or people, its migrations. */
  state(): StoreState {
    if (!this.#kind) return { kind: null, staged: false, holds: false, migrations: [] };
    const sql = this.ctx.storage.sql;
    const holds = this.#kind === 'tree' && sql.exec<{ n: number }>('SELECT (SELECT count(*) FROM meta) + (SELECT count(*) FROM person) AS n').one().n > 0;
    return { kind: this.#kind, staged: this.#staged, holds, migrations: this.#migrations() };
  }

  /** Deletes everything this object stores: its tables, its migration record and what kind it was. It is then as never made. */
  async drop(): Promise<void> {
    this.#kind = undefined;
    this.#staged = false;
    await this.ctx.storage.deleteAll();
  }

  /** Empties this object and makes it a staged family database, migrated to this deploy's schema. Returns its migrations. */
  async stage(): Promise<string[]> {
    if (this.#kind === 'accounts') throw new Error('This store holds the accounts database');
    await this.drop();
    this.#migrate('tree');
    await this.ctx.storage.put({ kind: 'tree', staged: true });
    this.#kind = 'tree';
    this.#staged = true;
    return this.#migrations();
  }

  /** The staged database's tables (but SQLite's, Cloudflare's and the migration record) and their columns. */
  #schema(): Schema {
    const sql = this.#stagedSql();
    const tables = sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().filter((t) => NAME.test(t.name) && !NOT_IMPORTED.test(t.name));
    return new Map(tables.map((t) => [t.name, sql.exec(`SELECT * FROM "${t.name}" LIMIT 0`).columnNames]));
  }

  stagedSchema(): [string, string[]][] {
    return [...this.#schema()];
  }

  /**
   * Writes rows into a staged family: one statement built from the table's own schema (./transfer.ts importStatement), every
   * value bound as a parameter, all rows in one transaction. Returns how many were written.
   */
  stagedRows(table: string, columns: string[], rows: unknown[][]): number {
    const sql = this.#stagedSql();
    const statement = importStatement(this.#schema(), table, columns);
    const values = rows.map((r) => {
      if (!Array.isArray(r) || r.length !== columns.length) throw new Error(`${table}: a row has ${Array.isArray(r) ? r.length : 'no'} values for ${columns.length} columns`);
      return r.map(fromCell);
    });
    checkStatement(statement, values[0] ?? []);
    this.ctx.storage.transactionSync(() => {
      for (const v of values) sql.exec(statement, ...v);
    });
    return values.length;
  }

  /** How many rows each named table of a staged family holds, and the family id in its details. */
  stagedCounts(tables: string[]): { counts: Record<string, number>; id: string | null } {
    const sql = this.#stagedSql();
    const schema = this.#schema();
    const counts: Record<string, number> = {};
    for (const t of tables) {
      if (!schema.has(t)) throw new Error(`The family's database has no table "${String(t).slice(0, 64)}"`);
      counts[t] = sql.exec<{ n: number }>(`SELECT count(*) AS n FROM "${t}"`).one().n;
    }
    const id = sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'id'").toArray()[0]?.value ?? null;
    return { counts, id };
  }

  /** Ends the staging: from now on this object serves the family. Does nothing for one that is not staged. */
  async publish(): Promise<void> {
    if (this.#kind !== 'tree' || !this.#staged) return;
    await this.ctx.storage.delete('staged');
    this.#staged = false;
  }

  all(sql: string, params: Param[]): Row[] {
    checkStatement(sql, params);
    checkOneStatement(sql);
    return this.#sql().exec<Row>(sql, ...params).toArray().map(row);
  }

  get(sql: string, params: Param[]): Row | undefined {
    return this.all(sql, params)[0];
  }

  run(sql: string, params: Param[]): Result {
    return this.#exec(sql, params);
  }

  batch(queries: Query[]): Result[] {
    this.#sql();
    for (const x of queries) {
      checkStatement(x.sql, x.params);
      checkOneStatement(x.sql);
    }
    if (!queries.length) return [];
    return this.ctx.storage.transactionSync(() => queries.map((x) => this.#exec(x.sql, x.params)));
  }

  readBatch(queries: Query[]): Row[][] {
    const s = this.#sql();
    checkReads(queries);
    for (const x of queries) {
      checkStatement(x.sql, x.params);
      checkOneStatement(x.sql);
    }
    return queries.map((x) => s.exec<Row>(x.sql, ...x.params).toArray().map(row));
  }
}
