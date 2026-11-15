// node --test src/lib/votes/guest-voter.test.ts — the cookie that tells a guest voter apart: its attributes, that one cookie is
// one key, that no cookie is no key, how long it lasts, and that the network value is 18 bits shared by one IPv6 /64.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-guest-voter-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const G = await vite.ssrLoadModule('/src/lib/votes/guest-voter.server.ts') as typeof import('./guest-voter.server.ts');

test.after(async () => {
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const NOW = 1_800_000_000_000;
const request = (origin = 'http://localhost:3000', cookie?: string) => new Request(`${origin}/x`, { headers: cookie ? { cookie } : {} });
const tokenOf = (setCookie: string) => /^(?:__Host-)?kindred_voter=([^;]*)/.exec(setCookie)![1];

test('a new cookie has the attributes of the other guest cookies', async () => {
  const { setCookie } = await G.voterCookie(request(), null, NOW);
  assert.match(setCookie, /^kindred_voter=[A-Za-z0-9_-]{43}; .*HttpOnly; SameSite=Lax/);
  assert.doesNotMatch(setCookie, /Secure/);
  assert.match(setCookie, /Max-Age=7776000/);
  const https = (await G.voterCookie(request('https://tree.example'), null, NOW)).setCookie;
  assert.match(https, /^__Host-kindred_voter=.*; Secure/);
});

test('the same cookie gives the same key, and a held cookie is reused', async () => {
  const first = await G.voterCookie(request(), null, NOW);
  const held = `kindred_voter=${tokenOf(first.setCookie)}`;
  assert.equal(await G.guestVoterKey(request(undefined, held)), first.key);
  assert.equal((await G.voterCookie(request(undefined, held), null, NOW)).key, first.key);
  assert.match(first.key, /^g:[A-Za-z0-9_-]{43}$/);
  assert.notEqual((await G.voterCookie(request(), null, NOW)).key, first.key);
  assert.ok(!first.key.includes(tokenOf(first.setCookie)), 'the key is a hash, never the cookie');
});

test('no cookie, or a malformed one, gives no key', async () => {
  assert.equal(await G.guestVoterKey(request()), undefined);
  assert.equal(await G.guestVoterKey(request(undefined, 'kindred_voter=short')), undefined);
});

test('the cookie never outlives the link', async () => {
  assert.match((await G.voterCookie(request(), NOW + 3_600_000, NOW)).setCookie, /Max-Age=3600;/);
  assert.match((await G.voterCookie(request(), NOW + 200 * 86_400_000, NOW)).setCookie, /Max-Age=7776000;/);
  assert.match((await G.voterCookie(request(), NOW - 1000, NOW)).setCookie, /Max-Age=0;/);
});

test('two addresses in one IPv6 /64 are one network, in 18 bits', async () => {
  const a = await G.netOfAddress('2001:db8:1:2:aaaa::1');
  assert.equal(a, await G.netOfAddress('2001:db8:1:2:bbbb:cccc::9'));
  assert.ok(Number.isInteger(a) && a >= 0 && a < 2 ** 18);
  assert.notEqual(a, await G.netOfAddress('2001:db8:1:3::1'));
  assert.equal(await G.netOfAddress('203.0.113.7'), await G.netOfAddress('203.0.113.7'));
  assert.equal(typeof (await G.netOf(request())), 'number');
});
