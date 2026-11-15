// node --test src/lib/suggestions/expiry.test.ts — the suggestions' daily job on a private data folder with a fresh family per
// test: waiting suggestions older than EXPIRY_DAYS expire (decided_at the run's time, their files gone from storage and from the
// usage count), partly applied, recent and decided ones are left, the job runs without push keys, objects no row names are
// swept from `suggest/` and `source/` (young ones kept), and a suggester sees the outcomes in What's new. Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-expiry-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
const db = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const H = await load<typeof import('../history.server.ts')>('/src/lib/history.server.ts');
const S = await load<typeof import('./suggest.server.ts')>('/src/lib/suggestions/suggest.server.ts');
const R = await load<typeof import('./review.server.ts')>('/src/lib/suggestions/review.server.ts');
const X = await load<typeof import('./expiry.server.ts')>('/src/lib/suggestions/expiry.server.ts');
const { suggestionsJob } = await load<typeof import('../jobs/suggestions.ts')>('/src/lib/jobs/suggestions.ts');
const { outcomeKey } = await load<typeof import('../history.ts')>('/src/lib/history.ts');
const { EXPIRY_DAYS } = await load<typeof import('./types.ts')>('/src/lib/suggestions/types.ts');

test.after(async () => {
  H.actingAs(undefined);
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const DAY = 86_400_000;
const NOW = new Date('2026-11-15T10:00:00.000Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

let families = 0;
async function family(): Promise<string> {
  const id = `exp${++families}`;
  await db.store.ensureTree(id);
  const d = db.db(id);
  await d.run("INSERT INTO meta (key, value) VALUES ('id', ?), ('name', 'The Alders') ON CONFLICT (key) DO UPDATE SET value = excluded.value", id);
  await d.run("INSERT INTO person (id, given, surname, sex, born, living) VALUES ('bo', 'Bo', 'Alder', 'm', '1920', 0)");
  await d.run("INSERT INTO person (id, given, surname, living) VALUES ('fen', 'Fen', 'Fir', 0)");
  return id;
}
const who = (id: string, name: string, role: 'viewer' | 'contributor' | 'editor' | 'steward') => ({ id, name, role, person: null, personConfirmed: false });
const eli = who('acc-eli', 'Eli Elm', 'contributor');
const fay = who('acc-fay', 'Fay Fir', 'editor');
const member = (w: ReturnType<typeof who>) => ({ kind: 'member' as const, who: w });
const PNG = () => new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const stored = async (t: string, prefix: string) => (await db.store.media.list(t)).map((f) => f.key).filter((k) => k.startsWith(prefix)).sort();
const usage = async (t: string, prefix: string) =>
  (await db.store.accounts().all<{ key: string }>('SELECT key FROM media_usage WHERE tree = ? AND key LIKE ? ORDER BY key', t, `${prefix}%`)).map((r) => r.key);
const row = (t: string, id: string) => db.db(t).get<{ status: string; decided_at: string | null; decided_by: string | null }>('SELECT status, decided_at, decided_by FROM suggestion WHERE id = ?', id);

/** A waiting suggestion by Eli with a picture, made `days` ago. */
async function waiting(t: string, days: number, person = 'bo') {
  const { id } = await S.createSuggestion(t, member(eli), { kind: 'details', person, payload: { born: '1919' } as never }, NOW);
  await S.addSuggestionFile(t, member(eli), id, { name: 'p.png', mime: 'image/png', bytes: PNG() }, NOW);
  await db.db(t).run('UPDATE suggestion SET created_at = ? WHERE id = ?', ago(days), id);
  return id;
}

test('waiting suggestions older than EXPIRY_DAYS expire at the run’s time, their files go; newer, decided and partly applied ones stay', async () => {
  const t = await family();
  const old = await waiting(t, EXPIRY_DAYS + 1);
  const recent = await waiting(t, EXPIRY_DAYS - 1);
  const partial = await waiting(t, EXPIRY_DAYS + 5);
  const declined = await waiting(t, EXPIRY_DAYS + 5);
  await db.db(t).run("INSERT INTO history (at, account, name, kind, record, person, person_name, label, action, level, owner, fields, count, fn, suggestion) VALUES (?, 'acc-fay', 'Fay Fir', 'person', 'bo', 'bo', 'Bo Alder', NULL, 'changed', 'family', NULL, NULL, 1, 'x', ?)", ago(1), partial);
  H.actingAs({ account: fay.id, name: fay.name });
  await R.declineSuggestion(t, fay, declined, 'no', NOW);
  assert.equal((await stored(t, 'suggest/')).length, 3);

  assert.equal(await X.expireSuggestions(t, NOW), 1);
  assert.deepEqual({ ...(await row(t, old)) }, { status: 'expired', decided_at: NOW.toISOString(), decided_by: null });
  assert.equal((await row(t, recent))!.status, 'waiting');
  assert.equal((await row(t, partial))!.status, 'waiting', 'a partly applied one is for a reviewer to close');
  assert.equal((await row(t, declined))!.status, 'declined');
  assert.equal((await db.db(t).get<{ n: number }>('SELECT count(*) AS n FROM suggestion_file WHERE suggestion = ?', old))!.n, 0);
  const left = await stored(t, 'suggest/');
  assert.equal(left.length, 2, 'only the old one’s picture went from storage');
  assert.deepEqual(await usage(t, 'suggest/'), left, 'and from the family’s usage');
  assert.equal(await X.expireSuggestions(t, NOW), 0, 'again: nothing more');
});

test('the daily job expires and sweeps without push keys, and one family’s trouble does not stop the next', async () => {
  const a = await family();
  const b = await family();
  const old = await waiting(b, EXPIRY_DAYS + 2);
  const lines: string[] = [];
  await suggestionsJob.run({ trees: ['no-such-family', a, b], now: NOW, env: () => undefined, log: (m) => lines.push(m) });
  assert.equal((await row(b, old))!.status, 'expired');
  assert.match(lines.join('\n'), /expired 1 suggestions/);
});

test('objects no row names are swept from suggest/ and source/ once 30 days old; named, younger and unrecorded ones stay', async () => {
  const t = await family();
  const kept = await waiting(t, 1);
  const named = (await stored(t, 'suggest/'))[0]!;
  await db.db(t).run("INSERT INTO source (id, title, created_at, updated_at) VALUES ('s1', 'A letter', ?, ?)", NOW.toISOString(), NOW.toISOString());
  await db.db(t).run("INSERT INTO source_file (source, media_key, mime, name, ord, added_at) VALUES ('s1', 'source/11111111-1111-1111-1111-111111111111.png', 'image/png', 'a', 0, ?)", NOW.toISOString());
  const keys = {
    namedSource: 'source/11111111-1111-1111-1111-111111111111.png',
    young: 'source/22222222-2222-2222-2222-222222222222.png',
    twoDays: 'suggest/55555555-5555-5555-5555-555555555555.png',
    old: 'suggest/33333333-3333-3333-3333-333333333333.png',
    oldSource: 'source/66666666-6666-6666-6666-666666666666.png',
    unrecorded: 'suggest/77777777-7777-7777-7777-777777777777.png',
    other: 'photo/44444444-4444-4444-4444-444444444444.jpg',
  };
  for (const [name, key] of Object.entries(keys)) await db.media.put(t, key, PNG(), name === 'other' ? 'image/jpeg' : 'image/png');
  const setAge = (key: string, days: number) => db.store.accounts().run('UPDATE media_usage SET at = ? WHERE tree = ? AND key = ?', NOW.getTime() - days * DAY, t, key);
  await setAge(keys.namedSource, 40);
  await setAge(keys.twoDays, 2);
  await setAge(keys.old, 31);
  await setAge(keys.oldSource, 31);
  await setAge(keys.other, 40);
  await db.store.accounts().run('DELETE FROM media_usage WHERE tree = ? AND key = ?', t, keys.unrecorded);
  await db.store.accounts().run('UPDATE media_usage SET at = ? WHERE tree = ? AND key = ?', NOW.getTime(), t, keys.young);

  assert.equal(await X.sweepOrphanFiles(t, NOW), 2);
  assert.deepEqual(await stored(t, 'source/'), [keys.namedSource, keys.young].sort());
  assert.deepEqual(await stored(t, 'suggest/'), [named, keys.twoDays, keys.unrecorded].sort(), 'a 2-day-old stray and one with no usage time stay');
  assert.deepEqual(await stored(t, 'photo/'), [keys.other], 'other prefixes are not this sweep’s');
  assert.equal((await usage(t, 'suggest/3')).length, 0, 'the 31-day-old one left the usage count too');
  assert.equal((await row(t, kept))!.status, 'waiting');
});

test('a failing expiry is logged by family and does not skip the sweep or the next family', async () => {
  const a = await family();
  const b = await family();
  const lines: string[] = [];
  await waiting(a, EXPIRY_DAYS + 3);
  await db.media.put(a, 'suggest/88888888-8888-8888-8888-888888888888.png', PNG(), 'image/png');
  await db.store.accounts().run('UPDATE media_usage SET at = ? WHERE tree = ? AND key LIKE ?', NOW.getTime() - 40 * DAY, a, 'suggest/8%');
  await db.db(a).run('DROP TABLE history'); // makes the expiry read fail for this family alone
  await suggestionsJob.run({ trees: [a, b], now: NOW, env: () => undefined, log: (m) => lines.push(m) });
  assert.match(lines.join('\n'), new RegExp(`family ${a}: `));
  assert.match(lines.join('\n'), /family errors 1/);
  assert.equal((await stored(a, 'suggest/8')).length, 0, 'the sweep still ran');
});

test('a suggester sees the outcomes of their own suggestions since their last visit, never anyone else’s', async () => {
  const t = await family();
  const make = async (by: ReturnType<typeof who>, person: string) =>
    (await S.createSuggestion(t, member(by), { kind: 'details', person, payload: { born: '1919' } as never }, NOW)).id;
  const approved = await make(eli, 'bo');
  const declined = await make(eli, 'fen');
  const expiring = await make(eli, 'bo');
  const withdrawn = await make(eli, 'bo');
  const others = await make(who('acc-gus', 'Gus Gale', 'contributor'), 'bo');
  H.actingAs({ account: fay.id, name: fay.name });
  await R.approveSuggestion(t, fay, approved, undefined, { now: new Date(NOW.getTime() + 1000) });
  await R.declineSuggestion(t, fay, declined, 'Not Fen’s', new Date(NOW.getTime() + 2000));
  await R.declineSuggestion(t, fay, others, 'private', new Date(NOW.getTime() + 2000));
  await S.withdrawSuggestion(t, member(eli), withdrawn, NOW);
  await db.db(t).run('UPDATE suggestion SET created_at = ? WHERE id = ?', ago(EXPIRY_DAYS + 1), expiring);
  await X.expireSuggestions(t, new Date(NOW.getTime() + 3000));

  const audience = { account: eli.id, role: 'contributor' as const, guest: false };
  const news = await H.whatsNew(db.db(t), audience, NOW.getTime() - 1000);
  const byId = Object.fromEntries(news.outcomes.map((o) => [o.id, o]));
  assert.equal(news.outcomes.length, 3, 'approved, declined and expired; not withdrawn, not another member’s');
  assert.deepEqual([byId[approved]!.status, byId[approved]!.adjusted, byId[approved]!.about], ['approved', false, 'Bo Alder']);
  assert.deepEqual([byId[declined]!.status, byId[declined]!.reason, byId[declined]!.about], ['declined', 'Not Fen’s', 'Fen Fir']);
  assert.equal(byId[expiring]!.status, 'expired');
  assert.ok(news.total >= 3);
  assert.equal(JSON.stringify(news.outcomes).includes('Fay'), false, 'who decided is not told');
  assert.equal((await H.whatsNew(db.db(t), audience, NOW.getTime() + 10_000)).outcomes.length, 0, 'only since the last visit');
  assert.equal((await H.whatsNew(db.db(t), { account: 'acc-gus', role: 'contributor', guest: false }, NOW.getTime() - 1000)).outcomes.length, 1, 'each sees their own');
  assert.equal((await H.newsCount(db.db(t), audience, NOW.getTime() - 1000)), 4, 'the three outcomes, and the change the approval made');
});

test('an outcome’s sentence says approved, with changes, in part, declined or expired; an approval whose decision is not known is plain', async () => {
  assert.equal(outcomeKey({ status: 'approved', adjusted: false, partial: false }), 'history.outcome.approved');
  assert.equal(outcomeKey({ status: 'approved', adjusted: true, partial: false }), 'history.outcome.approved_changes');
  assert.equal(outcomeKey({ status: 'approved', adjusted: true, partial: true }), 'history.outcome.approved_part');
  assert.equal(outcomeKey({ status: 'declined', adjusted: null, partial: false }), 'history.outcome.declined');
  assert.equal(outcomeKey({ status: 'expired', adjusted: null, partial: false }), 'history.outcome.expired');
  const t = await family();
  const { id } = await S.createSuggestion(t, member(eli), { kind: 'details', person: 'bo', payload: { born: '1919' } as never }, NOW);
  await db.db(t).run("UPDATE suggestion SET status = 'approved', decided_by = 'acc-fay', decided_at = ?, applied = ? WHERE id = ?", new Date(NOW.getTime() + 1000).toISOString(), JSON.stringify({ partial: true, adjustedUnknown: true }), id);
  const [o] = (await H.whatsNew(db.db(t), { account: eli.id, role: 'contributor', guest: false }, NOW.getTime() - 1000)).outcomes;
  assert.deepEqual([o!.partial, o!.adjusted], [true, null], 'closed as partly applied, with no decision to tell whether it was adjusted');
});
