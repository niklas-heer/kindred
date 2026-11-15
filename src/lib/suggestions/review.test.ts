// node --test src/lib/suggestions/review.test.ts — approving and declining suggestions, on a private data folder with a fresh
// family per test: each kind applied through the write paths the forms use (their history rows naming the suggestion),
// adjusted values, the "changed since" refusal, files moved to their source through the counted store, an approval that
// fails half-way and is retried (Review Focus 4), declining, possible matches for a missing relative, and who may do any
// of it. Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-review-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
const db = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const H = await load<typeof import('../history.server.ts')>('/src/lib/history.server.ts');
const P = await load<typeof import('../person.server.ts')>('/src/lib/person.server.ts');
const S = await load<typeof import('./suggest.server.ts')>('/src/lib/suggestions/suggest.server.ts');
const R = await load<typeof import('./review.server.ts')>('/src/lib/suggestions/review.server.ts');
const Rel = await load<typeof import('../relations.server.ts')>('/src/lib/relations.server.ts');
const readOnly = await load<typeof import('../read-only.ts')>('/src/lib/read-only.ts');
const { AuthError } = await load<typeof import('../auth/errors.ts')>('/src/lib/auth/errors.ts');
const { MAX_REASON } = await load<typeof import('./types.ts')>('/src/lib/suggestions/types.ts');

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
/**
 * A fresh family: Ada (living, born 1950) and her late parents Bo (1920–1990, married to Cara in 1948 in Lund) and Cara
 * (1922–2001, born Birch), Bo's baptism in 1920, Dag (living, Ada's husband), and Fen Fir, of whom little is known.
 */
async function family(): Promise<string> {
  const id = `rev${++families}`;
  await db.store.ensureTree(id);
  const d = db.db(id);
  await d.run("INSERT INTO meta (key, value) VALUES ('id', ?), ('name', 'The Alders') ON CONFLICT (key) DO UPDATE SET value = excluded.value", id);
  await d.run("INSERT INTO person (id, given, surname, sex, born, living) VALUES ('ada', 'Ada', 'Alder', 'f', '1950', 1)");
  await d.run("INSERT INTO person (id, given, surname, sex, born, born_place, died, living) VALUES ('bo', 'Bo', 'Alder', 'm', '1920', 'Lund', '1990', 0)");
  await d.run("INSERT INTO person (id, given, surname, current_surname, sex, born, died, living) VALUES ('cara', 'Cara', 'Birch', 'Alder', 'f', '1922', '2001', 0)");
  await d.run("INSERT INTO person (id, given, surname, living) VALUES ('dag', 'Dag', 'Dune', 1)");
  await d.run("INSERT INTO person (id, given, surname, living) VALUES ('fen', 'Fen', 'Fir', 0)");
  await d.run("INSERT INTO parent (child, parent) VALUES ('ada', 'bo'), ('ada', 'cara')");
  await d.run("INSERT INTO partnership (id, a, b, kind, start, place) VALUES ('u1', 'bo', 'cara', 'marriage', '1948', 'Lund'), ('u2', 'ada', 'dag', 'marriage', '1975', NULL)");
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
const guest = { kind: 'guest' as const, key: 'g:key-1', name: 'Hal Hazel', link: 'link-1', net: 1, protectLiving: true };

/** The reviewer's request: the history names them, as the guard does for a real request. */
const asReviewer = (w: ReturnType<typeof who>) => H.actingAs({ account: w.id, name: w.name });

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  assert.fail('expected a refusal');
}
const row = (t: string, id: string) => db.db(t).get<Record<string, unknown>>('SELECT * FROM suggestion WHERE id = ?', id);
const count = async (t: string, table: string, where = '1') => (await db.db(t).get<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))!.n;
const RECORD_TABLES = ['person', 'parent', 'partnership', 'life_event', 'source', 'citation', 'history', 'source_file'];
const records = async (t: string) => Object.fromEntries(await Promise.all(RECORD_TABLES.map(async (x) => [x, await count(t, x)])));
const personRow = (t: string, id: string) => db.db(t).get<Record<string, unknown>>('SELECT * FROM person WHERE id = ?', id);
/** The history rows an approval wrote: every one names the suggestion. */
const historyOf = (t: string, suggestion: string) =>
  db.db(t).all<{ kind: string; record: string; action: string; name: string; account: string; suggestion: string; fields: string | null }>('SELECT * FROM history WHERE suggestion = ? ORDER BY id', suggestion);

const enc = (s: string) => new TextEncoder().encode(s);
const PNG = () => new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const PDF = () => enc('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n\nxref\n0 1\ntrailer\n<<>>\nstartxref\n9\n%%EOF\n');
const file = (mime: string, bytes: Uint8Array, name = 'letter') => ({ name, mime, bytes });
const stored = async (t: string, prefix: string) => (await db.store.media.list(t)).map((f) => f.key).filter((k) => k.startsWith(prefix)).sort();
const usage = async (t: string, prefix: string) =>
  (await db.store.accounts().all<{ key: string }>('SELECT key FROM media_usage WHERE tree = ? AND key LIKE ? ORDER BY key', t, `${prefix}%`)).map((r) => r.key);

const suggest = (t: string, by: Parameters<typeof S.createSuggestion>[1], kind: 'details' | 'relative' | 'event' | 'source', person: string | null, payload: unknown, note?: string) =>
  S.createSuggestion(t, by, { kind, person, payload: payload as never, note }, NOW);

