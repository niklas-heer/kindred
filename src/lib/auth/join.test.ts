// node --test src/lib/auth/join.test.ts — "Ask to join": who may ask, what a pending account can reach (nothing a guest could not),
// the limits, a steward's answer, expiry, the per-link switch, the push to stewards, and the measured guest visit. The real server
// code against scratch databases; only the framework around it (who is asking, createServerFn) and the passkey check are replaced.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-join-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
delete process.env.KINDRED_GUEST_ORIGIN;
delete process.env.KINDRED_ORIGIN;
delete process.env.KINDRED_AUTH;
delete process.env.KINDRED_TRUSTED_PROXIES;
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
      export const getRequestIP = () => '203.0.113.1';
      export const setResponseStatus = () => {};
      export const appendResponseHeader = (name, value) => { (globalThis.__setCookies ??= []).push(value); };
      export const getRequestHeader = () => undefined;`;
    if (id === STUB_SESSION) return `export const getSession = async () => ({ user: globalThis.__signedIn ?? null, via: globalThis.__signedIn ? 'passkey' : null, guest: globalThis.__guest });`;
    return undefined;
  },
};
const vite = await createServer({
  configFile: false, root: process.cwd(), logLevel: 'error', plugins: [framework], resolve: { alias: { '~': resolve('src') } },
  ssr: { noExternal: [/^@tanstack\/react-start/] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
});
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;

const store = await load<typeof import('./store.server.ts')>('/src/lib/auth/store.server.ts');
const dbs = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const share = await load<typeof import('./share.server.ts')>('/src/lib/auth/share.server.ts');
const j = await load<typeof import('./join.server.ts')>('/src/lib/auth/join.server.ts');
const fns = await load<typeof import('./join.functions.ts')>('/src/lib/auth/join.functions.ts');
const guardMod = await load<typeof import('./guard.server.ts')>('/src/lib/auth/guard.server.ts');
const statsStore = await load<typeof import('../stats/store.server.ts')>('/src/lib/stats/store.server.ts');
const webpush = await load<typeof import('../webpush.ts')>('/src/lib/webpush.ts');

const TREE = 'joining';
const OTHER = 'other-family';
const STEWARD = '00000000-0000-4000-8000-0000000000a1';
const MEMBER = '00000000-0000-4000-8000-0000000000a2';
const g = globalThis as unknown as { __signedIn?: { id: string; name: string } | null; __guest?: unknown; __setCookies?: string[]; __request?: Request };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DAY = 86_400_000;

const asSteward = () => { g.__signedIn = { id: STEWARD, name: 'steward' }; g.__guest = undefined; };
const asMember = () => { g.__signedIn = { id: MEMBER, name: 'member' }; g.__guest = undefined; };

let link: { id: string };
const guestOf = (l: { id: string } = link, tree = TREE) => ({ link: l.id, tree, expires: Date.now() + 3_600_000, protectLiving: true });
/** A new guest visit's cookie token (the share session's), as the password page gives it. */
const visit = () => randomBytes(32).toString('base64url');
/** A guest browser's request: a fresh visit unless the cookies name one. */
const req = (cookies: Record<string, string> = {}, extra: Record<string, string> = {}, url = 'http://localhost/joining') => {
  const all = { kindred_guest: visit(), ...cookies };
  return new Request(url, { headers: { 'user-agent': IPHONE, cookie: Object.entries(all).map(([k, v]) => `${k}=${v}`).join('; '), ...extra } });
};
const rules = await load<typeof import('./join-rules.ts')>('/src/lib/auth/join-rules.ts');

let credentialSeq = 0;
const fakeVerify = async () => ({ id: `cred-${++credentialSeq}`, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'], synced: false });

/** A guest asks, from a browser with these cookies. Returns the request's cookie token. */
async function ask(opts: { cookies?: Record<string, string>; ip?: string; person?: string | null; name?: string; guest?: ReturnType<typeof guestOf>; headers?: Record<string, string> } = {}) {
  const r = req(opts.cookies, opts.headers);
  const session = { user: null, guest: opts.guest ?? guestOf() };
  const { challengeId } = await j.joinOptions(r, session, TREE, { name: opts.name ?? 'Cleo Newcomer', person: opts.person === undefined ? 'bea' : opts.person, message: 'Hello!\nIt is me.', timeZone: 'Africa/Windhoek', language: 'af-NA' }, opts.ip ?? `198.51.100.${credentialSeq % 250}`);
  const done = await j.finishJoin(r, session, challengeId, {} as never, fakeVerify);
  const token = done.cookie.split(';')[0].split('=')[1];
  return { token, cookies: { kindred_join: token } };
}
const rowOf = async (token: string) => store.accounts().get<import('./join.server.ts').JoinRequestRow>('SELECT * FROM join_request WHERE browser = ?', await (await load<typeof import('./tokens.server.ts')>('/src/lib/auth/tokens.server.ts')).hashToken('join', token));

before(async () => {
  for (const [id, name] of [[TREE, 'Join Test'], [OTHER, 'Other']]) await dbs.provisionFamily(id, name);
  const d = dbs.db(TREE);
  await d.run("INSERT INTO person (id, given, living, born) VALUES ('ada', 'Ada', 1, '1950-01-02')");
  await d.run("INSERT INTO person (id, given, living, born) VALUES ('bea', 'Bea', 1, '1980-03-04')");
  for (const [id, name] of [[STEWARD, 'steward'], [MEMBER, 'member']]) await store.accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', id, name, `handle-${name}`, Date.now());
  await store.accounts().run("INSERT INTO membership (user, tree, role, person, created) VALUES (?, ?, 'steward', 'ada', ?)", STEWARD, TREE, Date.now());
  await store.accounts().run("INSERT INTO membership (user, tree, role, created) VALUES (?, ?, 'contributor', ?)", MEMBER, TREE, Date.now());
});
beforeEach(async () => {
  const a = store.accounts();
  await a.run('DELETE FROM user WHERE id IN (SELECT user FROM join_request)');
  await a.run('DELETE FROM join_request');
  await a.run('DELETE FROM guest_visitor');
  await a.run('DELETE FROM share_attempt');
  await a.run('DELETE FROM stats_setting');
  await a.run("DELETE FROM membership WHERE user NOT IN (?, ?)", STEWARD, MEMBER);
  await a.run("UPDATE membership SET person = NULL WHERE user = ?", MEMBER);
  link = await share.makeShareLink({ tree: TREE, password: true, days: 30, createdBy: STEWARD });
  // Replacing a link keeps the steward's choice; each test starts with it on.
  await share.setShareAskToJoin(TREE, true);
  (await load<typeof import('./throttle.server.ts')>('/src/lib/auth/throttle.server.ts')).resetThrottle();
  g.__request = undefined;
  g.__setCookies = [];
});
after(async () => {
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------- who may ask ----------

test('a guest may ask through an open link with Kindred sign-in; existing links have the switch on', async () => {
  const state = await j.joinState(req(), { user: null, guest: guestOf() }, TREE);
  assert.deepEqual(state, { available: true, request: null });
  assert.equal((await share.shareLinkOf(TREE))!.ask_to_join, 1);
});

test('nobody but a guest of this family through its link may ask', async () => {
  const input = { name: 'X', person: null };
  const refused = (p: Promise<unknown>, key = 'join.err_unavailable') => assert.rejects(p, (e: Error) => e.message === key);
  await refused(j.joinOptions(req(), { user: null, guest: undefined }, TREE, input, '1.1.1.1'));
  await refused(j.joinOptions(req(), { user: { id: STEWARD } as never, guest: guestOf() }, TREE, input, '1.1.1.1'));
  await refused(j.joinOptions(req(), { user: null, guest: guestOf(link, OTHER) }, TREE, input, '1.1.1.1'));
  await refused(j.joinOptions(req(), { user: null, guest: guestOf({ id: 'stale-link' }) }, TREE, input, '1.1.1.1'));
  await refused(j.joinOptions(req(), { user: null, guest: guestOf() }, TREE, { name: 'X', person: 'nobody-here' }, '1.1.1.1'), 'join.err_person');
});

test('the per-link switch, the guest host and Cloudflare Access each close the door', async () => {
  asSteward();
  await fns.setAskToJoin({ data: { tree: TREE, on: false } });
  assert.deepEqual(await j.joinState(req(), { user: null, guest: guestOf() }, TREE), { available: false, request: null });
  await fns.setAskToJoin({ data: { tree: TREE, on: true } });
  asMember();
  await assert.rejects(fns.setAskToJoin({ data: { tree: TREE, on: false } }), (e: { code?: string }) => e.code === 'forbidden', 'only a steward switches it');

  process.env.KINDRED_GUEST_ORIGIN = 'http://guests.localhost';
  try {
    assert.equal((await j.joinState(req({}, {}, 'http://guests.localhost/joining'), { user: null, guest: guestOf() }, TREE)).available, false, 'the guest host has no sign-in');
  } finally { delete process.env.KINDRED_GUEST_ORIGIN; }
  process.env.KINDRED_AUTH = 'cloudflare-access';
  process.env.CF_ACCESS_TEAM_DOMAIN = 'https://team.cloudflareaccess.com';
  process.env.CF_ACCESS_AUD = 'aud';
  try {
    assert.equal((await j.joinState(req(), { user: null, guest: guestOf() }, TREE)).available, false, 'only with Kindred’s own sign-in');
  } finally { delete process.env.KINDRED_AUTH; delete process.env.CF_ACCESS_TEAM_DOMAIN; delete process.env.CF_ACCESS_AUD; }
});

// ---------- the pending account ----------

test('a request makes a pending account with a passkey and no membership; only hashes are stored', async () => {
  const { token } = await ask();
  const row = await rowOf(token);
  assert.ok(row, 'the request is found by the cookie’s hash');
  assert.notEqual(row.browser, token);
  assert.ok(!JSON.stringify(row).includes(token), 'the cookie’s token is not stored');
  assert.equal(row.status, 'open');
  assert.equal(row.person, 'bea');
  assert.equal(row.message, 'Hello!\nIt is me.');
  assert.equal(row.device, 'iPhone, Safari');
  assert.equal(row.time_zone, 'Africa/Windhoek');
  assert.equal(row.language, 'af-NA');
  assert.equal(row.country, null, 'Node knows no place');
  assert.ok(!JSON.stringify(row).includes('198.51.100'), 'no address is kept');
  assert.ok(row.expires - row.created === 30 * DAY);
  assert.equal((await store.membershipsOf(row.user)).length, 0);
  assert.equal((await store.credentialsOf(row.user)).length, 1);
  assert.equal(await j.signInAllowed(row.user), 'pending', 'the sign-in route refuses it');
});

test('a pending account reaches nothing a guest could not already read', async () => {
  const { token } = await ask();
  const row = (await rowOf(token))!;
  const pending = (await store.userById(row.user))!;
  // Even if it somehow had a session on the main site, without the share visit it is no member of anything.
  g.__signedIn = pending; g.__guest = undefined;
  await assert.rejects(guardMod.requireReader(TREE), (e: { code?: string }) => e.code === 'not-member');
  await assert.rejects(guardMod.requireMember(TREE), (e: { code?: string }) => e.code === 'not-member');
  await assert.rejects(fns.fetchJoinRequests({ data: { tree: TREE } }), (e: { code?: string }) => e.code === 'not-member');
  // With the share visit it is a guest, as before: a viewer's reads, protected.
  g.__guest = guestOf();
  const reader = await guardMod.requireReader(TREE);
  assert.equal(reader.guest, true);
  assert.equal(reader.role, 'viewer');
  assert.equal(reader.protectLiving, true);
});

test('one browser sends one request: by its request cookie, by its visit, and by its visitor cookie', async () => {
  const here = visit();
  const first = await ask({ cookies: { kindred_guest: here } });
  await assert.rejects(ask({ cookies: { ...first.cookies, kindred_guest: visit() } }), (e: Error) => e.message === 'join.err_already');
  await assert.rejects(ask({ cookies: { kindred_guest: here } }), (e: Error) => e.message === 'join.err_already', 'dropping the request cookie does not help in the same visit');
  // A visitor cookie the link knows counts in any later visit; one the browser made up is no visitor at all.
  const elsewhere = visit();
  const set = await j.recordGuestUsage(req({ kindred_guest: elsewhere }), guestOf(), batch(), { active: 10, people: [] });
  const known = set!.split(';')[0].split('=')[1];
  await ask({ cookies: { kindred_guest: elsewhere, kindred_visitor: 'V'.repeat(43) } });
  await assert.rejects(ask({ cookies: { kindred_visitor: known } }), (e: Error) => e.message === 'join.err_already');
  const state = await j.joinState(req(first.cookies), { user: null, guest: guestOf() }, TREE);
  assert.equal(state.request?.status, 'open', 'the browser sees its request waiting');
  assert.equal(state.available, false);
});

test(`a link holds at most ${rules.MAX_OPEN_PER_LINK} open requests, also when they race`, async () => {
  const max = rules.MAX_OPEN_PER_LINK;
  for (let i = 0; i < max - 1; i++) await ask({ name: `Guest ${i}`, ip: `192.0.2.${i}` });
  // Two browsers start one below the limit; both finish: only one fits.
  const session = { user: null, guest: guestOf() };
  const a = await j.joinOptions(req(), session, TREE, { name: 'A', person: null }, '198.18.0.100');
  const b = await j.joinOptions(req(), session, TREE, { name: 'B', person: null }, '198.18.0.101');
  await j.finishJoin(req(), session, a.challengeId, {} as never, fakeVerify);
  await assert.rejects(j.finishJoin(req(), session, b.challengeId, {} as never, fakeVerify), (e: Error) => e.message === 'join.err_full');
  await assert.rejects(ask({ ip: '198.18.0.102' }), (e: Error) => e.message === 'join.err_full');
  assert.equal((await store.accounts().get<{ n: number }>("SELECT count(*) AS n FROM join_request WHERE status = 'open'"))!.n, max);
  assert.equal((await store.accounts().get<{ n: number }>('SELECT count(*) AS n FROM user'))!.n, max + 2, 'the refused one left no account behind');
});

test('a family of twelve can ask from one home on one evening; one person clearing cookies stops there, and cannot fill the link from two homes', async () => {
  const n = rules.MAX_OPEN_PER_NETWORK;
  assert.ok(n >= 12 && rules.JOINS_PER_IP >= 12, 'twelve fit in one window from one address');
  for (let i = 0; i < n; i++) await ask({ name: `Cousin ${i}`, ip: '203.0.113.7' });
  await assert.rejects(ask({ ip: '203.0.113.7' }), (e: Error) => e.message === 'join.err_network');
  // IPv6: every address in the home's /64 is the same home.
  for (let i = 0; i < n; i++) await ask({ name: `Nephew ${i}`, ip: `2001:db8:5:7::${i + 1}` });
  await assert.rejects(ask({ ip: '2001:db8:5:7:ffff::9' }), (e: Error) => e.message === 'join.err_network');
  assert.ok(2 * n < rules.MAX_OPEN_PER_LINK, 'two homes leave room for the family');
  await ask({ name: 'Real relative', ip: '198.51.100.200' });
  // The check holds when the ceremony finishes too, and approving clears what was kept of the network and makes room for the next.
  const rows = await store.accounts().all<{ network: string | null }>("SELECT network FROM join_request WHERE status = 'open'");
  assert.equal(new Set(rows.map((r) => r.network)).size, 3);
  assert.ok(rows.every((r) => r.network && r.network.length === 3 && !r.network.includes('203')), 'a short hash, not the address');
  asSteward();
  const r = (await fns.fetchJoinRequests({ data: { tree: TREE } })).requests.find((x) => x.name === 'Cousin 0')!;
  await fns.approveJoinRequest({ data: { tree: TREE, id: r.id, role: 'viewer', person: null } });
  assert.equal((await store.accounts().get<{ network: string | null }>('SELECT network FROM join_request WHERE id = ?', r.id))!.network, null);
  await ask({ name: 'Cousin again', ip: '203.0.113.7' });
});

test('the network is also checked as the ceremony finishes', async () => {
  const n = rules.MAX_OPEN_PER_NETWORK;
  const session = { user: null, guest: guestOf() };
  for (let i = 0; i < n - 1; i++) await ask({ name: `Cousin ${i}`, ip: '203.0.113.8' });
  const a = await j.joinOptions(req(), session, TREE, { name: 'A', person: null }, '203.0.113.8');
  const b = await j.joinOptions(req(), session, TREE, { name: 'B', person: null }, '203.0.113.8');
  await j.finishJoin(req(), session, a.challengeId, {} as never, fakeVerify);
  await assert.rejects(j.finishJoin(req(), session, b.challengeId, {} as never, fakeVerify));
  assert.equal((await store.accounts().get<{ n: number }>("SELECT count(*) AS n FROM join_request WHERE status = 'open'"))!.n, n);
});

test('starting requests is limited per address in the database, like the password tries', async () => {
  const session = { user: null, guest: guestOf() };
  for (let i = 0; i < rules.JOINS_PER_IP; i++) await j.joinOptions(req(), session, TREE, { name: 'X', person: null }, '203.0.113.50');
  await assert.rejects(j.joinOptions(req(), session, TREE, { name: 'X', person: null }, '203.0.113.50'), (e: Error & { code?: string }) => e.message === 'join.err_slow' && e.code === 'throttled');
  await j.joinOptions(req(), session, TREE, { name: 'X', person: null }, '203.0.113.51');
  const rows = await store.accounts().all<{ key: string }>('SELECT key FROM share_attempt');
  assert.ok(rows.every((r) => !r.key.includes('203.0.113')), 'the address is hashed');
});

test('a challenge is used once, and only by a guest still on that link', async () => {
  const session = { user: null, guest: guestOf() };
  const { challengeId } = await j.joinOptions(req(), session, TREE, { name: 'X', person: null }, '1.2.3.4');
  await share.makeShareLink({ tree: TREE, password: true, days: 30, createdBy: STEWARD });
  link = (await share.shareLinkOf(TREE))!;
  // The link was replaced: the old visit's session would have ended; one that somehow remained still has the same link id,
  // so the switch is what is checked here.
  await store.accounts().run('UPDATE share_link SET ask_to_join = 0 WHERE tree = ?', TREE);
  await assert.rejects(j.finishJoin(req(), session, challengeId, {} as never, fakeVerify), (e: Error) => e.message === 'join.err_unavailable');
  await assert.rejects(j.finishJoin(req(), session, challengeId, {} as never, fakeVerify), (e: Error) => e.message === 'That took too long. Please try again.');
});

// ---------- the steward's answer ----------

test('only a steward reads requests; the card warns when a member already stands for that person', async () => {
  await store.accounts().run("UPDATE membership SET person = 'bea' WHERE user = ?", MEMBER);
  await ask();
  asMember();
  await assert.rejects(fns.fetchJoinRequests({ data: { tree: TREE } }), (e: { code?: string }) => e.code === 'forbidden');
  g.__signedIn = null; g.__guest = guestOf();
  await assert.rejects(fns.fetchJoinRequests({ data: { tree: TREE } }), (e: { code?: string }) => e.code === 'signed-out');
  asSteward();
  const { requests } = await fns.fetchJoinRequests({ data: { tree: TREE } });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].claimedBy, [{ id: MEMBER, name: 'member' }]);
  assert.equal(requests[0].device, 'iPhone, Safari');
  assert.equal(requests[0].place, null);
  assert.equal((await (await load<typeof import('../ai/background.server.ts')>('/src/lib/ai/background.server.ts')).attentionParts(TREE)).access, 2, 'it counts on the badge, beside the member’s unconfirmed "this is me"');
});

test('approving makes a member with the chosen role and person, clears the details, and lets the passkey sign in, even after the link ended', async () => {
  const { token, cookies } = await ask();
  await share.revokeShareLink(TREE);
  asSteward();
  const [r] = (await fns.fetchJoinRequests({ data: { tree: TREE } })).requests;
  await assert.rejects(fns.approveJoinRequest({ data: { tree: TREE, id: r.id, role: 'contributor', person: 'nobody' } }), (e: Error) => e.message === 'join.err_person');
  asMember();
  await assert.rejects(fns.approveJoinRequest({ data: { tree: TREE, id: r.id, role: 'steward', person: null } }), (e: { code?: string }) => e.code === 'forbidden');
  asSteward();
  await fns.approveJoinRequest({ data: { tree: TREE, id: r.id, role: 'contributor', person: 'ada' } });
  const row = (await rowOf(token))!;
  assert.equal(row.status, 'approved');
  assert.equal(row.message, null);
  assert.equal(row.device, null);
  assert.equal(row.usage, null);
  const m = await store.membership(row.user, TREE);
  assert.equal(m?.role, 'contributor');
  assert.equal(m?.person, 'ada');
  assert.equal(m?.person_confirmed, 1, 'the steward confirmed who they are');
  const state = await j.joinState(req(cookies), { user: null, guest: guestOf() }, TREE);
  assert.equal(state.request?.status, 'approved', 'the asking browser learns the answer');
  await assert.rejects(fns.approveJoinRequest({ data: { tree: TREE, id: r.id, role: 'steward', person: null } }), (e: Error) => e.message === 'join.err_gone', 'only once');
  assert.equal(await j.signInAllowed(row.user), 'ok');
  assert.equal(await rowOf(token), undefined, 'the first sign-in ends the request');
  assert.equal(await store.stewardCount(TREE), 1, 'the stewards are unchanged');
});

test('declining deletes the request, the pending account and its passkey', async () => {
  const { token } = await ask();
  const row = (await rowOf(token))!;
  asSteward();
  await fns.declineJoinRequest({ data: { tree: TREE, id: row.id } });
  assert.equal(await store.userById(row.user), undefined);
  assert.equal((await store.credentialsOf(row.user)).length, 0);
  assert.equal(await rowOf(token), undefined);
  await assert.rejects(fns.declineJoinRequest({ data: { tree: TREE, id: row.id } }), (e: Error) => e.message === 'join.err_gone');
  assert.deepEqual(await j.joinState(req({ kindred_join: token }), { user: null, guest: guestOf() }, TREE), { available: true, request: null });
});

test('a steward of another family cannot answer this family’s requests', async () => {
  const { token } = await ask();
  const row = (await rowOf(token))!;
  await store.accounts().run("INSERT INTO membership (user, tree, role, created) VALUES (?, ?, 'steward', ?)", MEMBER, OTHER, Date.now());
  try {
    asMember();
    await assert.rejects(fns.approveJoinRequest({ data: { tree: OTHER, id: row.id, role: 'viewer', person: null } }), (e: Error) => e.message === 'join.err_gone');
    await assert.rejects(fns.declineJoinRequest({ data: { tree: OTHER, id: row.id } }), (e: Error) => e.message === 'join.err_gone');
    assert.equal((await rowOf(token))?.status, 'open');
  } finally {
    await store.accounts().run('DELETE FROM membership WHERE user = ? AND tree = ?', MEMBER, OTHER);
  }
});

test('a request expires after 30 days, and its account and passkey go with it', async () => {
  const { token } = await ask();
  const row = (await rowOf(token))!;
  await store.accounts().run('UPDATE join_request SET expires = ? WHERE id = ?', Date.now() - 1, row.id);
  assert.equal(await j.signInAllowed(row.user), 'expired');
  asSteward();
  assert.equal((await fns.fetchJoinRequests({ data: { tree: TREE } })).requests.length, 0);
  assert.equal(await store.userById(row.user), undefined);
  assert.equal((await store.credentialsOf(row.user)).length, 0);
});

// ---------- telling the stewards ----------

test('stewards with reminders on get a push; other members do not', async () => {
  const b64 = webpush.b64url;
  const device = async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    return { p256dh: b64(await crypto.subtle.exportKey('raw', kp.publicKey)), auth: b64(crypto.getRandomValues(new Uint8Array(16))) };
  };
  const signer = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const vapid = { publicKey: b64(await crypto.subtle.exportKey('raw', signer.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', signer.privateKey), subject: 'mailto:test@example.org' };
  for (const [user, endpoint] of [[STEWARD, 'https://fcm.googleapis.com/fcm/send/steward'], [MEMBER, 'https://fcm.googleapis.com/fcm/send/member']]) {
    const k = await device();
    await store.accounts().run(`INSERT INTO push_subscription (id, user, tree, endpoint, p256dh, auth, offsets, kinds, locale, created, last_seen) VALUES (?, ?, ?, ?, ?, ?, '[0]', '["birthday"]', 'de', ?, ?)`,
      crypto.randomUUID(), user, TREE, endpoint, k.p256dh, k.auth, Date.now(), Date.now());
  }
  const sent: string[] = [];
  const fakeFetch = (async (url: string) => { sent.push(url); return new Response(null, { status: 201 }); }) as unknown as typeof fetch;
  assert.equal(await j.notifyStewards(TREE, 'Cleo', vapid, fakeFetch), 1);
  assert.deepEqual(sent, ['https://fcm.googleapis.com/fcm/send/steward']);
  assert.equal(await j.notifyStewards(TREE, 'Cleo', null, fakeFetch), 0, 'without VAPID keys nothing is sent');
  await store.accounts().run('DELETE FROM push_subscription');
});

// ---------- the measured visit ----------

const batch = (extra: object = {}) => ({ tree: TREE, visit: true, views: { tree: 2, atlas: 1 }, events: {}, ...extra });

test('a guest browser’s use of the link is kept as totals under a hashed cookie, and copied into its request', async () => {
  const first = await j.recordGuestUsage(req(), guestOf(), batch(), { active: 60, people: ['ada'] });
  assert.ok(first, 'the browser gets its visitor cookie');
  assert.match(first, /^kindred_visitor=[A-Za-z0-9_-]{43}; .*HttpOnly; SameSite=Lax/);
  const token = first.split(';')[0].split('=')[1];
  assert.equal(await j.recordGuestUsage(req({ kindred_visitor: token }), guestOf(), batch({ visit: false }), { active: 30, people: ['bea', 'ada'] }), undefined);
  const rows = await store.accounts().all<Record<string, unknown>>('SELECT * FROM guest_visitor');
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].hash, token);
  assert.equal(rows[0].visits, 1);
  assert.equal(rows[0].active_seconds, 90);
  assert.deepEqual(JSON.parse(rows[0].sections as string), { tree: 4, atlas: 2 });
  assert.deepEqual(JSON.parse(rows[0].people as string), { ada: 2, bea: 1 });
  assert.equal(Object.keys(rows[0]).some((k) => /ip|address|path|url/i.test(k)), false, 'no address and no page log');

  const preview = await j.joinPreview(req({ kindred_visitor: token }), { user: null, guest: guestOf() }, TREE);
  assert.equal(preview.usage?.visits, 1);
  assert.equal(preview.device, 'iPhone, Safari');
  const asked = await ask({ cookies: { kindred_visitor: token } });
  const row = (await rowOf(asked.token))!;
  assert.deepEqual(JSON.parse(row.usage!), preview.usage, 'the stewards get exactly what the preview showed');
});

test('a visit makes one usage row at most, whatever cookies the browser sends or leaves out', async () => {
  const here = visit();
  const count = async () => (await store.accounts().get<{ n: number }>('SELECT count(*) AS n FROM guest_visitor'))!.n;
  const cookie = await j.recordGuestUsage(req({ kindred_guest: here }), guestOf(), batch(), { active: 5, people: [] });
  assert.ok(cookie);
  for (let i = 0; i < 5; i++) await j.recordGuestUsage(req({ kindred_guest: here }), guestOf(), batch(), { active: 5, people: [] });
  for (let i = 0; i < 5; i++) await j.recordGuestUsage(req({ kindred_guest: here, kindred_visitor: visit() }), guestOf(), batch(), { active: 5, people: [] });
  assert.equal(await count(), 1, 'no cookie and invented cookies are the same visitor');
  assert.equal((await store.accounts().get<{ visits: number }>('SELECT visits FROM guest_visitor'))!.visits, 11);
  // Without a visit there is nobody to count.
  const bare = new Request('http://localhost/joining', { headers: { 'user-agent': IPHONE } });
  assert.equal(await j.recordGuestUsage(bare, guestOf(), batch(), { active: 5, people: [] }), undefined);
  assert.equal(await count(), 1);
});

test(`a link keeps the usage of ${rules.MAX_VISITORS_PER_LINK} browsers at most, dropping those idle longest`, async () => {
  const max = rules.MAX_VISITORS_PER_LINK;
  const t = Date.now() - DAY;
  await store.accounts().batch(Array.from({ length: max }, (_, i) =>
    store.q('INSERT INTO guest_visitor (hash, link, tree, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)', `old-${i}`, link.id, TREE, t, t + i)));
  await j.recordGuestUsage(req(), guestOf(), batch(), { active: 5, people: [] });
  const rows = await store.accounts().all<{ hash: string }>('SELECT hash FROM guest_visitor WHERE link = ?', link.id);
  assert.equal(rows.length, max);
  assert.ok(!rows.some((r) => r.hash === 'old-0'), 'the one idle longest went');
  assert.ok(rows.some((r) => r.hash === 'old-1'));
});

test('Do Not Track, Global Privacy Control, statistics off and a closed door mean nothing is measured', async () => {
  assert.equal(await j.recordGuestUsage(req({}, { dnt: '1' }), guestOf(), batch(), { active: 60, people: [] }), undefined);
  assert.equal(await j.recordGuestUsage(req({}, { 'sec-gpc': '1' }), guestOf(), batch(), { active: 60, people: [] }), undefined);
  await statsStore.setCollecting(TREE, false);
  assert.equal(await j.recordGuestUsage(req(), guestOf(), batch(), { active: 60, people: [] }), undefined);
  await statsStore.setCollecting(TREE, true);
  await share.setShareAskToJoin(TREE, false);
  assert.equal(await j.recordGuestUsage(req(), guestOf(), batch(), { active: 60, people: [] }), undefined);
  await share.setShareAskToJoin(TREE, true);
  assert.equal((await store.accounts().get<{ n: number }>('SELECT count(*) AS n FROM guest_visitor'))!.n, 0);
});

test('usage goes when the link is replaced or turned off, and 90 days after the last visit; requests stay', async () => {
  await j.recordGuestUsage(req(), guestOf(), batch(), { active: 0, people: [] });
  await ask();
  await share.makeShareLink({ tree: TREE, password: true, days: 30, createdBy: STEWARD });
  assert.equal((await store.accounts().get<{ n: number }>('SELECT count(*) AS n FROM guest_visitor'))!.n, 0, 'replaced');
  assert.equal((await store.accounts().get<{ n: number }>('SELECT count(*) AS n FROM join_request'))!.n, 1, 'the request stays for the stewards');
  await j.recordGuestUsage(req(), guestOf(), batch(), { active: 0, people: [] });
  await share.revokeShareLink(TREE);
  assert.equal((await store.accounts().get<{ n: number }>('SELECT count(*) AS n FROM guest_visitor'))!.n, 0, 'turned off');
  link = await share.makeShareLink({ tree: TREE, password: true, days: 30, createdBy: STEWARD });
  await j.recordGuestUsage(req(), guestOf(), batch(), { active: 0, people: [] }, Date.now() - 91 * DAY);
  await j.pruneJoin();
  assert.equal((await store.accounts().get<{ n: number }>('SELECT count(*) AS n FROM guest_visitor'))!.n, 0, '90 days');
});

// ---------- asking with a password ----------

test('with passwords on, a guest asks with a username and password; the pending account cannot sign in until a steward says yes', async () => {
  const pw = await load<typeof import('./password.server.ts')>('/src/lib/auth/password.server.ts');
  const a = store.accounts();
  await assert.rejects(j.joinWithPassword(req(), { user: null, guest: guestOf() }, TREE, { name: 'Dora Newcomer', person: null, username: 'dora', password: 'a long evening walk' }, '198.51.100.70'),
    (e: Error) => e.message === 'pw.err.method_off', 'refused while the operator offers passkeys only');
  await a.run("INSERT INTO instance_setting (key, value, updated_at) VALUES ('auth_methods', '[\"passkey\",\"password\"]', 0)");
  try {
    await assert.rejects(j.joinWithPassword(req(), { user: null, guest: guestOf() }, TREE, { name: 'Dora Newcomer', person: null, username: 'dora', password: 'password1234' }, '198.51.100.70'),
      (e: Error) => e.message === 'pw.err.common');
    const done = await j.joinWithPassword(req(), { user: null, guest: guestOf() }, TREE, { name: 'Dora Newcomer', person: null, username: 'Dora', password: 'a long evening walk' }, '198.51.100.71');
    assert.equal(done.tree, TREE);
    const row = (await a.get<{ user: string; status: string }>("SELECT user, status FROM join_request WHERE name = 'Dora Newcomer'"))!;
    assert.equal(row.status, 'open');
    assert.equal((await store.userById(row.user))!.username, 'dora');
    assert.deepEqual(await store.membershipsOf(row.user), [], 'no family until a steward says yes');
    // The password is right, but the sign-in route refuses the pending account (as it does a passkey's).
    assert.equal((await pw.passwordSignIn(new Request('http://localhost/api/auth/password-signin'), { username: 'dora', password: 'a long evening walk' }, { ip: '198.51.100.72' })).kind, 'session');
    assert.equal(await j.signInAllowed(row.user), 'pending');
  } finally {
    await a.run("DELETE FROM instance_setting WHERE key = 'auth_methods'");
  }
});
