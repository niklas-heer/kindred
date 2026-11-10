// node --test src/lib/history.test.ts — the change history (history.server.ts): every records write carries its row in the
// same batch, and a write that forgets it is refused; who may read which row (a Personal field's change is its author's alone
// and holds no content, Editors-level content is for editors and stewards, a guest gets nothing); saves folded together; a
// bulk import as one row; restoring a value; "since your last visit"; comments read only when their table exists; pruning.
// The real server functions run against scratch databases; only "who is asking" and createServerFn are replaced, as in
// field-visibility.test.ts.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createServer, type Plugin } from 'vite';
import type { Role } from './roles.ts';

const dir = mkdtempSync(join(tmpdir(), 'kindred-history-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'history-test-secret';

const STUB_START = '\0stub-start';
const STUB_START_SERVER = '\0stub-start-server';
const STUB_SESSION = '\0stub-session';
const framework: Plugin = {
  name: 'stub-framework',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === '@tanstack/react-start') return STUB_START;
    if (source === '@tanstack/react-start/server') return STUB_START_SERVER;
    if (source === './session.server' && importer?.endsWith('guard.server.ts')) return STUB_SESSION;
    return undefined;
  },
  load(id) {
    if (id === STUB_START) return `export const createServerFn = () => { const b = { validator: () => b, handler: (fn) => { const f = (o) => fn(o ?? {}); f.isServerFn = true; return f; } }; return b; };`;
    // One request per "who is asking", as a real request is one reader: the guard remembers its session and actor per request.
    if (id === STUB_START_SERVER) return `
      export const getRequest = () => globalThis.__request ?? (globalThis.__request = new Request('http://localhost/'));
      export const getRequestIP = () => '203.0.113.1';
      export const setResponseStatus = () => {};
      export const appendResponseHeader = () => {};
      export const getRequestHeader = () => undefined;`;
    if (id === STUB_SESSION) return `export const getSession = async () => ({ user: globalThis.__signedIn ?? null, via: globalThis.__signedIn ? 'passkey' : null, guest: globalThis.__guest });`;
    return undefined;
  },
};
const vite = await createServer({
  configFile: false, root: process.cwd(), logLevel: 'error', plugins: [framework],
  resolve: { alias: { '~': resolve('src') } },
  ssr: { noExternal: [/^@tanstack\/react-start/] },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
});
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;

const store = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const dbs = await load<typeof import('./db.server.ts')>('/src/lib/db.server.ts');
const h = await load<typeof import('./history.server.ts')>('/src/lib/history.server.ts');
const hf = await load<typeof import('./history.functions.ts')>('/src/lib/history.functions.ts');
const fns = await load<typeof import('./person.functions.ts')>('/src/lib/person.functions.ts');
const api = await load<typeof import('./api.ts')>('/src/lib/api.ts');
const importer = await load<typeof import('./exchange/import.server.ts')>('/src/lib/exchange/import.server.ts');
const sources = await load<typeof import('./sources.server.ts')>('/src/lib/sources.server.ts');
const research = await load<typeof import('./research.server.ts')>('/src/lib/research.server.ts');
const push = await load<typeof import('./history-push.server.ts')>('/src/lib/history-push.server.ts');

const TREE = 'chronicle';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AUTHOR = id(1), EDITOR = id(2), STEWARD = id(3), CONTRIBUTOR = id(4), VIEWER = id(5);
const SECRET = 'PERSONALSECRET', HIDDEN = 'EDITORSHIDDEN';

