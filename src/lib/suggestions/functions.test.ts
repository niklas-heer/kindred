// node --test src/lib/suggestions/functions.test.ts — the suggestion server functions and the upload route called for real,
// against a scratch database; only the framework around them (who is asking, createServerFn) is replaced, as in
// src/lib/votes/functions.test.ts. The stub skips the zod validators, so what matters is also checked behind them.
// Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-suggest-fns-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'suggest-fns-test-secret';
delete process.env.KINDRED_DEMO;
delete process.env.KINDRED_GUEST_ORIGIN;
delete process.env.KINDRED_ORIGIN;

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
      export const getRequest = () => globalThis.__request ?? new Request('http://localhost/');
      export const getRequestIP = () => globalThis.__ip ?? '203.0.113.1';
      export const setResponseStatus = () => {};
      export const appendResponseHeader = (name, value) => { (globalThis.__setCookies ??= []).push(value); };
      export const getRequestHeader = (name) => (globalThis.__request ?? new Request('http://localhost/')).headers.get(name) ?? undefined;`;
    if (id === STUB_SESSION) return `export const getSession = async () => ({ user: globalThis.__signedIn ?? null, via: globalThis.__signedIn ? 'passkey' : null, guest: globalThis.__guest });`;
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
const fns = await load<typeof import('./suggestions.functions.ts')>('/src/lib/suggestions/suggestions.functions.ts');
const { MAX_FILE_BYTES } = await load<typeof import('./types.ts')>('/src/lib/suggestions/types.ts');

const TREE = 'suggestfns';
const ADA = '00000000-0000-4000-8000-0000000000a1'; // viewer, a suggester
const BO = '00000000-0000-4000-8000-0000000000b2'; // editor, a reviewer
const CARL = '00000000-0000-4000-8000-0000000000c3'; // steward
const DEE = '00000000-0000-4000-8000-0000000000d4'; // viewer, not the suggester
const g = globalThis as unknown as { __signedIn?: { id: string; name: string } | null; __guest?: unknown; __request?: Request; __setCookies?: string[] };
const asMember = (id: string, name: string) => { g.__signedIn = { id, name }; g.__guest = undefined; g.__request = new Request('http://localhost/'); g.__setCookies = []; };
const asGuest = (cookie?: string, protectLiving = true) => {
  g.__signedIn = null;
  g.__guest = { link: 'link-1', tree: TREE, expires: Date.now() + 3_600_000, protectLiving };
  g.__request = new Request('http://localhost/', { headers: cookie ? { cookie } : {} });
  g.__setCookies = [];
};
const asNobody = () => { g.__signedIn = null; g.__guest = undefined; g.__request = new Request('http://localhost/'); g.__setCookies = []; };
/** The cookies this request's response set (read through a function, so an earlier assertion does not narrow it). */
const setCookies = (): string[] => g.__setCookies ?? [];
const status = (code: number) => (e: Error & { status?: number }) => e.status === code;
type Fn = (o: { data: never }) => Promise<unknown>;
const call = (fn: unknown, data: Record<string, unknown>) => (fn as Fn)({ data: data as never });

const enc = (s: string) => new TextEncoder().encode(s);
/** A one-pixel PNG with nothing to strip. */
const PNG = () => new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

/** A details suggestion about Bo (dead, so a protecting link's guest may make it): his birth year corrected. */
const bornIn = (year: string) => ({ tree: TREE, kind: 'details', person: 'bo', payload: { born: year }, note: 'From the parish book' });

before(async () => {
  await dbs.provisionFamily(TREE, 'Suggestion Functions');
  const d = dbs.db(TREE);
  await d.run("INSERT INTO person (id, given, surname, sex, born, living) VALUES ('ada', 'Ada', 'Alder', 'f', '1950', 1)");
  await d.run("INSERT INTO person (id, given, surname, sex, born, died, living) VALUES ('bo', 'Bo', 'Alder', 'm', '1920', '1990', 0)");
  await d.run("INSERT INTO parent (child, parent) VALUES ('ada', 'bo')");
  for (const [id, name, role] of [[ADA, 'Ada', 'viewer'], [BO, 'Bo', 'editor'], [CARL, 'Carl', 'steward'], [DEE, 'Dee', 'viewer']]) {
    await store.accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', id, name, `handle-${name}`, Date.now());
    await store.accounts().run('INSERT INTO membership (user, tree, role, created) VALUES (?, ?, ?, ?)', id, TREE, role, Date.now());
  }
});
after(async () => {
  asNobody();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const REVIEWER_FNS = () => [fns.getWaitingSuggestions, fns.getSuggestionCounts, fns.getMatchCandidates, fns.approveSuggestionFn, fns.declineSuggestionFn, fns.closePartlyAppliedFn];

test('a signed-out request is refused on every read and write', async () => {
  asNobody();
  const all = [fns.getSuggestSettings, fns.setSuggestSettings, fns.getMySuggestions, fns.createSuggestionFn, fns.withdrawSuggestionFn, ...REVIEWER_FNS()];
  for (const fn of all) await assert.rejects(call(fn, { ...bornIn('1921'), id: '00000000-0000-4000-8000-000000000001', guests: true, guestFiles: true, name: 'Hal' }), status(401));
});

test('a guest reads the settings and their own suggestions, and is refused every reviewer’s and steward’s function', async () => {
  asGuest();
  assert.deepEqual(await call(fns.getSuggestSettings, { tree: TREE }), { guests: true, guestFiles: true });
  assert.deepEqual(await call(fns.getMySuggestions, { tree: TREE }), [], 'a guest without the cookie has none');
  for (const fn of [...REVIEWER_FNS(), fns.setSuggestSettings]) {
    await assert.rejects(call(fn, { tree: TREE, id: '00000000-0000-4000-8000-000000000001', guests: false, guestFiles: false }), status(401));
  }
});

test('a viewer suggests and reads their own, and is refused every reviewer’s and steward’s function', async () => {
  asMember(ADA, 'Ada');
  const { id } = (await call(fns.createSuggestionFn, bornIn('1921'))) as { id: string };
  const mine = (await call(fns.getMySuggestions, { tree: TREE })) as { id: string; author: { name: string } }[];
  assert.deepEqual(mine.map((s) => s.id), [id]);
  assert.equal(mine[0]!.author.name, 'Ada');
  assert.deepEqual(g.__setCookies, [], 'a member gets no voter cookie');
  for (const fn of [...REVIEWER_FNS(), fns.setSuggestSettings]) {
    await assert.rejects(call(fn, { tree: TREE, id, guests: false, guestFiles: false }), status(403));
  }
  // Another member does not see it, nor withdraw it.
  asMember(DEE, 'Dee');
  assert.deepEqual(await call(fns.getMySuggestions, { tree: TREE }), []);
  await assert.rejects(call(fns.withdrawSuggestionFn, { tree: TREE, id }), /suggest\.err\.gone/);
  asMember(ADA, 'Ada');
  await call(fns.withdrawSuggestionFn, { tree: TREE, id });
  assert.deepEqual(await call(fns.getMySuggestions, { tree: TREE }), [], 'a withdrawn suggestion leaves the list');
});

test('a guest’s first suggestion needs a name; only a suggestion taken sets the voter cookie, and the cookie finds it again', async () => {
  asGuest();
  await assert.rejects(call(fns.createSuggestionFn, bornIn('1922')), /suggest\.err\.name/);
  assert.deepEqual(g.__setCookies, [], 'no name: no cookie');
  await assert.rejects(call(fns.createSuggestionFn, { ...bornIn('1920'), name: 'Hal' }), /suggest\.err\.unchanged/);
  assert.deepEqual(g.__setCookies, [], 'a refused suggestion sets no cookie');
  const { id } = (await call(fns.createSuggestionFn, { ...bornIn('1922'), name: 'Hal Hazel' })) as { id: string };
  assert.equal(setCookies().length, 1);
  assert.match(setCookies()[0]!, /^(__Host-)?kindred_voter=/);
  const cookie = setCookies()[0]!.split(';')[0]!;
  const row = await dbs.db(TREE).get<{ guest_key: string; author_name: string; link: string; net: number; account: string | null }>('SELECT guest_key, author_name, link, net, account FROM suggestion WHERE id = ?', id);
  assert.match(row!.guest_key, /^g:/);
  assert.deepEqual([row!.author_name, row!.link, row!.account, typeof row!.net], ['Hal Hazel', 'link-1', null, 'number']);

  // The browser sends the cookie back: the same guest, no new cookie, and their name is kept without being given again.
  asGuest(cookie);
  const second = (await call(fns.createSuggestionFn, { ...bornIn('1923') })) as { id: string };
  assert.deepEqual(g.__setCookies, [], 'a guest who has the cookie is given no new one');
  assert.equal((await dbs.db(TREE).get<{ author_name: string }>('SELECT author_name FROM suggestion WHERE id = ?', second.id))!.author_name, 'Hal Hazel');
  const mine = (await call(fns.getMySuggestions, { tree: TREE })) as { id: string }[];
  assert.deepEqual(mine.map((s) => s.id).sort(), [id, second.id].sort());
  // Another guest's browser sees none of them.
  asGuest(`kindred_voter=${'w'.repeat(43)}`);
  assert.deepEqual(await call(fns.getMySuggestions, { tree: TREE }), []);
  await assert.rejects(call(fns.withdrawSuggestionFn, { tree: TREE, id }), /suggest\.err\.gone/);
  asGuest(cookie);
  await call(fns.withdrawSuggestionFn, { tree: TREE, id: second.id });
  assert.deepEqual(((await call(fns.getMySuggestions, { tree: TREE })) as { id: string }[]).map((s) => s.id), [id]);
});

test('a guest’s name and network are worked out only to make a suggestion, not to read, withdraw or attach', async () => {
  const suggester = await load<typeof import('./suggester.server.ts')>('/src/lib/suggestions/suggester.server.ts');
  asGuest();
  await call(fns.createSuggestionFn, { ...bornIn('1925'), name: 'Lia' });
  const cookie = setCookies()[0]!.split(';')[0]!;
  asGuest(cookie);
  const { by } = await suggester.suggesterOf(TREE, g.__request!);
  assert.deepEqual(Object.keys(by).sort(), ['key', 'kind', 'link', 'protectLiving'], 'no name looked up, no network computed');
  asGuest(cookie);
  const making = await suggester.makerOf(TREE, g.__request!, {});
  assert.equal(making.by.kind === 'guest' && making.by.name, 'Lia', 'the name they gave before stands');
  assert.equal(making.by.kind === 'guest' && typeof making.by.net, 'number');
});

test('a suggestion sent again with its retry key is the same suggestion, for a member and for a guest', async () => {
  const rows = async () => (await dbs.db(TREE).get<{ n: number }>('SELECT count(*) AS n FROM suggestion'))!.n;
  asMember(ADA, 'Ada');
  const before = await rows();
  const first = (await call(fns.createSuggestionFn, { ...bornIn('1926'), opKey: 'retry-ada-0001' })) as { id: string };
  asMember(ADA, 'Ada');
  const again = (await call(fns.createSuggestionFn, { ...bornIn('1926'), opKey: 'retry-ada-0001' })) as { id: string };
  assert.equal(again.id, first.id, 'a lost response retried: the same suggestion');
  assert.equal(await rows(), before + 1, 'not a second one');
  // Another member sending the same key is not given Ada's suggestion.
  asMember(DEE, 'Dee');
  await assert.rejects(call(fns.createSuggestionFn, { ...bornIn('1926'), opKey: 'retry-ada-0001' }), /already sent as something else/);

  asGuest();
  await call(fns.createSuggestionFn, { ...bornIn('1927'), name: 'Mo' });
  const cookie = setCookies()[0]!.split(';')[0]!;
  asGuest(cookie);
  const guestFirst = (await call(fns.createSuggestionFn, { ...bornIn('1928'), opKey: 'retry-mo-00001' })) as { id: string };
  asGuest(cookie);
  const guestAgain = (await call(fns.createSuggestionFn, { ...bornIn('1928'), opKey: 'retry-mo-00001' })) as { id: string };
  assert.equal(guestAgain.id, guestFirst.id);
  assert.equal((await dbs.db(TREE).get<{ n: number }>("SELECT count(*) AS n FROM suggestion WHERE author_name = 'Mo'"))!.n, 2);
  // The key is bound to the guest's cookie: another browser on the same link gets nothing of Mo's.
  asGuest(`kindred_voter=${'v'.repeat(43)}`);
  await assert.rejects(call(fns.createSuggestionFn, { ...bornIn('1928'), name: 'Mo', opKey: 'retry-mo-00001' }), /already sent as something else/);
});

test('withdrawing, declining and closing as partly applied, sent again with their retry key, are done once and not refused', async () => {
  const status = async (id: string) => (await dbs.db(TREE).get<{ status: string }>('SELECT status FROM suggestion WHERE id = ?', id))!.status;
  asMember(ADA, 'Ada');
  const mine = (await call(fns.createSuggestionFn, bornIn('1915'))) as { id: string };
  for (let i = 0; i < 2; i++) await call(fns.withdrawSuggestionFn, { tree: TREE, id: mine.id, opKey: 'withdraw-0001' });
  assert.equal(await status(mine.id), 'withdrawn');

  const theirs = (await call(fns.createSuggestionFn, bornIn('1914'))) as { id: string };
  asMember(BO, 'Bo');
  for (let i = 0; i < 2; i++) await call(fns.declineSuggestionFn, { tree: TREE, id: theirs.id, reason: 'Not so', opKey: 'decline-0001' });
  assert.equal(await status(theirs.id), 'declined');

  asMember(ADA, 'Ada');
  const rel = (await call(fns.createSuggestionFn, {
    tree: TREE, kind: 'relative', person: 'bo', payload: { person: { given: 'Una', born: '1950', living: false }, link: { kind: 'child' } },
  })) as { id: string };
  await dbs.media.put(TREE, 'suggest/una.png', PNG(), 'image/png');
  await dbs.db(TREE).run("INSERT INTO suggestion_file (id, suggestion, key, mime, size, name, created_at) VALUES ('sf-una', ?, 'suggest/una.png', 'image/png', 3, 'una.png', '2026-11-01')", rel.id);
  // The files' source can never be written: the approval stops after adding Una.
  await dbs.db(TREE).run("CREATE TRIGGER no_sources BEFORE INSERT ON source BEGIN SELECT RAISE(ABORT, 'test: no sources'); END");
  try {
    asMember(BO, 'Bo');
    await assert.rejects(call(fns.approveSuggestionFn, { tree: TREE, id: rel.id }));
    for (let i = 0; i < 2; i++) await call(fns.closePartlyAppliedFn, { tree: TREE, id: rel.id, opKey: 'close-000001' });
    assert.equal(await status(rel.id), 'approved');
  } finally {
    await dbs.db(TREE).run('DROP TRIGGER no_sources');
  }
});

test('a protecting link’s guest suggests nothing about the living, and sets no cookie', async () => {
  asGuest(undefined, true);
  await assert.rejects(call(fns.createSuggestionFn, { tree: TREE, kind: 'details', person: 'ada', payload: { born: '1951' }, name: 'Ivy' }), /suggest\.err\.person/);
  assert.deepEqual(g.__setCookies, []);
});

test('the steward’s switch: only a steward changes it, and guests are refused while it is off', async () => {
  asMember(BO, 'Bo');
  await assert.rejects(call(fns.setSuggestSettings, { tree: TREE, guests: false, guestFiles: false }), status(403));
  asMember(CARL, 'Carl');
  await call(fns.setSuggestSettings, { tree: TREE, guests: false, guestFiles: true });
  assert.deepEqual(await call(fns.getSuggestSettings, { tree: TREE }), { guests: false, guestFiles: true });
  try {
    asGuest();
    await assert.rejects(call(fns.createSuggestionFn, { ...bornIn('1924'), name: 'Jo' }), /suggest\.err\.guests/);
    assert.deepEqual(g.__setCookies, []);
  } finally {
    asMember(CARL, 'Carl');
    await call(fns.setSuggestSettings, { tree: TREE, guests: true, guestFiles: true });
  }
});

test('a reviewer lists, counts, matches, declines and approves; approval writes the record in the reviewer’s language', async () => {
  asMember(ADA, 'Ada');
  const a = (await call(fns.createSuggestionFn, bornIn('1919'))) as { id: string };
  const rel = (await call(fns.createSuggestionFn, {
    tree: TREE, kind: 'relative', person: 'ada', payload: { person: { given: 'Bo', surname: 'Alder', born: '1920', living: false }, link: { kind: 'parent' } },
  })) as { id: string };
  asMember(BO, 'Bo');
  const waiting = (await call(fns.getWaitingSuggestions, { tree: TREE })) as { id: string }[];
  assert.ok(waiting.some((s) => s.id === a.id) && waiting.some((s) => s.id === rel.id));
  assert.deepEqual(((await call(fns.getWaitingSuggestions, { tree: TREE, person: 'ada' })) as { id: string }[]).map((s) => s.id), [rel.id]);
  const counts = (await call(fns.getSuggestionCounts, { tree: TREE })) as { total: number; people: Record<string, number> };
  assert.equal(counts.people.ada, 1);
  assert.deepEqual(((await call(fns.getMatchCandidates, { tree: TREE, id: rel.id })) as { person: string }[]).map((m) => m.person), ['bo']);
  await assert.rejects(call(fns.closePartlyAppliedFn, { tree: TREE, id: a.id }), /suggest\.err\.not_partial/);

  await call(fns.declineSuggestionFn, { tree: TREE, id: rel.id, reason: 'He is in the tree already' });
  assert.equal((await dbs.db(TREE).get<{ status: string; reason: string }>('SELECT status, reason FROM suggestion WHERE id = ?', rel.id))!.reason, 'He is in the tree already');

  // Adjusted: the reviewer approves 1918 instead of the suggested 1919.
  const { applied } = (await call(fns.approveSuggestionFn, { tree: TREE, id: a.id, adjusted: { born: '1918' } })) as { applied: { person?: string } };
  assert.equal(applied.person, 'bo');
  assert.equal((await dbs.db(TREE).get<{ born: string }>("SELECT born FROM person WHERE id = 'bo'"))!.born, '1918');
  const decided = await dbs.db(TREE).get<{ status: string; adjusted: number; decided_by: string }>('SELECT status, adjusted, decided_by FROM suggestion WHERE id = ?', a.id);
  assert.deepEqual({ ...decided }, { status: 'approved', adjusted: 1, decided_by: BO });
});

test('approval with files names their source in the reviewer’s language when no title is given', async () => {
  asMember(ADA, 'Ada');
  const s = (await call(fns.createSuggestionFn, bornIn('1917'))) as { id: string };
  const up = await upload(s.id, PNG(), { name: 'page.png' });
  assert.equal(up.status, 200);
  asMember(BO, 'Bo');
  g.__request = new Request('http://localhost/', { headers: { 'accept-language': 'de' } });
  const { applied } = (await call(fns.approveSuggestionFn, { tree: TREE, id: s.id })) as { applied: { source?: string } };
  const title = (await dbs.db(TREE).get<{ title: string }>('SELECT title FROM source WHERE id = ?', applied.source!))!.title;
  assert.match(title, /Ada/);
  assert.doesNotMatch(title, /^Supplied/, 'written in German, not English');
});

// ---------- the upload route ----------

/** POSTs a file to the upload route, as the browser does: the bytes as the body, the type and the name as headers. */
async function upload(id: string, body: Uint8Array | ReadableStream<Uint8Array>, o: { mime?: string; name?: string; length?: number | null; cookie?: string } = {}) {
  const { Route } = await load<{ Route: { options: unknown } }>('/src/routes/api/suggestion-upload.$tree.$id.ts');
  const { POST } = (Route.options as { server: { handlers: { POST: (c: { params: Record<string, string>; request: Request }) => Promise<Response> } } }).server.handlers;
  const headers: Record<string, string> = { 'content-type': o.mime ?? 'image/png', 'x-file-name': encodeURIComponent(o.name ?? 'letter.png') };
  if (o.cookie) headers.cookie = o.cookie;
  const length = o.length === undefined ? (body instanceof Uint8Array ? body.length : null) : o.length;
  if (length !== null) headers['content-length'] = String(length);
  const request = new Request(`http://localhost/api/suggestion-upload/${TREE}/${id}`, { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
  g.__request = request;
  return POST({ params: { tree: TREE, id }, request });
}
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;
const filesOf = async (id: string) => (await dbs.db(TREE).all<{ name: string; mime: string }>('SELECT name, mime FROM suggestion_file WHERE suggestion = ?', id));

