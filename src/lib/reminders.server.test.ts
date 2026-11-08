// node --test src/lib/reminders.server.test.ts — the reminder devices and the daily run, on a scratch accounts database
// and a stubbed push service and family graph. Nothing reaches a real push endpoint, and nothing reads data/.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-reminders-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
after(() => rmSync(dir, { recursive: true, force: true }));

const store = await import('./auth/store.server.ts');
const { AuthError } = await import('./auth/errors.ts');
const r = await import('./reminders.server.ts');
const { b64url, fromB64url } = await import('./webpush.ts');
const { parseChoices, OFFSETS } = await import('./reminders.ts');
type Graph = import('./types.ts').Graph;

const enc = new TextEncoder();
const dec = new TextDecoder();
const DAY = 86_400_000;
const NOW = new Date('2026-11-01T06:00:00Z');
const ENDPOINT = (id: string) => `https://web.push.apple.com/${id}`;

async function device() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, keys: { p256dh: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)), auth: b64url(auth) } };
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** The device's view of a pushed message: what the browser would decrypt (RFC 8291, receiver side). */
async function open(body: Uint8Array<ArrayBuffer>, { pair, keys }: Awaited<ReturnType<typeof device>>) {
  const salt = body.slice(0, 16);
  const idLength = body[20];
  const senderPublic = body.slice(21, 21 + idLength);
  const sender = await crypto.subtle.importKey('raw', senderPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, pair.privateKey, 256));
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...fromB64url(keys.p256dh), ...senderPublic]);
  const ikm = await hkdf(fromB64url(keys.auth), shared, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idLength)));
  return JSON.parse(dec.decode(plain.slice(0, -1))) as { title: string; body: string; tag: string; url: string };
}

async function vapidConfig() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    publicKey: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)),
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
    subject: 'mailto:family@example.org',
  };
}

// A small family: Ada (76 on 2 November), Bo and Ada married on 8 November (51 years), and Gone died on 2 November 25 years ago.
const graph = {
  people: [
    { id: 'ada', given: 'Ada', surname: 'Linde', living: true, born: '1950-11-02', stories: 0, contacts: 0 },
    { id: 'bo', given: 'Bo', surname: 'Linde', living: true, born: '1948-11-08', stories: 0, contacts: 0 },
    { id: 'gone', given: 'Gone', surname: 'Linde', living: false, born: '1930-01-01', died: '2001-11-02', stories: 0, contacts: 0 },
  ],
  unions: [{ id: 'm1', a: 'ada', b: 'bo', kind: 'marriage', start: '1975-11-08' }],
} as unknown as Graph;

function fakePush(answers: Record<string, number> = {}) {
  const sent: { url: string; body: Uint8Array<ArrayBuffer> }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: new Uint8Array(init!.body as Uint8Array) });
    const status = answers[String(url)] ?? 201;
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

async function userWith(tree: string, role: 'viewer' | 'steward' = 'viewer') {
  const { user, insert } = store.newUser(`User ${crypto.randomUUID().slice(0, 4)}`, null);
  await store.accounts().batch([insert, store.upsertMembership(user.id, tree, role)]);
  return user.id;
}

const choices = (offsets: number[], kinds: string[]) => parseChoices(offsets, kinds)!;
const rowCount = async (tree?: string) =>
  (await store.accounts().get<{ n: number }>('SELECT count(*) AS n FROM push_subscription' + (tree ? ' WHERE tree = ?' : ''), ...(tree ? [tree] : [])))!.n;

test('a device registers for a family, and registering again refreshes it without a second row', async () => {
  const phone = await device();
  const alice = await userWith('lindes-register');
  const subscription = { endpoint: ENDPOINT('phone'), keys: phone.keys };
  await r.saveRegistration({ user: alice, tree: 'lindes-register', subscription, choices: choices([7, 1], ['birthday']), locale: 'de' });
  const first = await r.subscriptionOf(alice, 'lindes-register', subscription.endpoint);
  assert.ok(first);
  assert.deepEqual(r.choicesOf(first), { offsets: [1, 7], kinds: ['birthday'] });
  assert.equal(first.locale, 'de');
  await new Promise((resolve) => setTimeout(resolve, 5));
  await r.saveRegistration({ user: alice, tree: 'lindes-register', subscription, choices: choices([0], ['memorial', 'wedding']), locale: 'af' });
  const again = await r.subscriptionOf(alice, 'lindes-register', subscription.endpoint);
  assert.equal(await rowCount('lindes-register'), 1);
  assert.equal(again?.id, first.id, 'the same row is updated');
  assert.equal(again?.created, first.created, 'the first registration time is kept');
  assert.ok(again!.last_seen > first.last_seen);
  assert.equal(again?.locale, 'af');
  assert.deepEqual(r.choicesOf(again!), { offsets: [0], kinds: ['memorial', 'wedding'] });
});