const g = globalThis as unknown as { __signedIn?: { id: string; name: string } | null; __guest?: unknown; __request?: Request };
const NAMES: Record<string, string> = { [AUTHOR]: 'Mara Quill', [EDITOR]: 'Tobit Fenn', [STEWARD]: 'Ilse Ward', [CONTRIBUTOR]: 'Odo Brisk', [VIEWER]: 'Vera Lumen' };
const as = (user: string) => { g.__signedIn = { id: user, name: NAMES[user] ?? user }; g.__guest = undefined; g.__request = new Request('http://localhost/'); };
const asGuest = () => { g.__signedIn = null; g.__guest = { link: 'l', tree: TREE, expires: Date.now() + 3_600_000, protectLiving: false }; g.__request = new Request('http://localhost/'); };
let ops = 0;
const opKey = () => `histop-${++ops}-abcdefgh`;
const d = () => dbs.db(TREE);
type Snap = Awaited<ReturnType<typeof fns.getEditSnapshot>>;
const details = (s: Snap) => ({
  given: s.given, surname: s.surname, currentGiven: s.currentGiven, currentSurname: s.currentSurname, nickname: s.nickname, sex: s.sex,
  born: s.born, bornPlace: s.bornPlace, died: s.died, diedPlace: s.diedPlace, living: s.living, title: s.title, epithet: s.epithet,
  occupation: s.occupation, occupationCode: s.occupationCode, bio: s.bio,
});
const inputs = (s: Snap) => s.fields.map((f) => ({ id: f.id, type: f.type, label: f.label, value: f.value, visibility: f.visibility }));
type Input = Omit<ReturnType<typeof inputs>[number], 'id'> & { id?: string };
const save = async (person: string, change: (s: Snap) => { details?: Partial<ReturnType<typeof details>>; fields?: Input[] }) => {
  const s = await fns.getEditSnapshot({ data: { tree: TREE, id: person } });
  const c = change(s);
  return fns.savePersonEdit({ data: { tree: TREE, id: person, details: { ...details(s), ...c.details }, fields: c.fields ?? inputs(s), revision: s.revision, opKey: opKey() } });
};
const rows = (where = '1', ...params: (string | number)[]) => d().all<{ id: number; kind: string; record: string; action: string; level: string; owner: string | null; fields: string | null; account: string | null; name: string; person: string | null; person_name: string | null; label: string | null; count: number }>(`SELECT * FROM history WHERE ${where} ORDER BY id`, ...params);
const historyAs = async (user: string, o: { person?: string } = {}) => { as(user); return (await hf.getHistory({ data: { tree: TREE, ...o } })).items; };
/** Saves made more than MERGE_MS apart: the folding window is pushed back by ageing the rows already written. */
const age = () => d().run("UPDATE history SET at = '2020-01-01T00:00:00.000Z'");

before(async () => {
  await dbs.provisionFamily(TREE, 'The Quills');
  for (const [p, given] of [['ada', 'Ada'], ['ben', 'Ben'], ['cid', 'Cid']]) await d().run('INSERT INTO person (id, given, surname, living, born) VALUES (?, ?, ?, 1, ?)', p, given, 'Quill', '1950');
  for (const [u, role] of [[AUTHOR, 'editor'], [EDITOR, 'editor'], [STEWARD, 'steward'], [CONTRIBUTOR, 'contributor'], [VIEWER, 'viewer']] as const) {
    await store.accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', u, NAMES[u], `h-${u}`, Date.now());
    await store.accounts().run('INSERT INTO membership (user, tree, role, created) VALUES (?, ?, ?, ?)', u, TREE, role as Role, Date.now());
  }
});
after(async () => { await vite.close(); rmSync(dir, { recursive: true, force: true }); });

// ---------- the hook ----------

test('a records write that names no history is refused before anything is written, and so is one called NOT_A_RECORD', async () => {
  const add = (pid: string) => dbs.q('INSERT INTO person (id, given) VALUES (?, ?)', pid, 'Stray');
  await assert.rejects(dbs.once(TREE, undefined, 'forgot', () => ({ writes: [add('stray1')], result: 1 }) as never), /history\.missing:forgot/);
  await assert.rejects(dbs.once(TREE, undefined, 'mislabelled', () => ({ writes: [add('stray2')], history: dbs.NOT_A_RECORD, result: 1 })), /history\.not_a_record:mislabelled:person/);
  assert.equal(await d().get("SELECT id FROM person WHERE id IN ('stray1', 'stray2')"), undefined);
  // Not the family's records: fine without a row. Reads and guards alone are not writes.
  assert.deepEqual(h.tablesWritten([dbs.q('SELECT key FROM photo'), dbs.guard('1 = 1'), dbs.q('INSERT OR IGNORE INTO parent (child, parent) VALUES (?, ?)', 'a', 'b'), dbs.q('UPDATE  research_note SET x = 1')]), ['parent', 'research_note']);
  h.checkHistory('game', [dbs.q('UPDATE campaign SET enabled = 1')], dbs.NOT_A_RECORD);
});

