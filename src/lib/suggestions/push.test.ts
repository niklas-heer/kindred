// node --test src/lib/suggestions/push.test.ts — the push to reviewers that suggestions are waiting, on a private data folder
// with a fresh family per test: it reaches only devices that asked, of members whose role may review (never the suggester's own),
// at most one in six hours per device, says only the count in every language, and a demo or a preview sends nothing. The device
// switch is saved with the other reminder choices, and only for a role that may review. Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-suggest-push-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
const db = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const S = await load<typeof import('./suggest.server.ts')>('/src/lib/suggestions/suggest.server.ts');
const Push = await load<typeof import('./push.server.ts')>('/src/lib/suggestions/push.server.ts');
const store = await load<typeof import('../auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const readOnly = await load<typeof import('../read-only.ts')>('/src/lib/read-only.ts');
const { AuthError } = await load<typeof import('../auth/errors.ts')>('/src/lib/auth/errors.ts');
const { b64url } = await load<typeof import('../webpush.ts')>('/src/lib/webpush.ts');
const { translate } = await load<typeof import('../i18n/dictionary.ts')>('/src/lib/i18n/dictionary.ts');
const { LOCALES } = await load<typeof import('../i18n/types.ts')>('/src/lib/i18n/types.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

type Role = 'viewer' | 'contributor' | 'editor' | 'steward';
const NOW = new Date('2026-11-15T10:00:00.000Z');
const DAY = 86_400_000;
const HOUR = 3_600_000;
const later = (ms: number, from = NOW) => new Date(from.getTime() + ms);

let families = 0;
/** A fresh family: Ada (contributor, who suggests), Bo (editor), Carl (steward), Dee (viewer) and Eli (editor, whose device is stale). */
async function family() {
  const tree = `spush${++families}`;
  await db.store.ensureTree(tree);
  await db.db(tree).run("INSERT INTO person (id, given, surname, living) VALUES ('bo', 'Bo', 'Alder', 0)");
  const member = async (name: string, role: Role) => {
    const { user, insert } = store.newUser(name, null);
    await store.accounts().batch([insert, store.upsertMembership(user.id, tree, role)]);
    return { id: user.id, name, role, person: null, personConfirmed: false };
  };
  return { tree, ada: await member('Ada Alder', 'contributor'), bo: await member('Bo Birch', 'editor'), carl: await member('Carl Cedar', 'steward'), dee: await member('Dee Dune', 'viewer'), eli: await member('Eli Elm', 'editor') };
}
async function device(tree: string, user: string, name: string, suggestions: 0 | 1, seen = NOW.getTime(), locale = 'en') {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
  await store.accounts().run(
    `INSERT INTO push_subscription (id, user, tree, endpoint, p256dh, auth, offsets, kinds, locale, created, last_seen, suggestions)
     VALUES (?, ?, ?, ?, ?, ?, '[0]', '["birthday"]', ?, ?, ?, ?)`, crypto.randomUUID(), user, tree, `https://web.push.apple.com/${tree}/${name}`, p256dh, auth, locale, seen, seen, suggestions);
}
async function vapidKeys() {
  const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { publicKey: b64url(await crypto.subtle.exportKey('raw', signing.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', signing.privateKey), subject: 'mailto:family@example.org' };
}
function service() {
  const sent: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => { sent.push(String(url).split('/').at(-1)!); return new Response(null, { status: 201 }); }) as typeof fetch;
  return { sent, fetchImpl };
}
const suggest = (tree: string, by: { id: string; name: string; role: Role; person: null; personConfirmed: boolean }) =>
  S.createSuggestion(tree, { kind: 'member', who: by }, { kind: 'details', person: 'bo', payload: { born: '1919' } as never }, NOW);

test('reviewers who asked are told how many wait: not the suggester, not a role that cannot review, not a stale device; one in six hours', async () => {
  const { tree, ada, bo, carl, dee, eli } = await family();
  await device(tree, bo.id, 'bo', 1);
  await device(tree, carl.id, 'carl-off', 0);
  await device(tree, dee.id, 'dee-viewer', 1);
  await device(tree, eli.id, 'eli-stale', 1, NOW.getTime() - 400 * DAY);
  await device(tree, ada.id, 'ada-contributor', 1);
  const vapid = await vapidKeys();
  const { sent, fetchImpl } = service();
  await suggest(tree, ada);
  await suggest(tree, ada);

  assert.equal(await Push.notifySuggestion(tree, { vapid: null, fetchImpl, now: NOW }), 0, 'nothing without the server’s keys');
  assert.equal(await Push.notifySuggestion(tree, { vapid, fetchImpl, now: NOW, by: ada.id }), 1);
  assert.deepEqual(sent, ['bo'], 'a device that asked, of a reviewer, opened lately');
  assert.equal(await Push.notifySuggestion(tree, { vapid, fetchImpl, now: later(HOUR), by: ada.id }), 0, 'a busy hour is one push');
  assert.equal(await Push.notifySuggestion(tree, { vapid, fetchImpl, now: later(6 * HOUR), by: ada.id }), 1, 'six hours on, told again');
  assert.deepEqual(sent, ['bo', 'bo']);
  // A reviewer who suggested is not told of their own.
  await store.accounts().run('UPDATE push_subscription SET suggestions_sent_at = NULL');
  assert.equal(await Push.notifySuggestion(tree, { vapid, fetchImpl, now: later(DAY), by: bo.id }), 0, 'Bo’s own device is skipped, and no other reviewer asked');
});

test('nothing is sent when no suggestion waits', async () => {
  const { tree, bo } = await family();
  await device(tree, bo.id, 'bo', 1);
  const { sent, fetchImpl } = service();
  assert.equal(await Push.notifySuggestion(tree, { vapid: await vapidKeys(), fetchImpl, now: NOW }), 0);
  assert.deepEqual(sent, []);
});

test('the text is the count alone, in every language, with no name or other placeholder', async () => {
  for (const locale of LOCALES) {
    for (const count of [1, 3]) {
      const body = translate(locale, 'suggest.push.body', { count });
      assert.match(body, new RegExp(String(count)), `${locale} ${count}`);
      assert.ok(translate(locale, 'suggest.push.title', { count }), locale);
      assert.doesNotMatch(body + translate(locale, 'suggest.push.title', { count }), /[{}]/, locale);
    }
  }
});

test('a demo and a steward’s preview send no push about suggestions', async () => {
  const { tree, ada, bo } = await family();
  await device(tree, bo.id, 'bo', 1);
  const vapid = await vapidKeys();
  const { sent, fetchImpl } = service();
  await suggest(tree, ada);
  process.env.KINDRED_DEMO = '1';
  try {
    assert.equal(await Push.notifySuggestion(tree, { vapid, fetchImpl, now: NOW }), 0);
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  readOnly.onRequestReadOnly(() => new AuthError('forbidden', 'You are viewing as a viewer. Stop the preview to change something.'));
  try {
    assert.equal(await Push.notifySuggestion(tree, { vapid, fetchImpl, now: NOW }), 0);
  } finally {
    readOnly.onRequestReadOnly(() => undefined);
  }
  assert.deepEqual(sent, []);
  assert.equal(await Push.notifySuggestion(tree, { vapid, fetchImpl, now: NOW }), 1, 'the control: outside both it is sent');
});

test('the switch is the device’s, saved with its other choices, and off until asked for', async () => {
  const reminders = await load<typeof import('../reminders.server.ts')>('/src/lib/reminders.server.ts');
  const { parseChoices } = await load<typeof import('../reminders.ts')>('/src/lib/reminders.ts');
  const { tree, bo } = await family();
  const endpoint = `https://web.push.apple.com/${tree}/bo-switch`;
  const registration = { user: bo.id, tree, subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } }, choices: parseChoices([0], ['birthday'])!, locale: 'en' as const };
  const on = async () => (await reminders.subscriptionOf(bo.id, tree, endpoint))?.suggestions;
  await reminders.saveRegistration(registration);
  assert.equal(await on(), 0);
  await reminders.saveRegistration({ ...registration, suggestions: true });
  assert.equal(await on(), 1);
  await reminders.saveRegistration({ ...registration, suggestions: false });
  assert.equal(await on(), 0);
});
