// node --test src/lib/auth/share.test.ts — the family share link: its hashing, revoking and replacing it, expiry, the rate limit,
// the wrong password, and above all what a guest cannot reach. These call every real server function and the real media
// routes against scratch databases; only the framework around them is replaced (who is asking, and createServerFn).
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-share-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'share-test-secret';
delete process.env.KINDRED_GUEST_ORIGIN;
delete process.env.KINDRED_ORIGIN;
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
      export const getRequest = () => globalThis.__request ?? new Request('http://localhost/');
      export const getRequestIP = () => globalThis.__ip ?? '203.0.113.1';
      export const setResponseStatus = () => {};
      export const appendResponseHeader = (name, value) => { (globalThis.__setCookies ??= []).push(value); };
      export const getRequestHeader = () => undefined;`;
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

const store = await load<typeof import('./store.server.ts')>('/src/lib/auth/store.server.ts');
const dbs = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const share = await load<typeof import('./share.server.ts')>('/src/lib/auth/share.server.ts');
const fns = await load<typeof import('./share.functions.ts')>('/src/lib/auth/share.functions.ts');
const tokens = await load<typeof import('./tokens.server.ts')>('/src/lib/auth/tokens.server.ts');
const session = await load<typeof import('./session.server.ts')>('/src/lib/auth/session.server.ts');
const origin = await load<typeof import('./origin.ts')>('/src/lib/auth/origin.ts');
const guestHost = await load<typeof import('./guest-host.ts')>('/src/lib/auth/guest-host.ts');
const authFns = await load<typeof import('./functions.ts')>('/src/lib/auth/functions.ts');

const TREE = 'sharing';
const OTHER = 'other-family';
const STEWARD = '00000000-0000-4000-8000-0000000000a1';
const g = globalThis as unknown as { __signedIn?: { id: string; name: string } | null; __guest?: unknown; __ip?: string; __setCookies?: string[]; __request?: Request };

const asSteward = () => { g.__signedIn = { id: STEWARD, name: 'steward' }; g.__guest = undefined; };
const asGuest = (guest: unknown) => { g.__signedIn = null; g.__guest = guest; };
const asNobody = () => { g.__signedIn = null; g.__guest = undefined; };
const guestOfTree = { link: 'some-link', tree: TREE, expires: Date.now() + 3_600_000 };

const MEDIA_KEY = '00000000-0000-4000-8000-000000000b01.jpg';
const PRIVATE_DOC = 'private-doc-0001.pdf';
const OPEN_DOC = 'open-doc-0001.pdf';

/** The route's own GET handler, as the server calls it. */
async function get(route: string, params: Record<string, string>) {
  const { Route } = await load<{ Route: { options: unknown } }>(`/src/routes/api/${route}.ts`);
  const { GET } = (Route.options as { server: { handlers: { GET: (c: { params: Record<string, string>; request: Request }) => Promise<Response> } } }).server.handlers;
  return GET({ params, request: new Request('http://localhost/') });
}

/** Makes a link as the steward, and returns its URL's token and its password. */
async function makeLink(password = true, days: 1 | 7 | 30 | 90 | null = 30) {
  asSteward();
  const made = await fns.makeShareLink({ data: { tree: TREE, password, days } });
  return { ...made, token: made.url.split('/share/')[1] };
}

/** Opens a link from an address and returns what the real session code makes of the cookie it set. */
async function openAs(token: string, password: string | undefined, ip = '203.0.113.1') {
  asNobody();
  g.__ip = ip;
  g.__setCookies = [];
  const result = await fns.openShareLink({ data: { token, password } });
  const set = g.__setCookies.find((c) => c.startsWith('kindred_guest='));
  return { result, cookie: set?.split(';')[0] };
}
const realSession = (cookie: string | undefined, url = 'http://localhost/') =>
  session.getSession(new Request(url, { headers: cookie ? { cookie } : {} }), async () => undefined, async () => []);

before(async () => {
  for (const [id, name] of [[TREE, 'Share Test'], [OTHER, 'Other']]) await dbs.provisionFamily(id, name);
  const d = dbs.db(TREE);
  await d.run("INSERT INTO person (id, given, living, born) VALUES ('ada', 'Ada', 1, '1950')");
  await d.run(`INSERT INTO person_field (id, person, type, label, value, visibility) VALUES ('f1', 'ada', 'medical', 'Note', '{"text":"SECRET-DIAGNOSIS"}', 'editors')`);
  await d.run("INSERT INTO media (key, mime, uploaded_by, uploaded_at) VALUES (?, 'image/jpeg', 'x', '2026-01-01')", `gallery/${MEDIA_KEY}`);
  await dbs.media.put(TREE, `gallery/${MEDIA_KEY}`, new Uint8Array([255, 216, 255]), 'image/jpeg');
  await store.accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', STEWARD, 'steward', 'handle-steward', Date.now());
  await store.accounts().run("INSERT INTO membership (user, tree, role, created) VALUES (?, ?, 'steward', ?)", STEWARD, TREE, Date.now());
});
after(async () => {
  asNobody();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------- hashing ----------

test('the password goes through a real KDF, and its limits fit Workers', async () => {
  const a = await tokens.hashPassword('ABCD2345EFGH');
  const b = await tokens.hashPassword('ABCD2345EFGH');
  assert.match(a, /^pbkdf2-sha512\$100000\$[\w-]+\$[\w-]+$/, 'it names its scheme, iterations, salt and key');
  assert.notEqual(a, b, 'a fresh salt every time');
  assert.equal(await tokens.verifyPassword('ABCD2345EFGH', a), true);
  assert.equal(await tokens.verifyPassword('ABCD2345EFGJ', a), false);
  assert.equal(await tokens.verifyPassword('ABCD2345EFGH', 'pbkdf2-sha512$0$c2FsdA$a2V5'), false, 'a malformed stored value never matches');
  assert.equal(await tokens.verifyPassword('ABCD2345EFGH', 'md5$1$a$b'), false);
  assert.ok(tokens.PBKDF2_ITERATIONS <= 100_000, 'Cloudflare Workers has capped PBKDF2 at 100,000 iterations');
});

test('generated passwords are unambiguous and survive how they are typed', () => {
  const p = share.newSharePassword();
  assert.match(p, /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  assert.equal(share.normalizeSharePassword(p.toLowerCase().replace(/-/g, ' ')), p.replace(/-/g, ''));
});

test('the database holds no working token or password, and the token is long and random', async () => {
  const made = await makeLink();
  assert.match(made.token, /^[A-Za-z0-9_-]{43}$/, '256 bits, as an invitation has');
  assert.ok(made.password, 'a password is the default');
  const row = await store.accounts().get<{ token_hash: string; password_hash: string }>('SELECT token_hash, password_hash FROM share_link WHERE tree = ?', TREE);
  assert.ok(row);
  assert.notEqual(row.token_hash, made.token);
  assert.ok(!row.token_hash.includes(made.token));
  assert.ok(!row.password_hash.includes(made.password!.replace(/-/g, '')));
  assert.match(row.password_hash, /^pbkdf2-sha512\$/);
  const dump = JSON.stringify(await store.accounts().all('SELECT * FROM share_link'));
  assert.ok(!dump.includes(made.token) && !dump.includes(made.password!), 'nothing usable is stored');
});

test('a visitor learns nothing about the family from the link alone', async () => {
  const made = await makeLink();
  asNobody();
  const entry = await fns.fetchShareEntry({ data: { token: made.token } });
  assert.deepEqual(entry, { status: 'open', password: true, measured: true });
  assert.ok(!JSON.stringify(entry).includes(TREE), 'no family id or name before the password');
  const wrongToken = await fns.fetchShareEntry({ data: { token: 'A'.repeat(43) } });
  assert.deepEqual(wrongToken, { status: 'closed' }, 'an unknown link and a dead link look the same');
});

// ---------- the password ----------

test('a wrong password is refused and starts nothing; the right one starts a short visit', async () => {
  const made = await makeLink();
  const wrong = await openAs(made.token, 'WRONG-WRONG-WRON');
  assert.deepEqual(wrong.result, { status: 'wrong' });
  assert.equal(wrong.cookie, undefined, 'no cookie for a wrong password');
  const noPassword = await openAs(made.token, undefined);
  assert.deepEqual(noPassword.result, { status: 'wrong' }, 'the URL alone opens nothing');

  const right = await openAs(made.token, made.password!.toLowerCase().replace(/-/g, ' '), '198.51.100.9');
  assert.deepEqual(right.result, { status: 'ok', tree: TREE });
  assert.ok(right.cookie);
  const s = await realSession(right.cookie);
  assert.equal(s.user, null, 'a guest is not an account');
  assert.equal(s.via, null);
  assert.equal(s.guest?.tree, TREE);
  assert.ok(s.guest!.expires - Date.now() <= 12 * 3_600_000 + 1000, 'a visit lasts 12 hours at most');
  assert.ok(g.__setCookies!.some((c) => c.includes('HttpOnly') && c.includes('SameSite=Lax')));
});

test('a steward can choose no password, and only then does the URL alone open it', async () => {
  const made = await makeLink(false);
  assert.equal(made.password, null);
  asNobody();
  assert.deepEqual(await fns.fetchShareEntry({ data: { token: made.token } }), { status: 'open', password: false, measured: true });
  const opened = await openAs(made.token, undefined);
  assert.deepEqual(opened.result, { status: 'ok', tree: TREE });
});

// ---------- revoke, rotate, expiry ----------

test('revoking ends the link and every visit at once', async () => {
  const made = await makeLink();
  const { cookie } = await openAs(made.token, made.password!);
  assert.ok((await realSession(cookie)).guest);
  asSteward();
  await fns.revokeShareLink({ data: { tree: TREE } });
  assert.equal((await realSession(cookie)).guest, undefined, 'the visit died with the link');
  assert.equal((await store.accounts().get<{ n: number }>('SELECT count(*) AS n FROM share_session'))!.n, 0);
  asNobody();
  assert.deepEqual(await fns.fetchShareEntry({ data: { token: made.token } }), { status: 'closed' });
  assert.deepEqual((await openAs(made.token, made.password!)).result, { status: 'closed' });
  asSteward();
  assert.equal((await fns.fetchShareState({ data: { tree: TREE } })).link, null);
});

test('replacing the link kills the old URL, the old password and every visit', async () => {
  const first = await makeLink();
  const { cookie } = await openAs(first.token, first.password!);
  const second = await makeLink();
  assert.notEqual(second.token, first.token);
  assert.notEqual(second.password, first.password);
  assert.equal(second.generation, first.generation + 1);
  assert.equal(second.id, first.id, 'still the family’s one link');
  assert.equal((await realSession(cookie)).guest, undefined, 'the old visit is over');
  assert.deepEqual((await openAs(first.token, first.password!)).result, { status: 'closed' }, 'the old URL is dead');
  assert.deepEqual((await openAs(second.token, first.password!)).result, { status: 'wrong' }, 'the old password does not open the new URL');
  assert.equal((await openAs(second.token, second.password!)).result.status, 'ok');
});

test('a link with an expiry stops at that moment, and a visit never outlives it', async () => {
  const made = await makeLink(true, 1);
  const before = Date.now();
  await store.accounts().run('UPDATE share_link SET expires = ? WHERE tree = ?', before + 60_000, TREE);
  const { cookie } = await openAs(made.token, made.password!);
  const s = await realSession(cookie);
  assert.ok(s.guest!.expires <= before + 60_000 + 50, 'the visit is capped by the link');
  await store.accounts().run('UPDATE share_link SET expires = ? WHERE tree = ?', Date.now() - 1, TREE);
  assert.equal((await realSession(cookie)).guest, undefined, 'an expired link ends every visit');
  asNobody();
  assert.deepEqual(await fns.fetchShareEntry({ data: { token: made.token } }), { status: 'closed' });
  assert.deepEqual((await openAs(made.token, made.password!)).result, { status: 'closed' });
  asSteward();
  assert.equal((await fns.fetchShareState({ data: { tree: TREE } })).link?.ended, true, 'the steward sees it has ended');
});

test('no expiry means no end date', async () => {
  const made = await makeLink(true, null);
  assert.equal(made.expires, null);
  assert.equal((await openAs(made.token, made.password!)).result.status, 'ok');
});

// ---------- the rate limit ----------

test('too many tries from one address are stopped, even with the right password, and that address alone', async () => {
  const made = await makeLink();
  const ip = '198.18.0.7';
  for (let i = 0; i < share.ATTEMPTS_PER_IP; i++) assert.deepEqual((await openAs(made.token, `WRONG${i}`, ip)).result, { status: 'wrong' }, `try ${i + 1}`);
  assert.deepEqual((await openAs(made.token, made.password!, ip)).result, { status: 'slow' }, 'the limit holds before the password is even checked');
  assert.equal((await openAs(made.token, made.password!, '198.18.0.8')).result.status, 'ok', 'someone else is unaffected');
});

test('the limit is kept in the database and its window ends', async () => {
  const made = await makeLink();
  const ip = '198.18.0.9';
  for (let i = 0; i < share.ATTEMPTS_PER_IP + 1; i++) await openAs(made.token, 'NOPE', ip);
  assert.deepEqual((await openAs(made.token, made.password!, ip)).result, { status: 'slow' });
  const rows = await store.accounts().all<{ key: string; count: number }>('SELECT key, count FROM share_attempt WHERE key LIKE ?', `${made.id}:%`);
  assert.ok(rows.some((r) => r.count > share.ATTEMPTS_PER_IP), 'counted in the database');
  assert.ok(!JSON.stringify(rows).includes(ip), 'addresses are hashed');
  await store.accounts().run('UPDATE share_attempt SET started = started - ?', share.ATTEMPT_WINDOW_MS + 1);
  assert.equal((await openAs(made.token, made.password!, ip)).result.status, 'ok', 'a new window, a new chance');
});

test('the whole link has a limit across addresses, and a refused address does not spend it', async () => {
  const made = await makeLink();
  for (let i = 0; i < share.ATTEMPTS_PER_LINK; i++) await openAs(made.token, 'NOPE', `198.19.${Math.floor(i / 100)}.${i % 100}`);
  assert.deepEqual((await openAs(made.token, made.password!, '198.20.0.1')).result, { status: 'slow' }, 'the link is out of tries');
  await store.accounts().run('DELETE FROM share_attempt');
  const blocked = '198.20.0.2';
  for (let i = 0; i < share.ATTEMPTS_PER_IP + 5; i++) await openAs(made.token, 'NOPE', blocked);
  const link = await store.accounts().get<{ count: number }>('SELECT count FROM share_attempt WHERE key = ?', `${made.id}:all`);
  assert.equal(link?.count, share.ATTEMPTS_PER_IP, 'only the tries the address was allowed counted against the link');
});

test('a family arriving together is not locked out: correct passwords do not use up the link', async () => {
  const made = await makeLink();
  for (let i = 0; i < share.ATTEMPTS_PER_LINK + 5; i++) assert.equal((await openAs(made.token, made.password!, `192.0.2.${i}`)).result.status, 'ok', `relative ${i + 1}`);
  const link = await store.accounts().get<{ count: number }>('SELECT count FROM share_attempt WHERE key = ?', `${made.id}:all`);
  assert.equal(link?.count ?? 0, 0);
});

test('an unknown token costs no attempts and no hashing', async () => {
  await makeLink();
  await store.accounts().run('DELETE FROM share_attempt');
  assert.deepEqual((await openAs('B'.repeat(43), 'x')).result, { status: 'closed' });
  assert.deepEqual((await openAs('not-a-token', 'x')).result, { status: 'closed' });
  assert.equal((await store.accounts().get<{ n: number }>('SELECT count(*) AS n FROM share_attempt'))!.n, 0);
});

// ---------- what a guest can reach ----------

/** Where the server functions live. */
function serverFnFiles(from: string): string[] {
  return readdirSync(from).flatMap((name) => {
    const path = join(from, name);
    if (statSync(path).isDirectory()) return serverFnFiles(path);
    if (!/\.(ts|tsx)$/.test(name) || /\.test\./.test(name) || name === 'request.ts') return [];
    return readFileSync(path, 'utf8').includes('createServerFn(') ? [path] : [];
  });
}

/** The reads a guest may have. Adding one here is a decision: see requireReader in guard.server.ts. */
const GUEST_READS = new Set([
  'getGraph', 'getChronicle', 'getContacts', 'getPersonDetail', 'getResearchProjects', 'getResearchProject', 'getPersonResearch',
  'getHouseMeanings', 'getHouseTranslations', 'getHouseSettings', 'storyTranslations', 'getGallery', 'getPersonPhotos', 'aiStatus',
  'getPersonEvents', 'getEventPlaces', // life events: of the dead, and of the living unless the link protects them
  'getCookbook', 'getRecipe', // recipes are stories: read as the Chronicle is, and none of a living person when the link protects them
]);
/** Open to anyone: they check who is asking themselves, or hold nothing of a family's. */
const OPEN = new Set([
  'fetchSession', 'fetchMyFamilies', 'fetchInvite', 'fetchShareEntry', 'openShareLink', 'leaveGuestVisit', 'fetchRemindersAvailable', 'forgetThisDevice',
  // "Ask to join" is for guests by design; it gives them nothing to read but their own request (join.test.ts holds its rules).
  'fetchJoinState', 'fetchJoinPreview', 'joinOptions', 'sendJoinRequest', 'sendJoinWithPassword',
  // Which ways in the sign-in pages may offer, and whether an operator's reset link holds: no family, no account
  // (password.test.ts and methods.test.ts hold their rules).
  'fetchSignInMethods', 'fetchResetLink',
  // Stopping a "View as" preview ends this browser's preview, if it has one, and carries nothing (view-as.test.ts).
  'stopViewAs',
  // The server's own public pages (docs/hosting-many-families.md): its name and legal texts, and the two request forms anyone
  // may send. None reads a family (src/lib/operator/operator.test.ts holds their rules).
  'fetchPublicInstance', 'fetchLegal', 'sendFamilyRequest', 'sendDataRequest',
  // "New in Kindred" (src/lib/releases/): who reads the highlights ('everyone' for a guest) and the card, which a guest never
  // gets; the console's update dot, false for anyone but an operator. None reads a family (operator/insight.test.ts).
  'fetchReleaseReader', 'fetchReleaseCard', 'fetchUpdateDot',
  // The operator's announcements: nothing for anyone without an account, a guest included (src/lib/operator/policy.test.ts).
  'fetchMyAnnouncements',
]);
/** Everything a handler might read before its guard, so a failure can only be the guard's. */
const DATA = { tree: TREE, id: 'ada', person: 'ada', personId: 'ada', key: 'k', house: 'h', mediaKey: 'gallery/x.jpg', locale: 'en', format: 'gedcom', name: 'x', text: 'x', user: STEWARD, role: 'viewer', confirm: true, token: 'x', endpoint: 'https://x/y', opKey: 'abcdefgh', people: [], links: [], places: [], items: [], photos: [], title: 'x', body: 'x', project: 'p1' };

async function everyServerFn() {
  const found: { name: string; call: (o: unknown) => Promise<unknown> }[] = [];
  for (const file of serverFnFiles(resolve('src/lib'))) {
    const mod = await load<Record<string, unknown>>(`/${file.slice(resolve('.').length + 1).replace(/\\/g, '/')}`);
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === 'function' && (value as { isServerFn?: boolean }).isServerFn) found.push({ name, call: value as (o: unknown) => Promise<unknown> });
    }
  }
  return found;
}

test('a guest is refused on every server function that is not one of the allowed reads', async () => {
  const fns = await everyServerFn();
  assert.ok(fns.length > 100, `expected the whole app, found ${fns.length} functions`);
  const refused: string[] = [];
  for (const { name, call } of fns) {
    if (GUEST_READS.has(name) || OPEN.has(name)) continue;
    asGuest(guestOfTree);
    await assert.rejects(call({ data: DATA }), (e: Error & { code?: string; status?: number }) => {
      assert.equal(e.code, 'signed-out', `${name} must refuse a guest (got ${e.code}: ${e.message})`);
      assert.equal(e.status, 401, name);
      return true;
    }, `${name} let a guest through`);
    refused.push(name);
  }
  for (const write of ['saveStory', 'addStory', 'updatePersonFact', 'setMemberRole', 'createInvite', 'aiChatSend', 'aiChatLoad', 'setMyPerson', 'saveHouseSettings', 'makeShareLink', 'revokeShareLink']) {
    if (fns.some((f) => f.name === write)) assert.ok(refused.includes(write), `${write} was refused`);
  }
  // The family's feed (docs/feed.md) is the members': reading it, a person's posts, and writing, changing and removing one.
  for (const feed of ['getFeed', 'getPersonPosts', 'createPost', 'editPost', 'removePost', 'discardPostPictures']) assert.ok(refused.includes(feed), `${feed} was refused`);
});

test('the allowed reads work for a guest of this family and nobody else', async () => {
  const fns = await everyServerFn();
  for (const { name, call } of fns) {
    if (!GUEST_READS.has(name)) continue;
    asGuest(guestOfTree);
    await call({ data: DATA });
    asNobody();
    await assert.rejects(call({ data: DATA }), (e: Error & { status?: number }) => e.status === 401, `${name} refuses no session`);
    asGuest({ ...guestOfTree, tree: OTHER });
    await assert.rejects(call({ data: DATA }), (e: Error & { status?: number }) => e.status === 401, `${name} refuses a guest of another family`);
  }
});

test('a guest gets no AI: every feature is off, and the assistant is closed', async () => {
  const ai = await load<typeof import('../ai.functions.ts')>('/src/lib/ai.functions.ts');
  asGuest(guestOfTree);
  const status = await ai.aiStatus({ data: { tree: TREE } });
  assert.equal(status.configured, false);
  assert.ok(Object.values(status.features).every((on) => !on));
  await assert.rejects(ai.aiChatSend({ data: { tree: TREE, conv: '11111111-1111-4111-8111-111111111111', text: 'hello', locale: 'en' } }), (e: Error & { status?: number }) => e.status === 401);
});

test('a guest reads what a viewer reads: never a private field', async () => {
  const person = await load<typeof import('../person.functions.ts')>('/src/lib/person.functions.ts');
  asGuest(guestOfTree);
  const seen = JSON.stringify(await person.getPersonDetail({ data: { tree: TREE, id: 'ada' } }));
  assert.ok(!seen.includes('SECRET-DIAGNOSIS'), 'a guest never receives a private field');
  asSteward();
  assert.ok(JSON.stringify(await person.getPersonDetail({ data: { tree: TREE, id: 'ada' } })).includes('SECRET-DIAGNOSIS'), 'the control: the field exists');
});

test('media answers a guest of this family, nobody else, and a painted candidate never', async () => {
  const params = { tree: TREE, key: MEDIA_KEY };
  asGuest(guestOfTree);
  assert.equal((await get('media.$tree.$key', params)).status, 200, 'a guest may see gallery pictures');
  asNobody();
  assert.equal((await get('media.$tree.$key', params)).status, 401, 'nothing without a visit');
  asGuest({ ...guestOfTree, tree: OTHER });
  assert.equal((await get('media.$tree.$key', params)).status, 401, 'not another family’s guest');
  asGuest(guestOfTree);
  assert.equal((await get('paint.$tree.$key', { tree: TREE, key: 'x.png' })).status, 401, 'a guest never sees a painting waiting to be chosen');
  assert.equal((await get('research.$tree.$key', { tree: TREE, key: OPEN_DOC })).status, 404, 'research files go by role; this one does not exist');
  assert.equal((await get('export.$tree', { tree: TREE })).status, 400, 'bad format first');
});

test('an export is refused to a guest', async () => {
  const { Route } = await load<{ Route: { options: unknown } }>('/src/routes/api/export.$tree.ts');
  const { GET } = (Route.options as { server: { handlers: { GET: (c: { params: Record<string, string>; request: Request }) => Promise<Response> } } }).server.handlers;
  asGuest(guestOfTree);
  assert.equal((await GET({ params: { tree: TREE }, request: new Request('http://localhost/?format=gedcom') })).status, 401);
});

test('a backup is refused to a guest and to nobody, and a steward’s holds no personal item', async () => {
  asGuest(guestOfTree);
  assert.equal((await get('backup.$tree', { tree: TREE })).status, 401);
  asNobody();
  assert.equal((await get('backup.$tree', { tree: TREE })).status, 401);
  await dbs.db(TREE).run(`INSERT INTO person_field (id, person, type, label, value, visibility, owner) VALUES ('fp', 'ada', 'notes', '', '{"text":"MY-OWN-NOTE"}', 'personal', ?)`, STEWARD);
  asSteward();
  const res = await get('backup.$tree', { tree: TREE });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const text = await res.text();
  const backup = JSON.parse(text) as { tree: string; schema: string; tables: { table: string }[] };
  assert.equal(backup.tree, TREE);
  assert.match(backup.schema, /^\d{4}_/);
  assert.ok(backup.tables.some((t) => t.table === 'person'));
  assert.ok(!text.includes('MY-OWN-NOTE'), 'personal items stay out, as in a move to another install');
  await dbs.db(TREE).run("DELETE FROM person_field WHERE id = 'fp'");
});

test('private research stays hidden from a guest, file included', async () => {
  const d = dbs.db(TREE);
  await d.run("INSERT INTO research_project (id, title, created_by, created_at, updated_at) VALUES ('p9', 'Open project', 'x', '2026-01-01', '2026-01-01')");
  const doc = (id: string, name: string, priv: number) => d.run("INSERT INTO research_document (id, project, key, mime, size, title, private, created_by, created_at, updated_at) VALUES (?, 'p9', ?, 'application/pdf', 4, 'A document', ?, 'x', '2026-01-01', '2026-01-01')", id, `research/${name}`, priv);
  await doc('d9', PRIVATE_DOC, 1);
  await doc('d8', OPEN_DOC, 0);
  for (const name of [PRIVATE_DOC, OPEN_DOC]) await dbs.media.put(TREE, `research/${name}`, new Uint8Array([37, 80, 68, 70]), 'application/pdf');
  asGuest(guestOfTree);
  assert.equal((await get('research.$tree.$key', { tree: TREE, key: PRIVATE_DOC })).status, 404, 'a private document does not exist for a guest');
  assert.equal((await get('research.$tree.$key', { tree: TREE, key: OPEN_DOC })).status, 200, 'an open one is there');
  asSteward();
  assert.equal((await get('research.$tree.$key', { tree: TREE, key: PRIVATE_DOC })).status, 200, 'the control: a steward gets the private one');
});

test('guests do not appear as members and are no accounts', async () => {
  const made = await makeLink();
  const usersBefore = await store.userCount();
  await openAs(made.token, made.password!);
  assert.equal(await store.userCount(), usersBefore, 'no account was made');
  asSteward();
  const access = await authFns.fetchAccess({ data: { tree: TREE } });
  assert.equal(access.members.length, 1, 'only the steward');
  assert.equal(access.members[0].id, STEWARD);
});

test('only a steward manages the link', async () => {
  asGuest(guestOfTree);
  await assert.rejects(fns.fetchShareState({ data: { tree: TREE } }), (e: Error & { status?: number }) => e.status === 401);
  asNobody();
  await assert.rejects(fns.makeShareLink({ data: { tree: TREE, password: true, days: 7 } }), (e: Error & { status?: number }) => e.status === 401);
  const viewer = '00000000-0000-4000-8000-0000000000a2';
  await store.accounts().run('INSERT OR IGNORE INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', viewer, 'v', 'handle-v', Date.now());
  await store.accounts().run("INSERT OR IGNORE INTO membership (user, tree, role, created) VALUES (?, ?, 'editor', ?)", viewer, TREE, Date.now());
  g.__signedIn = { id: viewer, name: 'v' };
  await assert.rejects(fns.makeShareLink({ data: { tree: TREE, password: true, days: 7 } }), (e: Error & { status?: number }) => e.status === 403, 'editors manage people, not access');
  await assert.rejects(fns.revokeShareLink({ data: { tree: TREE } }), (e: Error & { status?: number }) => e.status === 403);
});

test('the session payload a guest gets is a viewer of one family, with no account', async () => {
  const made = await makeLink();
  const opened = await openAs(made.token, made.password!);
  asGuest((await realSession(opened.cookie)).guest);
  const s = await authFns.fetchSession();
  assert.equal(s.user, null);
  assert.deepEqual(s.memberships, [{ tree: TREE, role: 'viewer', person: null, personConfirmed: false }]);
  assert.equal(s.guest?.tree, TREE);
  const families = await authFns.fetchMyFamilies();
  assert.deepEqual(families.map((f) => f.id), [TREE], 'only their family');
});

// ---------- the guest host, for sites behind Cloudflare Access ----------

test('the guest host answers only what a guest needs', () => {
  for (const ok of ['/', '/share/abc', '/_serverFn/xyz', '/assets/app.js', '/api/health', '/api/photo/fam/p1', '/api/portrait/fam/p1', '/api/media/fam/a.jpg', '/api/research/fam/a.pdf', '/fam', '/fam/atlas', '/fam/chronicle', '/fam/house/h1', '/fam/person/p1', '/fam/PERSON/p1', '/favicon.svg']) {
    assert.equal(guestHost.guestHostAllows(ok), true, ok);
  }
  for (const no of ['/signin', '/setup', '/invite/abc', '/ui', '/api/auth/signout', '/api/export/fam', '/api/backup/fam', '/api/move/fam', '/api/paint/fam/a.png', '/fam/access', '/fam/new-section', '/fam/new-section/x', '/fam/persons/p1', '/fam/settings/ai', '/fam/settings/import', '/_not', '/api/other', '/Invite/abc', '/API/auth/signout', '/API/export/fam', '/fam/ACCESS', '/MODERN/Settings/Feedback', '/%69nvite/abc', '/fam/%41ccess', '/%E0%A4%A']) {
    assert.equal(guestHost.guestHostAllows(no), false, no);
  }
});

test('signing out also ends a guest visit in that browser and forgets it was one', async () => {
  const made = await makeLink();
  const { cookie } = await openAs(made.token, made.password!);
  assert.ok((await realSession(cookie)).guest, 'the visit is open');
  const set = await session.endAllSessions(new Request('http://localhost/', { headers: { cookie: `${cookie}; kindred_was_guest=1` } }));
  assert.ok(set.some((c) => c.startsWith('kindred_guest=;') && c.includes('Max-Age=0')), 'guest cookie cleared');
  assert.ok(set.some((c) => c.startsWith('kindred_was_guest=;') && c.includes('Max-Age=0')), 'was-guest marker cleared');
  assert.equal((await realSession(cookie)).guest, undefined, 'the visit is over on the server too');
});

test('on the guest host only a guest’s visit counts: never an account’s cookie', async () => {
  const made = await makeLink();
  const { cookie } = await openAs(made.token, made.password!);
  asSteward();
  const { token } = await store.createSession(STEWARD);
  process.env.KINDRED_GUEST_ORIGIN = 'https://guests.example.org';
  try {
    const url = 'https://guests.example.org/fam';
    assert.equal(origin.onGuestHost(new Request(url)), true);
    assert.equal(origin.onGuestHost(new Request('https://family.example.org/fam')), false);
    assert.equal(origin.originAllowed('https://guests.example.org', new Request(url)), true, 'the guest host’s own forms pass the CSRF check');
    assert.equal(origin.originAllowed('https://guests.example.org', new Request('https://family.example.org/x')), false, 'and only on its own host');
    assert.equal(origin.originAllowed('https://evil.example', new Request(url)), false);
    // The guest cookie on https is __Host-: rebuild it for this host.
    const guestCookie = `__Host-kindred_guest=${cookie!.split('=')[1]}; __Host-kindred_session=${token}`;
    const s = await session.getSession(new Request(url, { headers: { cookie: guestCookie } }), async () => 'someone@example.org', async () => []);
    assert.equal(s.user, null, 'a member’s session is ignored here');
    assert.equal(s.guest?.tree, TREE, 'a guest’s visit works');
  } finally {
    delete process.env.KINDRED_GUEST_ORIGIN;
  }
});

test('the migration runs by itself on a fresh database', () => {
  const d = new DatabaseSync(':memory:');
  d.exec(readFileSync('migrations/accounts/0015_share_link.sql', 'utf8'));
  d.prepare("INSERT INTO share_link (id, tree, token_hash, created) VALUES ('a', 't', 'x', 1)").run();
  assert.throws(() => d.prepare("INSERT INTO share_link (id, tree, token_hash, created) VALUES ('b', 't', 'y', 1)").run(), /UNIQUE/, 'one link per family');
  d.close();
});

// ---------- the limits behind a reverse proxy, and junk that must not spend them ----------

const PROXY = '172.18.0.3';
const resetLimits = () => (globalThis as unknown as { __kindredThrottle?: Map<string, number[]> }).__kindredThrottle?.clear();
/** A request that came through the proxy, which wrote `forwardedFor`. */
const viaProxy = (forwardedFor: string) => {
  g.__ip = PROXY;
  g.__request = new Request('http://localhost/', { headers: { 'x-forwarded-for': forwardedFor } });
};
/** A token in the right shape that is no link and no invitation. */
const unknownToken = () => tokens.randomToken(32);

test('behind a proxy that is not declared, one stranger uses up the limit for everyone (why the setting exists)', async () => {
  resetLimits();
  delete process.env.KINDRED_TRUSTED_PROXIES;
  const made = await makeLink();
  try {
    asNobody();
    viaProxy('198.51.100.66');
    for (let i = 0; i < 60; i++) await fns.openShareLink({ data: { token: unknownToken() } });
    viaProxy('192.0.2.10');
    assert.deepEqual((await fns.openShareLink({ data: { token: made.token, password: made.password! } })), { status: 'slow' }, 'a relative is stopped by the stranger');
  } finally {
    g.__request = undefined;
  }
});

test('with KINDRED_TRUSTED_PROXIES, each visitor has their own limit, and the address a visitor writes is not believed', async () => {
  resetLimits();
  process.env.KINDRED_TRUSTED_PROXIES = '1';
  const made = await makeLink();
  try {
    asNobody();
    // The stranger varies what they write themselves; the proxy appends their real address on the right.
    for (let i = 0; i < 60; i++) {
      viaProxy(`10.9.${i}.1, 198.51.100.66`);
      await fns.openShareLink({ data: { token: unknownToken() } });
    }
    viaProxy('10.9.99.1, 198.51.100.66');
    assert.deepEqual(await fns.openShareLink({ data: { token: made.token, password: made.password! } }), { status: 'slow' }, 'the stranger is limited');
    viaProxy('192.0.2.10');
    g.__setCookies = [];
    assert.equal((await fns.openShareLink({ data: { token: made.token, password: made.password! } })).status, 'ok', 'a relative is not');
  } finally {
    delete process.env.KINDRED_TRUSTED_PROXIES;
    g.__request = undefined;
  }
});

test('malformed tokens are refused before they count; tokens in the right shape still count', async () => {
  resetLimits();
  const made = await makeLink();
  asNobody();
  g.__ip = '198.51.100.70';
  for (let i = 0; i < 70; i++) {
    assert.deepEqual(await fns.openShareLink({ data: { token: 'junk' } }), { status: 'closed' });
    assert.deepEqual(await fns.fetchShareEntry({ data: { token: 'junk' } }), { status: 'closed' });
  }
  assert.deepEqual(await fns.fetchShareEntry({ data: { token: made.token } }), { status: 'open', password: true, measured: true });
  g.__setCookies = [];
  assert.equal((await fns.openShareLink({ data: { token: made.token, password: made.password! } })).status, 'ok');
  resetLimits();
  for (let i = 0; i < 60; i++) await fns.fetchShareEntry({ data: { token: unknownToken() } });
  assert.deepEqual(await fns.fetchShareEntry({ data: { token: made.token } }), { status: 'closed' }, 'guessing in the right shape is limited');
});

test('malformed invitation tokens do not use up the limit an invitee needs; guesses in the right shape do', async () => {
  resetLimits();
  asNobody();
  g.__ip = '198.51.100.71';
  const { token } = await store.createInvite({ tree: TREE, role: 'viewer', email: null, createdBy: STEWARD });
  for (let i = 0; i < 40; i++) assert.equal((await authFns.fetchInvite({ data: { token: 'not-a-token' } })).status, 'unknown');
  assert.equal((await authFns.fetchInvite({ data: { token } })).status, 'open');
  resetLimits();
  for (let i = 0; i < 30; i++) await authFns.fetchInvite({ data: { token: unknownToken() } });
  assert.equal((await authFns.fetchInvite({ data: { token } })).status, 'unknown', 'guessing in the right shape is limited');
});