test('every change carries its row in the same batch, with who made it and the name they had then', async () => {
  as(EDITOR);
  const before = (await rows()).length;
  await save('ada', () => ({ details: { born: '1951', nickname: 'Addy' } }));
  const [row] = (await rows()).slice(before);
  assert.equal(row!.kind, 'person');
  assert.equal(row!.action, 'changed');
  assert.equal(row!.account, EDITOR);
  assert.equal(row!.name, 'Tobit Fenn');
  assert.equal(row!.person_name, 'Ada Quill');
  assert.deepEqual(JSON.parse(row!.fields!).f, { born: ['1950', '1951'], nickname: [null, 'Addy'] });
  // A batch the database refuses writes no row either.
  const count = (await rows()).length;
  await assert.rejects(dbs.once(TREE, undefined, 'refused', () => ({ writes: [dbs.guard('1 = 0'), dbs.q("UPDATE person SET given = 'X' WHERE id = 'ada'")], history: [dbs.added('person', 'ada')], result: 1 })));
  assert.equal((await rows()).length, count);
});

// ---------- who reads what ----------

test('a Personal field’s change is its author’s alone and carries no content', async () => {
  await age();
  as(AUTHOR);
  await save('ben', (s) => ({ fields: [...inputs(s), { type: 'notes', label: 'Gift idea', value: { text: SECRET }, visibility: 'personal' }] }));
  await age();
  await save('ben', (s) => ({ fields: inputs(s).map((f) => (f.type === 'notes' ? { ...f, value: { text: `${SECRET} again` } } : f)) }));
  const personal = await rows("kind = 'field' AND level = 'personal'");
  assert.equal(personal.length, 2);
  for (const r of personal) {
    assert.equal(r.owner, AUTHOR);
    assert.equal(r.fields, null, 'no content is kept');
  }
  assert.equal(JSON.stringify(await rows()).includes(SECRET), false, 'the value is nowhere in the history');
  const mine = await historyAs(AUTHOR, { person: 'ben' });
  assert.equal(mine.filter((i) => i.kind === 'field').length, 2);
  for (const user of [EDITOR, STEWARD, CONTRIBUTOR, VIEWER]) {
    const seen = await historyAs(user, { person: 'ben' });
    assert.equal(seen.filter((i) => i.kind === 'field').length, 0, `${NAMES[user]} sees nothing of it`);
    as(user);
    assert.equal(JSON.stringify(await hf.getWhatsNew({ data: { tree: TREE } })).includes('field'), false);
  }
});

test('a field made Personal is, for everyone else, removed without its content', async () => {
  await age();
  as(AUTHOR);
  await save('ben', (s) => ({ fields: [...inputs(s), { type: 'favourites', label: '', value: { text: 'tea' }, visibility: 'family' }] }));
  await age();
  await save('ben', (s) => ({ fields: inputs(s).map((f) => (f.type === 'favourites' ? { ...f, visibility: 'personal' as const } : f)) }));
  const [last] = (await rows("kind = 'field' AND person = 'ben'")).slice(-1);
  assert.equal(last!.action, 'removed');
  assert.equal(last!.level, 'family');
  assert.equal(last!.fields, null);
});

test('Editors-level content reaches editors and stewards only; contributors and viewers do not learn the field exists', async () => {
  await age();
  as(EDITOR);
  await save('cid', (s) => ({ fields: [...inputs(s), { type: 'medical', label: '', value: { note: 'first' }, visibility: 'editors' }] }));
  await age();
  await save('cid', (s) => ({ fields: inputs(s).map((f) => (f.type === 'medical' ? { ...f, value: { note: HIDDEN } } : f)) }));
  for (const user of [AUTHOR, STEWARD]) {
    const items = (await historyAs(user, { person: 'cid' })).filter((i) => i.kind === 'field');
    assert.equal(items.length, 2);
    assert.equal(JSON.stringify(items).includes(HIDDEN), true, `${NAMES[user]} reads the value`);
  }
  for (const user of [CONTRIBUTOR, VIEWER]) {
    const items = await historyAs(user, { person: 'cid' });
    assert.equal(items.filter((i) => i.kind === 'field').length, 0);
    assert.equal(JSON.stringify(items).includes(HIDDEN), false);
    as(user);
    assert.equal(await hf.getNewsCount({ data: { tree: TREE } }) >= 0, true);
  }
  // Viewers and contributors still see who changed what they may see.
  const viewer = await historyAs(VIEWER, { person: 'ada' });
  assert.equal(viewer[0]?.author, 'Tobit Fenn');
});

