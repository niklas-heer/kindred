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
//
// Backups (src/lib/backup/, docs/hosting-many-families.md "Backups"): `backup` reads the object's own SQLite in one synchronous
// pass inside one storage transaction (src/lib/backup/dump.ts), seals it (src/lib/backup/kbak.ts) with the key from
// KINDRED_BACKUP_KEY or KINDRED_SECRET and puts it into the MEDIA bucket under `_backups/<scope>/`, so the family's data never
// travels over RPC. `drill` runs in a scratch object (`drill:<uuid>`, which no family or the accounts is ever called): it loads
// a backup, checks it and deletes everything it stored. `restoreBackup` replaces a family's object with a backup.
// Before an object applies new migrations it records its point-in-time-recovery bookmark (SQLite Durable Objects keep 30
// days); `rollback` restarts the object at one of them.
import { DurableObject } from 'cloudflare:workers';
import migrations from 'virtual:kindred/migrations';
import { ACCOUNTS_SCOPE, backupKey, backupSecret, deriveBackupKey, nameTime, open, seal, type BackupKey, type Manifest } from '../backup/kbak.ts';
import { compare, decodeDump, dumpCounts, dumpDatabase, dumpSchema, encodeDump, loadDump, schemaOf, tableCounts, type Exec } from '../backup/dump.ts';
import { checkReads, checkStatement, isReadSql, type DrillResult, type Param, type Query, type RecoveryPoint, type Result } from './db.ts';
import { fromCell, importStatement, NAME, NOT_IMPORTED, type Schema } from './transfer.ts';

export type StoreKind = 'tree' | 'accounts';
type Row = Record<string, unknown>;

/** What an object nobody created answers with; ./cf.ts turns it into "no tree <id>". */
export const NOT_MADE = 'kindred:not-made';
/** What an import step into an object that is not staged (any more) answers with. */
export const NOT_STAGED = 'kindred:not-staged';

/** What an object holds, for the move (./move.server.ts), and the recovery points it recorded before migrating. */
export interface StoreState { kind: StoreKind | null; staged: boolean; holds: boolean; migrations: string[]; recovery?: RecoveryPoint[] }