// ---------- retry keys ----------

// First in the file: `once` prunes old retry keys at its first keyed change in a process, which is the approval below.
test('old retry keys are pruned, but not the steps of an approval whose suggestion still waits', async () => {
  const t = await family();
  asReviewer(fay);
  const waits = await suggest(t, member(ada), 'details', 'bo', { born: '1919' });
  const decided = await suggest(t, member(ada), 'details', 'cara', { born: '1923' });
  await db.db(t).run("UPDATE suggestion SET status = 'declined' WHERE id = ?", decided.id);
  const old = new Date(NOW.getTime() - 60 * 86_400_000).toISOString();
  for (const key of [`sugg-${waits.id}-1`, `sugg-${waits.id}-d1`, `sugg-${decided.id}-1`, 'some-old-key'])
    await db.db(t).run("INSERT INTO op (key, fn, result, at, user, fingerprint) VALUES (?, 'x', 'null', ?, 'u', 'f')", key, old);
  const other = await suggest(t, member(ada), 'details', 'dag', { nickname: 'Dee' });
  await R.approveSuggestion(t, fay, other.id);
  const left = (await db.db(t).all<{ key: string }>('SELECT key FROM op WHERE at = ? ORDER BY key', old)).map((r) => r.key);
  assert.deepEqual(left, [`sugg-${waits.id}-1`, `sugg-${waits.id}-d1`].sort());
});

// ---------- who ----------

test('only an editor or a steward approves, declines or sees matches; a viewer, a contributor or a guest is refused', async () => {
  const t = await family();
  const { id } = await suggest(t, member(ada), 'details', 'bo', { born: '1919' });
  const rel = await suggest(t, member(ada), 'relative', 'bo', { person: { given: 'Fen', living: false }, link: { kind: 'child' } });
  const before = await records(t);
  for (const w of [ada, eli, guestWho]) {
    assert.ok((await refusal(R.approveSuggestion(t, w as never, id))).length);
    assert.ok((await refusal(R.declineSuggestion(t, w as never, id))).length);
    assert.ok((await refusal(R.matchCandidates(t, w as never, rel.id))).length);
  }
  assert.match(await refusal(R.approveSuggestion(t, eli, id)), /permission/);
  assert.match(await refusal(R.approveSuggestion(t, guestWho as never, id)), /access/);
  assert.deepEqual(await records(t), before, 'nothing was written');
  assert.equal((await row(t, id))!.status, 'waiting');
  // A steward may, as an editor may.
  asReviewer(gus);
  await R.approveSuggestion(t, gus, id, undefined, { now: LATER });
  assert.equal((await row(t, id))!.status, 'approved');
  assert.equal(await refusal(R.approveSuggestion(t, fay, 'nope')), 'suggest.err.gone');
});

// ---------- each kind ----------

test('a details suggestion applies through the person write path, names as detailsOf reads them, every history row naming it', async () => {
  const t = await family();
  asReviewer(fay);
  // Bo goes by Ash now; his birth surname stays Alder.
  const bo = await suggest(t, member(ada), 'details', 'bo', { surname: 'Ash', nickname: 'Bobo', born: '1919-02', diedPlace: 'Malmö' });
  // Cara: born Beech, still going by Alder.
  const cara = await suggest(t, member(ada), 'details', 'cara', { birthName: 'Beech' });
  // Ada: born Elm, but goes by Alder still (so Alder becomes her current surname); and not living any more.
  const adaS = await suggest(t, member(eli), 'details', 'ada', { birthName: 'Elm', living: false, died: '2025' });
  // Dag: his current surname is his birth surname again.
  await db.db(t).run("UPDATE person SET current_surname = 'Dale' WHERE id = 'dag'");
  const dag = await suggest(t, member(eli), 'details', 'dag', { surname: 'Dune' });

  const r = await R.approveSuggestion(t, fay, bo.id, undefined, { now: LATER });
  assert.deepEqual(r.applied, { person: 'bo' });
  const b = (await personRow(t, 'bo'))!;
  assert.deepEqual([b.surname, b.current_surname, b.nickname, b.born, b.died_place], ['Alder', 'Ash', 'Bobo', '1919-02', 'Malmö']);
  const rows = await historyOf(t, bo.id);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0]!.kind, rows[0]!.record, rows[0]!.action, rows[0]!.name, rows[0]!.account], ['person', 'bo', 'changed', 'Fay Fir', 'acc-fay']);
  assert.deepEqual(Object.keys(JSON.parse(rows[0]!.fields!).f).sort(), ['born', 'current_surname', 'died_place', 'nickname']);
  const s = (await row(t, bo.id))!;
  assert.deepEqual([s.status, s.adjusted, s.decided_by, s.decided_by_name, s.decided_at], ['approved', 0, 'acc-fay', 'Fay Fir', LATER.toISOString()]);
  assert.deepEqual(JSON.parse(s.applied as string), { person: 'bo' });

  await R.approveSuggestion(t, fay, cara.id);
  const c = (await personRow(t, 'cara'))!;
  assert.deepEqual([c.surname, c.current_surname], ['Beech', 'Alder']);
  await R.approveSuggestion(t, fay, adaS.id);
  const a = (await personRow(t, 'ada'))!;
  assert.deepEqual([a.surname, a.current_surname, a.living, a.died], ['Elm', 'Alder', 0, '2025']);
  await R.approveSuggestion(t, fay, dag.id);
  const g = (await personRow(t, 'dag'))!;
  assert.deepEqual([g.surname, g.current_surname], ['Dune', null]);
  for (const x of [cara, adaS, dag]) assert.equal((await historyOf(t, x.id)).length, 1);
  assert.equal(await count(t, 'history', 'suggestion IS NULL'), 0, 'no change of an approval goes unattributed');
});