test('a source’s link to a research document is for editors only; the rest of its change is for everyone', async () => {
  as(EDITOR);
  const project = await research.saveProject(TREE, { id: EDITOR, name: 'Tobit Fenn', role: 'editor' }, { title: 'Hidden letters', summary: '', private: true }, undefined);
  const doc = await research.addDocument(TREE, { id: EDITOR, name: 'Tobit Fenn', role: 'editor' }, project.id, new TextEncoder().encode('%PDF-1.4'), 'application/pdf', { width: 0, height: 0 }, { title: 'Letter', date: null, source: null, notes: '', private: true }, undefined);
  const who = { id: EDITOR, name: 'Tobit Fenn', role: 'editor' as Role };
  const src = await sources.saveSource(TREE, who, { title: 'Parish book', author: null, publication: null, reference: null, date: null, note: '', document: null, media: null }, undefined);
  await sources.saveSource(TREE, who, { id: src.id, title: 'Parish book', author: null, publication: null, reference: null, date: null, note: '', document: doc.id, media: null }, undefined);
  const change = (items: Awaited<ReturnType<typeof historyAs>>) => items.find((i) => i.kind === 'source' && i.action === 'changed');
  const forViewer = change(await historyAs(VIEWER))!;
  assert.deepEqual(forViewer.fields, [{ name: 'document', before: null, after: null, hidden: true }]);
  assert.equal(change(await historyAs(STEWARD))!.fields[0]!.after, doc.id);
  // The private research itself is not in a viewer's history at all.
  assert.equal((await historyAs(VIEWER)).some((i) => i.kind === 'research'), false);
  assert.equal((await historyAs(STEWARD)).filter((i) => i.kind === 'research').length, 2);
});

test('a guest gets no history: the page, What’s new and the dot all refuse', async () => {
  asGuest();
  await assert.rejects(hf.getHistory({ data: { tree: TREE } }));
  await assert.rejects(hf.getWhatsNew({ data: { tree: TREE } }));
  await assert.rejects(hf.getNewsCount({ data: { tree: TREE } }));
  await assert.rejects(hf.restoreHistoryValue({ data: { tree: TREE, id: 1, field: 'born' } }));
  assert.deepEqual(h.historyVisibleTo({ account: null, role: 'viewer', guest: true }), { sql: '0', params: [] });
});

// ---------- folding, imports, removal ----------

test('saves of one record by one person within ten minutes are one row, and a change undone leaves none', async () => {
  await age();
  as(EDITOR);
  const before = (await rows()).length;
  await save('ada', () => ({ details: { title: 'Dr' } }));
  await save('ada', () => ({ details: { title: 'Prof' } }));
  const now = await rows();
  assert.equal(now.length, before + 1);
  assert.deepEqual(JSON.parse(now.at(-1)!.fields!).f, { title: [null, 'Prof'] });
  await save('ada', () => ({ details: { title: null } }));
  assert.equal((await rows()).length, before, 'back where it started: no row');
  // Someone else's save is their own row.
  await save('ada', () => ({ details: { title: 'Dr' } }));
  as(AUTHOR);
  await save('ada', () => ({ details: { title: 'Prof' } }));
  assert.equal((await rows()).length, before + 2);
});