test('one device can hold reminders for several families, and each family keeps its own choices', async () => {
  const phone = await device();
  const alice = await userWith('lindes-two');
  await store.accounts().batch([store.upsertMembership(alice, 'lindes-other', 'viewer')]);
  const subscription = { endpoint: ENDPOINT('shared'), keys: phone.keys };
  await r.saveRegistration({ user: alice, tree: 'lindes-two', subscription, choices: choices([0], ['birthday']), locale: 'en' });
  await r.saveRegistration({ user: alice, tree: 'lindes-other', subscription, choices: choices([7], ['wedding']), locale: 'de' });
  assert.deepEqual(r.choicesOf((await r.subscriptionOf(alice, 'lindes-two', subscription.endpoint))!), { offsets: [0], kinds: ['birthday'] });
  assert.deepEqual(r.choicesOf((await r.subscriptionOf(alice, 'lindes-other', subscription.endpoint))!), { offsets: [7], kinds: ['wedding'] });
  assert.equal(await r.removeRegistration(alice, 'lindes-two', subscription.endpoint), 1, 'one family still has the device');
  assert.equal(await r.removeRegistration(alice, 'lindes-other', subscription.endpoint), 0, 'the last family removes it');
});

test('a browser endpoint belongs to one person at a time', async () => {
  const phone = await device();
  const alice = await userWith('lindes');
  const bo = await userWith('lindes');
  const subscription = { endpoint: ENDPOINT('family-ipad'), keys: phone.keys };
  await r.saveRegistration({ user: alice, tree: 'lindes', subscription, choices: choices([0], ['birthday']), locale: 'en' });
  await assert.rejects(
    r.saveRegistration({ user: bo, tree: 'lindes', subscription, choices: choices([0], ['birthday']), locale: 'en' }),
    (e: unknown) => e instanceof AuthError && /someone else/.test(e.message),
  );
  assert.equal((await r.subscriptionOf(alice, 'lindes', subscription.endpoint))?.user, alice);
});

test('a person holds at most ten devices, and the eleventh is refused until one is turned off', async () => {
  const user = await userWith('lindes');
  const keys = (await device()).keys;
  for (let index = 0; index < r.MAX_DEVICES_PER_PERSON; index += 1) {
    await r.saveRegistration({ user, tree: 'lindes', subscription: { endpoint: ENDPOINT(`cap-${index}`), keys }, choices: choices([0], ['birthday']), locale: 'en' });
  }
  await assert.rejects(
    r.saveRegistration({ user, tree: 'lindes', subscription: { endpoint: ENDPOINT('cap-extra'), keys }, choices: choices([0], ['birthday']), locale: 'en' }),
    (e: unknown) => e instanceof AuthError && /Too many devices/.test(e.message),
  );
  // A device already on the list can still be updated, even at the limit.
  await r.saveRegistration({ user, tree: 'lindes', subscription: { endpoint: ENDPOINT('cap-3'), keys }, choices: choices([1], ['birthday']), locale: 'en' });
  await r.removeRegistration(user, 'lindes', ENDPOINT('cap-0'));
  await r.saveRegistration({ user, tree: 'lindes', subscription: { endpoint: ENDPOINT('cap-extra'), keys }, choices: choices([0], ['birthday']), locale: 'en' });
});

test('only browser push services are accepted, and the device key must be a real point', async () => {
  const good = await device();
  await r.checkSubscription({ endpoint: ENDPOINT('ok'), keys: good.keys });
  await assert.rejects(r.checkSubscription({ endpoint: 'https://evil.example/x', keys: good.keys }), (e: unknown) => e instanceof AuthError && /push service/.test(e.message));
  await assert.rejects(r.checkSubscription({ endpoint: ENDPOINT('bad'), keys: { p256dh: `B${'a'.repeat(86)}`, auth: good.keys.auth } }), (e: unknown) => e instanceof AuthError && /keys/.test(e.message));
  await assert.rejects(r.checkSubscription({ endpoint: ENDPOINT('bad'), keys: { p256dh: good.keys.p256dh, auth: 'short' } }), (e: unknown) => e instanceof AuthError && /keys/.test(e.message));
});