test('upload: a member attaches a file to their own suggestion; nobody else can', async () => {
  asMember(ADA, 'Ada');
  const s = (await call(fns.createSuggestionFn, bornIn('1916'))) as { id: string };
  const ok = await upload(s.id, PNG(), { name: 'Kirchenbuch Seite 4.png' });
  assert.equal(ok.status, 200);
  assert.match(((await ok.json()) as { id: string }).id, /^[0-9a-f-]{36}$/);
  assert.deepEqual((await filesOf(s.id)).map((f) => ({ ...f })), [{ name: 'Kirchenbuch Seite 4.png', mime: 'image/png' }]);

  asMember(DEE, 'Dee');
  const other = await upload(s.id, PNG());
  assert.equal(other.status, 404, 'another member’s upload finds no suggestion of theirs');
  assert.equal(await errorOf(other), 'suggest.err.gone');
  asNobody();
  assert.equal((await upload(s.id, PNG())).status, 401);
  asGuest(`kindred_voter=${'w'.repeat(43)}`);
  assert.equal((await upload(s.id, PNG())).status, 404, 'nor a guest');
  assert.equal((await filesOf(s.id)).length, 1);
});

test('upload: the size limit holds before the body is read, and while it is read', async () => {
  asMember(ADA, 'Ada');
  const s = (await call(fns.createSuggestionFn, bornIn('1915'))) as { id: string };
  // Says it is too large: refused without reading a byte.
  let pulled = 0;
  const lying = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); } });
  const declared = await upload(s.id, lying, { length: MAX_FILE_BYTES + 1 });
  assert.equal(declared.status, 413);
  assert.equal(await errorOf(declared), 'suggest.err.file_size');
  assert.ok(pulled <= 1, `read ${pulled} chunks of a body it refused by its length`);
  // Says nothing of its length and keeps sending: stopped once past the limit.
  pulled = 0;
  const endless = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024 * 1024)); } });
  const streamed = await upload(s.id, endless, { length: null });
  assert.equal(streamed.status, 413);
  assert.ok(pulled <= Math.ceil(MAX_FILE_BYTES / (1024 * 1024)) + 2, `read ${pulled} MB, far past the limit`);
  assert.deepEqual(await filesOf(s.id), []);
});