test('a current surname the same as the birth surname is no current surname: no stray change of it', async () => {
  const t = await family();
  asReviewer(fay);
  await db.db(t).run("UPDATE person SET current_surname = 'Dune' WHERE id = 'dag'");
  const { id } = await suggest(t, member(ada), 'details', 'dag', { nickname: 'Dee' });
  await R.approveSuggestion(t, fay, id);
  const rows = await historyOf(t, id);
  assert.deepEqual(rows.map((r) => Object.keys(JSON.parse(r.fields!).f)), [['nickname']]);
});

test('approving with adjusted values applies those and marks the suggestion adjusted', async () => {
  const t = await family();
  asReviewer(fay);
  const { id } = await suggest(t, member(ada), 'details', 'bo', { born: '1919', bornPlace: 'Ystad' });
  for (const bad of [{ born: '1919-13' }, { bio: 'A long life' }, [], { given: '' }]) {
    assert.equal(await refusal(R.approveSuggestion(t, fay, id, bad as never)), 'suggest.err.payload', JSON.stringify(bad));
  }
  assert.equal(await refusal(R.approveSuggestion(t, fay, id, { born: '1920', bornPlace: 'Lund' })), 'suggest.err.unchanged');
  await R.approveSuggestion(t, fay, id, { born: '1918' });
  const b = (await personRow(t, 'bo'))!;
  assert.deepEqual([b.born, b.born_place], ['1918', 'Lund'], 'only the adjusted values');
  assert.equal((await row(t, id))!.adjusted, 1);
  assert.deepEqual(JSON.parse((await row(t, id))!.payload as string), { born: '1919', bornPlace: 'Ystad' }, 'what was suggested is kept');

  // The same values as suggested are no adjustment.
  const same = await suggest(t, member(ada), 'details', 'cara', { nickname: 'Cari' });
  await R.approveSuggestion(t, fay, same.id, { nickname: 'Cari' });
  assert.equal((await row(t, same.id))!.adjusted, 0);
});

test('a correction is refused as changed since when the record moved on; approved against the values shown, it applies', async () => {
  const t = await family();
  asReviewer(fay);
  const { id } = await suggest(t, member(ada), 'details', 'bo', { born: '1919', nickname: 'Bobo' });
  await db.db(t).run("UPDATE person SET born = '1921' WHERE id = 'bo'");
  const before = await records(t);
  assert.equal(await refusal(R.approveSuggestion(t, fay, id)), 'suggest.err.changed');
  assert.deepEqual(await records(t), before);
  assert.equal((await row(t, id))!.status, 'waiting');
  // The reviewer looked again and approves against what is there now.
  assert.equal(await refusal(R.approveSuggestion(t, fay, id, undefined, { seen: { born: '1922' } })), 'suggest.err.changed');
  // Refused before any step was written, it may still be decided again: here with other values.
  await R.approveSuggestion(t, fay, id, { born: '1917', nickname: 'Bobo' }, { seen: { born: '1921' } });
  assert.deepEqual([(await personRow(t, 'bo'))!.born, (await personRow(t, 'bo'))!.nickname], ['1917', 'Bobo']);
  assert.equal((await row(t, id))!.adjusted, 1);

  // A record that moved on to exactly the suggested value is no conflict.
  const second = await suggest(t, member(ada), 'details', 'cara', { born: '1923' });
  await db.db(t).run("UPDATE person SET born = '1923' WHERE id = 'cara'");
  await R.approveSuggestion(t, fay, second.id);
  assert.equal((await row(t, second.id))!.status, 'approved');

  // An event correction keeps its basis as well.
  const ev = await suggest(t, member(ada), 'event', 'bo', { event: 'e1', place: 'Malmö' });
  await db.db(t).run("UPDATE life_event SET place = 'Ystad' WHERE id = 'e1'");
  assert.equal(await refusal(R.approveSuggestion(t, fay, ev.id)), 'suggest.err.changed');
  const union = await suggest(t, member(ada), 'event', 'bo', { partnership: 'u1', start: '1947' });
  await db.db(t).run("UPDATE partnership SET start = '1949' WHERE id = 'u1'");
  assert.equal(await refusal(R.approveSuggestion(t, fay, union.id)), 'suggest.err.changed');
});

