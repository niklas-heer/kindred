// The Node driver: node:sqlite, one file per family (data/<id>.db) and data/accounts.db, media in
// data/media/<tree>/. Files are brought up to date with migrations/ when they are opened. Never bundled
// for Workers: package.json maps `#store/driver` here by default and to ./cf.ts under `workerd`.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { checkMediaKey, checkReads, checkStatement, NOT_TREES, TREE_ID, type Db, type Driver, type MediaStore, type Param, type Query, type Result } from './db.ts';

const DATA_DEFAULT = resolve(process.cwd(), 'data');
const DATA = process.env.KINDRED_DATA_DIR ? resolve(process.env.KINDRED_DATA_DIR) : DATA_DEFAULT;
/**
 * The data folder, refused inside `node --test` when it is the repository's own data/: a test that forgets
 * KINDRED_DATA_DIR would otherwise open, migrate and write the real family files.
 */
function dataDir(): string {
  if (process.env.NODE_TEST_CONTEXT && DATA === DATA_DEFAULT) {
    throw new Error('[kindred] a test reached data/; set KINDRED_DATA_DIR to a temporary folder before importing the store');
  }
  return DATA;
}
const MIGRATIONS = resolve(process.cwd(), 'migrations');
const gazetteerPath = () => (process.env.KINDRED_GAZETTEER ? resolve(process.env.KINDRED_GAZETTEER) : join(dataDir(), 'gazetteer.db'));
const accountsPath = () => (process.env.KINDRED_ACCOUNTS_DB ? resolve(process.env.KINDRED_ACCOUNTS_DB) : join(dataDir(), 'accounts.db'));

export type Kind = 'tree' | 'accounts';

// ---------- migrations ----------

/** Wrangler's own bookkeeping table, so a file uploaded to D1 carries which migrations it has. */
const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS d1_migrations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;

/** The migration files for a kind of database, in order: migrations/<kind>/NNNN_name.sql. */
export function migrationFiles(kind: Kind): string[] {
  const dir = join(MIGRATIONS, kind);
  return readdirSync(dir).filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f)).sort();
}

/**
 * Applies every migration the file hasn't had, each in its own transaction, exactly as
 * `wrangler d1 migrations apply` does on D1 (same files, same d1_migrations table). A file that already
 * holds data is copied to backups/ next to it first.
 */
