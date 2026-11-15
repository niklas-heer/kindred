// node --test src/lib/suggestions/suggest.test.ts — making, attaching files to and withdrawing suggestions, on a private data
// folder with a fresh family per test: the family's settings, each kind checked against the record (a details suggestion
// keeps what it changes, an unchanged one is refused), that suggesting writes no record, a protecting link's guest and the
// living (the same refusal as for nobody), the limits, the files (type, size, count, the family's pending ceiling, the
// guests' switch, a failed write leaving nothing stored), withdrawing, and that a demo and a preview store nothing.
// Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-suggest-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
const db = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const S = await load<typeof import('./suggest.server.ts')>('/src/lib/suggestions/suggest.server.ts');
const readOnly = await load<typeof import('../read-only.ts')>('/src/lib/read-only.ts');
const { AuthError } = await load<typeof import('../auth/errors.ts')>('/src/lib/auth/errors.ts');
const { MAX_FILES, MAX_FILE_BYTES, MEMBER_WAITING, GUEST_WAITING_PER_NETWORK, GUEST_WAITING_PER_LINK, PENDING_BYTES, MAX_NOTE } =
  await load<typeof import('./types.ts')>('/src/lib/suggestions/types.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

type Role = 'viewer' | 'contributor' | 'editor' | 'steward';
const NOW = new Date('2026-11-15T10:00:00.000Z');

let families = 0;
/**
 * A fresh family: Ada (living, born 1950) and her late parents Bo (1920–1990, married to Cara in 1948 in Lund) and Cara
 * (1922–2001), Bo's baptism in 1920, and Dag (living), married to Ada and once Bo's partner.
 */
async function family(): Promise<string> {
  const id = `sugg${++families}`;
  await db.store.ensureTree(id);
  const d = db.db(id);
  await d.run("INSERT INTO meta (key, value) VALUES ('id', ?), ('name', 'The Alders') ON CONFLICT (key) DO UPDATE SET value = excluded.value", id);
  await d.run("INSERT INTO person (id, given, surname, sex, born, living) VALUES ('ada', 'Ada', 'Alder', 'f', '1950', 1)");
  await d.run("INSERT INTO person (id, given, surname, sex, born, born_place, died, living) VALUES ('bo', 'Bo', 'Alder', 'm', '1920', 'Lund', '1990', 0)");
  await d.run("INSERT INTO person (id, given, surname, current_surname, sex, born, died, living) VALUES ('cara', 'Cara', 'Birch', 'Alder', 'f', '1922', '2001', 0)");
  await d.run("INSERT INTO person (id, given, surname, living) VALUES ('dag', 'Dag', 'Dune', 1)");
  await d.run("INSERT INTO parent (child, parent) VALUES ('ada', 'bo'), ('ada', 'cara')");
  await d.run("INSERT INTO partnership (id, a, b, kind, start, place) VALUES ('u1', 'bo', 'cara', 'marriage', '1948', 'Lund'), ('u2', 'ada', 'dag', 'marriage', '1975', NULL), ('u3', 'bo', 'dag', 'partnership', '1995', NULL)");
  await d.run("INSERT INTO life_event (id, person, type, date, place, note, created_at, updated_at) VALUES ('e1', 'bo', 'baptism', '1920', 'Lund', '', ?, ?)", NOW.toISOString(), NOW.toISOString());
  await d.run("INSERT INTO life_event (id, person, type, date, created_at, updated_at) VALUES ('e2', 'ada', 'education', '1968', ?, ?)", NOW.toISOString(), NOW.toISOString());
  return id;
}
const who = (id: string, name: string, role: Role, person: string | null = null) => ({ id, name, role, person, personConfirmed: !!person });
const ada = who('acc-ada', 'Ada Alder', 'viewer', 'ada');
const eli = who('acc-eli', 'Eli Elm', 'contributor');
const fay = who('acc-fay', 'Fay Fir', 'editor');
const gus = who('acc-gus', 'Gus Gale', 'steward');
const member = (w: ReturnType<typeof who>) => ({ kind: 'member' as const, who: w });
const guest = (n: number, protectLiving = true, net = n, link = 'link-1') =>
  ({ kind: 'guest' as const, key: `g:key-${n}`, name: `Guest ${n}`, link, net, protectLiving });

/** The error a promise is refused with: its message (a translation key, or an AuthError's text). */
async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  assert.fail('expected a refusal');
}
const row = (t: string, id: string) => db.db(t).get<Record<string, unknown>>('SELECT * FROM suggestion WHERE id = ?', id);
const count = async (t: string, table: string) => (await db.db(t).get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))!.n;
const RECORD_TABLES = ['person', 'parent', 'partnership', 'life_event', 'source', 'citation', 'history', 'media', 'source_file'];
const records = async (t: string) => Object.fromEntries(await Promise.all(RECORD_TABLES.map(async (x) => [x, await count(t, x)])));
const personRow = (t: string, id: string) => db.db(t).get<Record<string, unknown>>('SELECT * FROM person WHERE id = ?', id);