test('an edit landing between the check and the write of an event or couple correction refuses it as changed', async () => {
  const t = await family();
  asReviewer(fay);
  const ev = await suggest(t, member(ada), 'event', 'bo', { event: 'e1', note: 'In the cathedral' });
  const union = await suggest(t, member(ada), 'event', 'bo', { partnership: 'u1', start: '1947' });
  const d = db.db(t);
  const get = d.get.bind(d);
  /** After the approval's own read of the record, someone else's edit lands. */
  const landing = (read: string, edit: string) => {
    let fired = false;
    d.get = (async (sql: string, ...params: unknown[]) => {
      const r = await get(sql, ...(params as never[]));
      if (!fired && sql === read) {
        fired = true;
        await d.run(edit);
      }
      return r;
    }) as typeof d.get;
  };
  try {
    landing('SELECT type, label, date, end_date, place, note FROM life_event WHERE id = ? AND person = ?', "UPDATE life_event SET place = 'Ystad' WHERE id = 'e1'");
    assert.equal(await refusal(R.approveSuggestion(t, fay, ev.id)), 'suggest.err.changed');
    const e1 = (await d.get<Record<string, unknown>>("SELECT place, note FROM life_event WHERE id = 'e1'"))!;
    assert.deepEqual([e1.place, e1.note], ['Ystad', ''], 'the other edit stands, and the suggestion wrote nothing');
    landing('SELECT a, b, kind, start, place FROM partnership WHERE id = ?', "UPDATE partnership SET place = 'Ystad' WHERE id = 'u1'");
    assert.equal(await refusal(R.approveSuggestion(t, fay, union.id)), 'suggest.err.changed');
    const u1 = (await d.get<Record<string, unknown>>("SELECT start, place FROM partnership WHERE id = 'u1'"))!;
    assert.deepEqual([u1.start, u1.place], ['1948', 'Ystad']);
  } finally {
    d.get = get;
  }
  assert.equal(await count(t, 'history'), 0);
});

test('a missing relative is added with its link through the add-relative path, or linked to someone already there', async () => {
  const t = await family();
  asReviewer(fay);
  const child = await suggest(t, member(ada), 'relative', 'bo', { person: { given: 'Eve', surname: 'Alder', sex: 'f', born: '1952', living: false }, link: { kind: 'child', parentKind: 'adoptive' } });
  const r = await R.approveSuggestion(t, fay, child.id);
  const eve = r.applied.person!;
  assert.deepEqual([(await personRow(t, eve))!.given, (await personRow(t, eve))!.born], ['Eve', '1952']);
  assert.equal((await db.db(t).get<{ kind: string }>('SELECT kind FROM parent WHERE child = ? AND parent = ?', eve, 'bo'))?.kind, 'adoptive');
  const rows = await historyOf(t, child.id);
  assert.deepEqual(rows.map((x) => `${x.kind}:${x.action}`), ['person:added', 'link:added']);

  const partner = await suggest(t, member(ada), 'relative', 'fen', { person: { given: 'Gil', living: false }, link: { kind: 'partner', partnerKind: 'betrothal' } });
  const p = await R.approveSuggestion(t, fay, partner.id);
  assert.equal((await db.db(t).get<{ kind: string }>('SELECT kind FROM partnership WHERE id = ?', p.applied.partnership!))?.kind, 'betrothal');

  // "This is Fen": no one new; only the link, and the facts Fen lacks (not her name).
  const known = await suggest(t, member(ada), 'relative', 'bo', { person: { given: 'Fenna', surname: 'Fir', sex: 'f', born: '1955', living: false }, link: { kind: 'child' } });
  const people = await count(t, 'person');
  assert.equal(await refusal(R.approveSuggestion(t, fay, known.id, undefined, { existing: 'nobody' })), 'suggest.err.person');
  const k = await R.approveSuggestion(t, fay, known.id, undefined, { existing: 'fen' });
  assert.equal(await count(t, 'person'), people);
  assert.equal(k.applied.person, 'fen');
  assert.ok(await db.db(t).get("SELECT 1 AS x FROM parent WHERE child = 'fen' AND parent = 'bo'"));
  const fen = (await personRow(t, 'fen'))!;
  assert.deepEqual([fen.given, fen.sex, fen.born], ['Fen', 'f', '1955']);
  assert.ok((await historyOf(t, known.id)).length >= 2);

  // The link plan gives a parent's kind only to a parent or a child link, never to a sibling's shared parents.
  await db.db(t).run("INSERT INTO person (id, given, living) VALUES ('kit', 'Kit', 0)");
  await db.once(t, undefined, 'linkRelative', (d) => Rel.linkPlan(d, { anchor: 'ada', person: 'kit', relation: 'sibling', parentKind: 'adoptive' }));
  assert.deepEqual((await db.db(t).all<{ kind: string }>("SELECT kind FROM parent WHERE child = 'kit'")).map((x) => x.kind), ['biological', 'biological']);

  // The form's own rules still hold: a third parent is refused, and nothing is written.
  const third = await suggest(t, member(ada), 'relative', 'ada', { person: { given: 'Ivo', living: false }, link: { kind: 'parent' } });
  const before = await records(t);
  assert.match(await refusal(R.approveSuggestion(t, fay, third.id)), /two parents/);
  assert.deepEqual(await records(t), before);
  assert.equal((await row(t, third.id))!.status, 'waiting');
});

