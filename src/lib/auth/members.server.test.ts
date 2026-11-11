// node --test src/lib/auth/members.server.test.ts — when a steward removes a member (the one way a membership ends), what of
// theirs goes and what stays in the family (members.server.ts): reactions, quiz answers, Campaign rows, reminder devices and
// the choices for being told go; memories, comments, the chronicle and the history stay; a second removal changes nothing;
// the last steward cannot be removed. A scratch family and accounts database; never data/. Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-members-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
for (const tree of ['family', 'other']) {
  const family = openSqlite(join(dir, `${tree}.db`), 'tree', { create: true });
  family.exec(`
    INSERT INTO meta (key, value) VALUES ('id', '${tree}'), ('name', 'Family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
    INSERT INTO person (id, given, surname, born, living) VALUES ('ada', 'Ada', 'Alder', '1890', 0), ('ben', 'Ben', 'Alder', '1920', 0);
  `);
  family.close();
}
const db = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const R = await load<typeof import('../responses.server.ts')>('/src/lib/responses.server.ts');
const store = await load<typeof import('./store.server.ts')>('/src/lib/auth/store.server.ts');
const M = await load<typeof import('./members.server.ts')>('/src/lib/auth/members.server.ts');
const reminders = await load<typeof import('../reminders.server.ts')>('/src/lib/reminders.server.ts');
const { b64url } = await load<typeof import('../webpush.ts')>('/src/lib/webpush.ts');
const { translate } = await load<typeof import('../i18n/dictionary.ts')>('/src/lib/i18n/dictionary.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

type Role = 'viewer' | 'contributor' | 'editor' | 'steward';
async function member(name: string, role: Role, tree = 'family') {
  const { user, insert } = store.newUser(name, null);
  await store.accounts().batch([insert, store.upsertMembership(user.id, tree, role)]);
  return { id: user.id, name, role };
}
const run = (tree: string, sql: string, ...p: (string | number | null)[]) => db.db(tree).run(sql, ...p);
const count = async (table: string, where = '1 = 1', tree = 'family') => (await db.db(tree).get<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))!.n;
const devices = async (user: string, tree?: string) =>
  (await store.accounts().get<{ n: number }>(`SELECT count(*) AS n FROM push_subscription WHERE user = ?${tree ? ' AND tree = ?' : ''}`, ...(tree ? [user, tree] : [user])))!.n;
let n = 0;
async function story(person: string, author: { id: string; name: string }) {
  const id = `s${++n}`;
  await run('family', 'INSERT INTO story (id, person, kind, body, author, at, author_account) VALUES (?, ?, ?, ?, ?, ?, ?)', id, person, 'memory', 'We went to the lake.', author.name, new Date().toISOString(), author.id);
  return id;
}
async function device(user: string, tree: string, endpoint: string) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const at = Date.now();
  await store.accounts().run(
    "INSERT INTO push_subscription (id, user, tree, endpoint, p256dh, auth, offsets, kinds, locale, created, last_seen, weekly) VALUES (?, ?, ?, ?, ?, ?, '[0]', '[\"birthday\"]', 'en', ?, ?, 1)",
    crypto.randomUUID(), user, tree, endpoint, p256dh, auth, at, at,
  );
}
const steward = await member('Stella Steward', 'steward');
const editor = await member('Eda Editor', 'editor');