const enc = (s: string) => new TextEncoder().encode(s);
/** A one-pixel PNG with nothing to strip. */
const PNG = () => new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const PDF = () => enc('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n\nxref\n0 1\ntrailer\n<<>>\nstartxref\n9\n%%EOF\n');
const HEIC = () => new Uint8Array([0, 0, 0, 24, ...enc('ftypheic'), 0, 0, 0, 0, ...enc('mif1heic'), 1, 2, 3]);
const file = (mime: string, bytes: Uint8Array, name = 'letter') => ({ name, mime, bytes });
const stored = async (t: string) => (await db.store.media.list(t)).map((f) => f.key).filter((k) => k.startsWith('suggest/'));

const details = (t: string, by: Parameters<typeof S.createSuggestion>[1], person: string | null, payload: unknown, note?: string) =>
  S.createSuggestion(t, by, { kind: 'details', person, payload: payload as never, note }, NOW);

// ---------- settings ----------

test('the settings default to guests suggesting with files; only a steward changes them, and the change is in the history', async () => {
  const t = await family();
  assert.deepEqual(await S.suggestSettings(t), { guests: true, guestFiles: true });
  assert.match(await refusal(S.saveSuggestSettings(t, fay, { guests: false, guestFiles: false })), /permission|steward/i);
  const before = await count(t, 'history');
  await S.saveSuggestSettings(t, gus, { guests: false, guestFiles: true });
  assert.deepEqual(await S.suggestSettings(t), { guests: false, guestFiles: true });
  assert.equal(await count(t, 'history'), before + 1, 'meta is a record: the change is in the history');
  await S.saveSuggestSettings(t, gus, { guests: true, guestFiles: false });
  assert.deepEqual(await S.suggestSettings(t), { guests: true, guestFiles: false });
  assert.equal(await refusal(S.saveSuggestSettings(t, gus, { guests: 'yes' as never, guestFiles: true })), 'suggest.err.settings');
});

// ---------- each kind ----------

test('a details suggestion keeps only the fields it changes, with their values on record as its basis', async () => {
  const t = await family();
  const { id } = await details(t, member(ada), 'cara', { given: 'Cara', surname: 'Ash', birthName: 'Birch', born: '1922-03-04', bornPlace: ' Malmö ', nickname: '' }, '  From her passport. ');
  const r = (await row(t, id))!;
  assert.equal(r.kind, 'details');
  assert.equal(r.person, 'cara');
  assert.equal(r.status, 'waiting');
  assert.deepEqual(JSON.parse(r.payload as string), { surname: 'Ash', born: '1922-03-04', bornPlace: 'Malmö' });
  // `surname` is the name she goes by now (current, else at birth); `birthName` her surname at birth.
  assert.deepEqual(JSON.parse(r.basis as string), { surname: 'Alder', born: '1922', bornPlace: null });
  assert.equal(r.note, 'From her passport.');
  assert.deepEqual([r.account, r.guest_key, r.author_name, r.author_person, r.created_at], ['acc-ada', null, 'Ada Alder', 'ada', NOW.toISOString()]);
  // A birth surname differs from the current one; sex and living are read as the form writes them.
  const second = await details(t, member(eli), 'cara', { birthName: 'Berg', sex: 'x', living: false, died: '' });
  assert.deepEqual(JSON.parse((await row(t, second.id))!.payload as string), { birthName: 'Berg', sex: 'x', died: null });
  assert.deepEqual(JSON.parse((await row(t, second.id))!.basis as string), { birthName: 'Birch', sex: 'f', died: '2001' });
  assert.equal((await row(t, second.id))!.author_person, null, 'a member with no confirmed person signs with none');
});