test('a life event: a new one (a custom one with its label), a correction, or a partnership correction', async () => {
  const t = await family();
  asReviewer(fay);
  const added = await suggest(t, member(ada), 'event', 'bo', { kind: 'military', date: '1940', place: 'Kiel', note: 'Navy' });
  const a = await R.approveSuggestion(t, fay, added.id);
  const e = (await db.db(t).get<Record<string, unknown>>('SELECT * FROM life_event WHERE id = ?', a.applied.event!))!;
  assert.deepEqual([e.person, e.type, e.date, e.place, e.note, e.created_by], ['bo', 'military', '1940', 'Kiel', 'Navy', 'acc-fay']);
  assert.deepEqual((await historyOf(t, added.id)).map((x) => `${x.kind}:${x.action}`), ['event:added']);

  const custom = await suggest(t, member(ada), 'event', 'bo', { kind: 'custom', label: 'Lighthouse keeper', date: '1950' });
  const c = await R.approveSuggestion(t, fay, custom.id);
  assert.equal((await db.db(t).get<{ label: string }>('SELECT label FROM life_event WHERE id = ?', c.applied.event!))?.label, 'Lighthouse keeper');

  const fixed = await suggest(t, member(ada), 'event', 'bo', { event: 'e1', date: '1920-05', note: 'In the cathedral' });
  const f = await R.approveSuggestion(t, fay, fixed.id);
  assert.equal(f.applied.event, 'e1');
  const e1 = (await db.db(t).get<Record<string, unknown>>("SELECT * FROM life_event WHERE id = 'e1'"))!;
  assert.deepEqual([e1.type, e1.date, e1.place, e1.note], ['baptism', '1920-05', 'Lund', 'In the cathedral']);
  assert.deepEqual((await historyOf(t, fixed.id)).map((x) => `${x.kind}:${x.record}:${x.action}`), ['event:e1:changed']);

  const union = await suggest(t, member(ada), 'event', 'cara', { partnership: 'u1', start: '1948-06-01', startPlace: 'Malmö' });
  const u = await R.approveSuggestion(t, fay, union.id);
  assert.equal(u.applied.partnership, 'u1');
  const pu = (await db.db(t).get<Record<string, unknown>>("SELECT * FROM partnership WHERE id = 'u1'"))!;
  assert.deepEqual([pu.kind, pu.start, pu.place], ['marriage', '1948-06-01', 'Malmö']);
  assert.deepEqual((await historyOf(t, union.id)).map((x) => `${x.kind}:${x.record}`), ['partnership:u1']);

  // Adjusted: the reviewer moves the new event's date.
  const moved = await suggest(t, member(ada), 'event', 'bo', { kind: 'census', date: '1930' });
  const m = await R.approveSuggestion(t, fay, moved.id, { kind: 'census', date: '1931' });
  assert.equal((await db.db(t).get<{ date: string }>('SELECT date FROM life_event WHERE id = ?', m.applied.event!))?.date, '1931');
  assert.equal((await row(t, moved.id))!.adjusted, 1);
});

test('a source is added with the citation of what it backs, the transcription on the citation', async () => {
  const t = await family();
  asReviewer(fay);
  const { id } = await suggest(t, member(ada), 'source', 'bo', { title: 'Parish book of Lund', author: 'The parish', reference: 'p. 12', date: '1920', transcription: 'Bo, son of …', backs: { fact: 'birth' } });
  const r = await R.approveSuggestion(t, fay, id);
  const so = (await db.db(t).get<Record<string, unknown>>('SELECT * FROM source WHERE id = ?', r.applied.source!))!;
  assert.deepEqual([so.title, so.author, so.reference, so.date, so.note], ['Parish book of Lund', 'The parish', 'p. 12', '1920', '']);
  const ci = (await db.db(t).get<Record<string, unknown>>('SELECT * FROM citation WHERE id = ?', r.applied.citations![0]!))!;
  assert.deepEqual([ci.source, ci.fact, ci.person, ci.transcription], [r.applied.source, 'birth', 'bo', 'Bo, son of …']);
  assert.deepEqual((await historyOf(t, id)).map((x) => `${x.kind}:${x.action}`), ['source:added', 'citation:added']);

  // Backing an event; a source that backs nothing keeps its transcription in its note.
  const ev = await suggest(t, member(ada), 'source', 'bo', { title: 'Baptism record', backs: { fact: 'event', event: 'e1' } });
  const er = await R.approveSuggestion(t, fay, ev.id);
  assert.equal((await db.db(t).get<{ event: string }>('SELECT event FROM citation WHERE id = ?', er.applied.citations![0]!))?.event, 'e1');
  const loose = await suggest(t, member(ada), 'source', null, { title: 'A letter', note: 'From Cara', transcription: 'Dear Bo' });
  const lr = await R.approveSuggestion(t, fay, loose.id);
  assert.equal((await db.db(t).get<{ note: string }>('SELECT note FROM source WHERE id = ?', lr.applied.source!))?.note, 'From Cara\n\nDear Bo');
  assert.equal(lr.applied.citations, undefined);
});

// ---------- files ----------

