// node --test src/lib/votes/guest-voter.test.ts — the cookie that tells a guest voter apart: its attributes, that one cookie is
// one key in a family and another in the next, that no cookie is no key, how long it lasts, and that the network value is 18
// bits shared by one IPv6 /64 and different from one vote to the next.
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
const F = 'alders';
const VOTE = '00000000-0000-4000-8000-0000000000aa';
const request = (origin = 'http://localhost:3000', cookie?: string) => new Request(`${origin}/x`, { headers: cookie ? { cookie } : {} });
const tokenOf = (setCookie: string) => /^(?:__Host-)?kindred_voter=([^;]*)/.exec(setCookie)![1];

test('a new cookie has the attributes of the other guest cookies', async () => {
  const { setCookie } = await G.voterCookie(request(), F, null, NOW);
  assert.match(setCookie, /^kindred_voter=[A-Za-z0-9_-]{43}; .*HttpOnly; SameSite=Lax/);
  assert.doesNotMatch(setCookie, /Secure/);
  assert.match(setCookie, /Max-Age=7776000/);
  const https = (await G.voterCookie(request('https://tree.example'), F, null, NOW)).setCookie;
  assert.match(https, /^__Host-kindred_voter=.*; Secure/);
});

test('the same cookie gives the same key, and a held cookie is reused', async () => {
  const first = await G.voterCookie(request(), F, null, NOW);
  const held = `kindred_voter=${tokenOf(first.setCookie)}`;
  assert.equal(await G.guestVoterKey(request(undefined, held), F), first.key);
  assert.equal((await G.voterCookie(request(undefined, held), F, null, NOW)).key, first.key);
  assert.match(first.key, /^g:[A-Za-z0-9_-]{43}$/);
  assert.notEqual((await G.voterCookie(request(), F, null, NOW)).key, first.key);
  assert.ok(!first.key.includes(tokenOf(first.setCookie)), 'the key is a hash, never the cookie');
});

test('no cookie, or a malformed one, gives no key', async () => {
  assert.equal(await G.guestVoterKey(request(), F), undefined);
  assert.equal(await G.guestVoterKey(request(undefined, 'kindred_voter=short'), F), undefined);
});

test('the cookie never outlives the link', async () => {
  assert.match((await G.voterCookie(request(), F, NOW + 3_600_000, NOW)).setCookie, /Max-Age=3600;/);
  assert.match((await G.voterCookie(request(), F, NOW + 200 * 86_400_000, NOW)).setCookie, /Max-Age=7776000;/);
  assert.match((await G.voterCookie(request(), F, NOW - 1000, NOW)).setCookie, /Max-Age=0;/);
});

test('two addresses in one IPv6 /64 are one network, in 18 bits', async () => {
  const a = await G.netOfAddress('2001:db8:1:2:aaaa::1', VOTE);
  assert.equal(a, await G.netOfAddress('2001:db8:1:2:bbbb:cccc::9', VOTE));
  assert.ok(Number.isInteger(a) && a >= 0 && a < 2 ** 18);
  assert.notEqual(a, await G.netOfAddress('2001:db8:1:3::1', VOTE));
  assert.equal(await G.netOfAddress('203.0.113.7', VOTE), await G.netOfAddress('203.0.113.7', VOTE));
  assert.equal(typeof (await G.netOf(request(), VOTE)), 'number');
});

test('the same browser is another guest in another family, and the same network another value in another vote', async () => {
  const { setCookie, key } = await G.voterCookie(request(), F, null, NOW);
  const held = request(undefined, `kindred_voter=${tokenOf(setCookie)}`);
  const elsewhere = await G.guestVoterKey(held, 'other-family');
  assert.ok(elsewhere?.startsWith('g:'));
  assert.notEqual(elsewhere, key, 'two families’ databases cannot be joined on a guest');
  assert.equal((await G.voterCookie(held, 'other-family', null, NOW)).key, elsewhere);
  // Over many votes, the values for one network are not one value: the count of a network stays within a vote.
  const nets = new Set<number>();
  for (let i = 0; i < 8; i++) nets.add(await G.netOfAddress('203.0.113.7', `00000000-0000-4000-8000-00000000000${i}`));
  assert.ok(nets.size > 1, 'one network is not the same number in every vote');
});