test('a details suggestion that changes nothing, or is not a valid change, is refused', async () => {
  const t = await family();
  assert.equal(await refusal(details(t, member(ada), 'bo', { given: 'Bo', surname: 'Alder', born: '1920', living: false })), 'suggest.err.unchanged');
  assert.equal(await refusal(details(t, member(ada), 'bo', {})), 'suggest.err.unchanged');
  for (const bad of [{ born: '1920-13' }, { sex: 'q' }, { given: '' }, { given: 'x'.repeat(121) }, { bornPlace: 'x'.repeat(201) }, { bio: 'A long life' }, { living: 'no' }, []]) {
    assert.equal(await refusal(details(t, member(ada), 'bo', bad)), 'suggest.err.payload', JSON.stringify(bad));
  }
  assert.equal(await refusal(details(t, member(ada), 'nobody', { born: '1920' })), 'suggest.err.person');
  assert.equal(await refusal(details(t, member(ada), null, { born: '1920' })), 'suggest.err.person');
  assert.equal(await refusal(details(t, member(ada), 'bo', { born: '1921' }, 'x'.repeat(MAX_NOTE + 1))), 'suggest.err.note');
  assert.equal(await refusal(S.createSuggestion(t, member(ada), { kind: 'gossip' as never, person: 'bo', payload: {} as never }, NOW)), 'suggest.err.payload');
});

test('a missing relative is a new person and a link, checked like the add-relative form', async () => {
  const t = await family();
  const payload = { person: { given: 'Hugo', surname: 'Alder', sex: 'm', born: '1946', died: '2010', living: false }, link: { kind: 'sibling' } };
  const { id } = await S.createSuggestion(t, member(ada), { kind: 'relative', person: 'ada', payload: payload as never }, NOW);
  const r = (await row(t, id))!;
  assert.deepEqual(JSON.parse(r.payload as string), payload);
  assert.equal(r.basis, null);
  const parent = { person: { given: 'Ivo', furtherGiven: ['Karl'], living: false }, link: { kind: 'parent', parentKind: 'adoptive' } };
  await S.createSuggestion(t, member(ada), { kind: 'relative', person: 'bo', payload: parent as never }, NOW);
  const partner = { person: { given: 'Jo', living: true }, link: { kind: 'partner', partnerKind: 'betrothal' } };
  await S.createSuggestion(t, member(ada), { kind: 'relative', person: 'dag', payload: partner as never }, NOW);
  for (const bad of [
    { person: { given: '', living: false }, link: { kind: 'child' } },
    { person: { given: 'Jo', sex: 'q', living: false }, link: { kind: 'child' } },
    { person: { given: 'Jo', born: '19x0', living: false }, link: { kind: 'child' } },
    { person: { given: 'Jo' }, link: { kind: 'child' } },
    { person: { given: 'Jo', living: false }, link: { kind: 'cousin' } },
    { person: { given: 'Jo', living: false }, link: { kind: 'partner', parentKind: 'adoptive' } },
    { person: { given: 'Jo', living: false }, link: { kind: 'child', partnerKind: 'marriage' } },
    { person: { given: 'Jo', living: false }, link: { kind: 'parent', parentKind: 'grand' } },
  ]) assert.equal(await refusal(S.createSuggestion(t, member(ada), { kind: 'relative', person: 'bo', payload: bad as never }, NOW)), 'suggest.err.payload', JSON.stringify(bad));
  assert.equal(await refusal(S.createSuggestion(t, member(ada), { kind: 'relative', person: null, payload: payload as never }, NOW)), 'suggest.err.person');
});