/** What a rollback whose bookmark cannot be restored here answers with (local workerd keeps no history). */
export const NO_PITR = 'kindred:no-pitr';
/** The most recovery points an object keeps (Cloudflare keeps 30 days of history in any case). */
const RECOVERY_KEPT = 10;

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
        const point = await this.#recoveryPoint(kind);
        this.#migrate(kind);
        if (point && kind === 'accounts') this.#recordOwnPoint(point);
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

  /** Before migrating a database that holds something: its bookmark, kept with the object's recovery points. */
  async #recoveryPoint(kind: StoreKind): Promise<RecoveryPoint | null> {
    const sql = this.ctx.storage.sql;
    sql.exec(MIGRATIONS_TABLE);
    const applied = sql.exec<{ name: string }>('SELECT name FROM d1_migrations ORDER BY name').toArray().map((r) => r.name);
    const pending = migrations[kind].filter((m) => !applied.includes(m.name));
    if (!pending.length || !applied.length) return null;
    let bookmark: string;
    try {
      bookmark = await this.ctx.storage.getCurrentBookmark();
    } catch {
      return null;
    }
    const point: RecoveryPoint = { bookmark, at: Date.now(), reason: 'migration', before: pending[0]!.name, held: applied.at(-1) ?? null };
    const kept = (await this.ctx.storage.get<RecoveryPoint[]>('recovery')) ?? [];
    await this.ctx.storage.put('recovery', [point, ...kept.filter((p) => p.bookmark !== bookmark)].slice(0, RECOVERY_KEPT));
    return point;
  }

  /** The accounts database keeps its own recovery points in its `recovery_point` table (accounts migration 0051). */
  #recordOwnPoint(p: RecoveryPoint) {
    try {
      this.ctx.storage.sql.exec(
        'INSERT INTO recovery_point (tree, bookmark, at, reason, before_migration, held_migration) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(tree, bookmark) DO NOTHING',
        ACCOUNTS_SCOPE, p.bookmark, p.at, p.reason, p.before, p.held);
    } catch {
      // Before migration 0051 there is no table; the point is still kept in the object.
    }
  }

  #env() {
    return (this.env ?? {}) as Record<string, unknown>;
  }

  #bucket(): R2Bucket {
    const b = this.#env().MEDIA as R2Bucket | undefined;
    if (!b) throw new Error('No MEDIA bucket is bound; see wrangler.jsonc');
    return b;
  }

  #key(): Promise<BackupKey> {
    const e = this.#env();
    return deriveBackupKey(backupSecret((n) => (typeof e[n] === 'string' ? (e[n] as string) : undefined)).secret);
  }

  #execAll(): Exec {
    const sql = this.ctx.storage.sql;
    return (q, ...params) => sql.exec<Row>(q, ...params).toArray().map(row);
  }

  /** A backup's database, read from the bucket and opened (decrypted and checked). */
  async #opened(scope: string, name: string) {
    const o = await this.#bucket().get(backupKey(scope, name));
    if (!o) throw new Error('The backup file is gone.');
    return open(new Uint8Array(await new Response(o.body).arrayBuffer()), await this.#key(), scope, name);
  }

  /** Backs this object's database up into the bucket as `scope`/`name` and returns the manifest and the file's size. */
  async backup(scope: string, name: string): Promise<{ manifest: Manifest; bytes: number }> {
    const kind = this.#kind;
    if (!kind || this.#staged) throw new Error(NOT_MADE);
    if ((scope === ACCOUNTS_SCOPE) !== (kind === 'accounts')) throw new Error(`This store holds the ${kind} database, not ${scope}`);
    const sql = this.ctx.storage.sql;
    const exec = this.#execAll();
    // One synchronous pass inside one transaction: nothing else runs in this object until it ends.
    const { dump, schema } = this.ctx.storage.transactionSync(() => ({
      dump: dumpDatabase(exec, (t) => sql.exec(`SELECT * FROM "${t}" LIMIT 0`).columnNames),
      schema: schemaOf(exec),
    }));
    const { bytes, manifest } = await seal({ scope, name, created: new Date(nameTime(name)).toISOString(), format: 'dump', schema, counts: dumpCounts(dump) }, encodeDump(dump), await this.#key());
    await this.#bucket().put(backupKey(scope, name), bytes, { httpMetadata: { contentType: 'application/octet-stream' } });
    return { manifest, bytes: bytes.length };
  }

  /**
   * A restore drill, in a scratch object nothing else uses: loads the backup, runs PRAGMA quick_check (the Durable Object
   * refuses integrity_check), compares the row counts and the schema with the manifest, then deletes everything it stored.
   */
  async drill(scope: string, name: string): Promise<DrillResult> {
    const check = 'quick_check' as const;
    if (this.#kind) return { ok: false, problem: 'A drill runs in a scratch object only.', check };
    try {
      const { manifest, plain } = await this.#opened(scope, name);
      if (manifest.format !== 'dump') return { ok: false, problem: `a ${manifest.format} backup cannot be loaded here`, check };
      const dump = decodeDump(plain);
      const exec = this.#execAll();
      this.ctx.storage.transactionSync(() => loadDump(exec, dump));
      const quick = exec('PRAGMA quick_check').map((r) => String(Object.values(r)[0]));
      if (quick.join() !== 'ok') return { ok: false, problem: `quick_check: ${quick.slice(0, 3).join('; ')}`, check };
      return { ok: true, problem: compare(manifest.counts, manifest.schema, tableCounts(exec), schemaOf(exec)), check };
    } catch (e) {
      return { ok: false, problem: e instanceof Error ? e.message : String(e), check };
    } finally {
      await this.ctx.storage.deleteAll();
    }
  }

  /**
   * Replaces this object's database with a family's backup, then brings it up to this deploy's schema. The caller backed the
   * family up first and passes `over` (a restore over it), or claimed the id (a restore into a new id): then an object that holds
   * anything already (a family, or an import being staged) is refused. The backup's rows and schema are checked against its
   * manifest before anything is deleted (./cf.ts ran the full drill in a scratch object before). Returns its migrations.
   */
  async restoreBackup(scope: string, name: string, over = false): Promise<string[]> {
    if (this.#kind === 'accounts' || scope === ACCOUNTS_SCOPE) throw new Error('The accounts database is restored by hand (docs/deploy-cloudflare.md, "Backups").');
    const { manifest, plain } = await this.#opened(scope, name);
    if (manifest.format !== 'dump') throw new Error(`a ${manifest.format} backup cannot be loaded into a Durable Object`);
    const dump = decodeDump(plain);
    if (!dump.objects.some((o) => o.type === 'table' && o.name === 'meta')) throw new Error('The backup holds no family.');
    const problem = compare(manifest.counts, manifest.schema, dumpCounts(dump), dumpSchema(dump));
    if (problem) throw new Error(`The backup does not pass its checks, so nothing was replaced: ${problem}`);
    return this.ctx.blockConcurrencyWhile(async () => {
      if (!over && (this.#kind || (await this.ctx.storage.get<StoreKind>('kind')))) throw new Error('This object already holds a family; only a restore over it replaces it');
      this.#kind = undefined;
      this.#staged = false;
      await this.ctx.storage.deleteAll();
      const exec = this.#execAll();
      this.ctx.storage.transactionSync(() => loadDump(exec, dump));
      this.#migrate('tree');
      await this.ctx.storage.put('kind', 'tree');
      this.#kind = 'tree';
      return this.#migrations();
    });
  }

  /** The recovery points this object recorded before it migrated, newest first. */
  async recoveryPoints(): Promise<RecoveryPoint[]> {
    return (await this.ctx.storage.get<RecoveryPoint[]>('recovery')) ?? [];
  }

  /** This object's bookmark now: the point a rollback can be undone to. */
  currentBookmark(): Promise<string> {
    return this.ctx.storage.getCurrentBookmark();
  }

  /** Restarts this object at `bookmark`: every write since is undone. The call ends with the object's reset. */
  async rollback(bookmark: string): Promise<void> {
    if (this.#kind !== 'tree') throw new Error(NOT_MADE);
    try {
      await this.ctx.storage.onNextSessionRestoreBookmark(bookmark);
    } catch (e) {
      throw new Error(`${NO_PITR}: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.ctx.abort('rolled back to a recovery point');
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
  async state(): Promise<StoreState> {
    if (!this.#kind) return { kind: null, staged: false, holds: false, migrations: [] };
    const sql = this.ctx.storage.sql;
    const holds = this.#kind === 'tree' && sql.exec<{ n: number }>('SELECT (SELECT count(*) FROM meta) + (SELECT count(*) FROM person) AS n').one().n > 0;
    return { kind: this.#kind, staged: this.#staged, holds, migrations: this.#migrations(), recovery: await this.recoveryPoints() };
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
