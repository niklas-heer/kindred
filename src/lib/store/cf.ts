// The Cloudflare driver: each family in its own Durable Object or in a D1 database, the accounts in a Durable Object or
// D1, R2 for media. Bindings (wrangler.jsonc):
//   FAMILIES       Durable Objects (class FamilyStore, ./durable.ts, SQLite storage): one per family, made on demand
//                  (`ensureTree`), and the accounts when no ACCOUNTS database is bound. The families made here are listed
//                  in the accounts database's `family_store` table. KINDRED_JURISDICTION=eu keeps them all in the EU.
//   TREE_<ID>      D1, optional: a family's database, as before Durable Objects (migrations/tree). A family with a binding
//                  is served from it, whether or not FAMILIES is bound; TREE_FAMILY serves /family, TREE_MY_FAMILY /my-family.
//   ACCOUNTS       D1, optional when FAMILIES is bound: the accounts database (migrations/accounts)
//   MEDIA          R2, uploaded files under <tree>/<key>
//   GAZETTEER      D1, optional: the GeoNames towns for assisted place entry, read-only (migrations/gazetteer,
//                  loaded by `mise run cf:gazetteer`). Without it the place picker offers the family's own places.
import { env, waitUntil } from 'cloudflare:workers';
import { checkMediaKey, checkReads, checkStatement, emptyDatabase, NOT_TREES, q, TREE_ID, type BackupStore, type Db, type DrillResult, type Driver, type ImportTarget, type Param, type Query, type RecoveryPoint, type Result } from './db.ts';
import { NO_PITR, NOT_MADE, type StoreKind, type StoreState } from './durable.ts';
import { forgetReports, migrationError, reportRecovery, reportSchema } from './schema-report.ts';
import { ACCOUNTS_SCOPE, backupKey, type Manifest } from '../backup/kbak.ts';

const isD1 = (v: unknown): v is D1Database => !!v && typeof (v as D1Database).prepare === 'function' && typeof (v as D1Database).batch === 'function';

/** The binding that holds a tree: `my-family` → TREE_MY_FAMILY. */
export const treeBinding = (tree: string) => `TREE_${tree.toUpperCase().replace(/-/g, '_')}`;

/** D1 returns a BLOB as an array of numbers; every other value in a row is a scalar, so an array can only be a BLOB. */
function row<R>(r: R): R {
  const values = r as Record<string, unknown>;
  for (const k in values) if (Array.isArray(values[k])) values[k] = Uint8Array.from(values[k] as number[]);
  return r;
}

function wrap(d1: D1Database): Db {
  const stmt = (sql: string, params: Param[]) => {
    checkStatement(sql, params);
    return d1.prepare(sql).bind(...params);
  };
  const result = (r: D1Result): Result => ({ rows: (r.results ?? []).map(row), changes: r.meta?.changes ?? 0, lastRowId: r.meta?.last_row_id ?? 0 });
  return {
    async all<R>(sql: string, ...params: Param[]) {
      return (await stmt(sql, params).all<R>()).results.map(row);
    },
    async get<R>(sql: string, ...params: Param[]) {
      const r = await stmt(sql, params).first<R>();
      return r ? row(r) : undefined;
    },
    async run(sql: string, ...params: Param[]) {
      return result(await stmt(sql, params).run());
    },
    async batch(queries: Query[]) {
      if (!queries.length) return [];
      return (await d1.batch(queries.map((x) => stmt(x.sql, x.params)))).map(result);
    },
    // One batch is one round trip, and D1 runs it as one transaction: the reads see one moment.
    async readBatch(queries: Query[]) {
      checkReads(queries);
      if (!queries.length) return [];
      return (await d1.batch(queries.map((x) => stmt(x.sql, x.params)))).map((r) => (r.results ?? []).map(row) as Record<string, unknown>[]);
    },
  };
}

const wrapped = new WeakMap<D1Database, Db>();
const db = (d1: D1Database) => {
  let w = wrapped.get(d1);
  if (!w) wrapped.set(d1, (w = wrap(d1)));
  return w;
};

// ---------- Durable Objects ----------

