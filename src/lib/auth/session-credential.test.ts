// node --test src/lib/auth/session-credential.test.ts — a session remembers the passkey that started it (accounts migration
// 0022): removing that passkey signs its devices out, and "sign out everywhere else" ends every session but this one.
// Scratch data folder and accounts database only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-session-credential-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
for (const k of ['KINDRED_AUTH', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'KINDRED_ORIGIN', 'KINDRED_GUEST_ORIGIN']) delete process.env[k];

const store = await import('./store.server.ts');
const { endOtherSessionsOf, sessionStillOpen, startSession } = await import('./session.server.ts');

const SITE = 'http://family.example.org/';
const wipe = () => store.accounts().batch(['session', 'credential', 'user'].map((t) => store.q(`DELETE FROM ${t}`)));

async function account(name: string, passkeys: string[]) {
  const made = store.newUser(name, null);
  await store.accounts().batch([
    made.insert,
    ...passkeys.map((id) => store.insertCredential({ id, user: made.user.id, publicKey: new Uint8Array([1]), counter: 0, transports: [], device: 'Mac', synced: false })),
  ]);
  return made.user.id;
}
const open = async (token: string) => !!(await store.sessionByToken(token));
const requestWith = (token: string) => new Request(SITE, { headers: { cookie: `kindred_session=${token}` } });

beforeEach(wipe);
after(async () => {
  (await import('../store/node.ts')).closeAccounts();
  rmSync(dir, { recursive: true, force: true });
});

test('a sign-in records its passkey on the session', async () => {
  const user = await account('Mira Testfield', ['key-phone']);
  const setCookie = await startSession(new Request(SITE), user, 'key-phone');
  const token = /kindred_session=([^;]+)/.exec(setCookie)![1];
  assert.equal((await store.sessionByToken(token))!.credential, 'key-phone');
});

test('removing a passkey ends the sessions it started, and only those', async () => {
  const user = await account('Mira Testfield', ['key-phone', 'key-laptop']);
  const other = await account('Oskar Vellum', ['key-oskar']);
  const phone = (await store.createSession(user, 'key-phone')).token;
  const phoneAgain = (await store.createSession(user, 'key-phone')).token;
  const laptop = (await store.createSession(user, 'key-laptop')).token;
  const older = (await store.createSession(user)).token; // a session from before migration 0022 names no passkey
  const oskar = (await store.createSession(other, 'key-oskar')).token;

  assert.equal(await store.removeCredential(user, 'key-phone'), 'removed');
  assert.equal(await open(phone), false, 'the lost phone is signed out');
  assert.equal(await open(phoneAgain), false, 'every session of that passkey');
  assert.equal(await open(laptop), true, 'another passkey’s session stays');
  assert.equal(await open(older), true, 'an older session without a passkey keeps working');
  assert.equal(await open(oskar), true, 'someone else’s session is untouched');
  assert.equal(await store.credentialById('key-phone'), undefined);
});

test('the last passkey cannot be removed, and its sessions stay', async () => {
  const user = await account('Mira Testfield', ['key-only']);
  const token = (await store.createSession(user, 'key-only')).token;
  assert.equal(await store.removeCredential(user, 'key-only'), 'last');
  assert.ok(await store.credentialById('key-only'));
  assert.equal(await open(token), true);
});

test('a passkey already removed, or someone else’s, removes nothing', async () => {
  const user = await account('Mira Testfield', ['key-a', 'key-b']);
  const other = await account('Oskar Vellum', ['key-oskar', 'key-oskar-2']);
  const oskar = (await store.createSession(other, 'key-oskar')).token;
  assert.equal(await store.removeCredential(user, 'key-gone'), 'already-removed');
  assert.equal(await store.removeCredential(user, 'key-oskar'), 'already-removed');
  assert.ok(await store.credentialById('key-oskar'));
  assert.equal(await open(oskar), true);
});

test('the session that signed in with the removed passkey learns it is signed out', async () => {
  const user = await account('Mira Testfield', ['key-here', 'key-there']);
  const here = (await store.createSession(user, 'key-here')).token;
  assert.equal(await sessionStillOpen(requestWith(here)), true);
  await store.removeCredential(user, 'key-here');
  assert.equal(await sessionStillOpen(requestWith(here)), false);
  assert.equal(await sessionStillOpen(new Request(SITE)), false, 'no cookie, no session');
});

test('sign out everywhere else ends every other session of the reader and keeps this one', async () => {
  const user = await account('Mira Testfield', ['key-phone', 'key-laptop']);
  const other = await account('Oskar Vellum', ['key-oskar']);
  const here = (await store.createSession(user, 'key-laptop')).token;
  const sameKeyElsewhere = (await store.createSession(user, 'key-laptop')).token;
  const phone = (await store.createSession(user, 'key-phone')).token;
  const older = (await store.createSession(user)).token;
  const oskar = (await store.createSession(other, 'key-oskar')).token;

  assert.equal(await endOtherSessionsOf(requestWith(here), user), 3);
  assert.equal(await open(here), true);
  for (const t of [sameKeyElsewhere, phone, older]) assert.equal(await open(t), false);
  assert.equal(await open(oskar), true, 'only the reader’s own sessions');
  assert.equal(await endOtherSessionsOf(requestWith(here), user), 0, 'nothing left to end');
  assert.equal(await endOtherSessionsOf(new Request(SITE), user), 0, 'a request without a session cookie ends nothing');
  assert.equal(await open(here), true);
});