test('files move to source/ through the counted store, on a source made for them that cites the changed facts', async () => {
  const t = await family();
  asReviewer(fay);
  const { id } = await suggest(t, member(ada), 'details', 'bo', { born: '1919', diedPlace: 'Malmö', nickname: 'Bobo' });
  await S.addSuggestionFile(t, member(ada), id, file('image/png', PNG(), 'birth.png'), NOW);
  await S.addSuggestionFile(t, member(ada), id, file('application/pdf', PDF(), 'death.pdf'), NOW);
  const pending = await stored(t, 'suggest/');
  assert.equal(pending.length, 2);

  const r = await R.approveSuggestion(t, fay, id, undefined, { sourceTitle: '  Letters from Ada  ' });
  const so = (await db.db(t).get<Record<string, unknown>>('SELECT * FROM source WHERE id = ?', r.applied.source!))!;
  assert.equal(so.title, 'Letters from Ada');
  const cites = await db.db(t).all<{ fact: string; person: string }>('SELECT fact, person FROM citation WHERE source = ? ORDER BY fact', r.applied.source!);
  assert.deepEqual(cites.map((c) => `${c.fact}:${c.person}`), ['birth:bo', 'death:bo', 'name:bo']);
  const files = await db.db(t).all<{ media_key: string; mime: string; name: string; ord: number }>('SELECT * FROM source_file WHERE source = ? ORDER BY ord', r.applied.source!);
  assert.deepEqual(files.map((f) => [f.mime, f.name, f.ord]), [['image/png', 'birth.png', 0], ['application/pdf', 'death.pdf', 1]]);
  for (const f of files) assert.match(f.media_key, /^source\/[0-9a-f-]{36}\.(png|pdf)$/);
  assert.deepEqual(r.applied.files, files.map((f) => f.media_key));
  assert.deepEqual(await stored(t, 'suggest/'), [], 'the pending objects are gone');
  assert.deepEqual(await stored(t, 'source/'), files.map((f) => f.media_key).sort());
  assert.deepEqual(await usage(t, 'suggest/'), [], 'and no longer counted');
  assert.deepEqual(await usage(t, 'source/'), files.map((f) => f.media_key).sort(), 'the moved files are counted');
  assert.equal(await count(t, 'suggestion_file'), 0);
  const kinds = (await historyOf(t, id)).map((x) => `${x.kind}:${x.action}`);
  assert.deepEqual(kinds, ['person:changed', 'source:added', 'citation:added', 'citation:added', 'citation:added', 'source:changed']);

  // A source suggestion's files go to that source. Without a title given, the files' source says who supplied them.
  const src = await suggest(t, member(ada), 'source', 'bo', { title: 'Parish book' });
  await S.addSuggestionFile(t, member(ada), src.id, file('image/png', PNG(), 'page.png'), NOW);
  const sr = await R.approveSuggestion(t, fay, src.id);
  assert.equal(await count(t, 'source_file', `source = '${sr.applied.source}'`), 1);
  assert.equal(await count(t, 'source', "title = 'Parish book'"), 1);
  const ev = await suggest(t, { ...guest }, 'event', 'bo', { kind: 'census', date: '1930' });
  await S.addSuggestionFile(t, { ...guest }, ev.id, file('image/png', PNG(), 'census.png'), NOW);
  const er = await R.approveSuggestion(t, fay, ev.id);
  assert.equal((await db.db(t).get<{ title: string }>('SELECT title FROM source WHERE id = ?', er.applied.source!))?.title, 'Supplied with a suggestion by Hal Hazel');
  // In the reviewer's language.
  const de = await suggest(t, member(ada), 'event', 'bo', { kind: 'census', date: '1940' });
  await S.addSuggestionFile(t, member(ada), de.id, file('image/png', PNG(), 'census.png'), NOW);
  const dr = await R.approveSuggestion(t, fay, de.id, undefined, { locale: 'de' });
  assert.equal((await db.db(t).get<{ title: string }>('SELECT title FROM source WHERE id = ?', dr.applied.source!))?.title, 'Mit einem Vorschlag von Ada Alder geschickt');
  assert.equal((await db.db(t).get<{ event: string }>('SELECT event FROM citation WHERE source = ?', er.applied.source!))?.event, er.applied.event);
  assert.deepEqual(await stored(t, 'suggest/'), []);
});

// ---------- Review Focus 4: an approval that fails half-way ----------

test('an approval that fails at its second step is retried without duplicates, and its status flips once', async () => {
  const t = await family();
  asReviewer(fay);
  const { id } = await suggest(t, member(ada), 'relative', 'bo', { person: { given: 'Eve', born: '1952', living: false }, link: { kind: 'child' } });
  await S.addSuggestionFile(t, member(ada), id, file('image/png', PNG(), 'eve.png'), NOW);
  const before = await records(t);
  // The second step makes the files' source: the database refuses it this time.
  await db.db(t).run("CREATE TRIGGER no_sources BEFORE INSERT ON source BEGIN SELECT RAISE(ABORT, 'test: no sources'); END");
  assert.match(await refusal(R.approveSuggestion(t, fay, id)), /no sources/);
  assert.equal(await count(t, 'person'), before.person + 1, 'the first step was written');
  assert.equal((await row(t, id))!.status, 'waiting', 'the status flips only after the last step');
  assert.equal((await row(t, id))!.decided_at, null);
  assert.equal((await stored(t, 'suggest/')).length, 1, 'the file is still pending');

  await db.db(t).run('DROP TRIGGER no_sources');
  const r = await R.approveSuggestion(t, fay, id, undefined, { now: LATER });
  assert.equal(await count(t, 'person'), before.person + 1, 'the person is not added twice');
  assert.equal(await count(t, 'person', "given = 'Eve'"), 1);
  assert.equal(await count(t, 'parent'), before.parent + 1);
  assert.equal(await count(t, 'source'), before.source + 1);
  assert.equal(await count(t, 'source_file'), 1);
  assert.equal(await count(t, 'history', `suggestion = '${id}' AND kind = 'person'`), 1);
  const s = (await row(t, id))!;
  assert.deepEqual([s.status, s.decided_at], ['approved', LATER.toISOString()]);
  assert.equal(JSON.parse(s.applied as string).person, r.applied.person);

  // Approving again: it is no longer waiting, and nothing more is written.
  const after = await records(t);
  assert.equal(await refusal(R.approveSuggestion(t, gus, id)), 'suggest.err.state');
  assert.deepEqual(await records(t), after);
  assert.equal((await row(t, id))!.decided_at, LATER.toISOString());
});

