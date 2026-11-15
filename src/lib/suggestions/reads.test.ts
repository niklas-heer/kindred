// node --test src/lib/suggestions/reads.test.ts — what each reader sees of suggestions, on a private data folder with a fresh
// family per test: the reviewers' waiting list and counts, a suggester's own list (a member's by account, a guest's by their
// cookie's key), who may fetch a pending file and an approved source's file, the headers a file is served with, and the
// change history naming who suggested an approved change. Review Focus 3: nobody else reads a suggestion or a pending file,
// and pending data reaches neither the feed, nor the history, nor the exports, nor the assistant. Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-reads-test-'));
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
const V = await load<typeof import('./reads.server.ts')>('/src/lib/suggestions/reads.server.ts');
const Src = await load<typeof import('../sources.server.ts')>('/src/lib/sources.server.ts');
const F = await load<typeof import('../feed/feed.server.ts')>('/src/lib/feed/feed.server.ts');
const X = await load<typeof import('../exchange/export.server.ts')>('/src/lib/exchange/export.server.ts');
const T = await load<typeof import('../ai/tools.server.ts')>('/src/lib/ai/tools.server.ts');
const P = await load<typeof import('../person.server.ts')>('/src/lib/person.server.ts');

test.after(async () => {
  H.actingAs(undefined);
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

type Role = 'viewer' | 'contributor' | 'editor' | 'steward';
const NOW = new Date('2026-11-15T10:00:00.000Z');
const LATER = new Date('2026-11-16T09:30:00.000Z');

let families = 0;
/** A fresh family: Ada (living, born 1950), her late parents Bo (1920–1990) and Cara (1922–2001), Bo's baptism in 1920. */
async function family(): Promise<string> {
  const id = `reads${++families}`;
  await db.store.ensureTree(id);
  const d = db.db(id);
  await d.run("INSERT INTO meta (key, value) VALUES ('id', ?), ('name', 'The Alders') ON CONFLICT (key) DO UPDATE SET value = excluded.value", id);
  await d.run("INSERT INTO person (id, given, surname, sex, born, living) VALUES ('ada', 'Ada', 'Alder', 'f', '1950', 1)");
  await d.run("INSERT INTO person (id, given, surname, sex, born, born_place, died, living) VALUES ('bo', 'Bo', 'Alder', 'm', '1920', 'Lund', '1990', 0)");
  await d.run("INSERT INTO person (id, given, surname, current_surname, sex, born, died, living) VALUES ('cara', 'Cara', 'Birch', 'Alder', 'f', '1922', '2001', 0)");
  await d.run("INSERT INTO parent (child, parent) VALUES ('ada', 'bo'), ('ada', 'cara')");
  await d.run("INSERT INTO partnership (id, a, b, kind, start, place) VALUES ('u1', 'bo', 'cara', 'marriage', '1948', 'Lund')");
  await d.run("INSERT INTO life_event (id, person, type, date, place, note, created_at, updated_at) VALUES ('e1', 'bo', 'baptism', '1920', 'Lund', '', ?, ?)", NOW.toISOString(), NOW.toISOString());
  return id;
}
const who = (id: string, name: string, role: Role, person: string | null = null) => ({ id, name, role, person, personConfirmed: !!person });
const ada = who('acc-ada', 'Ada Alder', 'viewer', 'ada');
const eli = who('acc-eli', 'Eli Elm', 'contributor');
const fay = who('acc-fay', 'Fay Fir', 'editor');
const gus = who('acc-gus', 'Gus Gale', 'steward');
const guestWho = { id: '', name: '', role: 'viewer' as const, guest: true };
const member = (w: ReturnType<typeof who>) => ({ kind: 'member' as const, who: w });
const guest = (n: number, protectLiving = true) => ({ kind: 'guest' as const, key: `g:key-${n}`, name: `Hal ${n}`, link: 'link-1', net: n, protectLiving });
const asReviewer = (w: ReturnType<typeof who>) => H.actingAs({ account: w.id, name: w.name });

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  assert.fail('expected a refusal');
}

const PNG = () => new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const file = (name: string) => ({ name, mime: 'image/png', bytes: PNG() });
const suggest = (t: string, by: Parameters<typeof S.createSuggestion>[1], kind: 'details' | 'relative' | 'event' | 'source', person: string | null, payload: unknown, note?: string) =>
  S.createSuggestion(t, by, { kind, person, payload: payload as never, note }, NOW);
const fileId = async (t: string, suggestion: string) => (await db.db(t).get<{ id: string }>('SELECT id FROM suggestion_file WHERE suggestion = ?', suggestion))!.id;

// ---------- the reviewers' list ----------

test('a reviewer sees every waiting suggestion, newest first, with its author, note, files and "current → suggested"', async () => {
  const t = await family();
  const details = await suggest(t, member(ada), 'details', 'bo', { born: '1919', bornPlace: 'Malmo' }, 'His baptism record');
  await S.addSuggestionFile(t, member(ada), details.id, file('baptism.png'), NOW);
  const rel = await S.createSuggestion(t, guest(1), { kind: 'relative', person: 'bo', payload: { person: { given: 'Fen', living: false }, link: { kind: 'child' } } as never }, LATER);
  // The record moves on after the suggestion was made: the reviewer sees what it rests on and what is there now.
  await db.db(t).run("UPDATE person SET born_place = 'Ystad' WHERE id = 'bo'");

  for (const w of [fay, gus]) {
    const list = await V.waitingSuggestions(t, w);
    assert.deepEqual(list.map((s) => s.id), [rel.id, details.id], 'newest first');
    const [g, m] = list;
    assert.deepEqual(m!.author, { name: 'Ada Alder', person: 'ada', guest: false });
    assert.deepEqual(g!.author, { name: 'Hal 1', person: null, guest: true });
    assert.equal(m!.note, 'His baptism record');
    assert.deepEqual(m!.payload, { born: '1919', bornPlace: 'Malmo' });
    assert.deepEqual(m!.basis, { born: '1920', bornPlace: 'Lund' });
    assert.deepEqual(m!.current, { born: '1920', bornPlace: 'Ystad' });
    assert.equal(g!.current, null);
    assert.deepEqual(m!.files.map((f) => [f.name, f.mime]), [['baptism.png', 'image/png']]);
    assert.deepEqual(m!.may, { withdraw: false, approve: true, decline: true, close: false });
    assert.equal(m!.mine, false);
    assert.equal(m!.status, 'waiting');
    assert.equal(m!.adjusted, false);
    assert.equal(m!.partial, false);
  }
  assert.deepEqual((await V.waitingSuggestions(t, fay, { person: 'bo' })).length, 2);
  assert.deepEqual(await V.waitingSuggestions(t, fay, { person: 'cara' }), []);
});

test('an event and a couple correction show their record now; a decided suggestion is not waiting', async () => {
  const t = await family();
  const ev = await suggest(t, member(ada), 'event', 'bo', { event: 'e1', place: 'Malmo' });
  const couple = await suggest(t, member(ada), 'event', 'bo', { partnership: 'u1', start: '1947' });
  const gone = await suggest(t, member(ada), 'details', 'cara', { born: '1923' });
  await R.declineSuggestion(t, fay, gone.id, 'Not so', NOW);
  const list = await V.waitingSuggestions(t, fay);
  assert.deepEqual(list.map((s) => s.id).sort(), [ev.id, couple.id].sort());
  assert.deepEqual(list.find((s) => s.id === ev.id)!.current, { place: 'Lund' });
  assert.deepEqual(list.find((s) => s.id === couple.id)!.current, { start: '1948' });
});

test('only an editor or a steward reads the waiting list and the counts; a viewer, a contributor and a guest are refused', async () => {
  const t = await family();
  await suggest(t, member(ada), 'details', 'bo', { born: '1919' });
  for (const w of [ada, eli, guestWho]) {
    assert.ok((await refusal(V.waitingSuggestions(t, w))).length);
    assert.ok((await refusal(V.suggestionCounts(t, w))).length);
  }
});

test('the counts are the waiting suggestions, in all and per person', async () => {
  const t = await family();
  await suggest(t, member(ada), 'details', 'bo', { born: '1919' });
  await suggest(t, member(eli), 'event', 'bo', { event: 'e1', place: 'Malmo' });
  const c = await suggest(t, member(ada), 'details', 'cara', { born: '1923' });
  await suggest(t, member(ada), 'source', null, { title: 'Parish book' });
  await R.declineSuggestion(t, fay, c.id, undefined, NOW);
  await suggest(t, member(eli), 'details', 'cara', { died: '2002' });
  assert.deepEqual(await V.suggestionCounts(t, fay), { total: 4, people: { bo: 2, cara: 1 } });
});

// ---------- a suggester's own ----------

test('a suggester sees only their own suggestions and their states, without the record’s values', async () => {
  const t = await family();
  const mine = await suggest(t, member(ada), 'details', 'bo', { born: '1919' });
  const declined = await suggest(t, member(ada), 'details', 'cara', { born: '1923' });
  await R.declineSuggestion(t, fay, declined.id, 'The census says 1922', NOW);
  const approved = await suggest(t, member(ada), 'event', 'bo', { event: 'e1', place: 'Malmo' });
  asReviewer(fay);
  await R.approveSuggestion(t, fay, approved.id, { event: 'e1', place: 'Malmö' }, { now: NOW });
  const withdrawn = await suggest(t, member(ada), 'details', 'bo', { died: '1991' });
  await S.withdrawSuggestion(t, member(ada), withdrawn.id, NOW);
  const elis = await suggest(t, member(eli), 'details', 'bo', { died: '1989' });
  const guests = await S.createSuggestion(t, guest(1), { kind: 'details', person: 'bo', payload: { nickname: 'Bobo' } }, NOW);

  const list = await V.mySuggestions(t, member(ada), { now: LATER });
  assert.deepEqual(list.map((s) => s.id).sort(), [mine.id, declined.id, approved.id].sort(), 'not withdrawn ones, nor anyone else’s');
  for (const s of list) {
    assert.equal(s.mine, true);
    assert.equal(s.basis, null, 'the record’s values are for reviewers');
    assert.equal(s.current, null);
  }
  const by = (id: string) => list.find((s) => s.id === id)!;
  assert.deepEqual(by(mine.id).may, { withdraw: true, approve: false, decline: false, close: false });
  assert.equal(by(declined.id).status, 'declined');
  assert.equal(by(declined.id).reason, 'The census says 1922');
  assert.equal(by(approved.id).status, 'approved');
  assert.equal(by(approved.id).adjusted, true, 'approved with changes');
  assert.equal(by(approved.id).may.withdraw, false);

  assert.deepEqual((await V.mySuggestions(t, member(eli))).map((s) => s.id), [elis.id]);
  assert.deepEqual((await V.mySuggestions(t, guest(1))).map((s) => s.id), [guests.id]);
  assert.deepEqual((await V.mySuggestions(t, guest(2))).map((s) => s.id), [], 'another guest reads none of them');
  assert.deepEqual(await V.mySuggestions(t, { kind: 'guest', key: '', protectLiving: true }), [], 'a guest without the cookie has none');
  assert.deepEqual((await V.mySuggestions(t, member(ada), { person: 'cara', now: LATER })).map((s) => s.id), [declined.id]);
  assert.ok((await refusal(V.mySuggestions(t, member(guestWho as never)))).length, 'a guest is not a member');
});

test('a decided suggestion leaves the suggester’s list after 90 days', async () => {
  const t = await family();
  const old = await suggest(t, member(ada), 'details', 'bo', { born: '1919' });
  await R.declineSuggestion(t, fay, old.id, undefined, NOW);
  const later = new Date(NOW.getTime() + 91 * 86_400_000);
  assert.deepEqual(await V.mySuggestions(t, member(ada), { now: later }), []);
  assert.equal((await V.mySuggestions(t, member(ada), { now: LATER })).length, 1);
});

test('a guest of a protecting link no longer sees their suggestion about someone since marked living', async () => {
  const t = await family();
  const s = await S.createSuggestion(t, guest(1), { kind: 'details', person: 'bo', payload: { nickname: 'Bobo' } }, NOW);
  await S.addSuggestionFile(t, guest(1), s.id, file('bo.png'), NOW);
  const id = await fileId(t, s.id);
  await db.db(t).run("UPDATE person SET living = 1 WHERE id = 'bo'");
  assert.deepEqual(await V.mySuggestions(t, guest(1)), []);
  assert.equal(await V.pendingFile(t, guest(1), id), null);
  assert.equal((await V.mySuggestions(t, guest(1, false))).length, 1, 'a link that shows the living shows it');
});

test('nor their correction of a couple whose partner is since marked living, as suggesting it would be refused', async () => {
  const t = await family();
  const s = await S.createSuggestion(t, guest(1), { kind: 'event', person: 'bo', payload: { partnership: 'u1', start: '1947' } }, NOW);
  await S.addSuggestionFile(t, guest(1), s.id, file('wedding.png'), NOW);
  const id = await fileId(t, s.id);
  assert.equal((await V.mySuggestions(t, guest(1))).length, 1, 'both partners dead: theirs to see');
  await db.db(t).run("UPDATE person SET living = 1 WHERE id = 'cara'");
  assert.deepEqual(await V.mySuggestions(t, guest(1)), []);
  assert.equal(await V.pendingFile(t, guest(1), id), null);
  assert.equal((await V.mySuggestions(t, guest(1, false))).length, 1);
});

test('a source’s file is found by its storage key through an index', async () => {
  const t = await family();
  const plan = await db.db(t).all<{ detail: string }>("EXPLAIN QUERY PLAN SELECT 1 FROM source_file WHERE media_key = 'source/x.png'");
  assert.ok(plan.some((r) => /USING (COVERING )?INDEX source_file_key/.test(r.detail)), JSON.stringify(plan));
});

test('an approval closed in part says so, and whether it was adjusted is unknown when nothing tells', async () => {
  const t = await family();
  const s = await suggest(t, member(ada), 'details', 'bo', { born: '1919' });
  await db.db(t).run("UPDATE suggestion SET status = 'approved', decided_at = ?, applied = ? WHERE id = ?", NOW.toISOString(), JSON.stringify({ partial: true, adjustedUnknown: true }), s.id);
  const [v] = await V.mySuggestions(t, member(ada), { now: LATER });
  assert.equal(v!.partial, true);
  assert.equal(v!.adjusted, null);
});

test('a waiting suggestion whose approval has begun can be closed by a reviewer, not declined or withdrawn', async () => {
  const t = await family();
  const s = await suggest(t, member(ada), 'details', 'bo', { born: '1919' });
  await db.db(t).run("INSERT INTO history (at, account, name, kind, record, action, level, count, fn, suggestion) VALUES (?, 'acc-fay', 'Fay Fir', 'person', 'bo', 'changed', 'family', 1, 'x', ?)", NOW.toISOString(), s.id);
  const [r] = await V.waitingSuggestions(t, fay);
  assert.deepEqual(r!.may, { withdraw: false, approve: true, decline: false, close: true });
  const [m] = await V.mySuggestions(t, member(ada));
  assert.equal(m!.may.withdraw, false);
});

// ---------- files ----------

test('a pending file is served to reviewers and to its own suggester, never to another member or guest (Review Focus 3)', async () => {
  const t = await family();
  const m = await suggest(t, member(ada), 'details', 'bo', { born: '1919' });
  await S.addSuggestionFile(t, member(ada), m.id, file('baptism.png'), NOW);
  const g = await S.createSuggestion(t, guest(1), { kind: 'details', person: 'bo', payload: { nickname: 'Bobo' } }, NOW);
  await S.addSuggestionFile(t, guest(1), g.id, file('bobo.png'), NOW);
  const mf = await fileId(t, m.id);
  const gf = await fileId(t, g.id);

  for (const reader of [member(fay), member(gus)]) {
    assert.equal((await V.pendingFile(t, reader, mf))?.name, 'baptism.png');
    assert.equal((await V.pendingFile(t, reader, gf))?.name, 'bobo.png');
  }
  const own = await V.pendingFile(t, member(ada), mf);
  assert.equal(own?.mime, 'image/png');
  assert.match(own!.key, /^suggest\//);
  assert.equal((await V.pendingFile(t, guest(1), gf))?.name, 'bobo.png');

  assert.equal(await V.pendingFile(t, member(ada), gf), null, 'a member viewer does not read a guest’s file');
  assert.equal(await V.pendingFile(t, member(eli), mf), null, 'nor a contributor another member’s');
  assert.equal(await V.pendingFile(t, guest(1), mf), null, 'a guest reads no member’s file');
  assert.equal(await V.pendingFile(t, guest(2), gf), null, 'nor another guest’s');
  assert.equal(await V.pendingFile(t, { kind: 'guest', key: '', protectLiving: true }, gf), null, 'nor one without the cookie');
  assert.equal(await V.pendingFile(t, member(guestWho as never), mf), null, 'a guest posing as a member reads none');

  await R.declineSuggestion(t, fay, m.id, undefined, NOW);
  assert.equal(await V.pendingFile(t, member(fay), mf), null, 'a declined suggestion’s file is gone');
});

test('an approved source’s files are listed with the source and served to members, never to guests', async () => {
  const t = await family();
  const s = await suggest(t, member(ada), 'source', 'bo', { title: 'Parish book', backs: { fact: 'birth' } });
  await S.addSuggestionFile(t, member(ada), s.id, file('page 1.png'), NOW);
  asReviewer(fay);
  const { applied } = await R.approveSuggestion(t, fay, s.id, undefined, { now: NOW });
  const sources = await Src.listSources(t, { id: ada.id, name: ada.name, role: 'viewer' });
  const files = sources.find((x) => x.id === applied.source)!.files;
  assert.equal(files.length, 1);
  assert.equal(files[0]!.name, 'page 1.png');
  assert.equal(files[0]!.mime, 'image/png');
  assert.match(files[0]!.key, /^[0-9a-f-]{36}\.png$/, 'the key the file route takes');

  for (const w of [ada, eli, fay]) assert.equal((await V.sourceFile(t, w, files[0]!.key))?.name, 'page 1.png');
  assert.equal(await V.sourceFile(t, guestWho, files[0]!.key), null, 'a guest gets no sources');
  assert.equal(await V.sourceFile(t, ada, 'not-there.png'), null);
  // A pending file is not a source's, whatever key is asked for.
  const p = await suggest(t, member(ada), 'details', 'bo', { born: '1919' });
  await S.addSuggestionFile(t, member(ada), p.id, file('x.png'), NOW);
  const pending = (await db.db(t).get<{ key: string }>('SELECT key FROM suggestion_file WHERE suggestion = ?', p.id))!.key;
  assert.equal(await V.sourceFile(t, fay, pending.slice('suggest/'.length)), null);
});

test('a file is served as its type, under a safe name, kept by no shared cache', () => {
  const pending = V.fileHeaders({ mime: 'image/png', name: 'Bö "evil".html\r\nX: y' }, { download: false, keep: false });
  assert.equal(pending['Content-Type'], 'image/png');
  assert.equal(pending['X-Content-Type-Options'], 'nosniff');
  assert.equal(pending['Cache-Control'], 'private, no-store');
  assert.equal(pending.Vary, 'Cookie');
  const disposition = pending['Content-Disposition']!;
  assert.match(disposition, /^inline; filename="[\w .-]+\.png"; filename\*=UTF-8''[^\s"]+$/);
  assert.ok(!/[\r\n]/.test(disposition));
  assert.match(pending['Content-Security-Policy']!, /sandbox/);
  const pdf = V.fileHeaders({ mime: 'application/pdf', name: 'letter.pdf' }, { download: true, keep: true });
  assert.match(pdf['Content-Disposition']!, /^attachment; filename="letter\.pdf"/);
  assert.equal(pdf['Cache-Control'], 'private, max-age=3600');
  assert.doesNotMatch(pdf['Content-Security-Policy']!, /sandbox/);
});

// ---------- the history ----------

test('the history and What’s new name who suggested an approved change; other rows name nobody', async () => {
  const t = await family();
  asReviewer(fay);
  const m = await suggest(t, member(ada), 'details', 'bo', { born: '1919' });
  await R.approveSuggestion(t, fay, m.id, undefined, { now: NOW });
  const g = await S.createSuggestion(t, guest(1), { kind: 'details', person: 'cara', payload: { died: '2002' } }, NOW);
  await R.approveSuggestion(t, fay, g.id, undefined, { now: NOW });
  await P.fillGaps(t, 'cara', { occupation: 'Weaver' }, undefined, undefined);

  const page = await H.historyPage(t, db.db(t), { account: eli.id, role: 'contributor', guest: false });
  const of = (person: string, kind = 'person') => page.items.filter((i) => i.person === person && i.kind === kind);
  assert.deepEqual(of('bo').map((i) => [i.author, i.suggestedBy]), [['Fay Fir', 'Ada Alder']]);
  const cara = of('cara').map((i) => i.suggestedBy);
  assert.equal(cara.length, 2);
  assert.ok(cara.includes('Hal 1') && cara.includes(null), 'the guest’s name for their change, none for the editor’s own');
  const one = await H.historyRow(db.db(t), { account: eli.id, role: 'contributor', guest: false }, of('bo')[0]!.id);
  assert.equal((await H.itemOf(t, { account: eli.id, role: 'contributor', guest: false }, one!)).suggestedBy, 'Ada Alder');

  const news = await H.whatsNew(db.db(t), { account: eli.id, role: 'contributor', guest: false }, NOW.getTime() - 86_400_000);
  const lines = news.groups.flatMap((x) => x.lines.map((l) => [x.person, l.author, l.suggestedBy] as const));
  assert.ok(lines.some(([p, a, s]) => p === 'bo' && a === 'Fay Fir' && s === 'Ada Alder'));
  assert.ok(lines.some(([p, , s]) => p === 'cara' && s === 'Hal 1'));
  assert.ok(lines.some(([p, , s]) => p === 'cara' && s === null), 'a suggested change and an own one are separate lines');
});

test('the history can find an approval’s rows by its suggestion through an index', async () => {
  const t = await family();
  const plan = await db.db(t).all<{ detail: string }>("EXPLAIN QUERY PLAN SELECT 1 FROM history WHERE suggestion = 'x'");
  assert.ok(plan.some((r) => /history_suggestion/.test(r.detail)), JSON.stringify(plan));
});

// ---------- nothing pending leaks (Review Focus 3) ----------

test('pending suggestions reach neither the feed, the history, What’s new, the exports nor the assistant', async () => {
  const t = await family();
  const MARK = 'Quixmarrow';
  const rel = await suggest(t, member(ada), 'relative', 'bo', { person: { given: MARK, surname: `${MARK}son`, living: false }, link: { kind: 'child' } }, `${MARK} note`);
  await suggest(t, member(ada), 'details', 'bo', { nickname: `${MARK}nick` });
  await suggest(t, member(ada), 'event', 'bo', { kind: 'occupation', note: `${MARK} event`, date: '1950' });
  await suggest(t, member(ada), 'source', 'bo', { title: `${MARK} book`, author: MARK });
  await S.createSuggestion(t, guest(1), { kind: 'details', person: 'cara', payload: { nickname: `${MARK}guest` }, note: MARK }, NOW);
  await S.addSuggestionFile(t, member(ada), rel.id, file(`${MARK}.png`), NOW);

  const leaks = (label: string, text: string, control = 'Bo') => {
    assert.ok(text.includes(control), `${label}: the control is there`);
    assert.ok(!text.includes(MARK), `${label} carries pending data`);
  };
  for (const w of [ada, fay, gus]) {
    const feed = await F.feedPage(t, w, null, 50, LATER);
    assert.ok(!JSON.stringify(feed).includes(MARK), 'the feed');
    const audience = { account: w.id, role: w.role, guest: false };
    assert.ok(!JSON.stringify(await H.historyPage(t, db.db(t), audience)).includes(MARK), 'the history');
    assert.ok(!JSON.stringify(await H.whatsNew(db.db(t), audience, 0)).includes(MARK), 'What’s new');
  }
  leaks('GEDCOM', (await X.gedcomExport(t, NOW)).body);
  leaks('Markdown', Buffer.from((await X.markdownExport(t, NOW)).body).toString('latin1'));
  leaks('snapshot', JSON.stringify(await X.familySnapshot(t)));

  const ctx = { tree: t, role: 'steward' as const, me: null, user: gus.id, locale: 'en' as const };
  const out: never[] = [];
  const asked = [
    await T.runTool(ctx, 'search_people', { query: 'Bo' }, out),
    await T.runTool(ctx, 'search_people', { query: MARK }, out),
    await T.runTool(ctx, 'read_person', { id: 'bo' }, out),
    await T.runTool(ctx, 'relatives', { id: 'bo' }, out),
    await T.runTool(ctx, 'list_events', { person: 'bo' }, out),
    await T.runTool(ctx, 'list_sources', {}, out),
  ].join('\n');
  leaks('the assistant', asked);
  assert.deepEqual(out, [], 'reading proposes nothing');
});
