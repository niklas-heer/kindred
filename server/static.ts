// The built client (dist/client) for the Node server. Vite names everything under assets/ by its content,
// so those files can be cached for a year; the rest (favicon.svg and the like) for an hour. Text files are sent as the
// brotli or gzip copy the build wrote beside them (server/compress.ts), whichever the browser takes.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { accepted, compressibleType, precompressed, varyOnEncoding } from './compress.ts';

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

/**
 * The regular file under `clientDir` that the URL path names, or undefined. Never a file outside
 * `clientDir`, however the path is encoded (`/..%2Fsecret` is refused), and never a folder.
 */
export async function staticFile(clientDir: string, pathname: string): Promise<string | undefined> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const root = resolve(clientDir);
  const file = resolve(root, `.${decoded}`);
  if (!file.startsWith(root + sep)) return undefined;
  try {
    return (await stat(file)).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}

/** The response for a GET or HEAD of a built file, or undefined when the request is not for one. */
export async function staticResponse(clientDir: string, req: Request): Promise<Response | undefined> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return undefined;
  const file = await staticFile(clientDir, new URL(req.url).pathname);
  if (!file) return undefined;
  const hashed = relative(resolve(clientDir), file).startsWith(`assets${sep}`);
  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  let body = { path: file, size: (await stat(file)).size };
  let encoding: string | undefined;
  if (compressibleType(type) && !req.headers.has('Range')) {
    for (const e of accepted(req.headers.get('Accept-Encoding'))) {
      const variant = await precompressed(file, e);
      if (variant) {
        body = variant;
        encoding = e;
        break;
      }
    }
  }
  const headers = new Headers({
    'Content-Type': type,
    'Content-Length': String(body.size),
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  if (compressibleType(type)) varyOnEncoding(headers);
  if (encoding) headers.set('Content-Encoding', encoding);
  if (req.method === 'HEAD') return new Response(null, { headers });
  return new Response(Readable.toWeb(createReadStream(body.path)) as unknown as ReadableStream, { headers });
}