test('a life event is a new one on the person, or a correction of one of theirs (or of their partnership) kept with its values', async () => {
  const t = await family();
  const ev = (person: string | null, payload: unknown) => S.createSuggestion(t, member(ada), { kind: 'event', person, payload: payload as never }, NOW);
  const added = await ev('bo', { kind: 'military', date: '1940', place: 'Kiel', note: 'Navy' });
  assert.deepEqual(JSON.parse((await row(t, added.id))!.payload as string), { kind: 'military', date: '1940', place: 'Kiel', note: 'Navy' });
  assert.equal((await row(t, added.id))!.basis, null);

  const fixed = await ev('bo', { event: 'e1', date: '1920-05', place: 'Lund', note: 'In the cathedral' });
  assert.deepEqual(JSON.parse((await row(t, fixed.id))!.payload as string), { event: 'e1', date: '1920-05', note: 'In the cathedral' });
  assert.deepEqual(JSON.parse((await row(t, fixed.id))!.basis as string), { date: '1920', place: 'Lund', note: '' });

  const union = await ev('cara', { partnership: 'u1', partnershipKind: 'marriage', start: '1948-06-01', startPlace: 'Malmö' });
  assert.deepEqual(JSON.parse((await row(t, union.id))!.payload as string), { partnership: 'u1', start: '1948-06-01', startPlace: 'Malmö' });
  assert.deepEqual(JSON.parse((await row(t, union.id))!.basis as string), { partnershipKind: 'marriage', start: '1948', startPlace: 'Lund' });

  assert.equal(await refusal(ev('bo', { event: 'e1', date: '1920', place: 'Lund' })), 'suggest.err.unchanged');
  assert.equal(await refusal(ev('bo', { partnership: 'u1', start: '1948' })), 'suggest.err.unchanged');
  assert.equal(await refusal(ev('bo', { event: 'e2', date: '1969' })), 'suggest.err.event', 'another person’s event');
  assert.equal(await refusal(ev('bo', { event: 'nope', date: '1969' })), 'suggest.err.event');
  assert.equal(await refusal(ev('bo', { partnership: 'u2', start: '1976' })), 'suggest.err.event', 'a partnership they are not in');
  assert.equal(await refusal(ev('ada', { kind: 'burial', date: '2020' })), 'suggest.err.event', 'no burial for the living');
  assert.equal(await refusal(ev('bo', { kind: 'custom', date: '1950' })), 'suggest.err.event', 'a custom event needs a label');
  for (const bad of [{}, { kind: 'party' }, { kind: 'census', date: '1950-02-30' }, { event: 'e1', kind: 'census' }, { event: 'e1', partnership: 'u1' }, { partnership: 'u1', partnershipKind: 'fling' }, { kind: 'census', start: '1950' }]) {
    assert.equal(await refusal(ev('bo', bad)), 'suggest.err.payload', JSON.stringify(bad));
  }
});

test('a source may back a fact of its person: their birth, death or name, or one of their events', async () => {
  const t = await family();
  const src = (person: string | null, payload: unknown) => S.createSuggestion(t, member(ada), { kind: 'source', person, payload: payload as never }, NOW);
  const a = await src('bo', { title: 'Parish register of Lund', author: 'Lund parish', reference: 'https://example.org/lund', date: '1920', transcription: 'Bo, son of …', backs: { fact: 'birth' } });
  assert.equal(JSON.parse((await row(t, a.id))!.payload as string).backs.fact, 'birth');
  await src('bo', { title: 'Baptism record', backs: { fact: 'event', event: 'e1' } });
  await src(null, { title: 'A family bible' });
  assert.equal(await refusal(src(null, { title: 'A family bible', backs: { fact: 'birth' } })), 'suggest.err.backs');
  assert.equal(await refusal(src('bo', { title: 'X', backs: { fact: 'event', event: 'e2' } })), 'suggest.err.backs', 'an event of someone else');
  assert.equal(await refusal(src('bo', { title: 'X', backs: { fact: 'event' } })), 'suggest.err.backs');
  assert.equal(await refusal(src('bo', { title: 'X', backs: { fact: 'birth', event: 'e1' } })), 'suggest.err.backs');
  for (const bad of [{ title: '' }, { title: 'X', date: 'soon' }, { title: 'X', backs: { fact: 'parent' } }, { title: 'x'.repeat(301) }]) {
    assert.equal(await refusal(src('bo', bad)), 'suggest.err.payload', JSON.stringify(bad));
  }
});

// ---------- Review Focus 1: no record changes ----------

