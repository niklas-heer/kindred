// node --test src/lib/auth/person-link.test.ts — a member who says "this is me" may paint through that link only once a
// steward has confirmed it. These call the real server functions, the real guard and the real picture route against scratch
// databases; only the framework around them is replaced (who is signed in, and createServerFn, which needs a compile step).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-person-link-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'person-link-test-secret';

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
    if (id === STUB_START) return `export const createServerFn = () => { const b = { validator: () => b, handler: (fn) => (o) => fn(o ?? {}) }; return b; };`;
    if (id === STUB_START_SERVER) return `export const getRequest = () => new Request('http://localhost/'); export const setResponseStatus = () => {}; export const appendResponseHeader = () => {};`;
    if (id === STUB_SESSION) return `export const getSession = async () => ({ user: globalThis.__signedIn ?? null, via: 'passkey' });`;
    return undefined;
  },
};
const vite = await createServer({
  configFile: false,
  root: process.cwd(),
  logLevel: 'error',
  plugins: [framework],
  resolve: { alias: { '~': resolve('src') } },
  ssr: { noExternal: [/^@tanstack\/react-start/] },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
});
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;

const store = await load<typeof import('./store.server.ts')>('/src/lib/auth/store.server.ts');
const dbs = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const { linksWaiting } = await load<typeof import('./links.server.ts')>('/src/lib/auth/links.server.ts');
const auth = await load<typeof import('./functions.ts')>('/src/lib/auth/functions.ts');
const portrait = await load<typeof import('../portrait.functions.ts')>('/src/lib/portrait.functions.ts');
const { Route } = await load<typeof import('../../routes/api/paint.$tree.$key.ts')>('/src/routes/api/paint.$tree.$key.ts');
const { attention, attentionParts } = await load<typeof import('../ai/background.server.ts')>('/src/lib/ai/background.server.ts');

const TREE = 'links';
const USERS = {
  steward: '00000000-0000-4000-8000-000000000001',
  editor: '00000000-0000-4000-8000-000000000002',
  viewer: '00000000-0000-4000-8000-000000000003',
  contributor: '00000000-0000-4000-8000-000000000004',
} as const;
type Who = keyof typeof USERS;
const PAINTING = 'portrait/00000000-0000-4000-8000-00000000abcd.png';

const signIn = (who: Who) => { (globalThis as { __signedIn?: unknown }).__signedIn = { id: USERS[who], name: who }; };
const row = async (who: Who) => (await store.membership(USERS[who], TREE))!;
const link = (who: Who, person: string | null) => { signIn(who); return auth.setMyPerson({ data: { tree: TREE, person } }); };
const answer = (who: Who, confirm: boolean, person = 'ada') => { signIn('steward'); return auth.answerPersonLink({ data: { tree: TREE, user: USERS[who], person, confirm } }); };
const picture = (who: Who) => {
  signIn(who);
  // The route's own handler, as the server calls it.
  const { GET } = (Route.options as unknown as { server: { handlers: { GET: (c: { params: { tree: string; key: string } }) => Promise<Response> } } }).server.handlers;
  return GET({ params: { tree: TREE, key: PAINTING.replace('portrait/', '') } });
};

/** Every portrait function that goes through the link, each with what it needs. */
const PATHS: [string, () => Promise<unknown>][] = [
  ['getProfilePhotoKey', () => portrait.getProfilePhotoKey({ data: { tree: TREE, personId: 'ada' } })],
  ['getPortraitVersions', () => portrait.getPortraitVersions({ data: { tree: TREE, personId: 'ada' } })],
  ['aiCreatePortrait', () => portrait.aiCreatePortrait({ data: { tree: TREE, personId: 'ada', mediaKey: 'gallery/none.png' } })],
  ['acceptPortrait', () => portrait.acceptPortrait({ data: { tree: TREE, personId: 'ada', key: PAINTING } })],
  ['keepPortrait', () => portrait.keepPortrait({ data: { tree: TREE, personId: 'ada', key: PAINTING } })],
  ['discardPortrait', () => portrait.discardPortrait({ data: { tree: TREE, personId: 'ada', key: PAINTING } })],
  ['removePortrait', () => portrait.removePortrait({ data: { tree: TREE, personId: 'ada' } })],
];

