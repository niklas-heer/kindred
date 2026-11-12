// The few Workers types the Cloudflare driver uses. @cloudflare/workers-types redeclares Request,
// Response and friends globally, which clashes with the DOM types the rest of the app checks against.
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
  export function waitUntil(promise: Promise<unknown>): void;
}

interface D1Meta { changes: number; last_row_id: number }
interface D1Result<T = Record<string, unknown>> { results: T[]; success: boolean; meta: D1Meta }
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface R2ObjectBody {
  body: ReadableStream;
  size: number;
  httpMetadata?: { contentType?: string };
}
interface R2Bucket {
  put(key: string, value: ArrayBuffer | ArrayBufferView | ReadableStream | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string | string[]): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string; size: number }[]; truncated: boolean; cursor?: string }>;
}

// Durable Objects with SQLite storage (./durable.ts).
declare module 'cloudflare:workers' {
  export abstract class DurableObject {
    protected ctx: DurableObjectState;
    protected env: unknown;
    constructor(ctx: DurableObjectState, env: unknown);
  }
}
interface SqlStorageCursor<T> {
  toArray(): T[];
  one(): T;
  readonly columnNames: string[];
}
interface SqlStorage {
  exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): SqlStorageCursor<T>;
}
interface DurableObjectStorage {
  sql: SqlStorage;
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteAll(): Promise<void>;
  transactionSync<T>(work: () => T): T;
  /** Point-in-time recovery (SQLite storage only; local workerd answers with a placeholder and cannot restore). */
  getCurrentBookmark(): Promise<string>;
  onNextSessionRestoreBookmark(bookmark: string): Promise<string>;
}
interface DurableObjectState {
  storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(work: () => Promise<T>): Promise<T>;
  abort(reason?: string): void;
}
interface DurableObjectId { toString(): string }
interface DurableObjectNamespace<T = unknown> {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): T;
  jurisdiction(name: string): DurableObjectNamespace<T>;
}

declare module 'virtual:kindred/migrations' {
  const migrations: Record<'tree' | 'accounts', { name: string; sql: string }[]>;
  export default migrations;
}
