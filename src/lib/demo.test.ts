// node --test src/lib/demo.test.ts: demo mode (KINDRED_DEMO=1, src/lib/demo.ts). Only the environment turns it on, never a
// request; a setting that cannot go with it stops the server; in a demo the visitor is a viewer of every family with no account,
// and every write is refused where all writes pass (the store, `once`, the guard), while reading works. With the setting off,
// an install behaves exactly as before: sessions, writes and the AI are what they were. Invented names only.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-demo-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
for (const name of ['KINDRED_DEMO', 'KINDRED_AUTH', 'CF_ACCESS_AUD', 'CF_ACCESS_TEAM_DOMAIN', 'KINDRED_GUEST_ORIGIN', 'KINDRED_ORIGIN', 'KINDRED_SETUP_CODE', 'KINDRED_REQUIRE_SETUP_CODE', 'KINDRED_VAPID_PUBLIC_KEY', 'KINDRED_VAPID_PRIVATE_JWK', 'KINDRED_VAPID_SUBJECT', 'KINDRED_DEFAULT_TREE']) delete process.env[name];

const STUB_START = '\0stub-start';
const STUB_START_SERVER = '\0stub-start-server';
const framework: Plugin = {
  name: 'stub-framework',
  enforce: 'pre',
  resolveId(source) {
    if (source === '@tanstack/react-start') return STUB_START;
    if (source === '@tanstack/react-start/server') return STUB_START_SERVER;
    return undefined;
  },
  load(id) {
    if (id === STUB_START) return `export const createServerFn = () => { const b = { validator: () => b, handler: (fn) => { const f = (o) => fn(o ?? {}); f.isServerFn = true; return f; } }; return b; };`;
    if (id === STUB_START_SERVER) return `
      export const getRequest = () => globalThis.__request ?? (globalThis.__request = new Request('http://localhost/'));
      export const getRequestIP = () => '203.0.113.1';
      export const setResponseStatus = (s) => { globalThis.__status = s; };
      export const appendResponseHeader = (name, value) => { (globalThis.__setCookies ??= []).push(value); };
      export const getRequestHeader = () => undefined;`;
    return undefined;
  },
};
const vite = await createServer({
  configFile: false, root: process.cwd(), logLevel: 'error', plugins: [framework],
  resolve: { alias: { '~': resolve('src') } }, ssr: { noExternal: [/^@tanstack\/react-start/] },
  server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
});
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;

const demo = await load<typeof import('./demo.ts')>('/src/lib/demo.ts');
const dbs = await load<typeof import('./db.server.ts')>('/src/lib/db.server.ts');
const acc = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const session = await load<typeof import('./auth/session.server.ts')>('/src/lib/auth/session.server.ts');
const guard = await load<typeof import('./auth/guard.server.ts')>('/src/lib/auth/guard.server.ts');
const fns = await load<typeof import('./auth/functions.ts')>('/src/lib/auth/functions.ts');
const famFns = await load<typeof import('./families.functions.ts')>('/src/lib/families.functions.ts');
const ai = await load<typeof import('./ai/settings.server.ts')>('/src/lib/ai/settings.server.ts');
const jobs = await load<typeof import('./jobs/run.server.ts')>('/src/lib/jobs/run.server.ts');
const st = await load<typeof import('./store/index.ts')>('/src/lib/store/index.ts');
const { closeDatabases } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');

const g = globalThis as unknown as { __request?: Request; __setCookies?: string[]; __status?: number };
const T = Date.now();
const STEWARD = '00000000-0000-4000-8000-0000000000d1';
const READ_ONLY = 'This is a demo, so nothing can be changed or saved here.';
const on = () => { process.env.KINDRED_DEMO = '1'; };
const off = () => { delete process.env.KINDRED_DEMO; };
/** A fresh request, as the browser would send one; the guard reads its session once per request. */
const request = (init: { url?: string; headers?: Record<string, string> } = {}) => {
  g.__request = new Request(init.url ?? 'http://localhost/', { headers: init.headers });
  g.__setCookies = [];
  return g.__request;
};
const isReadOnly = (e: Error) => e.message === READ_ONLY && (e as { status?: number }).status === 403;

