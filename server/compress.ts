// Compression for the Node server, which otherwise sends everything as it is: a family's tree page is about 2 MB of
// HTML that brotli makes about 150 kB. Built files are compressed once, at build time, at the highest settings
// (`precompress`, run by vite.config.ts for the Node target; server/static.ts serves the results). Everything the
// application answers (pages, server functions) is compressed as it streams, at a moderate setting (`compressResponse`).
// A reverse proxy in front that compresses too (Caddy's `encode`, deploy/Caddyfile) leaves a response that already has
// a Content-Encoding alone, so nothing is compressed twice.
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { brotliCompress, constants, createBrotliCompress, createGzip, gzip, type BrotliCompress, type Gzip } from 'node:zlib';

export type Encoding = 'br' | 'gzip';

/** Below this, compressing saves too little to be worth a header and the work. */
export const MIN_BYTES = 1024;

/** Types that compress well. Images other than SVG, fonts (woff2 is compressed already), PDFs and archives do not. */
const COMPRESSIBLE = /^(?:text\/|application\/(?:json|javascript|xml|manifest\+json|[a-z0-9.+-]*\+(?:json|xml))\b|image\/svg\+xml\b)/i;
/** Files the build compresses, by extension. */
const COMPRESSIBLE_FILE = /\.(?:js|mjs|css|html|json|map|svg|txt|webmanifest|xml)$/i;

/** The encodings the client takes, brotli first. An encoding with q=0 is refused; `*` stands for any not named. */
export function accepted(acceptEncoding: string | null): Encoding[] {
  if (!acceptEncoding) return [];
  const q = new Map<string, number>();
  for (const part of acceptEncoding.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    const weight = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const value = weight ? Number(weight.slice(2)) : 1;
    q.set(name, Number.isFinite(value) ? value : 0);
  }
  const takes = (e: string) => (q.get(e) ?? (e === 'gzip' ? q.get('x-gzip') : undefined) ?? q.get('*') ?? 0) > 0;
  return (['br', 'gzip'] as const).filter(takes);
}

/** The encoding to compress with for this client, if any. */
export const negotiate = (acceptEncoding: string | null): Encoding | undefined => accepted(acceptEncoding)[0];

/** Adds Accept-Encoding to Vary, keeping what is there. */
export function varyOnEncoding(headers: Headers) {
  const vary = headers.get('Vary');
  if (!vary) headers.set('Vary', 'Accept-Encoding');
  else if (!/(^|,)\s*(accept-encoding|\*)\s*(,|$)/i.test(vary)) headers.set('Vary', `${vary}, Accept-Encoding`);
}

export const compressibleType = (type: string | null) => !!type && COMPRESSIBLE.test(type) && !/^text\/event-stream\b/i.test(type);

// ---------- built files ----------

/**
 * Writes `<file>.br` and `<file>.gz` beside every compressible file under `dir` that is at least MIN_BYTES and that
 * compression makes smaller, at the highest settings: it runs once per build, and Vite's hashed files never change.
 */
export async function precompress(dir: string): Promise<{ files: number; before: number; after: number }> {
  const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile() && COMPRESSIBLE_FILE.test(e.name))
    .map((e) => join(e.parentPath, e.name));
  const br = promisify(brotliCompress);
  const gz = promisify(gzip);
  let count = 0, before = 0, after = 0;
  await Promise.all(files.map(async (file) => {
    const data = await readFile(file);
    if (data.length < MIN_BYTES) return;
    const [b, g] = await Promise.all([
      br(data, { params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }),
      gz(data, { level: constants.Z_BEST_COMPRESSION }),
    ]);
    if (b.length < data.length * 0.95) await writeFile(`${file}.br`, b);
    if (g.length < data.length * 0.95) await writeFile(`${file}.gz`, g);
    count++;
    before += data.length;
    after += Math.min(b.length, data.length);
  }));
  return { files: count, before, after };
}

/** The precompressed sibling of `file` for `encoding`, if the build made one and it is not older than the file. */
export async function precompressed(file: string, encoding: Encoding): Promise<{ path: string; size: number } | undefined> {
  const path = `${file}.${encoding === 'br' ? 'br' : 'gz'}`;
  try {
    const [variant, original] = await Promise.all([stat(path), stat(file)]);
    return variant.isFile() && variant.mtimeMs >= original.mtimeMs ? { path, size: variant.size } : undefined;
  } catch {
    return undefined;
  }
}

// ---------- the application's responses ----------

/** Brotli 4 is about as fast as gzip 6 and smaller; the highest settings are far too slow for every request. */
const BROTLI_QUALITY = 4;

function compressor(encoding: Encoding, sizeHint?: number): BrotliCompress | Gzip {
  return encoding === 'br'
    ? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY, ...(sizeHint ? { [constants.BROTLI_PARAM_SIZE_HINT]: sizeHint } : {}) } })
    : createGzip({ level: 6 });
}

