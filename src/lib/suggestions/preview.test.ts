// node --test src/lib/suggestions/preview.test.ts — suggestions under a steward's "View as" preview (src/lib/auth/view-as.server.ts):
// a preview offers "Suggest a change" as the previewed reader would see it, but making one and attaching a file are refused
// with the preview's own sentence, before anything else is asked or stored; and a viewer's or a guest's preview reads no
// pending file and no source file, not even the steward's own. Real server functions and routes on scratch
// databases; only the framework around them is replaced (who is asking, and createServerFn), as in src/lib/auth/view-as.test.ts.
// Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-suggest-preview-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'suggest-preview-test-secret';
delete process.env.KINDRED_GUEST_ORIGIN;
delete process.env.KINDRED_ORIGIN;
delete process.env.KINDRED_DEMO;
delete process.env.KINDRED_AUTH;
delete process.env.CF_ACCESS_AUD;
delete process.env.CF_ACCESS_TEAM_DOMAIN;

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
      export const getRequest = () => { if (!globalThis.__request) throw new Error('outside a request'); return globalThis.__request; };
      export const getRequestIP = () => '203.0.113.1';
      export const setResponseStatus = () => {};
      export const appendResponseHeader = (name, value) => { (globalThis.__setCookies ??= []).push(value); };
      export const getRequestHeader = () => undefined;`;
    if (id === STUB_SESSION) return `export const getSession = async () => globalThis.__session ?? { user: null, via: null };`;
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
const store = await load<typeof import('../auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const dbs = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const viewAs = await load<typeof import('../auth/view-as.functions.ts')>('/src/lib/auth/view-as.functions.ts');
const fns = await load<typeof import('./suggestions.functions.ts')>('/src/lib/suggestions/suggestions.functions.ts');
const S = await load<typeof import('./suggest.server.ts')>('/src/lib/suggestions/suggest.server.ts');

const TREE = 'previewing';
const STELLA = '00000000-0000-4000-8000-0000000000a1'; // steward
const SESSION_HASH = 'stella-session-hash';

const g = globalThis as unknown as { __session?: unknown; __request?: Request; __setCookies?: string[] };
const userRow = (id: string, name: string) => ({ id, name, locale: null, email: null, handle: `h-${id}`, created: 0, last_seen: Date.now() });
let cookie: string | undefined;
/** A new request from the steward's browser, holding the preview cookie when there is one. */
function steward(extra: Record<string, string> = {}) {
  g.__session = { user: userRow(STELLA, 'Stella Steward'), via: 'passkey', sessionHash: SESSION_HASH };
  g.__setCookies = [];
  g.__request = new Request('http://localhost/', { headers: { ...(cookie ? { cookie } : {}), ...extra } });
}
async function start(choice: Parameters<typeof viewAs.startViewAs>[0]['data']['choice']) {
  steward();
  await viewAs.startViewAs({ data: { tree: TREE, choice } });
  cookie = g.__setCookies!.findLast((c) => /^kindred_view_as=[^;]/.test(c))!.split(';')[0];
}
async function stop() {
  steward();
  await viewAs.stopViewAs({});
  cookie = undefined;
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const refusedAsPreview = (e: unknown) => /Stop the preview to change something\.$/.test(message(e));
const count = async (table: string) => (await dbs.db(TREE).get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))!.n;
const stored = async (prefix: string) => (await dbs.store.media.list(TREE)).map((f) => f.key).filter((k) => k.startsWith(prefix));
const PNG = () => new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

/** POSTs a file to the upload route as the steward's browser. */
async function upload(id: string) {
  const { Route } = await load<{ Route: { options: unknown } }>('/src/routes/api/suggestion-upload.$tree.$id.ts');
  const { POST } = (Route.options as { server: { handlers: { POST: (c: { params: Record<string, string>; request: Request }) => Promise<Response> } } }).server.handlers;
  const body = PNG();
  steward({ 'content-type': 'image/png', 'content-length': String(body.length), 'x-file-name': 'page.png' });
  const request = new Request(`http://localhost/api/suggestion-upload/${TREE}/${id}`, { method: 'POST', headers: g.__request!.headers, body });
  g.__request = request;
  return POST({ params: { tree: TREE, id }, request });
}