test('a bulk import logs one summary row, not one per person', async () => {
  const people = Array.from({ length: 300 }, (_, i) => `0 @I${i}@ INDI\n1 NAME Person${i} /Importer/\n1 SEX ${i % 2 ? 'M' : 'F'}\n1 BIRT\n2 DATE ${1800 + (i % 100)}`).join('\n');
  const text = `0 HEAD\n1 CHAR UTF-8\n1 GEDC\n2 VERS 5.5.1\n${people}\n0 TRLR\n`;
  // Called as the import's server function calls it, by the steward the request names (there is no request here).
  h.actingAs({ account: STEWARD, name: NAMES[STEWARD]! });
  const before = (await rows()).length;
  const result = await importer.applyImport(TREE, text, undefined, true).finally(() => h.actingAs(undefined));
  assert.equal(result.people, 300);
  const added = (await rows()).slice(before);
  assert.equal(added.length, 1);
  assert.equal(added[0]!.kind, 'import');
  assert.equal(added[0]!.count, 300);
  assert.equal(added[0]!.account, STEWARD);
});

test('removing a person keeps their history, and the removal names them', async () => {
  as(EDITOR);
  const pid = await api.addRelative({ data: { tree: TREE, anchor: 'ada', relation: 'child', person: { given: 'Wren', surname: 'Quill', living: true, born: '1990' } } });
  await api.removePerson({ data: { tree: TREE, id: pid } });
  const mine = await rows('person = ?', pid);
  assert.deepEqual(mine.map((r) => [r.kind, r.action, r.person_name]), [['person', 'added', 'Wren Quill'], ['person', 'removed', 'Wren Quill']]);
});

// ---------- restore ----------

test('an editor puts a value back from a row; it is a save of its own, and a viewer may not', async () => {
  await age();
  as(EDITOR);
  await save('ben', () => ({ details: { born: '1949' } }));
  const item = (await historyAs(EDITOR, { person: 'ben' })).find((i) => i.kind === 'person' && i.fields.some((f) => f.name === 'born'))!;
  assert.deepEqual(item.restorable, ['born']);
  assert.deepEqual((await historyAs(VIEWER, { person: 'ben' })).find((i) => i.id === item.id)!.restorable, []);
  as(VIEWER);
  await assert.rejects(hf.restoreHistoryValue({ data: { tree: TREE, id: item.id, field: 'born' } }));
  as(EDITOR);
  await hf.restoreHistoryValue({ data: { tree: TREE, id: item.id, field: 'born' } });
  assert.equal((await d().get<{ born: string }>("SELECT born FROM person WHERE id = 'ben'"))!.born, '1950');
  const [last] = (await rows("person = 'ben' AND kind = 'person'")).slice(-1);
  assert.deepEqual(JSON.parse(last!.fields!).f, { born: ['1949', '1950'] }, 'the restore is its own row, not folded into the change it undoes');
  await assert.rejects(hf.restoreHistoryValue({ data: { tree: TREE, id: item.id, field: 'given' } }), /history\.err\.cannot_restore/);
});

// ---------- since your last visit ----------

test('the visit marker never skips news: it stays during a visit and moves only up to what was shown', async () => {
  const user = VIEWER;
  const t0 = Date.UTC(2026, 10, 1, 9);
  await store.accounts().run('DELETE FROM family_visit WHERE user = ?', user);
  await h.noteVisit(user, TREE, t0);
  const first = (await h.visitOf(user, TREE))!;
  assert.equal(first.since, t0 - h.FIRST_LOOK);
  // Opening twice in a minute, or again within the visit: the same news.
  await h.noteVisit(user, TREE, t0 + 30_000);
  await h.noteVisit(user, TREE, t0 + 3_600_000);
  assert.equal((await h.visitOf(user, TREE))!.since, first.since);
  // A new visit without ever being shown the news keeps all of it.
  await h.noteVisit(user, TREE, t0 + 10 * 3_600_000);
  assert.equal((await h.visitOf(user, TREE))!.since, first.since);
  // Shown at some point: the next visit starts there, not at the end of the visit.
  await h.markShown(user, TREE, t0 + 10 * 3_600_000 + 60_000);
  await h.noteVisit(user, TREE, t0 + 11 * 3_600_000);
  assert.equal((await h.visitOf(user, TREE))!.since, first.since, 'still the same visit');
  await h.noteVisit(user, TREE, t0 + 20 * 3_600_000);
  assert.equal((await h.visitOf(user, TREE))!.since, t0 + 10 * 3_600_000 + 60_000);
});