/** Everything a member can leave behind in the family, in both families (so the other one shows what must not change). */
async function leaveTraces(who: { id: string; name: string; role: Role }, other?: string) {
  const s = await story('ada', editor);
  await R.react('family', who, 'story', s, '❤️', true);
  const { id: commentId } = await R.addComment('family', who, 'story', s, 'I was there.');
  await run('family', "INSERT OR IGNORE INTO quiz_day (day, kind, about, question, answer) VALUES ('2026-11-10', 'k', NULL, '{}', '0')");
  await run('family', "INSERT INTO quiz_answer (day, account, choice, correct, house, at) VALUES ('2026-11-10', ?, '0', 1, NULL, '2026-11-10T08:00:00Z')", who.id);
  await run('family', "INSERT OR IGNORE INTO campaign_season (season, seed, started, map, sides, state) VALUES (1, 's', 1, '{}', '[]', '{}')");
  await run('family', "INSERT INTO campaign_member (season, account, name, side, pledged, orders) VALUES (1, ?, ?, 'ash', 1, 2)", who.id, who.name);
  await run('family', "INSERT INTO campaign_log (season, day, at, kind, side, account, name) VALUES (1, 1, '2026-11-10T08:00:00Z', 'pledge', 'ash', ?, ?)", who.id, who.name);
  await run('family', "INSERT INTO campaign_push (account, day) VALUES (?, '2026-11-10')", who.id);
  await run('family', 'INSERT INTO response_push (account, enabled) VALUES (?, 1)', who.id);
  await device(who.id, 'family', `https://web.push.apple.com/${who.id}-family`);
  if (other) await device(who.id, other, `https://web.push.apple.com/${who.id}-other`);
  return { story: s, commentId };
}

test('removing a member takes their reactions, quiz answers, Campaign rows, push claims and devices; memories and comments stay', async () => {
  const lou = await member('Lou Leaving', 'contributor');
  const other = await member('Ola Other', 'contributor');
  const { story: s } = await leaveTraces(lou);
  await R.react('family', other, 'story', s, '❤️', true);
  await run('family', "INSERT INTO quiz_answer (day, account, choice, correct, house, at) VALUES ('2026-11-10', ?, '0', 1, NULL, '2026-11-10T08:00:00Z')", other.id);
  const own = await story('ben', lou);

  await M.endMembership('family', lou.id);

  assert.equal(await store.membership(lou.id, 'family'), undefined);
  for (const table of ['reaction', 'quiz_answer', 'campaign_member', 'campaign_push', 'response_push']) assert.equal(await count(table, 'account = ?'.replace('?', `'${lou.id}'`)), 0, `${table} of the removed member`);
  assert.equal(await devices(lou.id), 0, 'no reminder device is left for the family');
  // What others did, and what is the family's record, is untouched.
  assert.equal(await count('reaction', `account = '${other.id}'`), 1);
  assert.equal(await count('quiz_answer', `account = '${other.id}'`), 1);
  assert.equal(await count('story', `id = '${own}'`), 1, 'their memories stay');
  assert.equal(await count('comment', `account = '${lou.id}'`), 1, 'their comment stays');
  assert.equal(await count('campaign_log', `account = '${lou.id}'`), 1, 'the chronicle keeps what happened, under their name');
});

test('a comment by someone who left still renders, under the name it was written with', async () => {
  const gone = await member('Gil Gone', 'contributor');
  const s = await story('ada', editor);
  await R.addComment('family', gone, 'story', s, 'Farewell.');
  await M.endMembership('family', gone.id);
  const t = await R.thread('family', steward, 'story', s);
  assert.equal(t.comments.length, 1);
  assert.equal(t.comments[0].authorName, 'Gil Gone');
  assert.equal(t.comments[0].person, null);
  // Even once the account itself is gone, and for a comment written with no name at all.
  await store.accounts().run('DELETE FROM user WHERE id = ?', gone.id);
  await run('family', "UPDATE comment SET author_name = '' WHERE account = ?", gone.id);
  const again = await R.thread('family', steward, 'story', s);
  assert.equal(again.comments[0].authorName, '', 'the reader shows "a former member" for it');
  for (const locale of ['en', 'de', 'af'] as const) assert.notEqual(translate(locale, 'responses.former_member'), 'responses.former_member');
});