test('upload: only images and PDFs, of the type their bytes are', async () => {
  asMember(ADA, 'Ada');
  const s = (await call(fns.createSuggestionFn, bornIn('1914'))) as { id: string };
  const html = await upload(s.id, enc('<script>alert(1)</script>'), { mime: 'text/html', name: 'x.html' });
  assert.equal(html.status, 415);
  assert.equal(await errorOf(html), 'suggest.err.file_type');
  const renamed = await upload(s.id, enc('<script>alert(1)</script>'), { mime: 'image/png', name: 'x.png' });
  assert.equal(renamed.status, 415, 'bytes that are not the type they claim');
  assert.deepEqual(await filesOf(s.id), []);
});

test('upload: who may attach is decided before the body is read; an empty body is a bad request', async () => {
  asMember(ADA, 'Ada');
  const s = (await call(fns.createSuggestionFn, bornIn('1912'))) as { id: string };
  /** A body that never ends and says nothing of its length, counting what is read of it. */
  const endless = () => {
    const seen = { pulled: 0 };
    return { seen, body: new ReadableStream<Uint8Array>({ pull(c) { seen.pulled++; c.enqueue(new Uint8Array(1024 * 1024)); } }) };
  };
  // Not your suggestion: refused before a byte is read.
  asMember(DEE, 'Dee');
  let e = endless();
  const other = await upload(s.id, e.body, { length: null });
  assert.equal(other.status, 404);
  assert.ok(e.seen.pulled <= 1, `read ${e.seen.pulled} MB of a body it refused`);
  // Your suggestion with all the files it can have.
  asMember(ADA, 'Ada');
  for (let n = 0; n < 5; n++) assert.equal((await upload(s.id, PNG())).status, 200);
  e = endless();
  const full = await upload(s.id, e.body, { length: null });
  assert.equal(full.status, 400);
  assert.equal(await errorOf(full), 'suggest.err.files');
  assert.ok(e.seen.pulled <= 1, `read ${e.seen.pulled} MB though no file could be taken`);
  // Nothing sent: not a wrong type, just nothing.
  const fresh = (await call(fns.createSuggestionFn, bornIn('1911'))) as { id: string };
  const empty = await upload(fresh.id, new Uint8Array());
  assert.equal(empty.status, 400);
  assert.equal(await errorOf(empty), 'suggest.err.empty');
  assert.deepEqual(await filesOf(fresh.id), []);
});