test('suggesting, attaching and withdrawing write none of the family’s records', async () => {
  const t = await family();
  const before = await records(t);
  const bo = await personRow(t, 'bo');
  const ids = [
    await details(t, member(ada), 'bo', { born: '1919', died: '1991', bornPlace: 'Malmö' }),
    await S.createSuggestion(t, member(ada), { kind: 'relative', person: 'bo', payload: { person: { given: 'Ivo', living: false }, link: { kind: 'parent' } } as never }, NOW),
    await S.createSuggestion(t, member(ada), { kind: 'event', person: 'bo', payload: { event: 'e1', date: '1921' } as never }, NOW),
    await S.createSuggestion(t, member(ada), { kind: 'event', person: 'bo', payload: { partnership: 'u1', start: '1947' } as never }, NOW),
    await S.createSuggestion(t, guest(1, true), { kind: 'source', person: 'bo', payload: { title: 'Register', backs: { fact: 'birth' } } as never }, NOW),
  ];
  await S.addSuggestionFile(t, member(ada), ids[0]!.id, file('image/png', PNG()), NOW);
  await S.withdrawSuggestion(t, member(ada), ids[1]!.id);
  assert.deepEqual(await records(t), before);
  assert.deepEqual(await personRow(t, 'bo'), bo);
  assert.equal(await count(t, 'suggestion'), 5);
});

// ---------- Review Focus 2: a protecting link's guest and the living ----------

test('a protecting link’s guest gets the same refusal for a living person as for nobody, and never suggests a living relative', async () => {
  const t = await family();
  const g = guest(1, true);
  const kinds = [
    { kind: 'details', payload: { born: '1951' } },
    { kind: 'relative', payload: { person: { given: 'Jo', living: false }, link: { kind: 'child' } } },
    { kind: 'event', payload: { kind: 'census', date: '1960' } },
    { kind: 'source', payload: { title: 'Register' } },
  ] as const;
  for (const k of kinds) {
    const living = await refusal(S.createSuggestion(t, g, { kind: k.kind, person: 'ada', payload: k.payload as never }, NOW));
    const nobody = await refusal(S.createSuggestion(t, g, { kind: k.kind, person: 'nobody', payload: k.payload as never }, NOW));
    assert.equal(living, 'suggest.err.person', k.kind);
    assert.equal(living, nobody, `${k.kind}: the same refusal reveals nothing`);
  }
  // About the living: a partnership with a living partner, a relative or a person marked living.
  assert.equal(await refusal(S.createSuggestion(t, g, { kind: 'event', person: 'bo', payload: { partnership: 'u3', start: '1996' } as never }, NOW)), 'suggest.err.person');
  assert.equal(await refusal(S.createSuggestion(t, g, { kind: 'relative', person: 'bo', payload: { person: { given: 'Jo', living: true }, link: { kind: 'child' } } as never }, NOW)), 'suggest.err.living');
  assert.equal(await refusal(details(t, g, 'bo', { living: true })), 'suggest.err.living');
  // Someone not living is theirs to suggest about, as the link shows them in full.
  const ok = await details(t, g, 'bo', { born: '1919' });
  const r = (await row(t, ok.id))!;
  assert.deepEqual([r.account, r.guest_key, r.author_name, r.author_person, r.link, r.net], [null, 'g:key-1', 'Guest 1', null, 'link-1', 1]);
  await S.createSuggestion(t, g, { kind: 'relative', person: 'bo', payload: { person: { given: 'Jo', living: false }, link: { kind: 'child' } } as never }, NOW);
  await S.createSuggestion(t, g, { kind: 'event', person: 'bo', payload: { partnership: 'u1', start: '1947' } as never }, NOW);

  // A link that does not protect the living shows them, so its guest may suggest about them.
  const open = guest(2, false);
  await details(t, open, 'ada', { born: '1951' });
  await S.createSuggestion(t, open, { kind: 'relative', person: 'ada', payload: { person: { given: 'Jo', living: true }, link: { kind: 'child' } } as never }, NOW);
  assert.equal(await refusal(details(t, open, 'nobody', { born: '1951' })), 'suggest.err.person');

  // Someone marked living after the suggestion was made: no file is added to it by such a guest.
  await db.db(t).run("UPDATE person SET living = 1 WHERE id = 'bo'");
  assert.equal(await refusal(S.addSuggestionFile(t, g, ok.id, file('image/png', PNG()), NOW)), 'suggest.err.person');
  assert.deepEqual(await stored(t), []);
});