test('an adjusted correction that fails at a later step finishes on retry with the values it began with', async () => {
  const t = await family();
  asReviewer(fay);
  const { id } = await suggest(t, member(ada), 'details', 'bo', { born: '1919', nickname: 'Bobo' });
  await S.addSuggestionFile(t, member(ada), id, file('image/png', PNG(), 'bo.png'), NOW);
  const ev = await suggest(t, member(ada), 'event', 'bo', { event: 'e1', place: 'Malmö' });
  await S.addSuggestionFile(t, member(ada), ev.id, file('image/png', PNG(), 'e1.png'), NOW);
  await db.db(t).run("CREATE TRIGGER no_sources BEFORE INSERT ON source BEGIN SELECT RAISE(ABORT, 'test: no sources'); END");
  assert.match(await refusal(R.approveSuggestion(t, fay, id, { born: '1918' })), /no sources/);
  assert.match(await refusal(R.approveSuggestion(t, fay, ev.id, { event: 'e1', place: 'Ystad' })), /no sources/);
  assert.equal((await personRow(t, 'bo'))!.born, '1918', 'the first step was written, adjusted');
  assert.equal((await db.db(t).get<{ place: string }>("SELECT place FROM life_event WHERE id = 'e1'"))?.place, 'Ystad');

  // Half-way, it can be neither declined nor withdrawn: only approving it again finishes it.
  assert.equal(await refusal(R.declineSuggestion(t, fay, id)), 'suggest.err.partial');
  assert.equal(await refusal(S.withdrawSuggestion(t, member(ada), id)), 'suggest.err.partial');
  assert.equal((await row(t, id))!.status, 'waiting');

  await db.db(t).run('DROP TRIGGER no_sources');
  // Sent again without the adjustment, or with another one: it finishes as it began.
  await R.approveSuggestion(t, fay, id);
  await R.approveSuggestion(t, gus, ev.id, { event: 'e1', place: 'Lund, cathedral' });
  const b = (await personRow(t, 'bo'))!;
  assert.deepEqual([b.born, b.nickname], ['1918', null], 'the adjusted values, not the suggested ones');
  assert.deepEqual([(await row(t, id))!.status, (await row(t, id))!.adjusted], ['approved', 1]);
  assert.equal((await db.db(t).get<{ place: string }>("SELECT place FROM life_event WHERE id = 'e1'"))?.place, 'Ystad');
  assert.deepEqual([(await row(t, ev.id))!.status, (await row(t, ev.id))!.adjusted], ['approved', 1]);
  assert.equal(await count(t, 'history', `suggestion = '${id}' AND kind = 'person'`), 1);
  assert.equal(await count(t, 'history', `suggestion = '${ev.id}' AND kind = 'event'`), 1);
  assert.equal(await count(t, 'source_file'), 2);
});

test('an approval begun whose steps are lost is refused rather than written twice', async () => {
  const t = await family();
  asReviewer(fay);
  const { id } = await suggest(t, member(ada), 'relative', 'bo', { person: { given: 'Eve', born: '1952', living: false }, link: { kind: 'child' } });
  await S.addSuggestionFile(t, member(ada), id, file('image/png', PNG()), NOW);
  await db.db(t).run("CREATE TRIGGER no_sources BEFORE INSERT ON source BEGIN SELECT RAISE(ABORT, 'test: no sources'); END");
  await refusal(R.approveSuggestion(t, fay, id));
  await db.db(t).run('DROP TRIGGER no_sources');
  await db.db(t).run("DELETE FROM op WHERE key LIKE 'sugg-%'");
  const before = await records(t);
  assert.equal(await refusal(R.approveSuggestion(t, fay, id)), 'suggest.err.stuck');
  assert.deepEqual(await records(t), before);
  assert.equal(await count(t, 'person', "given = 'Eve'"), 1);
});

test('a step of an approval writes nothing once its suggestion is no longer waiting', async () => {
  const t = await family();
  asReviewer(fay);
  const { id } = await suggest(t, member(ada), 'details', 'bo', { born: '1919' });
  await S.withdrawSuggestion(t, member(ada), id);
  const before = await records(t);
  // As if the suggester withdrew it between two steps: the person path, run for the suggestion, is refused by the batch.
  await assert.rejects(P.fillGaps(t, 'bo', { born: '1918' }, undefined, undefined, { suggestion: id }));
  assert.deepEqual(await records(t), before);
  assert.equal(await refusal(R.approveSuggestion(t, fay, id)), 'suggest.err.state');
});

test('a suggestion’s change stays its own history row beside the reviewer’s own edits', async () => {
  const t = await family();
  asReviewer(fay);
  await P.fillGaps(t, 'bo', { occupation: 'Fisher' }, undefined, undefined);
  const { id } = await suggest(t, member(ada), 'details', 'bo', { born: '1919' });
  await R.approveSuggestion(t, fay, id);
  await P.fillGaps(t, 'bo', { occupation: 'Sailor' }, undefined, undefined);
  const rows = await db.db(t).all<{ suggestion: string | null; fields: string }>("SELECT suggestion, fields FROM history WHERE record = 'bo' ORDER BY id");
  assert.deepEqual(rows.map((r) => [r.suggestion, Object.keys(JSON.parse(r.fields).f)]), [[null, ['occupation']], [id, ['born']], [null, ['occupation']]]);
});

