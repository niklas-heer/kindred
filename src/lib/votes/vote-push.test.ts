// node --test src/lib/votes/vote-push.test.ts — the pushes about family votes, on a private data folder with a fresh family
// per test: a new vote reaches the devices that asked (never the creator's, at most one in six hours per device), the reminder
// a day before a vote closes reaches each member who asked and has not voted (also in a secret vote) once, the vote's creator
// hears of answers on it as a post's writer does, the texts name the question in every language, and a demo or a preview sends
// nothing. The device switch is saved with the other reminder choices. Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-vote-push-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
const db = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const V = await load<typeof import('./votes.server.ts')>('/src/lib/votes/votes.server.ts');
const Push = await load<typeof import('./vote-push.server.ts')>('/src/lib/votes/vote-push.server.ts');
const R = await load<typeof import('../responses.server.ts')>('/src/lib/responses.server.ts');
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
type Input = Parameters<typeof V.createVote>[2];

const NOW = new Date('2026-11-15T10:00:00.000Z');
const DAY = 86_400_000;
const HOUR = 3_600_000;
const later = (ms: number, from = NOW) => new Date(from.getTime() + ms);

let families = 0;
/** A fresh family for one test, with its members' accounts: Ada (contributor, who starts votes), Bo, Carl and Dee. */
async function family() {
  const tree = `vpush${++families}`;
  await db.store.ensureTree(tree);
  const member = async (name: string, role: Role) => {
    const { user, insert } = store.newUser(name, null);
    await store.accounts().batch([insert, store.upsertMembership(user.id, tree, role)]);
    return { id: user.id, name, role, person: null, personConfirmed: false };
  };
  return { tree, ada: await member('Ada Alder', 'contributor'), bo: await member('Bo Birch', 'viewer'), carl: await member('Carl Cedar', 'viewer'), dee: await member('Dee Dune', 'editor') };
}
/** A device of `user` in `tree`, with the votes switch on or off, last opened at `seen`. */
async function device(tree: string, user: string, name: string, votes: 0 | 1, seen = NOW.getTime()) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
  await store.accounts().run(
    `INSERT INTO push_subscription (id, user, tree, endpoint, p256dh, auth, offsets, kinds, locale, created, last_seen, votes)
     VALUES (?, ?, ?, ?, ?, ?, '[0]', '["birthday"]', 'de', ?, ?, ?)`, crypto.randomUUID(), user, tree, `https://web.push.apple.com/${tree}/${name}`, p256dh, auth, seen, seen, votes);
}
async function vapidKeys() {
  const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { publicKey: b64url(await crypto.subtle.exportKey('raw', signing.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', signing.privateKey), subject: 'mailto:family@example.org' };
}
/** A push service that answers 201 and remembers which devices it was asked to reach, by their names. */
function service() {
  const sent: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => { sent.push(String(url).split('/').at(-1)!); return new Response(null, { status: 201 }); }) as typeof fetch;
  return { sent, fetchImpl };
}
const input = (over: Partial<Input> = {}): Input => ({
  question: 'Where do we meet next summer?', description: '', kind: 'single', secret: false, addOptions: false, guests: false,
  closesAt: later(7 * DAY).toISOString(), options: ['Beach', 'Mountains', 'Lake'], ...over,
});
const optionIds = async (tree: string, vote: string) => (await db.db(tree).all<{ id: string }>('SELECT id FROM vote_option WHERE vote = ? ORDER BY ord', vote)).map((r) => r.id);

test('a new vote: only to devices that asked, never to the creator, at most one in six hours per device', async () => {
  const { tree, ada, bo, carl, dee } = await family();
  await device(tree, ada.id, 'ada', 1);
  await device(tree, bo.id, 'bo', 1);
  await device(tree, carl.id, 'carl-off', 0);
  await device(tree, dee.id, 'dee-stale', 1, NOW.getTime() - 400 * DAY);
  const vapid = await vapidKeys();
  const { sent, fetchImpl } = service();
  const { id: first } = await V.createVote(tree, ada, input(), undefined, NOW);
  const { id: second } = await V.createVote(tree, ada, input({ question: 'Cake or pie?', options: ['Cake', 'Pie'] }), undefined, NOW);

  assert.equal(await Push.notifyVote(tree, ada, first, { vapid: null, fetchImpl, now: NOW }), 0, 'nothing without the server’s keys');
  assert.equal(await Push.notifyVote(tree, ada, first, { vapid, fetchImpl, now: NOW }), 1);
  assert.deepEqual(sent, ['bo'], 'not the creator, not a device that did not ask, not one unopened for long');
  assert.equal(await Push.notifyVote(tree, ada, second, { vapid, fetchImpl, now: later(HOUR) }), 0, 'a busy hour is one push');
  assert.equal(await Push.notifyVote(tree, ada, second, { vapid, fetchImpl, now: later(6 * HOUR) }), 1, 'six hours on, the device is told again');
  assert.equal(await Push.notifyVote(tree, ada, '00000000-0000-4000-8000-000000000000', { vapid, fetchImpl, now: later(DAY) }), 0, 'a vote not there names nothing');
  assert.deepEqual(sent, ['bo', 'bo']);
  // The post push has its own quiet hours: a vote does not use them up, nor they a vote's.
  assert.equal((await store.accounts().get<{ p: number | null }>('SELECT posts_sent_at AS p FROM push_subscription WHERE user = ?', bo.id))?.p, null);
});

test('the reminder: open votes closing within a day, to members who asked and have not voted, once each; also in a secret vote', async () => {
  const { tree, ada, bo, carl, dee } = await family();
  for (const [m, name] of [[ada, 'ada'], [bo, 'bo'], [carl, 'carl']] as const) await device(tree, m.id, name, 1);
  await device(tree, dee.id, 'dee-off', 0);
  const vapid = await vapidKeys();
  const { sent, fetchImpl } = service();
  const { id: open } = await V.createVote(tree, ada, input({ closesAt: later(30 * HOUR).toISOString() }), undefined, NOW);
  const { id: secret } = await V.createVote(tree, ada, input({ secret: true, question: 'Which name for the dog?', options: ['Rex', 'Fido'], closesAt: later(30 * HOUR).toISOString() }), undefined, NOW);
  const { id: far } = await V.createVote(tree, ada, input({ closesAt: later(3 * DAY).toISOString() }), undefined, NOW);
  const { id: closed } = await V.createVote(tree, ada, input({ closesAt: later(30 * HOUR).toISOString() }), undefined, NOW);
  await V.closeVote(tree, ada, closed, undefined, later(HOUR));
  await V.castBallot(tree, { kind: 'member', who: bo }, open, [(await optionIds(tree, open))[0]!], later(HOUR));
  await V.castBallot(tree, { kind: 'member', who: bo }, secret, [(await optionIds(tree, secret))[1]!], later(HOUR));
  await V.castBallot(tree, { kind: 'member', who: ada }, open, [(await optionIds(tree, open))[2]!], later(HOUR));

  assert.equal(await Push.remindVotes(tree, later(2 * HOUR), { vapid, fetchImpl }), 0, 'more than a day before closing: nothing yet');
  const at = later(8 * HOUR);
  assert.equal(await Push.remindVotes(tree, at, { vapid: null, fetchImpl }), 0, 'nothing without the server’s keys');
  assert.equal(await Push.remindVotes(tree, at, { vapid, fetchImpl }), 3);
  // Open vote: Ada and Bo voted, so Carl. Secret vote: Bo voted (found by vote_voter, never by a ballot), so Ada and Carl.
  assert.deepEqual(sent.sort(), ['ada', 'carl', 'carl']);
  const reminded = await db.db(tree).all<{ vote: string; account: string }>('SELECT vote, account FROM vote_reminded ORDER BY vote, account');
  assert.deepEqual(new Set(reminded.map((r) => `${r.vote}:${r.account}`)), new Set([`${open}:${carl.id}`, `${secret}:${ada.id}`, `${secret}:${carl.id}`]));
  assert.ok(!reminded.some((r) => r.vote === far || r.vote === closed));

  assert.equal(await Push.remindVotes(tree, later(9 * HOUR), { vapid, fetchImpl }), 0, 'once per member and vote');
  assert.equal(await Push.remindVotes(tree, later(31 * HOUR), { vapid, fetchImpl }), 0, 'a vote that has closed is not reminded');
  assert.equal(sent.length, 3);
});

test('the reminder claims nothing for a member with no device that asked, so a device turned on later still hears', async () => {
  const { tree, ada, carl } = await family();
  await device(tree, carl.id, 'carl', 0);
  const vapid = await vapidKeys();
  const { sent, fetchImpl } = service();
  await V.createVote(tree, ada, input({ closesAt: later(30 * HOUR).toISOString() }), undefined, NOW);
  assert.equal(await Push.remindVotes(tree, later(8 * HOUR), { vapid, fetchImpl }), 0);
  assert.equal((await db.db(tree).get<{ n: number }>('SELECT count(*) AS n FROM vote_reminded'))!.n, 0);
  await store.accounts().run('UPDATE push_subscription SET votes = 1 WHERE user = ?', carl.id);
  assert.equal(await Push.remindVotes(tree, later(9 * HOUR), { vapid, fetchImpl }), 1);
  assert.deepEqual(sent, ['carl']);
});

test('the vote’s creator hears of reactions and comments on it, as a post’s writer does', async () => {
  const { tree, ada, bo } = await family();
  await device(tree, ada.id, 'ada', 0);
  const vapid = await vapidKeys();
  const { sent, fetchImpl } = service();
  const { id } = await V.createVote(tree, ada, input(), undefined, NOW);
  const answer = { kind: 'vote' as const, target: id, by: bo, what: 'comment' as const };
  assert.equal(await R.notifyAuthor(tree, answer, { now: NOW, vapid, fetchImpl }), 0, 'off until the creator turns it on');
  await R.setResponsePush(tree, ada, true);
  assert.equal(await R.notifyAuthor(tree, { ...answer, by: ada }, { now: NOW, vapid, fetchImpl }), 0, 'not for their own comment');
  assert.equal(await R.notifyAuthor(tree, answer, { now: NOW, vapid, fetchImpl }), 1);
  assert.equal(await R.notifyAuthor(tree, { ...answer, what: 'reaction', reaction: '❤️' }, { now: later(DAY), vapid, fetchImpl }), 1);
  assert.deepEqual(sent, ['ada', 'ada']);
});

test('the texts name the question and never a choice, in every language', async () => {
  const vars = { name: 'Ada Alder', question: 'Where do we meet?', family: 'The Alders', reaction: '❤️', person: '' };
  for (const locale of LOCALES) {
    assert.match(translate(locale, 'votes.push.title', vars), /Ada Alder/, locale);
    assert.match(translate(locale, 'votes.push.body', vars), /Where do we meet\?/, locale);
    assert.match(translate(locale, 'votes.push.remind_body', vars), /Where do we meet\?/, locale);
    assert.ok(translate(locale, 'votes.push.remind_title', vars), locale);
    assert.match(translate(locale, 'responses.push.comment_vote', vars), /Ada Alder/, locale);
    assert.match(translate(locale, 'responses.push.reaction_vote', vars), /❤️/, locale);
  }
});

test('a demo and a steward’s preview send no push about a vote', async () => {
  const { tree, ada, carl } = await family();
  await device(tree, carl.id, 'carl', 1);
  const vapid = await vapidKeys();
  const { sent, fetchImpl } = service();
  const { id } = await V.createVote(tree, ada, input({ closesAt: later(30 * HOUR).toISOString() }), undefined, NOW);
  process.env.KINDRED_DEMO = '1';
  try {
    assert.equal(await Push.notifyVote(tree, ada, id, { vapid, fetchImpl, now: NOW }), 0);
    assert.equal(await Push.remindVotes(tree, later(8 * HOUR), { vapid, fetchImpl }), 0);
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  readOnly.onRequestReadOnly(() => new AuthError('forbidden', 'You are viewing as a viewer. Stop the preview to change something.'));
  try {
    assert.equal(await Push.notifyVote(tree, ada, id, { vapid, fetchImpl, now: NOW }), 0);
    assert.equal(await Push.remindVotes(tree, later(8 * HOUR), { vapid, fetchImpl }), 0);
  } finally {
    readOnly.onRequestReadOnly(() => undefined);
  }
  assert.deepEqual(sent, []);
  assert.equal(await Push.notifyVote(tree, ada, id, { vapid, fetchImpl, now: NOW }), 1, 'the control: outside both it is sent');
});

test('the votes switch is the device’s, saved with its other reminder choices, and off until asked for', async () => {
  const reminders = await load<typeof import('../reminders.server.ts')>('/src/lib/reminders.server.ts');
  const { parseChoices } = await load<typeof import('../reminders.ts')>('/src/lib/reminders.ts');
  const { tree, bo } = await family();
  const endpoint = `https://web.push.apple.com/${tree}/bo-switch`;
  const registration = { user: bo.id, tree, subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } }, choices: parseChoices([0], ['birthday'])!, locale: 'en' as const };
  const votes = async () => (await reminders.subscriptionOf(bo.id, tree, endpoint))?.votes;
  await reminders.saveRegistration(registration);
  assert.equal(await votes(), 0);
  await reminders.saveRegistration({ ...registration, votes: true });
  assert.equal(await votes(), 1);
  await reminders.saveRegistration({ ...registration, votes: false });
  assert.equal(await votes(), 0);
});