test('What’s new groups others’ changes by person, leaves out the reader’s own, and reads comments only where they exist', async () => {
  as(EDITOR);
  await save('ada', () => ({ details: { epithet: 'the Bold' } }));
  await dbs.upsertPlaces(TREE, [{ name: 'Lindenfeld', lat: 50, lng: 8 }]);
  as(CONTRIBUTOR);
  await store.accounts().run('DELETE FROM family_visit WHERE user = ?', CONTRIBUTOR);
  const storyId = await api.addStory({ data: { tree: TREE, person: 'cid', kind: 'memory', body: 'The summer of the long rain.', title: 'Rain' } });
  const news = await hf.getWhatsNew({ data: { tree: TREE } });
  assert.equal(news.first, true);
  assert.equal(news.groups.some((g) => g.lines.some((l) => l.author === 'Odo Brisk')), false, 'not their own change');
  const ada = news.groups.find((g) => g.person === 'ada')!;
  assert.equal(ada.name, 'Ada Quill');
  assert.ok(ada.lines.length > 0);
  assert.equal(news.groups.at(-1)!.person, null, 'the family as a whole comes last');
  assert.deepEqual(news.replies, [], 'no comment table, no comments');
  // Once the comments feature's tables exist, comments and reactions on what the reader wrote are news to them.
  await d().run('CREATE TABLE comment (id TEXT PRIMARY KEY, target_kind TEXT, target TEXT, account TEXT, author_name TEXT, body TEXT, created_at TEXT, edited_at TEXT)');
  await d().run('CREATE TABLE reaction (target_kind TEXT, target TEXT, account TEXT, kind TEXT, created_at INTEGER)');
  await d().run("INSERT INTO comment VALUES ('c1', 'story', ?, ?, 'Vera Lumen', 'Lovely', ?, NULL)", storyId, VIEWER, new Date().toISOString());
  await d().run("INSERT INTO comment VALUES ('c2', 'story', ?, ?, 'Odo Brisk', 'Thanks', ?, NULL)", storyId, CONTRIBUTOR, new Date().toISOString());
  await d().run("INSERT INTO reaction VALUES ('story', ?, ?, 'heart', ?)", storyId, EDITOR, Date.now());
  const replies = await h.repliesTo(d(), CONTRIBUTOR, Date.now() - 60_000);
  assert.deepEqual(replies.map((r) => [r.kind, r.count, r.label, r.author]), [['comment', 1, 'Rain', 'Vera Lumen'], ['reaction', 1, 'Rain', '']]);
  assert.deepEqual(await h.repliesTo(d(), VIEWER, Date.now() - 60_000), [], 'not on what they wrote');
  await d().run('DROP TABLE comment');
  await d().run('DROP TABLE reaction');
});

test('the weekly push says what the week brought, and nothing when it brought nothing', () => {
  const quiet = push.weeklyMessage(TREE, 'The Quills', 'en', { since: '', first: false, groups: [], replies: [], total: 0 });
  assert.equal(quiet, null);
  const m = push.weeklyMessage(TREE, 'The Quills', 'de', {
    since: '', first: false, total: 4, replies: [],
    groups: [{ person: 'ada', name: 'Ada Quill', lines: [{ author: 'Mara Quill', kind: 'photo', action: 'added', count: 3, label: null }] }],
  })!;
  assert.equal(m.title, 'Diese Woche bei The Quills');
  assert.equal(m.body, 'Ada Quill: Mara Quill hat 3 Fotos hinzugefügt');
  assert.equal(m.url, `/${TREE}/history`);
});

test('pruning keeps the last three years by default', async () => {
  await d().run("INSERT INTO history (at, kind, record, action, fn) VALUES ('2019-01-01T00:00:00.000Z', 'place', 'Old', 'added', 'test')");
  assert.equal(h.keepYears(() => undefined), 3);
  assert.equal(h.keepYears((n) => (n === 'KINDRED_HISTORY_YEARS' ? '0' : undefined)), 0);
  const gone = await h.pruneHistory(d(), 3, Date.UTC(2026, 10, 10));
  assert.ok(gone >= 1);
  assert.equal((await rows("record = 'Old'")).length, 0);
  assert.equal(await h.pruneHistory(d(), 0), 0, '0 keeps everything');
});