type Row = Record<string, unknown>;
/** The FamilyStore's methods as RPC sees them (./durable.ts). */
interface StoreStub {
  create(kind: StoreKind): Promise<string[]>;
  made(): Promise<StoreKind | null>;
  drop(): Promise<void>;
  all(sql: string, params: Param[]): Promise<Row[]>;
  get(sql: string, params: Param[]): Promise<Row | undefined>;
  run(sql: string, params: Param[]): Promise<Result>;
  batch(queries: Query[]): Promise<Result[]>;
  readBatch(queries: Query[]): Promise<Row[][]>;
  state(): Promise<StoreState>;
  stage(): Promise<string[]>;
  stagedSchema(): Promise<[string, string[]][]>;
  stagedRows(table: string, columns: string[], rows: unknown[][]): Promise<number>;
  stagedCounts(tables: string[]): Promise<{ counts: Record<string, number>; id: string | null }>;
  publish(): Promise<void>;
  backup(scope: string, name: string): Promise<{ manifest: Manifest; bytes: number }>;
  drill(scope: string, name: string): Promise<DrillResult>;
  restoreBackup(scope: string, name: string, over: boolean): Promise<string[]>;
  recoveryPoints(): Promise<RecoveryPoint[]>;
  currentBookmark(): Promise<string>;
  rollback(bookmark: string): Promise<void>;
}

/** The driver a family made here is recorded under in `family_store` (accounts migration 0033). */
export const DURABLE = 'durable-object';
/** Where Cloudflare may keep the Durable Objects. Only `eu` and `fedramp` exist; it must be chosen before the first family. */
const JURISDICTIONS = new Set(['eu', 'fedramp']);

/** The FAMILIES namespace, in KINDRED_JURISDICTION when set; undefined when it is not bound. */
function namespace(): DurableObjectNamespace<StoreStub> | undefined {
  const ns = env.FAMILIES as DurableObjectNamespace<StoreStub> | undefined;
  if (!ns || typeof ns.idFromName !== 'function') return undefined;
  const j = String((env as Record<string, unknown>).KINDRED_JURISDICTION ?? '').trim().toLowerCase();
  if (!j) return ns;
  if (!JURISDICTIONS.has(j)) throw new Error(`KINDRED_JURISDICTION must be eu, fedramp or empty, not "${j}"`);
  try {
    return ns.jurisdiction(j);
  } catch (e) {
    // Local workerd (mise run dev:cf, the tests) has no jurisdictions; everything is on this machine anyway.
    if (/not implemented in workerd/i.test(e instanceof Error ? e.message : String(e))) return ns;
    throw e;
  }
}

/** The object that holds a family (`tree:<id>`) or the accounts (`accounts`). A stub belongs to one request, so each call makes its own. */
const objectName = (tree: string | null) => (tree === null ? 'accounts' : `tree:${tree}`);
function stub(name: string): StoreStub {
  const ns = namespace();
  if (!ns) throw new Error('No FAMILIES Durable Object namespace is bound; see wrangler.jsonc');
  return ns.get(ns.idFromName(name));
}

/** The accounts object makes itself on first use; this isolate remembers that it has asked once. */
let accountsMade = false;

/**
 * Where the Durable Objects were first made, kept in the MEDIA bucket (`.kindred/store.json`, never a family's key: those
 * start with a tree id). The same name in another jurisdiction is another, empty object, so a changed KINDRED_JURISDICTION
 * would hide every family and the accounts, and open /setup to whoever comes first. It is refused instead, before any object
 * is reached. Checked once per isolate once the marker is there.
 *
 * The marker is written only when something worth keeping is made (`mark`): the first account (setup, `markPlace`), a
 * family's object (`ensureTree`) or an import (`importTarget().stage`). A visit to a fresh site (a scanner on workers.dev)
 * writes nothing, so the jurisdiction can still be set until the site is set up.
 */
const PLACE_KEY = '.kindred/store.json';
let placeChecked = false;
async function checkPlace(mark = false) {
  if (placeChecked) return;
  const b = env.MEDIA as R2Bucket | undefined;
  if (!b) {
    placeChecked = true;
    return;
  }
  const here = String((env as Record<string, unknown>).KINDRED_JURISDICTION ?? '').trim().toLowerCase() || 'default';
  const held = await b.get(PLACE_KEY);
  if (held) {
    const was = (JSON.parse(await new Response(held.body).text()) as { jurisdiction?: string }).jurisdiction ?? 'default';
    if (was !== here) throw new Error(`The families were made with KINDRED_JURISDICTION=${was === 'default' ? '(empty)' : was}, and this Worker has ${here === 'default' ? '(empty)' : here}. A jurisdiction cannot be changed: set it back.`);
    placeChecked = true;
  } else if (mark) {
    await b.put(PLACE_KEY, JSON.stringify({ jurisdiction: here, since: new Date().toISOString() }), { httpMetadata: { contentType: 'application/json' } });
    placeChecked = true;
  }
}