test('a guest gives a name, needs the family’s switch, and is held to the network’s and the link’s limits', async () => {
  const t = await family();
  const some = (g: ReturnType<typeof guest>) => details(t, g, 'bo', { born: '1919' });
  assert.equal(await refusal(some({ ...guest(1), name: '   ' })), 'suggest.err.name');
  assert.equal(await refusal(some({ ...guest(1), name: 'x'.repeat(61) })), 'suggest.err.name');
  assert.equal(await refusal(some({ ...guest(1), key: 'acc-ada' })), 'suggest.err.guests');
  await S.saveSuggestSettings(t, gus, { guests: false, guestFiles: true });
  assert.equal(await refusal(some(guest(1))), 'suggest.err.guests');
  await S.saveSuggestSettings(t, gus, { guests: true, guestFiles: true });

  const d = db.db(t);
  const fill = async (n: number, net: number, link: string, status = 'waiting') => {
    for (let i = 0; i < n; i++) {
      await d.run("INSERT INTO suggestion (id, kind, person, payload, status, guest_key, author_name, link, net, created_at) VALUES (?, 'details', 'bo', '{}', ?, ?, 'G', ?, ?, ?)",
        crypto.randomUUID(), status, `g:other-${i}`, link, net, NOW.toISOString());
    }
  };
  await fill(GUEST_WAITING_PER_NETWORK - 1, 7, 'link-1');
  await fill(5, 7, 'link-1', 'declined');
  await some(guest(1, true, 7));
  assert.equal(await refusal(some(guest(2, true, 7))), 'suggest.err.limit', 'the network has its twenty waiting');
  await some(guest(3, true, 7, 'link-2'));
  await some(guest(4, true, 8));
  await fill(GUEST_WAITING_PER_LINK - GUEST_WAITING_PER_NETWORK - 1, 9, 'link-1');
  assert.equal(await refusal(some(guest(5, true, 10))), 'suggest.err.limit', 'the link has its hundred waiting');
  // A member is not counted with the guests.
  await some(member(ada) as never);
});

test('a member needs the suggest role and has at most fifty waiting', async () => {
  const t = await family();
  const guestWho = { id: '', name: '', role: 'viewer' as const, guest: true };
  assert.match(await refusal(details(t, member(guestWho as never), 'bo', { born: '1919' })), /access/);
  const d = db.db(t);
  for (let i = 0; i < MEMBER_WAITING - 1; i++) {
    await d.run("INSERT INTO suggestion (id, kind, person, payload, status, account, author_name, created_at) VALUES (?, 'details', 'bo', '{}', 'waiting', 'acc-ada', 'Ada', ?)", crypto.randomUUID(), NOW.toISOString());
  }
  await d.run("INSERT INTO suggestion (id, kind, person, payload, status, account, author_name, created_at) VALUES (?, 'details', 'bo', '{}', 'approved', 'acc-ada', 'Ada', ?)", crypto.randomUUID(), NOW.toISOString());
  await details(t, member(ada), 'bo', { born: '1919' });
  assert.equal(await refusal(details(t, member(ada), 'bo', { born: '1918' })), 'suggest.err.too_many');
  await details(t, member(eli), 'bo', { born: '1918' });
});

// ---------- files ----------