test('approving a person whose processing is restricted is refused', async () => {
  const t = await family();
  asReviewer(fay);
  const { id } = await suggest(t, member(ada), 'details', 'bo', { born: '1919' });
  await db.store.accounts().run('INSERT INTO subject_restriction (tree, person, since, restricted_by) VALUES (?, ?, ?, ?)', t, 'bo', Date.now(), 'acc-gus');
  assert.match(await refusal(R.approveSuggestion(t, fay, id)), /restricted/);
  assert.equal((await personRow(t, 'bo'))!.born, '1920');
  const rel = await suggest(t, member(ada), 'relative', 'cara', { person: { given: 'Ivo', living: false }, link: { kind: 'child' } });
  assert.match(await refusal(R.approveSuggestion(t, fay, rel.id, undefined, { existing: 'bo' })), /restricted/);
});

// ---------- declining ----------

test('declining keeps the reason, deletes the files from storage, and only a waiting suggestion', async () => {
  const t = await family();
  const { id } = await suggest(t, member(ada), 'details', 'bo', { born: '1919' });
  await S.addSuggestionFile(t, member(ada), id, file('image/png', PNG()), NOW);
  await S.addSuggestionFile(t, member(ada), id, file('application/pdf', PDF()), NOW);
  assert.equal((await stored(t, 'suggest/')).length, 2);
  const before = await records(t);
  assert.equal(await refusal(R.declineSuggestion(t, fay, id, 'x'.repeat(MAX_REASON + 1))), 'suggest.err.reason');
  await R.declineSuggestion(t, fay, id, '  The parish book says 1920.  ', LATER);
  const s = (await row(t, id))!;
  assert.deepEqual([s.status, s.reason, s.decided_by, s.decided_by_name, s.decided_at], ['declined', 'The parish book says 1920.', 'acc-fay', 'Fay Fir', LATER.toISOString()]);
  assert.equal(await count(t, 'suggestion_file'), 0);
  assert.deepEqual(await stored(t, 'suggest/'), []);
  assert.deepEqual(await usage(t, 'suggest/'), []);
  assert.deepEqual(await records(t), before, 'declining writes no record');
  assert.equal(await refusal(R.declineSuggestion(t, fay, id)), 'suggest.err.state');
  assert.equal(await refusal(R.approveSuggestion(t, fay, id)), 'suggest.err.state');

  const quiet = await suggest(t, member(ada), 'details', 'bo', { born: '1918' });
  await R.declineSuggestion(t, gus, quiet.id);
  assert.deepEqual([(await row(t, quiet.id))!.status, (await row(t, quiet.id))!.reason], ['declined', null]);
});

// ---------- matches ----------

test('possible matches for a missing relative: similar names and near dates, best first, never applied', async () => {
  const t = await family();
  await db.db(t).run("INSERT INTO person (id, given, surname, born, living) VALUES ('fen2', 'Fenna', 'Fir', '1956', 0), ('fen3', 'Fen', 'Oak', '1890', 0), ('zed', 'Zed', 'Fir', '1955', 0)");
  const { id } = await suggest(t, member(ada), 'relative', 'bo', { person: { given: 'Fen', surname: 'Fir', born: '1955', living: false }, link: { kind: 'child' } });
  const before = await records(t);
  const m = await R.matchCandidates(t, fay, id);
  assert.equal(m[0]!.person, 'fen', 'same name, no date against it');
  assert.ok(m.some((x) => x.person === 'fen2'), 'a similar name and a near date');
  assert.ok(!m.some((x) => x.person === 'fen3'), 'a date far apart');
  assert.ok(!m.some((x) => x.person === 'zed'), 'another given name');
  assert.ok(!m.some((x) => x.person === 'bo'), 'never the person it is about');
  for (const x of m) assert.ok(x.score > 0 && x.score <= 1);
  assert.deepEqual([...m].sort((a, b) => b.score - a.score), m);
  assert.deepEqual(await records(t), before);
  assert.equal((await row(t, id))!.status, 'waiting');
  const details = await suggest(t, member(ada), 'details', 'bo', { born: '1919' });
  assert.deepEqual(await R.matchCandidates(t, fay, details.id), []);
  assert.equal(await refusal(R.matchCandidates(t, fay, 'nope')), 'suggest.err.gone');
});

// ---------- demo and View as ----------

test('a demo and a steward’s preview approve and decline nothing', async () => {
  const t = await family();
  const { id } = await suggest(t, member(ada), 'details', 'bo', { born: '1919' });
  await S.addSuggestionFile(t, member(ada), id, file('image/png', PNG()), NOW);
  const before = await records(t);
  const tryAll = async () => {
    assert.ok(await refusal(R.approveSuggestion(t, fay, id)));
    assert.ok(await refusal(R.declineSuggestion(t, fay, id)));
  };
  process.env.KINDRED_DEMO = '1';
  try {
    await tryAll();
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  readOnly.onRequestReadOnly(() => new AuthError('forbidden', 'You are viewing as an editor.'));
  try {
    await tryAll();
  } finally {
    readOnly.onRequestReadOnly(() => undefined);
  }
  assert.deepEqual(await records(t), before);
  assert.equal((await row(t, id))!.status, 'waiting');
  assert.equal((await stored(t, 'suggest/')).length, 1);
});