/**
 * A database in a Durable Object, as a `Db`. A family that was never made answers "no tree <id>". The accounts object is
 * made on first use (`create` is idempotent and cheap after the first time).
 */
function durableDb(tree: string | null): Db {
  const name = objectName(tree);
  const call = async <T>(work: (s: StoreStub) => Promise<T>): Promise<T> => {
    await checkPlace();
    const s = stub(name);
    if (tree === null && !accountsMade) {
      await s.create('accounts');
      accountsMade = true;
    }
    try {
      const result = await work(s);
      // The first answer in this isolate: tell the Health tab which schema the family holds now (./schema-report.ts).
      if (tree !== null && !reportedHere.has(tree)) {
        reportedHere.add(tree);
        const st = await s.state().catch(() => null);
        const held = st?.migrations.at(-1) ?? null;
        if (held) await reportSchema(() => driver.accounts(), tree, held, null);
        // The recovery points it took before migrating, for the console (src/lib/backup/backup.server.ts).
        if (st?.recovery?.length) await reportRecovery(() => driver.accounts(), tree, st.recovery);
      }
      return result;
    } catch (e) {
      if (e instanceof Error && e.message.includes(NOT_MADE)) throw new Error(`no tree ${tree}; make it first (store.ensureTree)`);
      const error = tree === null ? null : migrationError(e);
      if (error) await reportSchema(() => driver.accounts(), tree!, null, error);
      throw e;
    }
  };
  return {
    all: <R>(sql: string, ...params: Param[]) => call((s) => s.all(sql, params)) as Promise<R[]>,
    get: <R>(sql: string, ...params: Param[]) => call((s) => s.get(sql, params)) as Promise<R | undefined>,
    run: (sql: string, ...params: Param[]) => call((s) => s.run(sql, params)),
    batch: (queries: Query[]) => call((s) => s.batch(queries.map((x) => ({ sql: x.sql, params: x.params })))),
    readBatch: (queries: Query[]) => call((s) => s.readBatch(queries.map((x) => ({ sql: x.sql, params: x.params })))),
  };
}

/** The families whose schema this isolate has reported (once each). */
const reportedHere = new Set<string>();

/** One `Db` per object name for this isolate, so the store's guard (./index.ts) wraps each once. */
const durables = new Map<string, Db>();
const durable = (tree: string | null) => {
  const name = objectName(tree);
  let d = durables.get(name);
  if (!d) durables.set(name, (d = durableDb(tree)));
  return d;
};

/** The families bound as D1 databases: TREE_<ID>. */
const boundTrees = () =>
  Object.keys(env)
    .filter((k) => /^TREE_[A-Z0-9_]+$/.test(k) && isD1(env[k]))
    .map((k) => k.slice(5).toLowerCase().replace(/_/g, '-'))
    .filter((id) => TREE_ID.test(id) && !NOT_TREES.has(id));

const checkId = (id: string) => {
  if (!TREE_ID.test(id) || NOT_TREES.has(id)) throw new Error(`bad tree id ${id}`);
};

// ---------- R2 ----------

const bucket = () => {
  const b = env.MEDIA as R2Bucket | undefined;
  if (!b) throw new Error('No MEDIA bucket is bound; see wrangler.jsonc');
  return b;
};

// ---------- backups ----------

/**
 * The automatic backups (src/lib/backup/): made by each Durable Object itself into MEDIA under `_backups/<scope>/`, a prefix no
 * family id or media key can start with (ids are lower-case letters, digits and dashes). A family in a bound D1 database, and
 * accounts in ACCOUNTS, are left to D1 Time Travel (`wrangler d1 time-travel`).
 */
