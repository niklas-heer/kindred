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
import { DurableObject } from 'cloudflare:workers';
import migrations from 'virtual:kindred/migrations';
import { checkReads, checkStatement, isReadSql, type Param, type Query, type Result } from './db.ts';

export type StoreKind = 'tree' | 'accounts';
type Row = Record<string, unknown>;

/** What an object nobody created answers with; ./cf.ts turns it into "no tree <id>". */
export const NOT_MADE = 'kindred:not-made';

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

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    // Before the first call is let in: bring a database made earlier up to date with the files this deploy carries.
    void ctx.blockConcurrencyWhile(async () => {
      const kind = await ctx.storage.get<StoreKind>('kind');
      if (kind) {
        this.#migrate(kind);
        this.#kind = kind;
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
    if (!this.#kind) throw new Error(NOT_MADE);
    return this.ctx.storage.sql;
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
    if (!this.#kind) {
      this.#migrate(kind);
      await this.ctx.storage.put('kind', kind);
      this.#kind = kind;
    }
    return this.ctx.storage.sql.exec<{ name: string }>('SELECT name FROM d1_migrations ORDER BY id').toArray().map((r) => r.name);
  }

  /** Whether this object holds a database. */
  made(): StoreKind | null {
    return this.#kind ?? null;
  }

  /** Deletes everything this object stores: its tables, its migration record and what kind it was. It is then as never made. */
  async drop(): Promise<void> {
    this.#kind = undefined;
    await this.ctx.storage.deleteAll();
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
