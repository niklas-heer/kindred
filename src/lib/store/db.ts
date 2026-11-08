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
}

/** What a driver provides. */
export interface Driver {
  name: 'node' | 'cloudflare';
  /** A family's database. Throws for an unknown tree. */
  tree(id: string): Db;
  /** The ids of every family database there is (some may still be empty). */
  treeIds(): string[];
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