test('a removed member gets no push about this family, and their devices for other families stay', async () => {
  const pia = await member('Pia Poster', 'contributor');
  const s = await story('ben', pia);
  await run('family', 'INSERT INTO response_push (account, enabled) VALUES (?, 1)', pia.id);
  await device(pia.id, 'family', 'https://web.push.apple.com/pia-family');
  await store.accounts().run('INSERT INTO membership (user, tree, role, created) VALUES (?, ?, ?, ?)', pia.id, 'other', 'viewer', Date.now());
  await device(pia.id, 'other', 'https://web.push.apple.com/pia-other');
  const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const vapid = { publicKey: b64url(await crypto.subtle.exportKey('raw', signing.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', signing.privateKey), subject: 'mailto:family@example.org' };
  const sent: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => { sent.push(String(url)); return new Response(null, { status: 201 }); }) as typeof fetch;

  await M.endMembership('family', pia.id);

  assert.equal(await R.notifyAuthor('family', { kind: 'story', target: s, by: steward, what: 'comment' }, { now: new Date(), vapid, fetchImpl }), 0, 'not told about a reply to their memory');
  const totals = await reminders.sendDailyReminders({ trees: ['family'], now: new Date(), vapid, fetchImpl, log: () => {}, loadGraph: async () => ({ people: [], unions: [], parents: [], houses: [], meta: {} }) as never });
  assert.equal(totals.sent, 0);
  assert.deepEqual(sent, [], 'nothing reached a push service');
  assert.equal(await devices(pia.id, 'family'), 0);
  assert.equal(await devices(pia.id, 'other'), 1, 'the other family is theirs still');
});

test('removing them again changes nothing, and finishes what a failed first try left behind', async () => {
  const lou = await member('Lou Twice', 'contributor');
  await leaveTraces(lou);
  // The accounts step ran and the family step did not (a failure between the two stores).
  await store.accounts().run('DELETE FROM membership WHERE user = ?', lou.id);
  assert.equal(await count('reaction', `account = '${lou.id}'`), 1);
  await M.endMembership('family', lou.id);
  assert.equal(await count('reaction', `account = '${lou.id}'`), 0);
  const before = await count('history');
  await M.endMembership('family', lou.id);
  await M.forgetInFamily('family', lou.id);
  assert.equal(await count('history'), before);
  assert.equal(await count('comment', `account = '${lou.id}'`), 1);
});

test('someone invited back before the clean-up runs again keeps what they have made since', async () => {
  const back = await member('Bea Back', 'contributor');
  const { story: s } = await leaveTraces(back);
  await M.endMembership('family', back.id);
  await store.accounts().batch([store.upsertMembership(back.id, 'family', 'contributor')]);
  await R.react('family', back, 'story', s, '🕯️', true);
  await M.forgetInFamily('family', back.id);
  assert.equal(await count('reaction', `account = '${back.id}'`), 1);
});

test('their private items and the history of them go; the history of what they changed in the family keeps their name', async () => {
  const pat = await member('Pat Private', 'contributor');
  await run('family', "INSERT INTO person_field (id, person, type, label, value, visibility, owner, created_by) VALUES ('f-priv', 'ada', 'notes', 'Secret', '{}', 'personal', ?, ?)", pat.id, pat.id);
  await run('family', "INSERT INTO history (at, account, name, kind, record, action, level, owner, count, fn) VALUES ('2026-11-10T08:00:00Z', ?, ?, 'field', 'f-priv', 'added', 'personal', ?, 1, 'x')", pat.id, pat.name, pat.id);
  await run('family', "INSERT INTO history (at, account, name, kind, record, action, level, count, fn) VALUES ('2026-11-10T08:01:00Z', ?, ?, 'person', 'ada', 'changed', 'family', 1, 'x')", pat.id, pat.name);
  await M.endMembership('family', pat.id);
  assert.equal(await count('person_field', "id = 'f-priv'"), 0);
  assert.equal(await count('history', `owner = '${pat.id}'`), 0);
  assert.equal(await count('history', `account = '${pat.id}' AND name = 'Pat Private'`), 1);
});

test('the last steward cannot be removed, and nothing is forgotten when it is refused', async () => {
  const only = await member('Sole Steward', 'steward', 'other');
  await run('other', 'INSERT INTO response_push (account, enabled) VALUES (?, 1)', only.id);
  await assert.rejects(M.endMembership('other', only.id), /at least one steward/);
  assert.ok(await store.membership(only.id, 'other'));
  assert.equal(await count('response_push', `account = '${only.id}'`, 'other'), 1);
});