test('the VAPID settings are read only when every part is well formed', async () => {
  const vapid = await vapidConfig();
  const env = (overrides: Record<string, string | undefined> = {}) => {
    const values: Record<string, string | undefined> = {
      KINDRED_VAPID_PUBLIC_KEY: vapid.publicKey,
      KINDRED_VAPID_PRIVATE_JWK: JSON.stringify(vapid.privateJwk),
      KINDRED_VAPID_SUBJECT: vapid.subject,
      ...overrides,
    };
    return (name: string) => values[name];
  };
  assert.equal(r.vapidFrom(env())?.publicKey, vapid.publicKey);
  assert.equal(r.vapidFrom(env({ KINDRED_VAPID_PUBLIC_KEY: undefined })), null);
  assert.equal(r.vapidFrom(env({ KINDRED_VAPID_PRIVATE_JWK: '{not json' })), null);
  assert.equal(r.vapidFrom(env({ KINDRED_VAPID_PRIVATE_JWK: JSON.stringify({ ...vapid.privateJwk, crv: 'P-384' }) })), null);
  assert.equal(r.vapidFrom(env({ KINDRED_VAPID_SUBJECT: 'family@example.org' })), null, 'the subject is a mailto: or https: address');
  assert.equal(r.vapidFrom(env({ KINDRED_VAPID_PUBLIC_KEY: 'short' })), null);
});