export function migrate(d: DatabaseSync, kind: Kind, path?: string) {
  d.exec(MIGRATIONS_TABLE);
  const applied = new Set((d.prepare('SELECT name FROM d1_migrations').all() as { name: string }[]).map((r) => r.name));
  const pending = migrationFiles(kind).filter((f) => !applied.has(f));
  if (!pending.length) return;
  const hasData = !!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name IN ('meta', 'user')").get();
  if (path && hasData) backup(d, path, `before-${pending[0].replace(/\.sql$/, '')}`);
  for (const name of pending) {
    d.exec('BEGIN IMMEDIATE');
    try {
      // Another process may have applied it while this one waited for the lock.
      if (!d.prepare('SELECT 1 FROM d1_migrations WHERE name = ?').get(name)) {
        d.exec(readFileSync(join(MIGRATIONS, kind, name), 'utf8'));
        if (kind === 'tree' && name.startsWith('0001_')) legacyOpColumns(d);
        d.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(name);
      }
      d.exec('COMMIT');
    } catch (e) {
      if (d.isTransaction) d.exec('ROLLBACK');
      throw new Error(`migration ${kind}/${name} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}

/** Files from before the retry keys were bound to a person have an op table without these columns. */
function legacyOpColumns(d: DatabaseSync) {
  const cols = new Set((d.prepare('PRAGMA table_info(op)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('user')) d.exec('ALTER TABLE op ADD COLUMN user TEXT');
  if (!cols.has('fingerprint')) d.exec('ALTER TABLE op ADD COLUMN fingerprint TEXT');
}

function backup(d: DatabaseSync, path: string, why: string) {
  const dir = join(dirname(path), 'backups');
  mkdirSync(dir, { recursive: true });
  // Fold the write-ahead log in first, so the copy is complete.
  d.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const name = path.split('/').pop()!.replace(/\.db$/, '');
  const to = join(dir, `${name}-${why}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  copyFileSync(path, to);
  console.log(`[kindred] ${path}: backed up to ${to} before migrating`);
}

/** Opens a SQLite file with the app's settings and brings it up to date. Scripts use this too. */
export function openSqlite(path: string, kind: Kind, opts: { create?: boolean } = {}): DatabaseSync {
  if (!opts.create && !existsSync(path)) throw new Error(`no database at ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  const d = new DatabaseSync(path);
  d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  migrate(d, kind, path);
  return d;
}

// ---------- the Db interface over node:sqlite ----------

const isTransactionControl = (sql: string) => /^\s*(BEGIN|COMMIT|ROLLBACK|END)\b/i.test(sql);

export function wrap(d: DatabaseSync): Db {
  const cache = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  const prepare = (sql: string) => {
    if (isTransactionControl(sql)) throw new Error('Use batch() for transactions');
    let s = cache.get(sql);
    if (!s) {
      s = d.prepare(sql);
      if (cache.size > 500) cache.clear();
      cache.set(sql, s);
    }
    return s;
  };
  const args = (params: Param[]) => params as SQLInputValue[];
  const checked = (sql: string, params: Param[]) => {
    checkStatement(sql, params);
    return prepare(sql);
  };
  const exec = (sql: string, params: Param[]): Result => {
    const s = checked(sql, params);
    if (s.columns().length) {
      // A SELECT, or a write with RETURNING.
      const rows = s.all(...args(params)) as Record<string, unknown>[];
      const isRead = /^\s*(SELECT|WITH|PRAGMA|VALUES)\b/i.test(sql);
      const last = d.prepare('SELECT last_insert_rowid() AS id').get() as { id: number };
      return { rows, changes: isRead ? 0 : rows.length, lastRowId: Number(last.id) };
    }
    const r = s.run(...args(params));
    return { rows: [], changes: Number(r.changes), lastRowId: Number(r.lastInsertRowid) };
  };
  return {
    async all<R>(sql: string, ...params: Param[]) {
      return checked(sql, params).all(...args(params)) as R[];
    },
    async get<R>(sql: string, ...params: Param[]) {
      return checked(sql, params).get(...args(params)) as R | undefined;
    },
    async run(sql: string, ...params: Param[]) {
      return exec(sql, params);
    },
    async batch(queries: Query[]) {
      // Synchronous from BEGIN to COMMIT: nothing else in this process runs in between, and other
      // processes wait for the write lock (busy_timeout).
      d.exec('BEGIN IMMEDIATE');
      try {
        const out = queries.map((x) => exec(x.sql, x.params));
        d.exec('COMMIT');
        return out;
      } catch (e) {
        if (d.isTransaction) d.exec('ROLLBACK');
        throw e;
      }
    },
    async readBatch(queries: Query[]) {
      checkReads(queries);
      if (!queries.length) return [];
      // A read transaction, so the reads see one moment, as a D1 batch does; it takes no write lock.
      d.exec('BEGIN');
      try {
        const out = queries.map((x) => checked(x.sql, x.params).all(...args(x.params)) as Record<string, unknown>[]);
        d.exec('COMMIT');
        return out;
      } catch (e) {
        if (d.isTransaction) d.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

// ---------- media in data/media/<tree>/ ----------

const mediaFile = (tree: string, key: string) => {
  checkMediaKey(tree, key);
  return join(dataDir(), 'media', tree, key);
};

export function putMediaSync(tree: string, key: string, bytes: Uint8Array) {
  const file = mediaFile(tree, key);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

const media: MediaStore = {
  async put(tree, key, bytes) {
    putMediaSync(tree, key, bytes);
  },
  async get(tree, key) {
    const file = mediaFile(tree, key);
    if (!existsSync(file)) return undefined;
    const body = new Uint8Array(readFileSync(file));
    return { body, size: statSync(file).size };
  },
  async delete(tree, key) {
    rmSync(mediaFile(tree, key), { force: true });
  },
  async deleteTree(tree) {
    if (!TREE_ID.test(tree) || NOT_TREES.has(tree)) throw new Error(`bad tree id ${tree}`);
    rmSync(join(dataDir(), 'media', tree), { recursive: true, force: true });
  },
};

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
export const mediaExt = (mime: string) => EXT[mime] ?? 'bin';

/**
 * Pictures saved before media storage (migration 0002) are still in the photo table: write each one to
 * media storage, then point the row at it and drop the bytes. Safe to stop half-way and run again.
 */
export function movePhotosOut(d: DatabaseSync, tree: string, put: (key: string, bytes: Uint8Array) => void = (key, bytes) => putMediaSync(tree, key, bytes)) {
  const rows = d.prepare('SELECT person, mime FROM photo WHERE key IS NULL AND data IS NOT NULL').all() as { person: string; mime: string }[];
  for (const r of rows) {
    const { data } = d.prepare('SELECT data FROM photo WHERE person = ?').get(r.person) as { data: Uint8Array };
    const key = `photo/${crypto.randomUUID()}.${mediaExt(r.mime)}`;
    put(key, data);
    d.prepare('UPDATE photo SET key = ?, data = NULL WHERE person = ? AND key IS NULL').run(key, r.person);
  }
  return rows.length;
}

// ---------- the driver ----------

const g = globalThis as unknown as { __kindredAccounts?: { path: string; d: DatabaseSync } };
/** Which family an open connection belongs to, so dropping the family closes it. */
const DB_ID = Symbol('kindred.tree');
const trees = new Map<string, Db>();
let accountsDb: { d: DatabaseSync; db: Db } | undefined;
let gazetteerDb: Db | null = null;
/** Every connection this process has open, so a shutdown can close them all (closeDatabases). */
const open = new Set<DatabaseSync>();

const driver: Driver = {
  name: 'node',
  keepAlive() {},

  tree(id) {
    if (!TREE_ID.test(id) || NOT_TREES.has(id)) throw new Error(`bad tree id ${id}`);
    let db = trees.get(id);
    if (!db) {
      const path = join(dataDir(), `${id}.db`);
      if (!existsSync(path)) throw new Error(`no tree ${id}; run mise run seed`);
      const d = openSqlite(path, 'tree');
      (d as unknown as { [k: symbol]: unknown })[DB_ID] = id;
      open.add(d);
      movePhotosOut(d, id);
      db = wrap(d);
      trees.set(id, db);
    }
    return db;
  },

  ensureTree(id) {
    if (!TREE_ID.test(id) || NOT_TREES.has(id)) throw new Error(`bad tree id ${id}`);
    const path = join(dataDir(), `${id}.db`);
    if (!trees.has(id) && !existsSync(path)) openSqlite(path, 'tree', { create: true }).close();
    return driver.tree(id);
  },

  async dropTree(id) {
    if (!TREE_ID.test(id) || NOT_TREES.has(id)) throw new Error(`bad tree id ${id}`);
    const path = join(dataDir(), `${id}.db`);
    trees.delete(id);
    // The open connection first, so its write-ahead log is folded in and nothing writes to the file after it is gone.
    for (const d of open) {
      if ((d as unknown as { [k: symbol]: unknown })[DB_ID] === id) {
        try { d.close(); } catch {}
        open.delete(d);
      }
    }
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
  },

  treeIds() {
    if (!existsSync(dataDir())) return [];
    return readdirSync(dataDir())
      .filter((f) => f.endsWith('.db'))
      .map((f) => f.slice(0, -3))
      .filter((id) => TREE_ID.test(id) && !NOT_TREES.has(id));
  },

  // One connection per process, kept across dev hot reloads. Reopened if the file is deleted (a reset)
  // or KINDRED_ACCOUNTS_DB points elsewhere (tests).
  accounts() {
    const path = accountsPath();
    const had = g.__kindredAccounts;
    if (had && (had.path !== path || !existsSync(path))) {
      try { had.d.close(); } catch {}
      open.delete(had.d);
      g.__kindredAccounts = undefined;
    }
    if (!g.__kindredAccounts) {
      const d = openSqlite(path, 'accounts', { create: true });
      open.add(d);
      g.__kindredAccounts = { path, d };
    }
    const { d } = g.__kindredAccounts;
    if (accountsDb?.d !== d) accountsDb = { d, db: wrap(d) };
    return accountsDb.db;
  },

  /** The offline gazetteer (scripts/gazetteer.ts), or null until it has been built. Checked again on each call until it exists. */
  gazetteer() {
    if (gazetteerDb) return gazetteerDb;
    const GAZETTEER = gazetteerPath();
    if (!existsSync(GAZETTEER)) return null;
    try {
      const d = new DatabaseSync(GAZETTEER, { readOnly: true });
      d.prepare('SELECT 1 FROM name LIMIT 1').get();
      open.add(d);
      gazetteerDb = wrap(d);
    } catch {
      gazetteerDb = null;
    }
    return gazetteerDb;
  },

  media,

  // Kept in the data folder, beside the family files: back it up with them, and never commit it.
  secret() {
    const fromEnv = process.env.KINDRED_SECRET?.trim();
    if (fromEnv) return fromEnv;
    const file = join(dataDir(), 'secret');
    if (existsSync(file)) return readFileSync(file, 'utf8').trim();
    mkdirSync(dataDir(), { recursive: true });
    const fresh = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
    try {
      writeFileSync(file, `${fresh}\n`, { mode: 0o600, flag: 'wx' });
      return fresh;
    } catch (e) {
      // Another request made it first: use theirs.
      if ((e as { code?: string }).code === 'EEXIST') return readFileSync(file, 'utf8').trim();
      throw e;
    }
  },
};

/** Closes the accounts connection (tests). */
export function closeAccounts() {
  try { g.__kindredAccounts?.d.close(); } catch {}
  g.__kindredAccounts = undefined;
  accountsDb = undefined;
}

/**
 * Closes every SQLite connection this process has open: the families, the accounts and the gazetteer.
 * server/node.ts calls it on SIGTERM, after the last request has finished, so each file is closed cleanly
 * (its write-ahead log is folded in). The next call to the driver opens them again.
 */
export function closeDatabases() {
  for (const d of open) {
    try { d.close(); } catch {}
  }
  open.clear();
  trees.clear();
  accountsDb = undefined;
  g.__kindredAccounts = undefined;
  gazetteerDb = null;
}

// The Node server bundle contains its own copy of this module, so server/node.ts finds the close by name.
(globalThis as unknown as Record<symbol, () => void>)[Symbol.for('kindred.closeDatabases')] = closeDatabases;

export default driver;
