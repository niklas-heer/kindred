// node --test src/lib/auth/account-locale.test.ts — the language a guest picks before signing up is kept on the account:
// the account row gets it when it is made, and a guest who never picked one leaves it empty. A scratch accounts database.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-account-locale-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
after(() => rmSync(dir, { recursive: true, force: true }));

const store = await import('./store.server.ts');
const { guestChoice, guestLocale } = await import('./session.server.ts');

test('a new account keeps the language the guest picked, from its first visit', async () => {
  const { user, insert } = store.newUser('Anna', null, 'handle-de', 'de');
  await store.accounts().batch([insert]);
  const row = await store.userById(user.id);
  assert.equal(row?.locale, 'de');
});

test('an account made without a choice has no saved language, as before', async () => {
  const { user, insert } = store.newUser('Bea', 'bea@example.org');
  await store.accounts().batch([insert]);
  assert.equal((await store.userById(user.id))?.locale, null);
});

test('the guest’s language is the cookie they picked; without a pick the browser’s preference applies', () => {
  const picked = new Request('http://localhost/setup', { headers: { cookie: 'kindred_locale_guest=af; other=1' } });
  assert.equal(guestChoice(picked), 'af');
  assert.equal(guestLocale(picked), 'af');
  const browser = new Request('http://localhost/setup', { headers: { 'accept-language': 'de-DE,de;q=0.9' } });
  assert.equal(guestChoice(browser), null, 'no pick, so nothing is saved on the account');
  assert.equal(guestLocale(browser), 'de');
  const junk = new Request('http://localhost/setup', { headers: { cookie: 'kindred_locale_guest=xx' } });
  assert.equal(guestChoice(junk), null);
});
