import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