const backups: BackupStore = {
  where: 'r2',
  covers(scope) {
    if (scope === ACCOUNTS_SCOPE) return isD1(env.ACCOUNTS) ? 'd1' : namespace() ? 'backup' : 'none';
    if (!TREE_ID.test(scope) || NOT_TREES.has(scope)) return 'none';
    return isD1(env[treeBinding(scope)]) ? 'd1' : namespace() ? 'backup' : 'none';
  },
  async take(scope, name) {
    if (backups.covers(scope) !== 'backup') throw new Error(`${scope} is not kept in a Durable Object here`);
    await checkPlace();
    return stub(objectName(scope === ACCOUNTS_SCOPE ? null : scope)).backup(scope, name);
  },
  async read(scope, name) {
    const o = await bucket().get(backupKey(scope, name));
    return o ? new Uint8Array(await new Response(o.body).arrayBuffer()) : undefined;
  },
  async write(scope, name, bytes) {
    await bucket().put(backupKey(scope, name), bytes);
  },
  async remove(scope, name) {
    await bucket().delete(backupKey(scope, name));
  },
  // A scratch object, named so that no family and not the accounts can ever be it; it deletes what it stored when done.
  async drill(scope, name) {
    backupKey(scope, name);
    return stub(`drill:${crypto.randomUUID()}`).drill(scope, name);
  },
  async restore(scope, name, into, opts) {
    checkId(into);
    if (isD1(env[treeBinding(into)])) throw new Error(`${into} is served by a bound D1 database: restore it with D1 Time Travel`);
    await checkPlace(true);
    // The drill first, in a scratch object: a backup that does not load and match its manifest replaces nothing.
    const drill = await stub(`drill:${crypto.randomUUID()}`).drill(scope, name);
    if (!drill.ok || drill.problem) throw new Error(`The backup does not pass its checks, so nothing was replaced: ${drill.problem ?? 'failed'}`);
    await stub(objectName(into)).restoreBackup(scope, name, opts?.over === true);
    reportedHere.delete(into);
    forgetReports(into);
    return q('INSERT INTO family_store (tree, driver, created_at) VALUES (?, ?, ?) ON CONFLICT(tree) DO NOTHING', into, DURABLE, new Date().toISOString());
  },
  recovery: {
    async points(tree) {
      checkId(tree);
      if (backups.covers(tree) !== 'backup') return [];
      await checkPlace();
      return stub(objectName(tree)).recoveryPoints();
    },
    async rollback(tree, bookmark) {
      checkId(tree);
      if (backups.covers(tree) !== 'backup') throw new Error(`${tree} is not kept in a Durable Object here`);
      await checkPlace();
      const undo = await stub(objectName(tree)).currentBookmark();
      try {
        await stub(objectName(tree)).rollback(bookmark);
      } catch (e) {
        // The object resets itself once the bookmark is set: that ends the call with an error, which is the rollback working.
        if (e instanceof Error && e.message.includes(NO_PITR)) throw e;
      }
      reportedHere.delete(tree);
      forgetReports(tree);
      return undo;
    },
  },
};