test('the daily run sends each device its reminders, in its own language, encrypted for that device', async () => {
  const tree = 'lindes-daily';
  const phone = await device();
  const alice = await userWith(tree);
  const vapid = await vapidConfig();
  await r.saveRegistration({ user: alice, tree, subscription: { endpoint: ENDPOINT('daily-de'), keys: phone.keys }, choices: choices([1], ['birthday']), locale: 'de' });
  const { sent, fetchImpl } = fakePush();
  const totals = await r.sendDailyReminders({ trees: [tree], now: NOW, vapid, fetchImpl, log: () => {}, loadGraph: async () => graph });
  assert.deepEqual(totals, { sent: 1, removed: 0, failed: 0, skipped: 0, errors: 0 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, ENDPOINT('daily-de'));
  const message = await open(sent[0].body, phone);
  assert.deepEqual(message, { title: 'Familie: Erinnerung', body: 'Morgen: Ada Linde wird 76', tag: `kindred-${tree}-2026-11-01`, url: `/${tree}?sel=ada` });
});

test('a device gets nothing when nothing is due for its choices, and its last-seen time is kept', async () => {
  const tree = 'lindes-quiet';
  const phone = await device();
  const alice = await userWith(tree);
  const vapid = await vapidConfig();
  await r.saveRegistration({ user: alice, tree, subscription: { endpoint: ENDPOINT('quiet'), keys: phone.keys }, choices: choices([0], ['memorial']), locale: 'en' });
  const { sent, fetchImpl } = fakePush();
  const totals = await r.sendDailyReminders({ trees: [tree], now: NOW, vapid, fetchImpl, log: () => {}, loadGraph: async () => graph });
  assert.equal(sent.length, 0);
  assert.equal(totals.skipped, 1);
  assert.equal(await rowCount(tree), 1);
});

test('a device the push service reports as gone (404 or 410) is removed; other failures keep it', async () => {
  const tree = 'lindes-gone';
  const keys = (await device()).keys;
  const alice = await userWith(tree);
  const vapid = await vapidConfig();
  const endpoints = { gone: ENDPOINT('gone'), missing: ENDPOINT('missing'), flaky: ENDPOINT('flaky') };
  for (const endpoint of Object.values(endpoints)) {
    await r.saveRegistration({ user: alice, tree, subscription: { endpoint, keys }, choices: choices([1], ['birthday']), locale: 'en' });
  }
  const { fetchImpl } = fakePush({ [endpoints.gone]: 410, [endpoints.missing]: 404, [endpoints.flaky]: 500 });
  const totals = await r.sendDailyReminders({ trees: [tree], now: NOW, vapid, fetchImpl, log: () => {}, loadGraph: async () => graph });
  assert.deepEqual(totals, { sent: 0, removed: 2, failed: 1, skipped: 0, errors: 0 });
  assert.equal(await r.subscriptionOf(alice, tree, endpoints.gone), undefined, 'a 410 device is removed');
  assert.equal(await r.subscriptionOf(alice, tree, endpoints.missing), undefined, 'a 404 device is removed');
  assert.ok(await r.subscriptionOf(alice, tree, endpoints.flaky), 'a failure that is not gone keeps the device');
});

test('a device whose owner has left the family is removed without a message', async () => {
  const tree = 'lindes-left';
  const keys = (await device()).keys;
  const alice = await userWith(tree);
  const vapid = await vapidConfig();
  await r.saveRegistration({ user: alice, tree, subscription: { endpoint: ENDPOINT('left'), keys }, choices: choices([1], ['birthday']), locale: 'en' });
  await store.accounts().batch([store.q('DELETE FROM membership WHERE user = ? AND tree = ?', alice, tree)]);
  const { sent, fetchImpl } = fakePush();
  const totals = await r.sendDailyReminders({ trees: [tree], now: NOW, vapid, fetchImpl, log: () => {}, loadGraph: async () => graph });
  assert.deepEqual(totals, { sent: 0, removed: 1, failed: 0, skipped: 0, errors: 0 });
  assert.equal(sent.length, 0, 'nothing is sent to a removed member');
  assert.equal(await rowCount(tree), 0);
});

test('devices not opened for 35 days are paused, and removed after 60', async () => {
  const tree = 'lindes-stale';
  const keys = (await device()).keys;
  const alice = await userWith(tree);
  const vapid = await vapidConfig();
  await r.saveRegistration({ user: alice, tree, subscription: { endpoint: ENDPOINT('stale'), keys }, choices: choices([1], ['birthday']), locale: 'en' });
  const seenDaysAgo = async (days: number) => store.accounts().batch([store.q('UPDATE push_subscription SET last_seen = ? WHERE tree = ?', NOW.getTime() - days * DAY, tree)]);
  const run = () => r.sendDailyReminders({ trees: [tree], now: NOW, vapid, fetchImpl: fakePush().fetchImpl, log: () => {}, loadGraph: async () => graph });
  await seenDaysAgo(40);
  assert.deepEqual(await run(), { sent: 0, removed: 0, failed: 0, skipped: 0, errors: 0 }, 'paused: nothing sent');
  assert.equal(await rowCount(tree), 1);
  await seenDaysAgo(61);
  assert.equal((await run()).removed, 1);
  assert.equal(await rowCount(tree), 0);
});

test('a test push goes to this device only, and an expired device is removed', async () => {
  const tree = 'lindes-test';
  const phone = await device();
  const alice = await userWith(tree);
  const bo = await userWith(tree);
  const vapid = await vapidConfig();
  const endpoint = ENDPOINT('test-phone');
  await r.saveRegistration({ user: alice, tree, subscription: { endpoint, keys: phone.keys }, choices: choices([0], ['birthday']), locale: 'en' });
  await assert.rejects(r.sendTest({ user: bo, tree, endpoint }, vapid), (e: unknown) => e instanceof AuthError, 'another person has no such device');
  const { sent, fetchImpl } = fakePush();
  assert.deepEqual(await r.sendTest({ user: alice, tree, endpoint }, vapid, fetchImpl), { status: 'sent' });
  assert.deepEqual(await open(sent[0].body, phone), { title: 'Family reminder', body: 'Reminders are working on this device.', tag: `kindred-test-${tree}`, url: `/${tree}` });
  const gone = fakePush({ [endpoint]: 410 });
  assert.deepEqual(await r.sendTest({ user: alice, tree, endpoint }, vapid, gone.fetchImpl), { status: 'expired' });
  assert.equal(await r.subscriptionOf(alice, tree, endpoint), undefined);
  // The device is gone now, so a second test is refused until it turns reminders on again.
  await assert.rejects(r.sendTest({ user: alice, tree, endpoint }, vapid, fakePush().fetchImpl), (e: unknown) => e instanceof AuthError);
});

test('a failing family does not stop the others', async () => {
  const phone = await device();
  const vapid = await vapidConfig();
  const broken = 'lindes-broken';
  const fine = 'lindes-fine';
  const alice = await userWith(fine);
  await userWith(broken);
  await r.saveRegistration({ user: alice, tree: fine, subscription: { endpoint: ENDPOINT('fine'), keys: phone.keys }, choices: choices([1], ['birthday']), locale: 'en' });
  const logged: string[] = [];
  const totals = await r.sendDailyReminders({
    trees: [broken, fine],
    now: NOW,
    vapid,
    fetchImpl: fakePush().fetchImpl,
    log: (message) => logged.push(message),
    loadGraph: async (tree) => {
      if (tree === broken) throw new Error('the family database is unreachable');
      return graph;
    },
  });
  assert.equal(totals.errors, 1);
  assert.equal(totals.sent, 1);
  assert.deepEqual(logged, [`family ${broken}: the family database is unreachable`]);
});

test('a test that the push service refuses reports the status, and keeps the device', async () => {
  const tree = 'lindes-refused';
  const phone = await device();
  const alice = await userWith(tree);
  const vapid = await vapidConfig();
  const endpoint = ENDPOINT('refused');
  await r.saveRegistration({ user: alice, tree, subscription: { endpoint, keys: phone.keys }, choices: choices([0], ['birthday']), locale: 'en' });
  assert.deepEqual(await r.sendTest({ user: alice, tree, endpoint }, vapid, fakePush({ [endpoint]: 500 }).fetchImpl), { status: 'failed', code: 500 });
  assert.ok(await r.subscriptionOf(alice, tree, endpoint), 'a refusal that is not gone keeps the device');
  assert.deepEqual([...OFFSETS], [0, 1, 7], 'the three days the app offers');
});
