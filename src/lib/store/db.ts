// The data-access interface every server function uses. Two drivers implement it: node:sqlite on Node
// (./node.ts: one SQLite file per tree, data/accounts.db) and Cloudflare D1 on Workers (./cf.ts). Its
// shape is D1's: async reads, single statements, and `batch()`, which runs several statements as one
// atomic transaction. There are no interactive transactions (read, decide, write while holding a lock),
// because D1 has none; see `commit` in ../db.server.ts for how changes stay safe without them.

export type Param = string | number | null | Uint8Array;

/** One statement and its parameters, for `batch()`. */
export interface Query { sql: string; params: Param[] }
export const q = (sql: string, ...params: Param[]): Query => ({ sql, params });

export interface Result<R = Record<string, unknown>> {
  /** Rows from a SELECT, or from a write with RETURNING. */
  rows: R[];
  /** Rows a write changed (0 for a SELECT). */
  changes: number;
  lastRowId: number;
}

export interface Db {
  all<R = Record<string, unknown>>(sql: string, ...params: Param[]): Promise<R[]>;
  get<R = Record<string, unknown>>(sql: string, ...params: Param[]): Promise<R | undefined>;
  run(sql: string, ...params: Param[]): Promise<Result>;
  /** Runs the statements in order as one transaction: all of them, or none if any fails. */
  batch(queries: Query[]): Promise<Result[]>;
  /**
   * Runs independent reads together and returns each one's rows, in order. On D1 that is one round trip instead of one per
   * read, and they see one moment of the database on both drivers. Reads only: a statement that is not a SELECT (or WITH)
   * is refused before anything runs. Use it where a page needs several reads that do not depend on each other.
   */
  readBatch(queries: Query[]): Promise<Record<string, unknown>[][]>;
}

/**
 * Whether a statement only reads: a SELECT, or a WITH whose statement is a SELECT. A WITH that ends in INSERT, UPDATE,
 * DELETE or REPLACE, or anything with RETURNING, writes. Errs on the side of "writes": a word like that inside a string
 * literal of a read makes it count as a write, which only refuses it, never lets a write through.
 */
export const isReadSql = (sql: string) => /^\s*SELECT\b/i.test(sql) || (/^\s*WITH\b/i.test(sql) && !/\b(INSERT|UPDATE|DELETE|REPLACE\s+INTO|RETURNING)\b/i.test(sql));

/** Refuses anything but a read in `readBatch`, on both drivers alike. */
export function checkReads(queries: Query[]) {
  for (const x of queries) if (!isReadSql(x.sql)) throw new Error(`readBatch runs reads only: ${x.sql.slice(0, 120)}`);
}

/** D1's limits on one statement, also inside a batch (developers.cloudflare.com/d1/platform/limits). */
export const MAX_BOUND_PARAMS = 100;
export const MAX_SQL_LENGTH = 100_000;

/**
 * Both drivers refuse a statement D1 would refuse, because local D1 and node:sqlite accept more and a query that only
 * fails once deployed is found by a family, not a test. For a list of any length, bind one JSON parameter:
 * `WHERE id IN (SELECT value FROM json_each(?))`.
 */
export function checkStatement(sql: string, params: Param[]) {
  if (params.length > MAX_BOUND_PARAMS) throw new Error(`A statement has ${params.length} bound parameters; D1 allows ${MAX_BOUND_PARAMS}: ${sql.slice(0, 120)}`);
  if (sql.length > MAX_SQL_LENGTH) throw new Error(`A statement is ${sql.length} characters long; D1 allows ${MAX_SQL_LENGTH}: ${sql.slice(0, 120)}`);
}

// ---------- guards ----------
//
// A guard is a statement in a batch that aborts the whole batch unless a condition holds:
//   INSERT INTO guard (ok) SELECT <condition>
// `guard` is a view whose INSTEAD OF trigger raises when ok is not 1 (migrations 0002 for trees and
// accounts). Server code reads, checks and decides, then sends its writes in a batch that starts with
// guards restating what the decision relied on ("the anchor still has one parent", "nobody has an
// account yet"). If another request changed any of it in between, the batch writes nothing and the
// caller decides again with fresh reads.

export const GUARD_MESSAGE = 'kindred:guard';

/** A batch statement that aborts the batch unless `condition` (an SQL expression) is true. */
export const guard = (condition: string, ...params: Param[]): Query => q(`INSERT INTO guard (ok) SELECT CASE WHEN (${condition}) THEN 1 ELSE 0 END`, ...params);

/** Whether a statement of a batch is a guard, which checks something and writes nothing. */
export const isGuard = (query: Query) => query.sql.startsWith('INSERT INTO guard ');

/** Whether a failed batch was stopped by a guard. */
export const isGuardError = (e: unknown) => e instanceof Error && (e.message.includes(GUARD_MESSAGE) || String((e as { cause?: unknown }).cause ?? '').includes(GUARD_MESSAGE));

/** Whether a failed batch broke a UNIQUE or PRIMARY KEY constraint. */
export const isUniqueError = (e: unknown) => e instanceof Error && /UNIQUE constraint failed|PRIMARY KEY/i.test(`${e.message} ${String((e as { cause?: unknown }).cause ?? '')}`);

