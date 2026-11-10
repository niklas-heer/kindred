// node --test src/lib/portrait-look-save.test.ts — who may save a person's drawn portrait. An editor may save anyone's; a
// member who is that person may save their own once a steward has confirmed the link; nobody else may. These call the real
// server function and the real guard against scratch databases; only the framework around them is replaced (who is signed
// in, and createServerFn, which needs a compile step), as in auth/person-link.test.ts.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-look-save-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'look-save-test-secret';

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

const store = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const dbs = await load<typeof import('./db.server.ts')>('/src/lib/db.server.ts');
const auth = await load<typeof import('./auth/functions.ts')>('/src/lib/auth/functions.ts');
const people = await load<typeof import('./person.functions.ts')>('/src/lib/person.functions.ts');

const TREE = 'looks';
const USERS = {
  steward: '00000000-0000-4000-8000-000000000011',
  editor: '00000000-0000-4000-8000-000000000012',
  viewer: '00000000-0000-4000-8000-000000000013',
  contributor: '00000000-0000-4000-8000-000000000014',
} as const;
type Who = keyof typeof USERS;
const LOOK = { skin: 4, hair: 0, eyes: 0, hairStyle: 'locs', expression: 'smile', backdrop: 'sea' };

const signIn = (who: Who) => { (globalThis as { __signedIn?: unknown }).__signedIn = { id: USERS[who], name: who }; };
let n = 0;
const save = (who: Who, id: string, look: unknown = LOOK) => { signIn(who); return people.setLook({ data: { tree: TREE, id, look, opKey: `look-save-${++n}-key` } }); };
const stored = async (id: string) => JSON.parse((await dbs.db(TREE).get<{ look: string | null }>('SELECT look FROM person WHERE id = ?', id))?.look ?? 'null');
const refused = (message?: string) => (e: Error & { code?: string; status?: number }) => {
  assert.equal(e.code, 'forbidden');
  assert.equal(e.status, 403);
  if (message) assert.equal(e.message, message);
  return true;
};

before(async () => {
  await dbs.provisionFamily(TREE, 'Look Test');
  const d = dbs.db(TREE);
  await d.run("INSERT INTO person (id, given, living, born) VALUES ('ada', 'Ada', 1, '1950')");
  await d.run("INSERT INTO person (id, given, living, born) VALUES ('ben', 'Ben', 1, '1960')");
  for (const [role, id] of Object.entries(USERS)) {
    await store.accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', id, role, `look-${role}`, Date.now());
    await store.accounts().run('INSERT INTO membership (user, tree, role, created) VALUES (?, ?, ?, ?)', id, TREE, role, Date.now());
  }
});
after(async () => {
  delete (globalThis as { __signedIn?: unknown }).__signedIn;
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

test('an editor saves anyone\'s look, as one entry in the family\'s history', async () => {
  await save('editor', 'ada');
  assert.deepEqual(await stored('ada'), LOOK);
  const rows = await dbs.db(TREE).all<{ kind: string; by_name: string | null }>("SELECT * FROM history WHERE person = 'ada'");
  assert.equal(rows.length, 1, 'one change, one entry');
});

test('a viewer and a contributor who are nobody in the tree are refused, and nothing is written', async () => {
  for (const who of ['viewer', 'contributor'] as const) await assert.rejects(save(who, 'ben'), refused());
  assert.equal(await stored('ben'), null);
});

test('a member who says "this is me" waits for a steward: until then their own look is refused, in words that say why', async () => {
  signIn('viewer');
  await auth.setMyPerson({ data: { tree: TREE, person: 'ben' } });
  await assert.rejects(save('viewer', 'ben'), refused('paint.err_link_unconfirmed'));
  assert.equal(await stored('ben'), null);
});

test('once confirmed they save their own look, and still nobody else\'s', async () => {
  signIn('steward');
  await auth.answerPersonLink({ data: { tree: TREE, user: USERS.viewer, person: 'ben', confirm: true } });
  await save('viewer', 'ben');
  assert.deepEqual(await stored('ben'), LOOK);
  await assert.rejects(save('viewer', 'ada', { ...LOOK, backdrop: 'night' }), refused());
  assert.deepEqual(await stored('ada'), LOOK, 'Ada is as the editor left her');
});

test('what is saved is the cleaned look: parts the portrait does not know are dropped, and a look with nothing in it is refused', async () => {
  await save('editor', 'ada', { ...LOOK, hairStyle: 'mohawk-of-doom', extras: ['pipe', 'jetpack'], grey: 9, script: '<svg onload=alert(1)>' });
  assert.deepEqual(await stored('ada'), { skin: 4, hair: 0, eyes: 0, expression: 'smile', backdrop: 'sea', extras: ['pipe'] });
  await assert.rejects(save('editor', 'ada', 'not a look'), /no parts a portrait can show/);
});

test('the same save sent twice is one change', async () => {
  signIn('editor');
  const data = { tree: TREE, id: 'ada', look: { ...LOOK, backdrop: 'books' }, opKey: 'look-save-retry-key' };
  await people.setLook({ data });
  await people.setLook({ data });
  const rows = await dbs.db(TREE).all("SELECT * FROM history WHERE person = 'ada'");
  assert.equal(rows.length, 3, 'the editor\'s first save, the cleaned one, and this one once');
});
