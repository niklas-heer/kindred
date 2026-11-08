// The few Workers types the Cloudflare driver uses. @cloudflare/workers-types redeclares Request,
// Response and friends globally, which clashes with the DOM types the rest of the app checks against.
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
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
}
