// node --test server/compress.test.ts — what the Node server compresses on the fly, and what it leaves alone: the
// assistant's event stream, small answers, ranges, and anything already encoded. A streamed page still arrives in parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brotliDecompressSync, createBrotliDecompress, gunzipSync } from 'node:zlib';
import { accepted, compressResponse, negotiate } from './compress.ts';

const page = `<!doctype html><html><body>${Array.from({ length: 2000 }, (_, i) => `<p>Halvard Ostergaard ${i}</p>`).join('')}</body></html>`;
const req = (headers: Record<string, string> = { 'Accept-Encoding': 'gzip, deflate, br' }, method = 'GET') => new Request('http://localhost:4901/family', { method, headers });
const html = (body: BodyInit | null = page, headers: Record<string, string> = {}) =>
  new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers } });

test('the encodings a browser takes: brotli first, never one it refuses', () => {
  assert.deepEqual(accepted('gzip, deflate, br, zstd'), ['br', 'gzip']);
  assert.equal(negotiate('gzip, deflate'), 'gzip');
  assert.equal(negotiate('br;q=0, gzip;q=0.5'), 'gzip');
  assert.equal(negotiate('*'), 'br');
  assert.equal(negotiate('br;q=0, *'), 'gzip');
  assert.equal(negotiate('gzip;q=0, br;q=0'), undefined);
  assert.equal(negotiate('identity'), undefined);
  assert.equal(negotiate(null), undefined);
});

test('a page is sent as brotli, with Vary, no stale length and a weak ETag', async () => {
  const res = await compressResponse(req(), html(page, { ETag: '"v1"', 'Set-Cookie': 'a=1' }));
  assert.equal(res.headers.get('content-encoding'), 'br');
  assert.equal(res.headers.get('vary'), 'Accept-Encoding');
  assert.equal(res.headers.get('content-length'), null);
  assert.equal(res.headers.get('etag'), 'W/"v1"', 'the compressed bytes are not the ones a strong ETag named');
  assert.deepEqual(res.headers.getSetCookie(), ['a=1']);
  const body = Buffer.from(await res.arrayBuffer());
  assert.ok(body.length < page.length / 10);
  assert.equal(brotliDecompressSync(body).toString(), page);
});

test('gzip for a browser without brotli; an existing Vary is kept', async () => {
  const res = await compressResponse(req({ 'Accept-Encoding': 'gzip' }), html(page, { Vary: 'Cookie' }));
  assert.equal(res.headers.get('content-encoding'), 'gzip');
  assert.equal(res.headers.get('vary'), 'Cookie, Accept-Encoding');
  assert.equal(gunzipSync(Buffer.from(await res.arrayBuffer())).toString(), page);
});

test('a browser that takes neither gets the page as it is, marked as depending on Accept-Encoding', async () => {
  const res = await compressResponse(req({}), html());
  assert.equal(res.headers.get('content-encoding'), null);
  assert.equal(res.headers.get('vary'), 'Accept-Encoding');
  assert.equal(await res.text(), page);
});

test('a small answer is sent as it is, with or without a length', async () => {
  const json = JSON.stringify({ ok: true });
  for (const headers of [{ 'Content-Type': 'application/json' } as Record<string, string>, { 'Content-Type': 'application/json', 'Content-Length': String(json.length) }]) {
    const res = await compressResponse(req(), new Response(json, { headers }));
    assert.equal(res.headers.get('content-encoding'), null);
    assert.equal(await res.text(), json);
  }
  const empty = await compressResponse(req(), html(''));
  assert.equal(empty.headers.get('content-encoding'), null);
  assert.equal(await empty.text(), '');
});

test('a large server-function answer is compressed', async () => {
  const json = JSON.stringify({ people: Array.from({ length: 300 }, (_, i) => ({ id: `p${i}`, given: 'Sigrun' })) });
  const res = await compressResponse(req(), new Response(json, { headers: { 'Content-Type': 'application/json' } }));
  assert.equal(res.headers.get('content-encoding'), 'br');
  assert.equal(brotliDecompressSync(Buffer.from(await res.arrayBuffer())).toString(), json);
});

test('left alone: HEAD, ranges, partial content, other encodings, no-transform, images and event streams', async () => {
  const cases: [Request, Response][] = [
    [req({ 'Accept-Encoding': 'br' }, 'HEAD'), html(null)],
    [req({ 'Accept-Encoding': 'br', Range: 'bytes=0-99' }), html()],
    [req(), new Response(page, { status: 206, headers: { 'Content-Type': 'text/html', 'Content-Range': 'bytes 0-99/5000' } })],
    [req(), html(page, { 'Content-Encoding': 'gzip' })],
    [req(), html(page, { 'Cache-Control': 'no-store, no-transform' })],
    [req(), new Response(new Uint8Array(5000), { headers: { 'Content-Type': 'image/png' } })],
    [req(), new Response(page, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } })],
    [req(), new Response(null, { status: 304 })],
  ];
  for (const [request, response] of cases) assert.equal(await compressResponse(request, response), response);
});

test('a streamed page arrives in parts: what is rendered is sent before the rest exists', { timeout: 5000 }, async () => {
  const shell = page.slice(0, 20_000);
  let finish!: () => void;
  const body = new ReadableStream<Uint8Array>({
    async start(c) {
      c.enqueue(new TextEncoder().encode(shell));
      await new Promise<void>((resolve) => { finish = resolve; });
      c.enqueue(new TextEncoder().encode('<p>the rest</p>'));
      c.close();
    },
  });
  const res = await compressResponse(req({ 'Accept-Encoding': 'br' }), html(body));
  assert.equal(res.headers.get('content-encoding'), 'br');
  const reader = res.body!.getReader();
  const unzip = createBrotliDecompress();
  let text = '';
  unzip.on('data', (b: Buffer) => { text += b.toString(); });
  while (text.length < shell.length) {
    const { value, done } = await reader.read();
    assert.equal(done, false, 'the shell came before the stream ended');
    await new Promise<void>((resolve) => unzip.write(value, () => resolve()));
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(text, shell);
  finish();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    unzip.write(value);
  }
  await new Promise((resolve) => unzip.end(resolve));
  assert.equal(text, `${shell}<p>the rest</p>`);
});

test('a reader that goes away stops the page being read', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode(page)); },
    cancel() { cancelled = true; },
  });
  const res = await compressResponse(req(), html(body));
  const reader = res.body!.getReader();
  await reader.read();
  await reader.cancel();
  for (let i = 0; i < 20 && !cancelled; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(cancelled, true);
});
