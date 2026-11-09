// node --test src/lib/stats-changes.test.ts — what the statistics call a change: a write that reached the database, once per burst of
// autosaves, and never a read, a refusal, a replay or a save with nothing in it. These call the real server functions against scratch
// databases; only "who is asking", the request and createServerFn are replaced, as in field-visibility.test.ts.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createServer, type Plugin } from 'vite';
import type { FieldInput } from '../components/fields/model.ts';

const dir = mkdtempSync(join(tmpdir(), 'kindred-stats-changes-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'stats-changes-secret';

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
    if (id === STUB_START_SERVER) return `
      export const getRequest = () => globalThis.__request;
      export const getRequestIP = () => '203.0.113.1';
      export const setResponseStatus = () => {};
      export const appendResponseHeader = () => {};
      export const getRequestHeader = () => undefined;`;
    if (id === STUB_SESSION) return `export const getSession = async () => ({ user: globalThis.__signedIn, via: 'passkey' });`;
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
const fns = await load<typeof import('./person.functions.ts')>('/src/lib/person.functions.ts');
const api = await load<typeof import('./api.ts')>('/src/lib/api.ts');
const suggest = await load<typeof import('./field-suggest.functions.ts')>('/src/lib/field-suggest.functions.ts');

const TREE = 'counts';
const EDITOR = { id: '00000000-0000-4000-8000-000000000001', name: 'Edda' };
const g = globalThis as unknown as { __signedIn: typeof EDITOR; __request: Request };
g.__signedIn = EDITOR;
/** Each server call is its own request, as in the app. */
const newRequest = () => { g.__request = new Request('http://localhost/'); };

let ops = 0;
const opKey = () => `testop-${++ops}-abcdefgh`;
const changes = async () => (await store.accounts().all<{ n: number }>("SELECT n FROM stats_daily WHERE tree = ? AND kind = 'change'", TREE)).reduce((sum, r) => sum + r.n, 0);
type Snap = Awaited<ReturnType<typeof fns.getEditSnapshot>>;
const details = (s: Snap) => ({ given: s.given, surname: s.surname, currentGiven: s.currentGiven, currentSurname: s.currentSurname, nickname: s.nickname, sex: s.sex, born: s.born, bornPlace: s.bornPlace, died: s.died, diedPlace: s.diedPlace, living: s.living, title: s.title, epithet: s.epithet, occupation: s.occupation, occupationCode: s.occupationCode, bio: s.bio });
const inputs = (s: Snap) => s.fields.map((f) => ({ id: f.id, type: f.type, label: f.label, value: f.value, visibility: f.visibility }));
const snapshot = () => { newRequest(); return fns.getEditSnapshot({ data: { tree: TREE, id: 'ada' } }); };
const save = (s: Snap, fields: FieldInput[] = inputs(s), d = details(s), key = opKey()) => { newRequest(); return fns.savePersonEdit({ data: { tree: TREE, id: 'ada', details: d, fields, revision: s.revision, opKey: key } }); };
const typed = (s: Snap, fid: string, text: string) => inputs(s).map((f) => (f.id === fid ? { ...f, value: { text } } : f));
const longAgo = () => new Date(Date.now() - 11 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

before(async () => {
  await dbs.provisionFamily(TREE, 'Counts');
  const d = dbs.db(TREE);
  await d.run("INSERT INTO person (id, given, living, born, updated_at) VALUES ('ada', 'Ada', 1, '1950', ?)", longAgo());
  for (const [ord, fid] of ['one', 'two'].entries()) await d.run("INSERT INTO person_field (id, person, type, label, value, ord, visibility, updated_by, updated_at) VALUES (?, 'ada', 'notes', '', '{\"text\":\"x\"}', ?, 'family', 'someone', ?)", fid, ord, longAgo());
  await d.run("INSERT INTO story (id, person, kind, body, author, at) VALUES ('tale', 'ada', 'memory', 'b', 'n', '2020-01-01')");
  await store.accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', EDITOR.id, EDITOR.name, 'h', Date.now());
  await store.accounts().run("INSERT INTO membership (user, tree, role, created) VALUES (?, ?, 'editor', ?)", EDITOR.id, TREE, Date.now());
});
after(async () => { await vite.close(); rmSync(dir, { recursive: true, force: true }); });

test('reading with an editor’s permission is not a change', async () => {
  const start = await changes();
  newRequest();
  await suggest.getFamilyWords({ data: { tree: TREE } });
  await snapshot();
  assert.equal(await changes(), start);
});

test('a refused save is not a change, and a save with nothing in it is not one either', async () => {
  const start = await changes();
  const s = await snapshot();
  await assert.rejects(save({ ...s, revision: s.revision + 5 }, typed(s, 'one', 'stale')));
  await assert.rejects(save(s, inputs(s).map((f) => (f.id === 'one' ? { ...f, visibility: 'personal' as const } : f))));
  await save(s);
  assert.equal(await changes(), start);
});

test('a burst of autosaves on one field is one change, and a retry of a save adds nothing', async () => {
  const start = await changes();
  let s = await snapshot();
  for (const text of ['h', 'he', 'hel', 'hello']) {
    await save(s, typed(s, 'one', text));
    s = await snapshot();
  }
  assert.equal(await changes(), start + 1);
  const key = opKey();
  const body = typed(s, 'one', 'hello!');
  await save(s, body, details(s), key);
  await save(s, body, details(s), key);
  assert.equal(await changes(), start + 1);
});

test('another field, the same field much later, and adding or removing a field are each a change of their own', async () => {
  let s = await snapshot();
  let was = await changes();
  await save(s, typed(s, 'two', 'other field'));
  assert.equal(await changes(), ++was, 'a different field');
  await dbs.db(TREE).run('UPDATE person_field SET updated_at = ? WHERE id = ?', longAgo(), 'one');
  s = await snapshot();
  await save(s, typed(s, 'one', 'back again'));
  assert.equal(await changes(), ++was, 'the same field after the burst has ended');
  s = await snapshot();
  const added = await save(s, [...inputs(s), { type: 'notes', label: '', value: { text: 'new' }, visibility: 'family' as const }]);
  assert.equal(await changes(), ++was, 'a new field');
  s = await snapshot();
  await save(s, inputs(s).filter((f) => f.id !== added.fieldIds.at(-1)));
  assert.equal(await changes(), ++was, 'a removed field');
});

test('a burst of autosaves on the person’s own details is one change', async () => {
  await dbs.db(TREE).run('UPDATE person SET updated_at = ? WHERE id = ?', longAgo(), 'ada');
  const start = await changes();
  let s = await snapshot();
  for (const nickname of ['A', 'Ad', 'Ady']) {
    await save(s, inputs(s), { ...details(s), nickname });
    s = await snapshot();
  }
  assert.equal(await changes(), start + 1);
});

test('a write outside a plan counts only when it changed a row', async () => {
  const start = await changes();
  newRequest();
  await api.deleteStory({ data: { tree: TREE, id: 'no-such-story' } });
  assert.equal(await changes(), start);
  newRequest();
  await api.deleteStory({ data: { tree: TREE, id: 'tale' } });
  assert.equal(await changes(), start + 1);
});

test('what is kept is the count: the member’s id appears nowhere in the statistics', async () => {
  const rows = await store.accounts().all<Record<string, unknown>>('SELECT * FROM stats_daily WHERE tree = ?', TREE);
  assert.ok(rows.some((r) => r.kind === 'change'));
  assert.equal(JSON.stringify(rows).includes(EDITOR.id), false);
  assert.equal(JSON.stringify(rows).includes(EDITOR.name), false);
});
