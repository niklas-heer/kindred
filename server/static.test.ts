import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { precompress } from './compress.ts';
import { staticFile, staticResponse } from './static.ts';

// A client folder with a hashed asset and a plain file, and a secret one level above it.
const base = mkdtempSync(join(tmpdir(), 'kindred-static-'));
const client = join(base, 'client');
mkdirSync(join(client, 'assets'), { recursive: true });
writeFileSync(join(client, 'assets', 'app-abc123.js'), 'console.log(1)');
writeFileSync(join(client, 'favicon.svg'), '<svg/>');
writeFileSync(join(base, 'secret.txt'), 'not for the web');

const get = (path: string, method = 'GET') => staticResponse(client, new Request(`http://localhost:4901${path}`, { method }));

test('a built file is served with its type and cache headers', async () => {
  const res = await get('/assets/app-abc123.js');
  assert.ok(res);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(await res.text(), 'console.log(1)');
});

test('files outside the assets folder get a short cache', async () => {
  const res = await get('/favicon.svg');
  assert.equal(res?.headers.get('content-type'), 'image/svg+xml');
  assert.equal(res?.headers.get('cache-control'), 'public, max-age=3600');
});

test('HEAD gives the headers and no body', async () => {
  const res = await get('/assets/app-abc123.js', 'HEAD');
  assert.equal(res?.headers.get('content-length'), String('console.log(1)'.length));
  assert.equal(res?.body, null);
});

test('nothing outside the client folder is served, however it is encoded', async () => {
  assert.equal(await staticFile(client, '/../secret.txt'), undefined);
  assert.equal(await staticFile(client, '/..%2Fsecret.txt'), undefined);
  assert.equal(await staticFile(client, '/%2e%2e%2fsecret.txt'), undefined);
  assert.equal(await staticFile(client, '/%E0%A4%A'), undefined);
});

test('folders, missing files and other methods are left to the application', async () => {
  assert.equal(await staticFile(client, '/assets'), undefined);
  assert.equal(await staticFile(client, '/'), undefined);
  assert.equal(await staticFile(client, '/assets/missing.js'), undefined);
  assert.equal(await get('/favicon.svg', 'POST'), undefined);
});

// ---------- the brotli and gzip copies the build writes (server/compress.ts) ----------

const zipped = join(base, 'zipped');
mkdirSync(join(zipped, 'assets'), { recursive: true });
const script = `export const names = ${JSON.stringify(Array.from({ length: 400 }, (_, i) => `Ottilie Brandvold ${i}`))};\n`;
writeFileSync(join(zipped, 'assets', 'names-abc123.js'), script);
writeFileSync(join(zipped, 'assets', 'tiny-abc123.js'), 'console.log(2)');
writeFileSync(join(zipped, 'assets', 'font-abc123.woff2'), Buffer.alloc(4096, 7));
const made = await precompress(zipped);
const getZ = (path: string, headers: Record<string, string> = {}) => staticResponse(zipped, new Request(`http://localhost:4901${path}`, { headers }));

test('the build writes brotli and gzip copies of text files only, and not of tiny ones', () => {
  assert.equal(made.files, 1);
  assert.ok(existsSync(join(zipped, 'assets', 'names-abc123.js.br')));
  assert.ok(existsSync(join(zipped, 'assets', 'names-abc123.js.gz')));
  assert.equal(existsSync(join(zipped, 'assets', 'tiny-abc123.js.br')), false, 'too small to be worth it');
  assert.equal(existsSync(join(zipped, 'assets', 'font-abc123.woff2.br')), false, 'fonts and images are compressed already');
});

test('a browser that takes brotli gets the brotli copy, with its own length and Vary', async () => {
  const res = await getZ('/assets/names-abc123.js', { 'Accept-Encoding': 'gzip, deflate, br, zstd' });
  assert.equal(res?.headers.get('content-encoding'), 'br');
  assert.equal(res?.headers.get('vary'), 'Accept-Encoding');
  assert.equal(res?.headers.get('content-type'), 'text/javascript; charset=utf-8');
  const body = Buffer.from(await res!.arrayBuffer());
  assert.equal(res?.headers.get('content-length'), String(body.length));
  assert.ok(body.length < script.length / 4);
  assert.equal(brotliDecompressSync(body).toString(), script);
});

test('gzip when brotli is refused, and the file as it is when neither is taken', async () => {
  const gz = await getZ('/assets/names-abc123.js', { 'Accept-Encoding': 'br;q=0, gzip' });
  assert.equal(gz?.headers.get('content-encoding'), 'gzip');
  assert.equal(gunzipSync(Buffer.from(await gz!.arrayBuffer())).toString(), script);
  for (const ae of [undefined, 'identity', 'gzip;q=0, br;q=0']) {
    const plain = await getZ('/assets/names-abc123.js', ae ? { 'Accept-Encoding': ae } : {});
    assert.equal(plain?.headers.get('content-encoding'), null, String(ae));
    assert.equal(plain?.headers.get('vary'), 'Accept-Encoding', 'a cache must not hand this copy to a browser that takes brotli');
    assert.equal(await plain!.text(), script);
  }
});

test('a range request, a file without a copy and a font are sent as they are', async () => {
  const ranged = await getZ('/assets/names-abc123.js', { 'Accept-Encoding': 'br', Range: 'bytes=0-9' });
  assert.equal(ranged?.headers.get('content-encoding'), null);
  const tiny = await getZ('/assets/tiny-abc123.js', { 'Accept-Encoding': 'br' });
  assert.equal(tiny?.headers.get('content-encoding'), null);
  assert.equal(await tiny!.text(), 'console.log(2)');
  const font = await getZ('/assets/font-abc123.woff2', { 'Accept-Encoding': 'br' });
  assert.equal(font?.headers.get('content-encoding'), null);
  assert.equal(font?.headers.get('vary'), null);
});

test('a copy older than its file is not used', async () => {
  const file = join(zipped, 'stale.js');
  writeFileSync(file, script);
  await precompress(zipped);
  const later = new Date(Date.now() + 60_000);
  utimesSync(file, later, later);
  const res = await getZ('/stale.js', { 'Accept-Encoding': 'br' });
  assert.equal(res?.headers.get('content-encoding'), null);
  assert.equal(await res!.text(), script);
});