/** A macrotask: the stream has had every chunk it could give right away. */
const nextTurn = () => new Promise<null>((resolve) => setImmediate(() => resolve(null)));

/** A copy of the response with other headers. */
const withHeaders = (res: Response, body: BodyInit | null, headers: Headers) =>
  new Response(body, { status: res.status, statusText: res.statusText, headers });

/**
 * The response compressed for this request, or the response unchanged when it should not be: a HEAD, a range request,
 * a body that is empty, small, already encoded, of a type that does not compress, an event stream (the assistant's
 * replies, which must arrive as they are written) or marked no-transform. A client that takes neither brotli nor gzip
 * gets it as it is, with `Vary: Accept-Encoding` so a cache does not hand it to one that does.
 *
 * It streams: what the page has rendered so far is flushed whenever the renderer pauses, so the shell of a streamed
 * page still arrives first. A strong ETag becomes weak, since the bytes differ from the uncompressed ones.
 */
export async function compressResponse(req: Request, res: Response): Promise<Response> {
  if (req.method === 'HEAD' || !res.body || req.headers.has('Range')) return res;
  if (res.status < 200 || res.status === 204 || res.status === 206 || res.status === 304) return res;
  const h = res.headers;
  if (h.has('Content-Encoding') || h.has('Content-Range') || !compressibleType(h.get('Content-Type'))) return res;
  if (/\bno-transform\b/i.test(h.get('Cache-Control') ?? '')) return res;
  const length = h.has('Content-Length') ? Number(h.get('Content-Length')) : undefined;
  if (length !== undefined && length < MIN_BYTES) return res;
  const headers = new Headers(h);
  varyOnEncoding(headers);
  const encoding = negotiate(req.headers.get('Accept-Encoding'));
  if (!encoding) return withHeaders(res, res.body, headers);

  // Without a length, the first chunks are read before deciding. A body given whole (a server function's JSON) has
  // ended by the next turn of the event loop, so a small one goes out as it is; a stream still going is not waited for.
  const reader = res.body.getReader();
  const head: Uint8Array[] = [];
  let size = 0;
  let ended = false;
  let inFlight: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
  while (length === undefined && size < MIN_BYTES) {
    const next = reader.read();
    const r = await Promise.race([next, nextTurn()]);
    if (r === null) { inFlight = next; break; }
    if (r.done) { ended = true; break; }
    head.push(r.value);
    size += r.value.length;
  }
  if (ended && size < MIN_BYTES) return withHeaders(res, size ? Buffer.concat(head) : null, headers);

  const source = new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of head) c.enqueue(chunk);
      if (ended) c.close();
    },
    async pull(c) {
      const r = await (inFlight ?? reader.read());
      inFlight = undefined;
      if (r.done) c.close();
      else c.enqueue(r.value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
  const z = compressor(encoding, length ?? (ended ? size : undefined));
  void pump(source, z, encoding);
  headers.set('Content-Encoding', encoding);
  headers.delete('Content-Length');
  const etag = headers.get('ETag');
  if (etag && !etag.startsWith('W/')) headers.set('ETag', `W/${etag}`);
  return withHeaders(res, Readable.toWeb(z) as unknown as ReadableStream<Uint8Array>, headers);
}

/** Resolves when the compressor takes more, or has closed. */
const drained = (z: BrotliCompress | Gzip) =>
  new Promise<void>((resolve) => {
    const done = () => {
      z.off('drain', done);
      z.off('close', done);
      resolve();
    };
    z.on('drain', done);
    z.on('close', done);
  });

/**
 * Feeds the body to the compressor. Whatever has been written is flushed once the body pauses (a macrotask with no new
 * chunk), so each piece of a streamed page is sent as soon as it is rendered, while a body given at once is compressed
 * as a whole. The flush keeps the compression window, so it costs a few bytes, not the ratio.
 */
async function pump(source: ReadableStream<Uint8Array>, z: BrotliCompress | Gzip, encoding: Encoding) {
  const reader = source.getReader();
  let closed = false;
  // The client went away (or the compressor failed): stop reading the page.
  z.once('close', () => {
    closed = true;
    reader.cancel().catch(() => {});
  });
  const flushKind = encoding === 'br' ? constants.BROTLI_OPERATION_FLUSH : constants.Z_SYNC_FLUSH;
  let flushQueued = false;
  const flushSoon = () => {
    if (flushQueued) return;
    flushQueued = true;
    setImmediate(() => {
      flushQueued = false;
      if (!closed && !z.writableEnded) z.flush(flushKind);
    });
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || closed) break;
      if (!z.write(value)) await drained(z);
      flushSoon();
    }
    if (!closed) z.end();
  } catch (e) {
    z.destroy(e instanceof Error ? e : new Error(String(e)));
  }
}