before(async () => {
  await dbs.provisionFamily('aurel', 'The Aurels');
  await dbs.provisionFamily('vesper', 'The Vespers');
  await dbs.db('aurel').run("INSERT INTO person (id, given) VALUES ('a1', 'Ada')");
  await acc.accounts().batch([
    acc.q('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', STEWARD, 'Steward', 'h-steward', T),
    acc.upsertMembership(STEWARD, 'aurel', 'steward'),
  ]);
});
afterEach(off);
after(async () => {
  off();
  await vite.close();
  closeDatabases();
  rmSync(dir, { recursive: true, force: true });
});

test('the setting: 1 is a demo, empty is not, anything else is refused, and so is a setting a demo cannot have', () => {
  assert.deepEqual(demo.demoSetting({}), { on: false });
  for (const v of ['', ' ', '0', 'false', 'off', 'no']) assert.deepEqual(demo.demoSetting({ KINDRED_DEMO: v }), { on: false }, v);
  for (const v of ['1', 'true', 'YES', 'on']) assert.deepEqual(demo.demoSetting({ KINDRED_DEMO: v }), { on: true }, v);
  for (const v of ['2', 'demo', 'enabled']) assert.match(demo.demoSetting({ KINDRED_DEMO: v }).problem ?? '', /KINDRED_DEMO must be 1/, v);
  assert.equal(demo.isDemo({ KINDRED_DEMO: 'maybe' }), false, 'a value it does not know never opens a demo');
  for (const name of demo.DEMO_CONFLICTS) {
    const value = name === 'KINDRED_AUTH' ? 'cloudflare-access' : name === 'KINDRED_REQUIRE_SETUP_CODE' ? 'yes' : 'something';
    const s = demo.demoSetting({ KINDRED_DEMO: '1', [name]: value });
    assert.equal(s.on, false, name);
    assert.match(s.problem ?? '', new RegExp(name), name);
  }
  // What does not clash: Kindred's own sign-in spelled out, a "no" for the setup-code flag, empty values (compose passes them).
  assert.deepEqual(demo.demoSetting({ KINDRED_DEMO: '1', KINDRED_AUTH: 'kindred', KINDRED_REQUIRE_SETUP_CODE: 'off', KINDRED_SETUP_CODE: '', CF_ACCESS_AUD: '' }), { on: true });
});

test('a bad demo setting replaces every page with a refusal (Workers) and stops the Node server at start', async () => {
  const page = demo.demoRefusal({ KINDRED_DEMO: '1', KINDRED_VAPID_PUBLIC_KEY: 'k' });
  assert.equal(page?.status, 503);
  assert.equal(page?.headers.get('cache-control'), 'no-store');
  assert.match(await page!.text(), /KINDRED_VAPID_PUBLIC_KEY/);
  assert.equal(demo.demoRefusal({}), undefined);
  assert.equal(demo.demoRefusal({ KINDRED_DEMO: '1' }), undefined);
  // server/node.ts asks the bundle (src/server.ts) and exits when there is a problem.
  const node = readFileSync('server/node.ts', 'utf8');
  assert.match(node, /startup\?\.problem[\s\S]*process\.exit\(1\)/);
  assert.match(readFileSync('src/server.ts', 'utf8'), /startup: \(\) => \(\{ problem: demoProblem\(\), demo: isDemo\(\) \}\)/);
  assert.match(readFileSync('src/start.ts', 'utf8'), /demoRefusal\(\) \?\? authRefusal\(request\)/);
});