before(async () => {
  await dbs.provisionFamily(TREE, 'Link Test');
  const d = dbs.db(TREE);
  await d.run("INSERT INTO person (id, given, living, born) VALUES ('ada', 'Ada', 0, '1950')");
  await d.run("INSERT INTO person (id, given, living, born) VALUES ('ben', 'Ben', 0, '1960')");
  await d.run("INSERT INTO portrait (key, person, mime, source, model, created_by, created_at) VALUES (?, 'ada', 'image/png', 'gallery/a.png', 'm', 'u', '2026-01-01')", PAINTING);
  await dbs.media.put(TREE, PAINTING, new Uint8Array([137, 80, 78, 71]), 'image/png');
  for (const [role, id] of Object.entries(USERS)) {
    await store.accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', id, role, `handle-${role}`, Date.now());
    await store.accounts().run('INSERT INTO membership (user, tree, role, created) VALUES (?, ?, ?, ?)', id, TREE, role, Date.now());
  }
});
after(async () => {
  delete (globalThis as { __signedIn?: unknown }).__signedIn;
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

test('linking works at once and waits for a steward; an unconfirmed member is refused on every path, the route included', async () => {
  await link('viewer', 'ada');
  const m = await row('viewer');
  assert.equal(m.person, 'ada', 'the link itself is saved straight away');
  assert.equal(m.person_confirmed, 0);
  assert.deepEqual(await linksWaiting(TREE), [{ user: USERS.viewer, name: 'viewer', person: 'ada' }]);
  assert.equal(await attention(TREE), 1, 'it counts among what waits for a steward');
  assert.deepEqual(await attentionParts(TREE), { access: 1, ai: 0 }, 'and it is answered on the Access page, not in AI activity');
  signIn('viewer');
  for (const [name, call] of PATHS) {
    await assert.rejects(call, (e: Error & { code?: string; status?: number }) => {
      assert.equal(e.code, 'forbidden', name);
      assert.equal(e.status, 403, name);
      assert.equal(e.message, 'paint.err_link_unconfirmed', `${name} says a steward needs to confirm`);
      return true;
    });
  }
  assert.equal((await picture('viewer')).status, 403);
});

test('only a steward confirms', async () => {
  for (const who of ['viewer', 'contributor', 'editor'] as const) {
    signIn(who);
    await assert.rejects(auth.answerPersonLink({ data: { tree: TREE, user: USERS.viewer, person: 'ada', confirm: true } }), (e: Error & { code?: string }) => e.code === 'forbidden', who);
  }
  assert.equal((await row('viewer')).person_confirmed, 0);
});

test('a confirmed member may use every read, and the route; refusals past the rule are about the data', async () => {
  await answer('viewer', true);
  assert.equal((await row('viewer')).person_confirmed, 1);
  assert.deepEqual(await linksWaiting(TREE), []);
  signIn('viewer');
  assert.deepEqual(await portrait.getPortraitVersions({ data: { tree: TREE, personId: 'ada' } }), []);
  assert.equal((await picture('viewer')).status, 200);
  for (const [name, call] of PATHS) {
    signIn('viewer');
    await call().catch((e: Error & { code?: string; message: string }) => {
      assert.notEqual(e.code, 'forbidden', `${name} let the confirmed member through`);
      assert.notEqual(e.message, 'paint.err_link_unconfirmed', name);
    });
  }
  // removePortrait and discardPortrait above may have taken the row and the picture with them; the rest of the file needs them.
  await dbs.db(TREE).run("INSERT OR IGNORE INTO portrait (key, person, mime, source, model, created_by, created_at) VALUES (?, 'ada', 'image/png', 'gallery/a.png', 'm', 'u', '2026-01-01')", PAINTING);
  await dbs.media.put(TREE, PAINTING, new Uint8Array([137, 80, 78, 71]), 'image/png');
});

test('saying the same again keeps the confirmation; changing the link clears it, also on the way back', async () => {
  await link('viewer', 'ada');
  assert.equal((await row('viewer')).person_confirmed, 1, 'the same answer');
  await link('viewer', 'ben');
  assert.equal((await row('viewer')).person_confirmed, 0, 'another person');
  await link('viewer', 'ada');
  assert.equal((await row('viewer')).person_confirmed, 0, 'back again still needs a steward');
  assert.equal((await picture('viewer')).status, 403);
  await answer('viewer', true);
  await link('viewer', '-');
  assert.equal((await row('viewer')).person_confirmed, 0, 'just browsing');
  assert.deepEqual(await linksWaiting(TREE), [], 'browsing is not a claim');
});

test('a steward answers only what the member said when they looked', async () => {
  await link('contributor', 'ada');
  await link('contributor', 'ben');
  for (const confirm of [true, false]) {
    await assert.rejects(answer('contributor', confirm, 'ada'), (e: Error & { code?: string }) => e.code === 'invalid');
  }
  const m = await row('contributor');
  assert.equal(m.person, 'ben');
  assert.equal(m.person_confirmed, 0, 'a stale confirmation does not land on the new person');
});

test('declining unlinks them', async () => {
  await answer('contributor', false, 'ben');
  const m = await row('contributor');
  assert.equal(m.person, null);
  assert.equal(m.person_confirmed, 0);
  assert.deepEqual(await linksWaiting(TREE), []);
});

test('editors and stewards are confirmed by linking and can paint anyway; they never wait', async () => {
  await link('editor', 'ben');
  assert.equal((await row('editor')).person_confirmed, 1);
  await link('steward', 'ben');
  assert.equal((await row('steward')).person_confirmed, 1);
  assert.deepEqual(await linksWaiting(TREE), []);
  assert.equal((await picture('editor')).status, 200, 'not linked to Ada at all, and may still see her painting');
  signIn('editor');
  assert.deepEqual(await portrait.getPortraitVersions({ data: { tree: TREE, personId: 'ada' } }), []);
});

test('an editor made a viewer loses the confirmation they had for being one', async () => {
  await link('editor', 'ada');
  await store.accounts().batch([store.changeRole(USERS.editor, TREE, 'viewer')]);
  assert.equal((await row('editor')).person_confirmed, 0);
  assert.equal((await picture('editor')).status, 403);
  assert.deepEqual((await linksWaiting(TREE)).map((l) => l.user), [USERS.editor]);
  await answer('editor', true);
  await store.accounts().batch([store.changeRole(USERS.editor, TREE, 'contributor')]);
  assert.equal((await row('editor')).person_confirmed, 1, 'a change between the lower roles keeps a steward’s confirmation');
});

test('a person who has left the tree is not left waiting', async () => {
  await dbs.db(TREE).run("INSERT INTO person (id, given, living, born) VALUES ('gone', 'Gone', 0, '1970')");
  await link('contributor', 'gone');
  assert.equal((await linksWaiting(TREE)).length, 1);
  await dbs.db(TREE).run("DELETE FROM person WHERE id = 'gone'");
  assert.deepEqual(await linksWaiting(TREE), []);
});

test('the migration confirms editors’ and stewards’ links and leaves the rest waiting', () => {
  const d = new DatabaseSync(':memory:');
  d.exec("CREATE TABLE membership (user TEXT, tree TEXT, role TEXT, person TEXT, created INTEGER)");
  const add = d.prepare("INSERT INTO membership VALUES (?, 't', ?, ?, 1)");
  const rows = [['a', 'steward', 'ada'], ['b', 'editor', 'ben'], ['c', 'viewer', 'cid'], ['d', 'contributor', 'dee'], ['e', 'editor', '-'], ['f', 'steward', null]] as const;
  for (const [u, r, p] of rows) add.run(u, r, p);
  d.exec(readFileSync('migrations/accounts/0014_person_confirmed.sql', 'utf8'));
  const got = Object.fromEntries((d.prepare('SELECT user, person_confirmed AS c FROM membership').all() as { user: string; c: number }[]).map((r) => [r.user, r.c]));
  assert.deepEqual(got, { a: 1, b: 1, c: 0, d: 0, e: 0, f: 0 });
  d.close();
});