test('files: images and PDFs whose bytes agree, up to the size and the count, stored under suggest/ and counted', async () => {
  const t = await family();
  const { id } = await details(t, member(ada), 'bo', { born: '1919' });
  const png = await S.addSuggestionFile(t, member(ada), id, file('image/png', PNG(), 'C:\\scans\\birth.png'), NOW);
  const f = (await db.db(t).get<{ suggestion: string; key: string; mime: string; size: number; name: string; created_at: string }>('SELECT * FROM suggestion_file WHERE id = ?', png.id))!;
  assert.match(f.key, /^suggest\/[0-9a-f-]{36}\.png$/);
  assert.deepEqual([f.suggestion, f.mime, f.size, f.name, f.created_at], [id, 'image/png', PNG().length, 'birth.png', NOW.toISOString()]);
  assert.ok(await db.media.get(t, f.key), 'the file is stored');
  const usage = await db.store.accounts().get<{ bytes: number }>('SELECT bytes FROM media_usage WHERE tree = ? AND key = ?', t, f.key);
  assert.equal(usage?.bytes, PNG().length, 'and counted against the family’s storage');
  const pdf = await S.addSuggestionFile(t, member(ada), id, file('application/pdf', PDF()), NOW);
  assert.match((await db.db(t).get<{ key: string }>('SELECT key FROM suggestion_file WHERE id = ?', pdf.id))!.key, /\.pdf$/);
  const heic = await S.addSuggestionFile(t, member(ada), id, file('image/heic', HEIC()), NOW);
  assert.match((await db.db(t).get<{ key: string }>('SELECT key FROM suggestion_file WHERE id = ?', heic.id))!.key, /\.heic$/);

  assert.equal(await refusal(S.addSuggestionFile(t, member(ada), id, file('image/png', PDF()), NOW)), 'suggest.err.file_type', 'bytes that disagree');
  assert.equal(await refusal(S.addSuggestionFile(t, member(ada), id, file('image/gif', enc('GIF89a....')), NOW)), 'suggest.err.file_type');
  assert.equal(await refusal(S.addSuggestionFile(t, member(ada), id, file('application/pdf', enc('%PDF-1.4\n/JavaScript (x)\n%%EOF\n')), NOW)), 'suggest.err.file_type');
  assert.equal(await refusal(S.addSuggestionFile(t, member(ada), id, file('image/png', new Uint8Array()), NOW)), 'suggest.err.file_type');
  const big = new Uint8Array(MAX_FILE_BYTES + 1);
  big.set(PNG());
  assert.equal(await refusal(S.addSuggestionFile(t, member(ada), id, file('image/png', big), NOW)), 'suggest.err.file_size');

  await S.addSuggestionFile(t, member(ada), id, file('image/png', PNG()), NOW);
  await S.addSuggestionFile(t, member(ada), id, file('image/png', PNG()), NOW);
  assert.equal(await count(t, 'suggestion_file'), MAX_FILES);
  assert.equal(await refusal(S.addSuggestionFile(t, member(ada), id, file('image/png', PNG()), NOW)), 'suggest.err.files');
  assert.equal((await stored(t)).length, MAX_FILES, 'a refused file is never stored');
});

test('files: only to your own waiting suggestion, within the family’s pending ceiling; guests only while the steward allows', async () => {
  const t = await family();
  const mine = await details(t, member(ada), 'bo', { born: '1919' });
  assert.equal(await refusal(S.addSuggestionFile(t, member(eli), mine.id, file('image/png', PNG()), NOW)), 'suggest.err.gone');
  assert.equal(await refusal(S.addSuggestionFile(t, guest(1), mine.id, file('image/png', PNG()), NOW)), 'suggest.err.gone');
  assert.equal(await refusal(S.addSuggestionFile(t, member(ada), 'nope', file('image/png', PNG()), NOW)), 'suggest.err.gone');

  const g = await details(t, guest(1), 'bo', { born: '1918' });
  await S.addSuggestionFile(t, guest(1), g.id, file('image/png', PNG()), NOW);
  assert.equal(await refusal(S.addSuggestionFile(t, guest(2), g.id, file('image/png', PNG()), NOW)), 'suggest.err.gone');
  await S.saveSuggestSettings(t, gus, { guests: true, guestFiles: false });
  assert.equal(await refusal(S.addSuggestionFile(t, guest(1), g.id, file('image/png', PNG()), NOW)), 'suggest.err.guest_files');
  await S.addSuggestionFile(t, member(ada), mine.id, file('image/png', PNG()), NOW);

  // The family's pending files: waiting suggestions' only; one more byte over the ceiling is refused.
  const d = db.db(t);
  const other = crypto.randomUUID();
  await d.run("INSERT INTO suggestion (id, kind, person, payload, status, account, author_name, created_at) VALUES (?, 'details', 'bo', '{}', 'waiting', 'acc-x', 'X', ?)", other, NOW.toISOString());
  const pending = (await d.get<{ n: number }>("SELECT coalesce(sum(size), 0) AS n FROM suggestion_file"))!.n;
  await d.run("INSERT INTO suggestion_file (id, suggestion, key, mime, size, name, created_at) VALUES ('big', ?, 'suggest/big.pdf', 'application/pdf', ?, 'big', ?)", other, PENDING_BYTES - pending - PNG().length + 1, NOW.toISOString());
  assert.equal(await refusal(S.addSuggestionFile(t, member(ada), mine.id, file('image/png', PNG()), NOW)), 'suggest.err.pending');
  await d.run("UPDATE suggestion SET status = 'declined' WHERE id = ?", other);
  await S.addSuggestionFile(t, member(ada), mine.id, file('image/png', PNG()), NOW);

  await S.withdrawSuggestion(t, member(ada), mine.id);
  assert.equal(await refusal(S.addSuggestionFile(t, member(ada), mine.id, file('image/png', PNG()), NOW)), 'suggest.err.state');
});