test('upload: a demo stores nothing', async () => {
  asMember(ADA, 'Ada');
  const s = (await call(fns.createSuggestionFn, bornIn('1910'))) as { id: string };
  process.env.KINDRED_DEMO = '1';
  try {
    asMember(ADA, 'Ada');
    const res = await upload(s.id, PNG());
    assert.equal(res.status, 403);
    assert.match(await errorOf(res), /demo/i);
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  assert.deepEqual(await filesOf(s.id), []);
});

test('upload: a guest attaches to their own suggestion by the cookie, while guests may attach files', async () => {
  asGuest();
  await call(fns.createSuggestionFn, { ...bornIn('1913'), name: 'Kit' });
  const cookie = setCookies()[0]!.split(';')[0]!;
  asGuest(cookie);
  const mine = (await call(fns.getMySuggestions, { tree: TREE })) as { id: string }[];
  const id = mine[0]!.id;
  asGuest();
  assert.equal((await upload(id, PNG())).status, 404, 'without the cookie it is no one’s');
  asGuest(cookie);
  assert.equal((await upload(id, PNG(), { cookie })).status, 200);
  asMember(CARL, 'Carl');
  await call(fns.setSuggestSettings, { tree: TREE, guests: true, guestFiles: false });
  try {
    asGuest(cookie);
    const off = await upload(id, PNG(), { cookie });
    assert.equal(off.status, 400);
    assert.equal(await errorOf(off), 'suggest.err.guest_files');
  } finally {
    asMember(CARL, 'Carl');
    await call(fns.setSuggestSettings, { tree: TREE, guests: true, guestFiles: true });
  }
  assert.equal((await filesOf(id)).length, 1);
});

test('the query helpers key the cache under the family’s suggestions, and approvals refresh the records', () => {
  assert.deepEqual(fns.suggestSettingsQuery('t').queryKey, ['suggestions', 't', 'settings']);
  assert.deepEqual(fns.mySuggestionsQuery('t').queryKey, ['suggestions', 't', 'mine', null]);
  assert.deepEqual(fns.mySuggestionsQuery('t', 'p').queryKey, ['suggestions', 't', 'mine', 'p']);
  assert.deepEqual(fns.waitingSuggestionsQuery('t', 'p').queryKey, ['suggestions', 't', 'waiting', 'p']);
  assert.deepEqual(fns.suggestionCountsQuery('t').queryKey, ['suggestions', 't', 'counts']);
  assert.deepEqual(fns.matchCandidatesQuery('t', 'x').queryKey, ['suggestions', 't', 'matches', 'x']);
  assert.deepEqual(fns.suggestionKeys('t'), [['suggestions', 't']]);
  const approval = fns.approvalKeys('t').map((k) => k[0]);
  for (const k of ['suggestions', 'graph', 'person', 'events', 'sources', 'history']) assert.ok(approval.includes(k), k);
});