/** A media object's body: bytes on Node, a stream from R2. */
export interface MediaObject { body: Uint8Array | ReadableStream; size: number; mime?: string }

/**
 * Where uploaded files live: data/media/<tree>/<key> on Node, the MEDIA R2 bucket (key `<tree>/<key>`)
 * on Workers. The database keeps only the key.
 */
export interface MediaStore {
  put(tree: string, key: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(tree: string, key: string): Promise<MediaObject | undefined>;
  delete(tree: string, key: string): Promise<void>;
  /** Deletes every file of a family (deleting the family, src/lib/families.server.ts). */
  deleteTree(tree: string): Promise<void>;
}

/** What a driver provides. */
export interface Driver {
  name: 'node' | 'cloudflare';
  /**
   * A family's database. Throws for an unknown tree, at once (Node, D1) or at its first query (a Durable Object that was
   * never made answers "no tree <id>"; finding that out needs a round trip).
   */
  tree(id: string): Db;
  /**
   * Whether `ensureTree(id)` can make this family here: Node always; Workers when TREE_<ID> or FAMILIES is bound. Without
   * an id: whether a family can be made without binding a database for it first (Node, or Workers with FAMILIES).
   */
  canMakeTree(id?: string): boolean;
  /**
   * A family's database, made if it does not exist yet, with the tree schema brought up to date. Node: a new data/<id>.db.
   * Workers: the bound D1 database TREE_<ID>, which must already exist; without one, a Durable Object of FAMILIES, made here
   * and recorded in the accounts database's `family_store`.
   */
  ensureTree(id: string): Promise<Db>;
  /**
   * The ids of every family database there is (some may still be empty). Node: data/*.db. Workers: the bound TREE_<ID>
   * databases and the families recorded in `family_store`.
   */
  treeIds(): Promise<string[]>;
  /**
   * Removes a family's database (deleting the family). Node: closes and deletes data/<id>.db. Workers: a D1 database cannot be
   * removed from inside the Worker, so it is emptied (`emptyDatabase`) and stays bound, ready to hold a family again; a Durable
   * Object deletes everything it stores and leaves `family_store`.
   */
  dropTree(id: string): Promise<void>;
  /** The accounts database: people, passkeys, sessions, invitations, memberships. */
  accounts(): Db;
  /** The offline place gazetteer (data/gazetteer.db), only on Node and only once built. */
  gazetteer(): Db | null;
  media: MediaStore;
  /**
   * The server secret that seals the family AI keys (src/lib/ai/secret.server.ts). Node: KINDRED_SECRET from the
   * environment, else data/secret, made on first use with mode 600. Workers: the KINDRED_SECRET binding. Throws
   * when a Worker has none.
   */
  secret(): string;
  /** Lets `work` finish after the response has ended or the client has gone. Workers stop a request's work when its client disconnects; Node does not, so there it does nothing. */
  keepAlive(work: Promise<unknown>): void;
}

/** Tables a migration fills with a starting row, which an emptied database must keep (tree migration 0011). */
export const SEEDED_TABLES = new Set(['ancestry_rev']);

/**
 * Deletes every row of a database but wrangler's migration record and the tables a migration seeded, so it is as a freshly
 * migrated one. Tables that refer to others go first, so the foreign keys hold at every step; `meta` (a family's details)
 * goes last, so a run that stops part-way leaves a family that is still there and can be deleted again. One batch: all or none.
 */
export async function emptyDatabase(d: Db): Promise<void> {
  const tables = (await d.all<{ name: string; sql: string | null }>("SELECT name, sql FROM sqlite_master WHERE type = 'table'"))
    .filter((t) => !/^(sqlite_|_cf_|d1_migrations$)/.test(t.name) && !SEEDED_TABLES.has(t.name) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(t.name));
  const refers = new Map(tables.map((t) => [t.name, new Set([...(t.sql ?? '').matchAll(/REFERENCES\s+"?([A-Za-z0-9_]+)"?/gi)].map((m) => m[1]).filter((p) => p !== t.name))]));
  const left = tables.map((t) => t.name).filter((n) => n !== 'meta');
  const order: string[] = [];
  while (left.length) {
    // A table nobody left refers to can go; a cycle (none today) goes in its remaining order.
    const i = left.findIndex((n) => !left.some((other) => other !== n && refers.get(other)?.has(n)));
    order.push(...left.splice(i < 0 ? 0 : i, 1));
  }
  if (tables.some((t) => t.name === 'meta')) order.push('meta');
  if (order.length) await d.batch(order.map((t) => q(`DELETE FROM "${t}"`)));
}

/** Tree ids are URL segments and database names: lower-case letters, digits and dashes. */
export const TREE_ID = /^[a-z0-9-]{1,64}$/;
/** data/*.db files that are not family trees. */
export const NOT_TREES = new Set(['gazetteer', 'accounts']);

/** Media keys are paths under a tree: `photo/<uuid>.jpg`. Nothing that could climb out of it. */
export const MEDIA_KEY = /^[a-z0-9-]+(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,127})+$/;
export function checkMediaKey(tree: string, key: string) {
  if (!TREE_ID.test(tree) || !MEDIA_KEY.test(key) || key.includes('..')) throw new Error(`bad media key ${tree}/${key}`);
}