test('a file whose row the database refuses is deleted from storage again', async () => {
  const t = await family();
  const { id } = await details(t, member(ada), 'bo', { born: '1919' });
  await db.db(t).run("CREATE TRIGGER no_files BEFORE INSERT ON suggestion_file BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed: test'); END");
  assert.match(await refusal(S.addSuggestionFile(t, member(ada), id, file('image/png', PNG()), NOW)), /constraint failed/);
  assert.deepEqual(await stored(t), []);
  const usage = await db.store.accounts().get<{ n: number }>("SELECT count(*) AS n FROM media_usage WHERE tree = ? AND key LIKE 'suggest/%'", t);
  assert.equal(usage?.n, 0, 'and no longer counted');
});

// ---------- withdrawing ----------

test('withdrawing your own waiting suggestion deletes its files from storage and their rows', async () => {
  const t = await family();
  const { id } = await details(t, member(ada), 'bo', { born: '1919' });
  await S.addSuggestionFile(t, member(ada), id, file('image/png', PNG()), NOW);
  await S.addSuggestionFile(t, member(ada), id, file('application/pdf', PDF()), NOW);
  assert.equal((await stored(t)).length, 2);
  assert.equal(await refusal(S.withdrawSuggestion(t, member(eli), id)), 'suggest.err.gone');
  assert.equal(await refusal(S.withdrawSuggestion(t, guest(1), id)), 'suggest.err.gone');
  await S.withdrawSuggestion(t, member(ada), id, NOW);
  const r = (await row(t, id))!;
  assert.deepEqual([r.status, r.decided_at], ['withdrawn', NOW.toISOString()]);
  assert.equal(await count(t, 'suggestion_file'), 0);
  assert.deepEqual(await stored(t), []);
  assert.equal(await refusal(S.withdrawSuggestion(t, member(ada), id)), 'suggest.err.state');

  // A guest withdraws theirs by their key, even after the family stopped guests suggesting.
  const g = await details(t, guest(1), 'bo', { born: '1918' });
  await S.addSuggestionFile(t, guest(1), g.id, file('image/png', PNG()), NOW);
  await S.saveSuggestSettings(t, gus, { guests: false, guestFiles: false });
  await S.withdrawSuggestion(t, guest(1), g.id);
  assert.equal((await row(t, g.id))!.status, 'withdrawn');
  assert.deepEqual(await stored(t), []);
});

// ---------- demo and View as ----------

test('a demo and a steward’s preview store nothing', async () => {
  const t = await family();
  const { id } = await details(t, member(ada), 'bo', { born: '1919' });
  const tryAll = async () => {
    assert.notEqual(await refusal(details(t, member(ada), 'bo', { born: '1918' })), 'suggest.err.unchanged');
    assert.ok(await refusal(S.addSuggestionFile(t, member(ada), id, file('image/png', PNG()), NOW)));
    assert.ok(await refusal(S.withdrawSuggestion(t, member(ada), id)));
    assert.ok(await refusal(S.saveSuggestSettings(t, gus, { guests: false, guestFiles: false })));
  };
  process.env.KINDRED_DEMO = '1';
  try {
    await tryAll();
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  readOnly.onRequestReadOnly(() => new AuthError('forbidden', 'You are viewing as a viewer.'));
  try {
    await tryAll();
  } finally {
    readOnly.onRequestReadOnly(() => undefined);
  }
  assert.equal(await count(t, 'suggestion'), 1);
  assert.equal((await row(t, id))!.status, 'waiting');
  assert.equal(await count(t, 'suggestion_file'), 0);
  assert.deepEqual(await stored(t), []);
  assert.deepEqual(await S.suggestSettings(t), { guests: true, guestFiles: true });
});
