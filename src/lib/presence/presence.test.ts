// node --test src/lib/presence/presence.test.ts — live presence (presence.server.ts): members only, guests and strangers
// refused; one entry per member however many tabs; rows expire and are swept; focus only a person of the family, only on the
// tree or a profile, and only between members who both share it; nothing written or shown in a demo or a "View as" preview;
// "Last here" from the visits. The real server functions run against scratch databases; only "who is asking" and
// createServerFn are replaced, as in src/lib/history.test.ts.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-presence-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'presence-test-secret';
delete process.env.KINDRED_DEMO;

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

const store = await load<typeof import('../auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const dbs = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const fns = await load<typeof import('./presence.functions.ts')>('/src/lib/presence/presence.functions.ts');
const server = await load<typeof import('./presence.server.ts')>('/src/lib/presence/presence.server.ts');
const { EXPIRY_MS } = await load<typeof import('./shared.ts')>('/src/lib/presence/shared.ts');

const TREE = 'gathering', OTHER = 'elsewhere-fam';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ANNA = id(1), BRAM = id(2), CORA = id(3), STRANGER = id(4);
const NAMES: Record<string, string> = { [ANNA]: 'Anna Veld', [BRAM]: 'Bram Veld', [CORA]: 'Cora Veld', [STRANGER]: 'Sten Away' };

const g = globalThis as unknown as { __signedIn?: { id: string; name: string } | null; __guest?: unknown; __request?: Request; __kindredRequestRefusal?: () => unknown };
const as = (user: string) => { g.__signedIn = { id: user, name: NAMES[user]! }; g.__guest = undefined; g.__request = new Request('http://localhost/'); };
const asGuest = () => { g.__signedIn = null; g.__guest = { link: 'l', tree: TREE, expires: Date.now() + 3_600_000, protectLiving: false }; g.__request = new Request('http://localhost/'); };
const tab = (n: number) => `tab-${String(n).padStart(8, '0')}`;
const beat = (who: string, o: Partial<{ tab: string; route: 'tree' | 'person' | 'gallery' | 'elsewhere'; focus: string | null; editing: boolean; shadows: boolean }> = {}) => {
  as(who);
  return fns.presenceBeat({ data: { tree: TREE, tab: o.tab ?? tab(1), route: o.route ?? 'tree', focus: o.focus ?? null, editing: o.editing ?? false, shadows: o.shadows ?? true } });
};
const rosterOf = (who: string) => { as(who); return fns.presenceRoster({ data: { tree: TREE } }); };
const rows = () => store.accounts().all<{ account: string; tab: string; focus: string | null }>('SELECT account, tab, focus FROM presence ORDER BY account, tab');
const clear = () => store.accounts().run('DELETE FROM presence');

before(async () => {
  await dbs.provisionFamily(TREE, 'The Velds');
  await dbs.provisionFamily(OTHER, 'The Aways');
  for (const p of ['carl', 'dina']) await dbs.db(TREE).run('INSERT INTO person (id, given, surname, living) VALUES (?, ?, ?, 1)', p, p, 'Veld');
  await dbs.db(OTHER).run('INSERT INTO person (id, given, surname, living) VALUES (?, ?, ?, 1)', 'otto', 'Otto', 'Away');
  for (const u of [ANNA, BRAM, CORA, STRANGER]) await store.accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', u, NAMES[u]!, `h-${u}`, Date.now());
  for (const [u, role, person] of [[ANNA, 'editor', 'carl'], [BRAM, 'viewer', null], [CORA, 'steward', '-']] as const) {
    await store.accounts().run('INSERT INTO membership (user, tree, role, person, created) VALUES (?, ?, ?, ?, ?)', u, TREE, role, person, Date.now());
  }
  await store.accounts().run('INSERT INTO membership (user, tree, role, created) VALUES (?, ?, ?, ?)', STRANGER, OTHER, 'steward', Date.now());
});
after(async () => { await vite.close(); rmSync(dir, { recursive: true, force: true }); });

test('a member sees the others here now, on their page, with their face, but never themselves', async () => {
  await clear();
  await beat(ANNA, { route: 'tree', focus: 'dina' });
  const r = await beat(BRAM, { route: 'gallery' });
  assert.equal(r.on, true);
  assert.deepEqual(r.here.map((p) => [p.name, p.route, p.focus, p.person]), [['Anna Veld', 'tree', 'dina', 'carl']]);
  const a = await rosterOf(ANNA);
  assert.deepEqual(a.here.map((p) => [p.name, p.route, p.person]), [['Bram Veld', 'gallery', null]]);
  assert.equal(a.last, null);
});

test('a guest and a stranger neither send nor receive', async () => {
  await clear();
  await beat(ANNA);
  asGuest();
  await assert.rejects(fns.presenceRoster({ data: { tree: TREE } }));
  await assert.rejects(fns.presenceBeat({ data: { tree: TREE, tab: tab(9), route: 'tree', focus: null, editing: false, shadows: true } }));
  await assert.rejects(fns.presenceLeave({ data: { tree: TREE, tab: tab(1) } }));
  as(STRANGER);
  await assert.rejects(fns.presenceRoster({ data: { tree: TREE } }));
  await assert.rejects(fns.presenceBeat({ data: { tree: TREE, tab: tab(9), route: 'tree', focus: null, editing: false, shadows: true } }));
  assert.deepEqual((await rows()).map((r) => r.account), [ANNA]);
});

test('a member with several tabs is one face, and the most recent tab speaks for them', async () => {
  await clear();
  await server.beat(TREE, ANNA, { tab: tab(1), route: 'gallery', focus: null, editing: false, shadows: true }, Date.now() - 5_000);
  await server.beat(TREE, ANNA, { tab: tab(2), route: 'person', focus: 'carl', editing: false, shadows: true });
  const r = await rosterOf(BRAM);
  assert.equal(r.here.length, 1);
  assert.deepEqual([r.here[0]!.route, r.here[0]!.focus], ['person', 'carl']);
  assert.equal((await rows()).length, 2);
});

test('a row older than the expiry is ignored, a closed tab goes at once, and old rows are swept', async () => {
  await clear();
  await server.beat(TREE, ANNA, { tab: tab(1), route: 'tree', focus: null, editing: false, shadows: true }, Date.now() - EXPIRY_MS - 1_000);
  assert.equal((await rosterOf(BRAM)).here.length, 0);
  await server.beat(TREE, CORA, { tab: tab(3), route: 'tree', focus: null, editing: false, shadows: true }, Date.now() - 60 * 60_000);
  await beat(BRAM);
  assert.deepEqual((await rows()).map((r) => r.account), [ANNA, BRAM], 'the hour-old row is swept by the next beat');
  await beat(ANNA, { tab: tab(5) });
  assert.equal((await rosterOf(BRAM)).here.length, 1);
  as(ANNA);
  await fns.presenceLeave({ data: { tree: TREE, tab: tab(5) } });
  assert.equal((await rosterOf(BRAM)).here.length, 0);
});

test('a focus is a person of this family on the tree or a profile, and nothing else', async () => {
  await clear();
  await beat(ANNA, { focus: 'nobody-here' });
  assert.equal((await rows())[0]!.focus, null, 'an unknown id is dropped');
  await beat(ANNA, { focus: 'otto' });
  assert.equal((await rows())[0]!.focus, null, 'a person of another family is dropped');
  await beat(ANNA, { route: 'gallery', focus: 'carl' });
  assert.equal((await rows())[0]!.focus, null, 'no focus away from the tree and the profiles');
  await beat(ANNA, { route: 'person', focus: 'carl', editing: true });
  const [p] = (await rosterOf(BRAM)).here;
  assert.deepEqual([p!.focus, p!.editing], ['carl', true]);
});

test('shadows are reciprocal: who does not share, neither shows nor sees a focus', async () => {
  await clear();
  await beat(ANNA, { focus: 'carl', editing: true, shadows: false });
  assert.equal((await rows())[0]!.focus, null, 'not even stored');
  await beat(CORA, { tab: tab(3), focus: 'dina' });
  const b = await beat(BRAM, { shadows: true });
  assert.deepEqual(b.here.map((p) => [p.name, p.focus, p.editing]).sort(), [['Anna Veld', null, false], ['Cora Veld', 'dina', false]]);
  const a = await rosterOf(ANNA);
  assert.equal(a.sharing, false);
  assert.ok(a.here.length === 2 && a.here.every((p) => p.focus === null), 'Anna sees where they are, not whom they selected');
});

test('nothing is written or shown in a demo or a "View as" preview', async () => {
  await clear();
  await beat(ANNA);
  const saved = g.__kindredRequestRefusal;
  g.__kindredRequestRefusal = () => new Error('preview');
  try {
    const r = await beat(BRAM, { tab: tab(2) });
    assert.deepEqual(r, { on: false, here: [], sharing: false, last: null });
    assert.equal((await rosterOf(BRAM)).on, false);
  } finally { g.__kindredRequestRefusal = saved; }
  process.env.KINDRED_DEMO = '1';
  try {
    assert.equal((await server.beat(TREE, CORA, { tab: tab(3), route: 'tree', focus: null, editing: false, shadows: true })).on, false);
  } finally { delete process.env.KINDRED_DEMO; }
  assert.deepEqual((await rows()).map((r) => r.account), [ANNA]);
});

test('when nobody else is here, the last member who was', async () => {
  await clear();
  const at = Date.now() - 2 * 3_600_000;
  await store.accounts().run('INSERT INTO family_visit (user, tree, since, last_seen, visits) VALUES (?, ?, ?, ?, 1)', CORA, TREE, at, at);
  await store.accounts().run('INSERT INTO family_visit (user, tree, since, last_seen, visits) VALUES (?, ?, ?, ?, 1)', ANNA, TREE, at - 1000, at - 1000);
  await store.accounts().run('INSERT INTO family_visit (user, tree, since, last_seen, visits) VALUES (?, ?, ?, ?, 1)', BRAM, TREE, Date.now(), Date.now());
  const r = await beat(BRAM);
  assert.deepEqual(r.last, { name: 'Cora Veld', person: null, at });
  await beat(ANNA);
  assert.equal((await rosterOf(BRAM)).last, null, 'someone is here: no "last here"');
});

test('a page is sent as a fixed name, and Contacts, Access and the settings only as "elsewhere"', async () => {
  const { presenceRoute, presenceFocus } = await load<typeof import('./shared.ts')>('/src/lib/presence/shared.ts');
  const r = (path: string) => presenceRoute(path, TREE);
  assert.deepEqual([r('/gathering'), r('/gathering/today'), r('/gathering/person/carl'), r('/gathering/people'), r('/gathering/research/p1')], ['tree', 'today', 'person', 'register', 'research-project']);
  assert.deepEqual([r('/gathering/contacts'), r('/gathering/access'), r('/gathering/settings/ai'), r('/gathering/statistics'), r('/gathering/print')], ['elsewhere', 'elsewhere', 'elsewhere', 'elsewhere', 'elsewhere']);
  assert.equal(r('/other/today'), null);
  assert.equal(presenceFocus('/gathering', { sel: 'dina', focus: 'carl' }, TREE), 'dina');
  assert.equal(presenceFocus('/gathering', { focus: 'carl' }, TREE), 'carl');
  assert.equal(presenceFocus('/gathering/person/carl', {}, TREE), 'carl');
  assert.equal(presenceFocus('/gathering/gallery', { sel: 'dina' }, TREE), null);
});