const driver: Driver = {
  name: 'cloudflare',

  // A bound D1 database wins, so an install from before Durable Objects keeps serving its families from D1 unchanged.
  tree(id) {
    checkId(id);
    const d1 = env[treeBinding(id)];
    if (isD1(d1)) return db(d1);
    if (namespace()) return durable(id);
    throw new Error(`no tree ${id}; bind a D1 database as ${treeBinding(id)}, or bind the FAMILIES Durable Objects`);
  },

  canMakeTree(id) {
    if (id === undefined) return !!namespace();
    return TREE_ID.test(id) && !NOT_TREES.has(id) && (isD1(env[treeBinding(id)]) || !!namespace());
  },

  // A D1 database must already be bound (docs/deploy-cloudflare.md): nothing can be created there. A Durable Object is made
  // here, its schema applied, and the family recorded in `family_store`, so treeIds lists it from now on.
  async ensureTree(id) {
    checkId(id);
    if (isD1(env[treeBinding(id)]) || !namespace()) return driver.tree(id);
    await checkPlace(true);
    await stub(objectName(id)).create('tree');
    await driver.accounts().run('INSERT INTO family_store (tree, driver, created_at) VALUES (?, ?, ?) ON CONFLICT(tree) DO NOTHING', id, DURABLE, new Date().toISOString());
    return durable(id);
  },

  // An import into the family's Durable Object (src/lib/store/move.server.ts): staged, so it serves nothing until published,
  // whether or not a D1 binding serves the family now. Nothing is made until `stage`.
  importTarget(id) {
    checkId(id);
    if (!namespace()) throw new Error('No FAMILIES Durable Object namespace is bound; see wrangler.jsonc');
    const call = async <T>(work: (s: StoreStub) => Promise<T>, mark = false): Promise<T> => {
      await checkPlace(mark);
      return work(stub(objectName(id)));
    };
    const target: ImportTarget = {
      serving: !isD1(env[treeBinding(id)]),
      state: () => call((s) => s.state()),
      stage: () => call((s) => s.stage(), true),
      schema: () => call((s) => s.stagedSchema()),
      rows: (table, columns, rows) => call((s) => s.stagedRows(table, columns, rows)),
      counts: (tables) => call((s) => s.stagedCounts(tables)),
      publish: () => call((s) => s.publish()),
      register: q('INSERT INTO family_store (tree, driver, created_at) VALUES (?, ?, ?) ON CONFLICT(tree) DO NOTHING', id, DURABLE, new Date().toISOString()),
    };
    return target;
  },

  async markPlace() {
    if (namespace()) await checkPlace(true);
  },

  // A bound D1 database cannot be removed from inside the Worker: it is emptied, and stays bound for a family to come. A
  // Durable Object deletes everything it stores, and the family leaves the registry.
  // A copy a move into a Durable Object left beside a bound D1 database goes too (published or still staged), or the family
  // would still be listed, or its rows kept.
  async dropTree(id) {
    checkId(id);
    if (isD1(env[treeBinding(id)]) || !namespace()) {
      await emptyDatabase(driver.tree(id));
      if (!namespace()) return;
    }
    await checkPlace();
    await stub(objectName(id)).drop();
    await driver.accounts().batch([q('DELETE FROM family_store WHERE tree = ?', id)]).catch((e: unknown) => {
      // Accounts in D1 from before migration 0033 list no Durable Object families.
      if (!/no such table: family_store/i.test(e instanceof Error ? e.message : String(e))) throw e;
    });
  },

  // The bound D1 families and the families made as Durable Objects. Before accounts migration 0033 there is no registry yet.
  async treeIds() {
    const bound = boundTrees();
    if (!namespace()) return bound;
    let made: string[];
    try {
      made = (await driver.accounts().all<{ tree: string }>('SELECT tree FROM family_store WHERE driver = ? ORDER BY tree', DURABLE)).map((r) => r.tree);
    } catch (e) {
      if (/no such table: family_store/i.test(e instanceof Error ? e.message : String(e))) return bound;
      throw e;
    }
    return [...new Set([...bound, ...made])].filter((id) => TREE_ID.test(id) && !NOT_TREES.has(id));
  },

  // ACCOUNTS (D1) when bound, as before Durable Objects; otherwise the accounts Durable Object, made on first use.
  accounts() {
    const d1 = env.ACCOUNTS;
    if (isD1(d1)) return db(d1);
    if (namespace()) return durable(null);
    throw new Error('No ACCOUNTS database is bound, nor the FAMILIES Durable Objects; see wrangler.jsonc');
  },

  // Read-only: the gazetteer is only ever searched. A write through it is refused, never sent to D1.
  gazetteer() {
    const g = env.GAZETTEER;
    if (!isD1(g)) return null;
    const d = db(g);
    const refuse = async (): Promise<never> => {
      throw new Error('The gazetteer is read-only');
    };
    return { all: d.all.bind(d), get: d.get.bind(d), readBatch: d.readBatch.bind(d), run: refuse, batch: refuse };
  },

  keepAlive(work) {
    waitUntil(work);
  },

  backups,

  secret() {
    const s = (env as Record<string, unknown>).KINDRED_SECRET;
    if (typeof s !== 'string' || !s.trim()) throw new Error('KINDRED_SECRET is not set. Add it as a Worker secret.');
    return s.trim();
  },

  media: {
    async put(tree, key, bytes, mime) {
      checkMediaKey(tree, key);
      await bucket().put(`${tree}/${key}`, bytes, { httpMetadata: { contentType: mime } });
    },
    async get(tree, key) {
      checkMediaKey(tree, key);
      const o = await bucket().get(`${tree}/${key}`);
      return o ? { body: o.body, size: o.size, mime: o.httpMetadata?.contentType } : undefined;
    },
    async delete(tree, key) {
      checkMediaKey(tree, key);
      await bucket().delete(`${tree}/${key}`);
    },
    // R2 lists at most 1000 keys at a time, with each object's size, and deletes as many in one call.
    async list(tree) {
      if (!TREE_ID.test(tree) || NOT_TREES.has(tree)) throw new Error(`bad tree id ${tree}`);
      const found: { key: string; size: number }[] = [];
      for (let cursor: string | undefined, more = true; more; ) {
        const page = await bucket().list({ prefix: `${tree}/`, cursor, limit: 1000 });
        for (const o of page.objects) found.push({ key: o.key.slice(tree.length + 1), size: o.size });
        more = page.truncated;
        cursor = page.truncated ? page.cursor : undefined;
      }
      return found;
    },
    async deleteTree(tree) {
      if (!TREE_ID.test(tree) || NOT_TREES.has(tree)) throw new Error(`bad tree id ${tree}`);
      for (let cursor: string | undefined, more = true; more; ) {
        const page = await bucket().list({ prefix: `${tree}/`, cursor, limit: 1000 });
        if (page.objects.length) await bucket().delete(page.objects.map((o) => o.key));
        more = page.truncated;
        cursor = page.truncated ? page.cursor : undefined;
      }
    },
  },
};

export default driver;