before(async () => {
  await dbs.provisionFamily(TREE, 'Previewing Family');
  await dbs.db(TREE).run("INSERT INTO person (id, given, surname, born, died, living) VALUES ('bo', 'Bo', 'Alder', '1920', '1990', 0)");
  const acc = store.accounts();
  await acc.run('INSERT INTO user (id, name, handle, created, last_seen) VALUES (?, ?, ?, ?, ?)', STELLA, 'Stella Steward', 'h-stella', Date.now(), 1000);
  await acc.run("INSERT INTO membership (user, tree, role, created) VALUES (?, ?, 'steward', 1)", STELLA, TREE);
});
after(async () => {
  g.__request = undefined;
  g.__session = undefined;
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a preview makes no suggestion and attaches no file: the preview’s sentence, before anything else is asked', async () => {
  // Stella's own waiting suggestion, made outside the preview.
  steward();
  const mine = (await fns.createSuggestionFn({ data: { tree: TREE, kind: 'details', person: 'bo', payload: { born: '1919' } } as never })) as { id: string };
  const before = { suggestions: await count('suggestion'), files: await count('suggestion_file') };

  for (const choice of [{ kind: 'role', role: 'viewer' }, { kind: 'guest' }] as const) {
    await start(choice);
    // As the previewed viewer or guest would send it; a guest without a name too, which would otherwise be asked for one.
    for (const data of [{ name: 'Nobody' }, {}]) {
      steward();
      await assert.rejects(fns.createSuggestionFn({ data: { tree: TREE, kind: 'details', person: 'bo', payload: { born: '1918' }, ...data } as never }), (e) => {
        assert.ok(refusedAsPreview(e), `${choice.kind}: ${message(e)}`);
        return true;
      });
      assert.deepEqual(g.__setCookies, [], 'no voter cookie is handed out');
    }
    const res = await upload(mine.id);
    assert.equal(res.status, 403, choice.kind);
    assert.ok(refusedAsPreview(((await res.json()) as { error: string }).error));
    await stop();
  }
  assert.deepEqual({ suggestions: await count('suggestion'), files: await count('suggestion_file') }, before);
  assert.deepEqual(await stored('suggest/'), []);
  assert.equal((await S.suggestSettings(TREE)).guests, true);
});

/** GETs a file route as the steward's browser: `suggestion-file` takes a pending file's id, `source-file` a source file's key. */
async function fetchFile(route: 'suggestion-file' | 'source-file', id: string) {
  const path = route === 'suggestion-file' ? '/src/routes/api/suggestion-file.$tree.$id.ts' : '/src/routes/api/source-file.$tree.$key.ts';
  const { Route } = await load<{ Route: { options: unknown } }>(path);
  const { GET } = (Route.options as { server: { handlers: { GET: (c: { params: Record<string, string>; request: Request }) => Promise<Response> } } }).server.handlers;
  steward();
  const request = new Request(`http://localhost/api/${route}/${TREE}/${id}`, { headers: g.__request!.headers });
  g.__request = request;
  return GET({ params: route === 'suggestion-file' ? { tree: TREE, id } : { tree: TREE, key: id }, request });
}

test('a preview as a viewer or a guest gets no pending file and no source file, not even the steward’s own', async () => {
  // Outside the preview: Stella's own waiting suggestion with a file, and a source's file.
  steward();
  const mine = (await fns.createSuggestionFn({ data: { tree: TREE, kind: 'details', person: 'bo', payload: { died: '1991' } } as never })) as { id: string };
  assert.equal((await upload(mine.id)).status, 200);
  const pending = (await dbs.db(TREE).get<{ id: string }>('SELECT id FROM suggestion_file WHERE suggestion = ?', mine.id))!.id;
  const key = '99999999-9999-4999-8999-999999999999.png';
  g.__request = undefined;
  await dbs.db(TREE).run("INSERT INTO source (id, title, created_at, updated_at) VALUES ('s1', 'Parish book', '2026-11-15', '2026-11-15')");
  await dbs.db(TREE).run("INSERT INTO source_file (source, media_key, mime, name, ord, added_at) VALUES ('s1', ?, 'image/png', 'page', 0, '2026-11-15')", `source/${key}`);
  await dbs.media.put(TREE, `source/${key}`, PNG(), 'image/png');
  assert.equal((await fetchFile('suggestion-file', pending)).status, 200, 'Stella herself gets her pending file');
  assert.equal((await fetchFile('source-file', key)).status, 200, 'and the source’s file');

  await start({ kind: 'role', role: 'viewer' });
  assert.equal((await fetchFile('suggestion-file', pending)).status, 404, 'a viewer’s preview is not Stella: her pending file is not theirs');
  await stop();
  await start({ kind: 'guest' });
  assert.equal((await fetchFile('suggestion-file', pending)).status, 404, 'a guest’s preview has no voter cookie of hers');
  assert.equal((await fetchFile('source-file', key)).status, 404, 'sources are members’ alone');
  await stop();
});