test('only the environment turns a demo on: the code reads KINDRED_DEMO in one place, from process.env', () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts')) files.push(p); } };
  walk('src');
  walk('server');
  const readers = files.filter((f) => /\.KINDRED_DEMO\b|\[['"]KINDRED_DEMO['"]\]/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(readers.map((f) => f.replace(/\\/g, '/')), ['src/lib/demo.ts']);
  const source = readFileSync('src/lib/demo.ts', 'utf8');
  assert.match(source, /env: Env = process\.env/);
  assert.doesNotMatch(source, /getRequest|headers\.get|readCookie|searchParams/);
});

test('with the setting off, a request that asks for a demo gets none, and the install behaves as before', async () => {
  off();
  const asking = request({ url: 'http://localhost/?KINDRED_DEMO=1&demo=1', headers: { 'x-kindred-demo': '1', 'KINDRED_DEMO': '1', cookie: 'KINDRED_DEMO=1; kindred_demo=1; demo=1' } });
  const s = await session.getSession(asking);
  assert.equal(s.user, null);
  assert.notEqual(s.via, 'demo');
  const info = await fns.fetchSession();
  assert.equal(info.demo, undefined);
  assert.equal(info.user, null);
  // Writes work as they always did.
  const renamed = await dbs.once('aurel', undefined, 'test', async () => ({ writes: [dbs.q("UPDATE person SET given = 'Adah' WHERE id = 'a1'")], history: [], result: 'ok' }));
  assert.equal(renamed, 'ok');
  await st.store.media.put('aurel', 'photo/x.jpg', new Uint8Array([1]), 'image/jpeg');
  await st.store.media.delete('aurel', 'photo/x.jpg');
  await acc.accounts().run('UPDATE user SET last_seen = ? WHERE id = ?', T, STEWARD);
  assert.equal(await demo.refuseInDemo(), undefined);
});

test('in a demo, every visitor is the same viewer of every family, with no account, no cookie and no setup', async () => {
  // Even with another account's session cookie, or a share link's: those are not looked at.
  const token = (await acc.createSession(STEWARD)).token;
  on();
  const s = await session.getSession(request({ headers: { cookie: `kindred_session=${token}; kindred_guest=${'x'.repeat(43)}` } }));
  assert.equal(s.via, 'demo');
  assert.equal(s.user?.id, demo.DEMO_USER_ID);
  assert.equal(s.guest, undefined);
  assert.deepEqual(s.memberships?.map((m) => [m.tree, m.role]).sort(), [['aurel', 'viewer'], ['vesper', 'viewer']]);
  assert.equal(s.setCookie, undefined);

  request();
  const info = await fns.fetchSession();
  assert.equal(info.demo, true);
  assert.equal(info.needsSetup, false);
  assert.equal(info.user?.via, 'demo');
  assert.deepEqual(info.memberships.map((m) => m.role), ['viewer', 'viewer']);
  assert.deepEqual(g.__setCookies, [], 'no cookie is set');

  // The visitor reads what a viewer reads.
  request();
  assert.equal((await guard.requireMember('aurel')).role, 'viewer');
  assert.equal((await guard.requireReader('vesper')).role, 'viewer');
  assert.equal((await guard.requireCan('aurel', 'view')).role, 'viewer');
  const families = await fns.fetchMyFamilies();
  assert.deepEqual(families.map((f) => f.id).sort(), ['aurel', 'vesper']);
  assert.ok((await dbs.graph('aurel')).people.some((p) => p.id === 'a1'));
});

test('in a demo, every write is refused where all writes pass: the store, once, the guard and the media store', async () => {
  on();
  // The guard: anything beyond reading.
  request();
  await assert.rejects(guard.requireCan('aurel', 'add-story'), isReadOnly);
  // once: before its plan runs, so nothing a plan does first (an upload, an AI call) happens either.
  let planned = false;
  await assert.rejects(dbs.once('aurel', undefined, 'test', async () => { planned = true; return { writes: [], history: [], result: 1 }; }), isReadOnly);
  assert.equal(planned, false);
  // The store: a family's database and the accounts database are read-only, whoever asks.
  await assert.rejects(dbs.db('aurel').run("UPDATE person SET given = 'X'"), isReadOnly);
  await assert.rejects(dbs.db('aurel').batch([dbs.q("DELETE FROM person")]), isReadOnly);
  await assert.rejects(acc.accounts().run('DELETE FROM user'), isReadOnly);
  await assert.rejects(acc.accounts().batch([acc.q('DELETE FROM membership')]), isReadOnly);
  // A write with RETURNING reads like a read; through `get` and `all` it is refused all the same.
  await assert.rejects(dbs.db('aurel').get("UPDATE person SET given = 'X' RETURNING id"), isReadOnly);
  await assert.rejects(dbs.db('aurel').all("WITH p AS (SELECT 'a1' AS id) DELETE FROM person WHERE id IN (SELECT id FROM p) RETURNING id"), isReadOnly);
  await assert.rejects(acc.accounts().get('DELETE FROM user WHERE id = ? RETURNING id', STEWARD), isReadOnly);
  await assert.rejects(acc.takeChallenge('any-id'), isReadOnly);
  assert.equal((await dbs.db('aurel').all<{ id: string }>("WITH p AS (SELECT 'a1' AS id) SELECT person.id FROM person JOIN p USING (id)")).length, 1);
  await assert.rejects(acc.createSession(STEWARD), isReadOnly);
  await assert.rejects(st.store.media.put('aurel', 'photo/y.jpg', new Uint8Array([1]), 'image/jpeg'), isReadOnly);
  await assert.rejects(st.store.media.delete('aurel', 'photo/y.jpg'), isReadOnly);
  await assert.rejects(st.store.media.deleteTree('aurel'), isReadOnly);
  await assert.rejects(st.store.dropTree('aurel'), isReadOnly);
  await assert.rejects(st.store.ensureTree('newcomer'), isReadOnly);
  // A read that a write would follow still reads.
  assert.equal((await dbs.db('aurel').get<{ given: string }>("SELECT given FROM person WHERE id = 'a1'"))?.given, 'Adah');
  assert.equal((await acc.accounts().readBatch([acc.q('SELECT count(*) AS n FROM user')]))[0][0].n, 1);
  // Families cannot be made, changed or deleted.
  request();
  await assert.rejects(famFns.createFamily({ data: { id: 'newcomer', name: 'New', tagline: '', theme: 'codex' } }), isReadOnly);
  request();
  await assert.rejects(famFns.editFamily({ data: { tree: 'aurel', opKey: 'demo-key-1', name: 'X', tagline: '', theme: 'codex' } }), isReadOnly);
  request();
  await assert.rejects(famFns.deleteFamily({ data: { tree: 'aurel', confirm: 'aurel' } }), isReadOnly);
  // Nothing changed.
  off();
  assert.equal((await dbs.db('aurel').get<{ n: number }>('SELECT count(*) AS n FROM person'))?.n, 1);
  assert.equal((await acc.accounts().get<{ n: number }>('SELECT count(*) AS n FROM membership'))?.n, 1);
});

test('in a demo there is no AI and no daily job, whatever the databases hold', async () => {
  off();
  await acc.accounts().batch([
    acc.q(`INSERT INTO ai_settings (tree, features, web_search, monthly_micros, custom_prices, updated, updated_by) VALUES ('aurel', '{"assistant":true}', 0, 5000000, '{}', ?, ?)`, T, STEWARD),
  ]);
  on();
  const status = await ai.statusFor('aurel');
  assert.equal(status.configured, false);
  assert.ok(Object.values(status.features).every((f) => f === false));
  await assert.rejects(ai.routeAdapter('aurel', 'assistant', 'en'), /AI|off/i);
  const lines: string[] = [];
  await jobs.runJobs(new Date(), () => undefined, (m) => lines.push(m));
  assert.deepEqual(lines, ['demo: no daily jobs']);
});

test('after a demo, the same process with the setting off writes again: nothing of the demo stays behind', async () => {
  on();
  await assert.rejects(dbs.db('vesper').run("INSERT INTO person (id, given) VALUES ('v1', 'Vi')"), isReadOnly);
  off();
  await dbs.db('vesper').run("INSERT INTO person (id, given) VALUES ('v1', 'Vi')");
  request();
  assert.equal((await session.getSession(g.__request!)).user, null);
});
