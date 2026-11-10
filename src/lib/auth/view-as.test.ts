// node --test src/lib/auth/view-as.test.ts — "View as": who may start a preview; that the previewed reader replaces the
// steward in every check (role, member, guest); that a preview writes nothing (through `once`, the store, the media store, a
// function that writes without `once`, and the AI adapters) while other sessions write as usual and Stop still works; that it
// leaves no trace; that the account stays the steward's and no member's own state reaches them; and that it ends by itself,
// on sign-out, and when the member, the link or the stewardship goes. Real server functions on scratch databases; only the
// framework around them is replaced (who is asking, and createServerFn).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-viewas-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'view-as-test-secret';
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
    // The session as the real code resolves it, minus the cookie lookup: the test says who is signed in.
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

const store = await load<typeof import('./store.server.ts')>('/src/lib/auth/store.server.ts');
const dbs = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const guard = await load<typeof import('./guard.server.ts')>('/src/lib/auth/guard.server.ts');
const viewAs = await load<typeof import('./view-as.functions.ts')>('/src/lib/auth/view-as.functions.ts');
const viewAsServer = await load<typeof import('./view-as.server.ts')>('/src/lib/auth/view-as.server.ts');
const share = await load<typeof import('./share.server.ts')>('/src/lib/auth/share.server.ts');
const authFns = await load<typeof import('./functions.ts')>('/src/lib/auth/functions.ts');
const shareFns = await load<typeof import('./share.functions.ts')>('/src/lib/auth/share.functions.ts');
const session = await load<typeof import('./session.server.ts')>('/src/lib/auth/session.server.ts');
const api = await load<typeof import('../api.ts')>('/src/lib/api.ts');
const person = await load<typeof import('../person.functions.ts')>('/src/lib/person.functions.ts');
const history = await load<typeof import('../history.functions.ts')>('/src/lib/history.functions.ts');
const today = await load<typeof import('../today/today.functions.ts')>('/src/lib/today/today.functions.ts');
const responses = await load<typeof import('../responses.functions.ts')>('/src/lib/responses.functions.ts');
const families = await load<typeof import('../families.functions.ts')>('/src/lib/families.functions.ts');
const join_ = await load<typeof import('./join.functions.ts')>('/src/lib/auth/join.functions.ts');
const ai = await load<typeof import('../ai/settings.server.ts')>('/src/lib/ai/settings.server.ts');
const historyServer = await load<typeof import('../history.server.ts')>('/src/lib/history.server.ts');
const readOnly = await load<typeof import('../read-only.ts')>('/src/lib/read-only.ts');

const TREE = 'viewing';
const OTHER = 'elsewhere';
const STEWARD = '00000000-0000-4000-8000-0000000000a1';
const MEMBER = '00000000-0000-4000-8000-0000000000b2';
const VIEWER = '00000000-0000-4000-8000-0000000000c3';
const SESSION_HASH = 'steward-session-hash';

type Who = { user: { id: string; name: string; locale: null; email: null; handle: string; created: number; last_seen: number | null } | null; via: string | null; sessionHash?: string; guest?: unknown };
const g = globalThis as unknown as { __session?: Who; __request?: Request; __setCookies?: string[] };
const userRow = (id: string, name: string) => ({ id, name, locale: null, email: null, handle: `h-${id}`, created: 0, last_seen: Date.now() });

let cookie: string | undefined;
/** A new request, as a browser holding `cookie` (this test's preview cookie, if any) signed in as `who`. */
function request(who: Who | undefined, withCookie: string | null | undefined = cookie) {
  g.__session = who;
  g.__setCookies = [];
  g.__request = new Request('http://localhost/', { headers: withCookie ? { cookie: withCookie } : {} });
}
const steward = (withCookie: string | null | undefined = cookie) => request({ user: userRow(STEWARD, 'Stella Steward'), via: 'passkey', sessionHash: SESSION_HASH }, withCookie);
const asMember = () => request({ user: userRow(MEMBER, 'Milo Member'), via: 'passkey', sessionHash: 'member-session' }, null);
const outside = () => { g.__request = undefined; g.__session = undefined; };

/** Starts a preview as the steward and keeps the cookie it set. */
async function start(choice: Parameters<typeof viewAs.startViewAs>[0]['data']['choice'], tree = TREE) {
  steward();
  await viewAs.startViewAs({ data: { tree, choice } });
  const set = g.__setCookies!.findLast((c) => /^kindred_view_as=[^;]/.test(c));
  assert.ok(set, 'the start sets the preview cookie');
  assert.match(set, /HttpOnly/);
  cookie = set.split(';')[0];
}
async function stop() {
  steward();
  await viewAs.stopViewAs({});
  cookie = undefined;
}
const rows = async (sql: string, ...p: (string | number)[]) => (await store.accounts().get<{ n: number }>(sql, ...p))!.n;
const previews = () => rows('SELECT count(*) AS n FROM view_as');
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const refusedAsPreview = (e: unknown) => /Stop the preview to change something\.$/.test(message(e));

before(async () => {
  for (const [id, name] of [[TREE, 'Viewing Family'], [OTHER, 'Elsewhere']]) await dbs.provisionFamily(id, name);
  const d = dbs.db(TREE);
  await d.run("INSERT INTO person (id, given, surname, living, born, born_place) VALUES ('milo', 'Milo', 'Member', 1, '1980-04-02', 'Uppsala')");
  await d.run("INSERT INTO person (id, given, surname, living, born) VALUES ('old', 'Olga', 'Old', 0, '1890')");
  await d.run(`INSERT INTO person_field (id, person, type, label, value, visibility, owner, created_by) VALUES ('mine', 'old', 'notes', 'Note', '{"text":"MILO-PRIVATE-NOTE"}', 'personal', ?, ?)`, MEMBER, MEMBER);
  await d.run(`INSERT INTO person_field (id, person, type, label, value, visibility) VALUES ('ed', 'old', 'notes', 'Note', '{"text":"EDITORS-ONLY"}', 'editors')`);
  await d.run("INSERT INTO story (id, person, kind, body, author, at) VALUES ('s1', 'old', 'memory', 'A summer by the lake.', 'Milo', '2026-01-01')");
  // Enough of a family for the daily quiz to draw a question: three generations with dates, places and two marriages.
  for (let i = 0; i < 8; i++) await d.run('INSERT INTO place (name, lat, lng) VALUES (?, ?, ?)', `Town ${i}`, 50 + i, 8 + i);
  const people: [string, string, number][] = [['gran', '1930-02-03', 0], ['gramps', '1928-05-06', 0], ['mum', '1955-03-04', 1], ['dad', '1953-07-08', 1], ['ada', '1980-01-02', 1], ['bo', '1983-04-05', 1], ['cy', '1985-06-07', 1]];
  for (const [i, [id, born, living]] of people.entries()) await d.run("INSERT INTO person (id, given, surname, born, born_place, living, sex) VALUES (?, ?, 'Tester', ?, ?, ?, 'f')", id, id, born, `Town ${i}`, living);
  for (const [c, a, b] of [['mum', 'gran', 'gramps'], ['ada', 'mum', 'dad'], ['bo', 'mum', 'dad'], ['cy', 'mum', 'dad']]) await d.run('INSERT INTO parent (child, parent) VALUES (?, ?), (?, ?)', c, a, c, b);
  await d.run("INSERT INTO partnership (id, a, b, kind) VALUES ('u1', 'gran', 'gramps', 'marriage'), ('u2', 'mum', 'dad', 'marriage')");
  const acc = store.accounts();
  for (const [id, name] of [[STEWARD, 'Stella Steward'], [MEMBER, 'Milo Member'], [VIEWER, 'Vera Viewer']]) await acc.run('INSERT INTO user (id, name, handle, created, last_seen) VALUES (?, ?, ?, ?, ?)', id, name, `h-${id}`, Date.now(), 1000);
  await acc.run("INSERT INTO membership (user, tree, role, created) VALUES (?, ?, 'steward', 1)", STEWARD, TREE);
  await acc.run("INSERT INTO membership (user, tree, role, created) VALUES (?, ?, 'steward', 2)", STEWARD, OTHER);
  await acc.run("INSERT INTO membership (user, tree, role, person, person_confirmed, created) VALUES (?, ?, 'contributor', 'milo', 1, 3)", MEMBER, TREE);
  await acc.run("INSERT INTO membership (user, tree, role, created) VALUES (?, ?, 'viewer', 4)", VIEWER, TREE);
  // The member's own state: a reaction, a quiz answer, a visit marker, an assistant chat.
  await d.run("INSERT INTO reaction (target_kind, target, account, kind, created_at) VALUES ('story', 's1', ?, 'heart', '2026-01-02')", MEMBER);
  await acc.run('INSERT INTO family_visit (user, tree, since, shown, last_seen, visits) VALUES (?, ?, 0, NULL, 0, 3)', MEMBER, TREE);
  await acc.run('INSERT INTO credential (id, user, public_key, created) VALUES (?, ?, ?, ?)', 'steward-key', STEWARD, new Uint8Array([1]), 1);
});
after(async () => {
  outside();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------- rule 1 and 7: who may start ----------

test('only a steward of the family starts a preview, checked against their real session', async () => {
  // A member who is not a steward.
  asMember();
  await assert.rejects(viewAs.startViewAs({ data: { tree: TREE, choice: { kind: 'role', role: 'viewer' } } }), /viewas\.err_not_steward/);
  // A steward of another family only.
  outside();
  await store.accounts().run("INSERT INTO membership (user, tree, role, created) VALUES (?, ?, 'steward', 9)", MEMBER, OTHER);
  asMember();
  await assert.rejects(viewAs.startViewAs({ data: { tree: TREE, choice: { kind: 'role', role: 'viewer' } } }), /viewas\.err_not_steward/);
  outside();
  await store.accounts().run('DELETE FROM membership WHERE user = ? AND tree = ?', MEMBER, OTHER);
  // A guest of the family's link, and nobody.
  request({ user: null, via: null, guest: { link: 'x', tree: TREE, expires: Date.now() + 60_000, protectLiving: true } }, null);
  await assert.rejects(viewAs.startViewAs({ data: { tree: TREE, choice: { kind: 'guest' } } }), /sign in/);
  request(undefined, null);
  await assert.rejects(viewAs.startViewAs({ data: { tree: TREE, choice: { kind: 'guest' } } }), /sign in/);
  // A demo's visitor.
  request({ user: userRow('demo', 'Demo visitor'), via: 'demo' }, null);
  await assert.rejects(viewAs.startViewAs({ data: { tree: TREE, choice: { kind: 'role', role: 'viewer' } } }), /viewas\.err_demo/);
  // Not as yourself, not as someone outside the family, never as a steward role.
  steward(null);
  await assert.rejects(viewAs.startViewAs({ data: { tree: TREE, choice: { kind: 'member', member: STEWARD } } }), /viewas\.err_self/);
  steward(null);
  await assert.rejects(viewAs.startViewAs({ data: { tree: TREE, choice: { kind: 'member', member: '00000000-0000-4000-8000-0000000000ff' } } }), /viewas\.err_no_member/);
  assert.equal(await previews(), 0, 'nothing was started');

  // A steward does, needing no passkey proof, and can switch while previewing a viewer (whose role could not).
  await start({ kind: 'role', role: 'viewer' });
  assert.equal(await previews(), 1);
  const stored = await store.accounts().get<{ hash: string; session: string }>('SELECT hash, session FROM view_as');
  assert.notEqual(stored!.hash, cookie!.split('=')[1], 'only the hash is stored');
  assert.equal(stored!.session, SESSION_HASH, 'it belongs to the session that started it');
  steward();
  await viewAs.startViewAs({ data: { tree: TREE, choice: { kind: 'role', role: 'editor' } } });
  cookie = g.__setCookies!.findLast((c) => /^kindred_view_as=[^;]/.test(c))!.split(';')[0];
  assert.equal(await previews(), 1, 'switching replaces the preview');
  steward();
  assert.equal((await guard.requireMember(TREE)).role, 'editor');
  await stop();
  assert.equal(await previews(), 0);
});

// ---------- rule 2: less, never more ----------

test('as a role: every check answers for that role, reads included', async () => {
  await start({ kind: 'role', role: 'viewer' });
  steward();
  const m = await guard.requireMember(TREE);
  assert.equal(m.role, 'viewer');
  assert.equal(m.person, null);
  assert.equal(m.user.id, viewAsServer.VIEW_AS_USER_ID, 'the previewed reader is no account');
  steward();
  await assert.rejects(guard.requireCan(TREE, 'manage-access'), /permission/);
  // Server functions a viewer may not call refuse the steward too: reads (Access, the share link's state) and changes.
  steward();
  await assert.rejects(authFns.fetchAccess({ data: { tree: TREE } }), /permission/);
  steward();
  await assert.rejects(shareFns.fetchShareState({ data: { tree: TREE } }), /permission/);
  steward();
  await assert.rejects(api.addStory({ data: { tree: TREE, person: 'old', kind: 'memory', body: 'x', opKey: 'k-viewer-story-1' } }), /permission/);
  // A viewer's reads hide what is for editors.
  steward();
  const detail = await person.getPersonDetail({ data: { tree: TREE, id: 'old' } });
  assert.doesNotMatch(JSON.stringify(detail), /EDITORS-ONLY/);
  // The browser is told the same.
  steward();
  const info = await authFns.fetchSession({});
  assert.equal(info.user?.id, STEWARD, 'the account stays the steward');
  assert.deepEqual(info.memberships.find((x) => x.tree === TREE), { tree: TREE, role: 'viewer', person: null, personConfirmed: false });
  assert.equal(info.memberships.find((x) => x.tree === OTHER)?.role, 'steward', 'another family is untouched');
  assert.equal(info.viewAs?.kind, 'role');
  assert.equal(info.viewAs?.role, 'viewer');
  // Another family is read as the steward.
  steward();
  assert.equal((await guard.requireCan(OTHER, 'manage-access')).role, 'steward');
  await stop();
  // Stopped: the steward again.
  steward();
  assert.equal((await guard.requireCan(TREE, 'manage-access')).role, 'steward');
});

test('as a member: their role and their person, never their account', async () => {
  await start({ kind: 'member', member: MEMBER });
  steward();
  const m = await guard.requireMember(TREE);
  assert.equal(m.role, 'contributor');
  assert.equal(m.person, 'milo', '"you" in the tree is the member’s person');
  assert.equal(m.personConfirmed, true);
  assert.notEqual(m.user.id, MEMBER, 'never the member’s account');
  assert.equal(m.user.id, viewAsServer.VIEW_AS_USER_ID);
  steward();
  const r = await guard.requireReader(TREE);
  assert.equal(r.role, 'contributor');
  assert.equal(r.user?.id, viewAsServer.VIEW_AS_USER_ID);
  steward();
  await assert.rejects(guard.requireCan(TREE, 'edit-person'), /permission/);
  steward();
  assert.equal((await authFns.fetchSession({})).viewAs?.name, 'Milo Member');
  // Their personal note stays theirs: not in what the preview reads.
  steward();
  assert.doesNotMatch(JSON.stringify(await person.getPersonDetail({ data: { tree: TREE, id: 'old' } })), /MILO-PRIVATE-NOTE/);
  steward();
  assert.doesNotMatch(JSON.stringify(await api.getGraph({ data: { tree: TREE } })), /MILO-PRIVATE-NOTE/);
  await stop();
});

test('as a guest: the guest’s reads only, with the link’s "Protect living people"', async () => {
  // No link yet: a plain guest, living people protected.
  await start({ kind: 'guest' });
  steward();
  await assert.rejects(guard.requireMember(TREE), /access/, 'a guest is not a member');
  steward();
  const r = await guard.requireReader(TREE);
  assert.deepEqual({ guest: r.guest, role: r.role, protectLiving: r.protectLiving, user: r.user }, { guest: true, role: 'viewer', protectLiving: true, user: null });
  steward();
  const graph = await api.getGraph({ data: { tree: TREE } });
  const milo = graph.people.find((p) => p.id === 'milo');
  assert.ok(milo, 'the living person is in the tree');
  assert.doesNotMatch(JSON.stringify(milo), /1980|Uppsala/, 'without their dates and places');
  steward();
  const info = await authFns.fetchSession({});
  assert.equal(info.guest?.tree, TREE);
  assert.equal(info.user?.id, STEWARD);
  assert.equal(info.viewAs?.link, false);
  // Members-only reads refuse, as for a guest.
  steward();
  await assert.rejects(history.getWhatsNew({ data: { tree: TREE } }), /access/);
  await stop();

  // A link that shows the living in full and lets guests ask to join.
  outside();
  await share.makeShareLink({ tree: TREE, password: false, days: 30, createdBy: STEWARD, protectLiving: false });
  await start({ kind: 'guest' });
  steward();
  assert.equal((await guard.requireReader(TREE)).protectLiving, false);
  steward();
  assert.match(JSON.stringify((await api.getGraph({ data: { tree: TREE } })).people.find((p) => p.id === 'milo')), /1980/);
  steward();
  assert.equal((await join_.fetchJoinState({ data: { tree: TREE } })).available, true, 'the invitation that guest would see');
  // Pressing it makes no request: the server refuses one from a preview.
  steward();
  await assert.rejects(join_.joinOptions({ data: { tree: TREE, name: 'Nobody', person: null } }));
  // The link's setting is read on every request.
  outside();
  await share.setShareProtectLiving(TREE, true);
  steward();
  assert.equal((await guard.requireReader(TREE)).protectLiving, true);
  await stop();
});

// ---------- rule 3: read-only ----------

test('a preview writes nothing, at every choke point; other sessions write; Stop works', async () => {
  await start({ kind: 'role', role: 'editor' });
  const before = await rows('SELECT count(*) AS n FROM view_as');
  // A records write through `once`, which the role would allow.
  steward();
  await assert.rejects(api.addStory({ data: { tree: TREE, person: 'old', kind: 'memory', body: 'Not saved.', opKey: 'k-editor-story-1' } }), (e) => refusedAsPreview(e) && /editor/.test(message(e)));
  // `once` itself, and the store underneath it, for the family and the accounts database.
  steward();
  await guard.currentSession();
  await assert.rejects(dbs.once(TREE, undefined, 'test', () => ({ writes: [dbs.q("UPDATE person SET given = 'X' WHERE id = 'old'")], history: dbs.NOT_A_RECORD, result: null })), refusedAsPreview);
  await assert.rejects(dbs.db(TREE).run("UPDATE person SET given = 'X' WHERE id = 'old'"), refusedAsPreview);
  await assert.rejects(dbs.db(TREE).get("UPDATE person SET given = 'X' WHERE id = 'old' RETURNING id"), refusedAsPreview);
  await assert.rejects(store.accounts().run('UPDATE user SET name = ? WHERE id = ?', 'X', STEWARD), refusedAsPreview);
  await assert.rejects(store.accounts().batch([dbs.q('DELETE FROM invite')]), refusedAsPreview);
  // Uploads and media.
  await assert.rejects(dbs.store.media.put(TREE, 'gallery/x.jpg', new Uint8Array([1]), 'image/jpeg'), refusedAsPreview);
  await assert.rejects(dbs.store.media.delete(TREE, 'gallery/x.jpg'), refusedAsPreview);
  // The assistant: no provider is asked.
  await assert.rejects(ai.routeAdapter(TREE, 'assistant', 'en'), refusedAsPreview);
  // Reads still work in the same request.
  assert.equal((await dbs.db(TREE).get<{ given: string }>("SELECT given FROM person WHERE id = 'old'"))!.given, 'Olga');
  // A function that writes without `once` (the accounts database): who you are, a reaction.
  steward();
  await assert.rejects(authFns.setMyPerson({ data: { tree: TREE, person: 'old' } }), refusedAsPreview);
  steward();
  await assert.rejects(responses.setReaction({ data: { tree: TREE, kind: 'story', target: 's1', reaction: 'heart', on: true, opKey: 'k-react-0001' } }), refusedAsPreview);
  // Access changes, in another family too: the whole session is read-only while the preview is on.
  steward();
  await guard.currentSession();
  await assert.rejects(store.revokeInvite('x', OTHER), refusedAsPreview);
  steward();
  await assert.rejects(families.createFamily({ data: { id: 'new-one', name: 'New', tagline: '', theme: 'codex' } }), refusedAsPreview);
  // Nothing changed.
  assert.equal((await dbs.db(TREE).get<{ given: string }>("SELECT given FROM person WHERE id = 'old'"))!.given, 'Olga');
  assert.equal(await rows("SELECT count(*) AS n FROM user WHERE name = 'X'"), 0);
  assert.equal(await rows('SELECT count(*) AS n FROM view_as'), before);
  // Another session (the member's, on another browser) writes as usual, at the same time.
  asMember();
  await guard.currentSession();
  await dbs.db(TREE).run("UPDATE person SET given = 'Olga' WHERE id = 'old'");
  assert.equal(readOnly.readOnly(), false);
  // Code outside a request (a daily job) is never in a preview.
  outside();
  assert.equal(readOnly.readOnly(), false);
  await dbs.db(TREE).run("UPDATE person SET given = 'Olga' WHERE id = 'old'");
  // Stop works, though it is a write, in a request already read-only.
  steward();
  await guard.currentSession();
  assert.equal(readOnly.readOnly(), true);
  await viewAs.stopViewAs({});
  assert.equal(await previews(), 0);
  assert.ok(g.__setCookies!.some((c) => /^kindred_view_as=;.*Max-Age=0/.test(c)), 'the cookie is forgotten');
  cookie = undefined;
  // And the steward writes again.
  steward();
  await guard.currentSession();
  assert.equal(readOnly.readOnly(), false);
});

// ---------- rule 4: no trace ----------

test('a preview leaves no trace: no visit, no news mark, no quiz draw, no statistics, no last-seen', async () => {
  steward(null);
  await today.setQuizOn({ data: { tree: TREE, on: true } });
  const memberSeen = await rows('SELECT last_seen AS n FROM user WHERE id = ?', MEMBER);
  const snapshot = async () => ({
    visits: await rows('SELECT count(*) AS n FROM family_visit'),
    memberVisit: await rows('SELECT coalesce(sum(visits * 1000 + last_seen), 0) AS n FROM family_visit WHERE user = ?', MEMBER),
    quiz: (await dbs.db(TREE).get<{ n: number }>('SELECT count(*) AS n FROM quiz_day'))!.n,
    history: (await dbs.db(TREE).get<{ n: number }>('SELECT count(*) AS n FROM history'))!.n,
    stats: await rows("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name LIKE 'stats%'") > 0 ? await rows('SELECT (SELECT count(*) FROM stats_daily) AS n') : 0,
    guests: await rows('SELECT count(*) AS n FROM guest_visitor'),
  });
  const was = await snapshot();
  for (const choice of [{ kind: 'member', member: MEMBER }, { kind: 'role', role: 'contributor' }] as const) {
    await start(choice);
    steward();
    await api.getGraph({ data: { tree: TREE } });
    steward();
    await history.getWhatsNew({ data: { tree: TREE } });
    steward();
    await history.getNewsCount({ data: { tree: TREE } });
    steward();
    const quiz = await today.getQuiz({ data: { tree: TREE } });
    assert.equal(quiz.mine, undefined, 'no answer of the member’s shows');
    assert.ok(quiz.question, 'the day’s question is drawn, and shown, but not kept');
    // Whatever a page hands them, the visit marker and the news mark write nothing during a preview, and do not fail the page.
    steward();
    await guard.currentSession();
    await historyServer.noteVisit(MEMBER, TREE);
    await historyServer.markShown(MEMBER, TREE);
    // The usage beacon.
    steward();
    const { Route } = await load<{ Route: { options: { server: { handlers: { POST: (c: { request: Request }) => Promise<Response> } } } } }>('/src/routes/api/stats.ts');
    const res = await Route.options.server.handlers.POST({ request: new Request('http://localhost/api/stats', { method: 'POST', headers: { cookie: cookie! }, body: JSON.stringify({ tree: TREE, visit: true, views: { tree: 1 }, events: { 'open-person': 1 } }) }) });
    assert.equal(res.status, 204);
    await stop();
  }
  // A guest's preview: no guest-link visit statistics.
  await start({ kind: 'guest' });
  steward();
  const { Route } = await load<{ Route: { options: { server: { handlers: { POST: (c: { request: Request }) => Promise<Response> } } } } }>('/src/routes/api/stats.ts');
  await Route.options.server.handlers.POST({ request: new Request('http://localhost/api/stats', { method: 'POST', headers: { cookie: cookie! }, body: JSON.stringify({ tree: TREE, visit: true, views: { tree: 2 } }) }) });
  await stop();
  assert.deepEqual(await snapshot(), was);
  assert.equal(await rows('SELECT last_seen AS n FROM user WHERE id = ?', MEMBER), memberSeen, 'the member was not seen');
});

// ---------- rule 5: the role and the person, not the account ----------

test('the account stays the steward’s; no member’s own state reaches the preview', async () => {
  await start({ kind: 'member', member: MEMBER });
  // The account page: the steward's own passkeys.
  steward();
  assert.deepEqual((await authFns.fetchMyPasskeys({})).map((k) => k.id), ['steward-key']);
  // The families page: the steward's own families and roles.
  steward();
  const overview = await families.fetchFamilies({});
  assert.equal(JSON.stringify(overview).includes('"steward"'), true);
  // The member's reaction, visit marker and quiz answer are not "mine" in the preview.
  steward();
  const graph = await api.getGraph({ data: { tree: TREE } });
  assert.ok(graph);
  steward();
  const news = await history.getWhatsNew({ data: { tree: TREE } });
  assert.equal(news.first, true, 'a new reader’s first look, not the member’s visit');
  steward();
  const counts = await responses.getResponseCounts({ data: { tree: TREE } });
  const s1 = Object.values(counts as Record<string, { reactions: Record<string, number>; mine: string[] }>)[0];
  assert.equal(s1.reactions.heart, 1, 'the family’s count is there');
  assert.deepEqual(s1.mine, [], 'the member’s own reaction is not shown as the reader’s');
  await stop();
});

// ---------- rule 1: how a preview ends ----------

test('a preview ends after an hour unused, after a day, on sign-out, and with its session', async () => {
  await start({ kind: 'role', role: 'viewer' });
  outside();
  await store.accounts().run('UPDATE view_as SET last_used = ?', Date.now() - viewAsServer.VIEW_AS_IDLE_MS - 1000);
  steward();
  assert.equal((await guard.requireMember(TREE)).role, 'steward', 'idle for an hour: over');
  assert.equal(await previews(), 0);
  assert.ok(g.__setCookies!.some((c) => /^kindred_view_as=;/.test(c)), 'and the browser forgets it');

  await start({ kind: 'role', role: 'viewer' });
  outside();
  await store.accounts().run('UPDATE view_as SET created = ?', Date.now() - viewAsServer.VIEW_AS_MAX_MS - 1000);
  steward();
  assert.equal((await guard.requireMember(TREE)).role, 'steward', 'a day old: over');

  // Used within the hour: still on, and it survives a reload (a new request with the same cookie).
  await start({ kind: 'role', role: 'viewer' });
  steward();
  assert.equal((await guard.requireMember(TREE)).role, 'viewer');
  steward();
  assert.equal((await guard.requireMember(TREE)).role, 'viewer');

  // Another session of the same account does not inherit it.
  request({ user: userRow(STEWARD, 'Stella Steward'), via: 'passkey', sessionHash: 'another-session' });
  assert.equal((await guard.requireMember(TREE)).role, 'steward');
  assert.equal(await previews(), 0);

  // Sign-out ends it.
  await start({ kind: 'role', role: 'viewer' });
  outside();
  await session.endAllSessions(new Request('http://localhost/', { headers: { cookie: cookie! } }));
  assert.equal(await previews(), 0);
  cookie = undefined;
});

test('a member removed, a link revoked or a steward no longer a steward ends the previews of them', async () => {
  // The member leaves.
  await start({ kind: 'member', member: VIEWER });
  steward();
  assert.equal((await guard.requireMember(TREE)).role, 'viewer');
  outside();
  await store.accounts().run('DELETE FROM membership WHERE user = ? AND tree = ?', VIEWER, TREE);
  steward();
  assert.equal((await guard.requireMember(TREE)).role, 'steward');
  assert.equal(await previews(), 0);
  outside();
  await store.accounts().run("INSERT INTO membership (user, tree, role, created) VALUES (?, ?, 'viewer', 4)", VIEWER, TREE);

  // The link goes.
  outside();
  await share.makeShareLink({ tree: TREE, password: false, days: 30, createdBy: STEWARD });
  await start({ kind: 'guest' });
  steward();
  assert.equal((await guard.requireReader(TREE)).guest, true);
  outside();
  await share.revokeShareLink(TREE);
  steward();
  assert.equal((await guard.requireReader(TREE)).guest, false);
  assert.equal(await previews(), 0);

  // The steward is made an editor by another steward.
  outside();
  await store.accounts().run("UPDATE membership SET role = 'steward' WHERE user = ? AND tree = ?", MEMBER, TREE);
  await start({ kind: 'role', role: 'viewer' });
  outside();
  await store.accounts().run("UPDATE membership SET role = 'editor' WHERE user = ? AND tree = ?", STEWARD, TREE);
  steward();
  assert.equal((await guard.requireMember(TREE)).role, 'editor');
  assert.equal(await previews(), 0);
  outside();
  await store.accounts().run("UPDATE membership SET role = 'steward' WHERE user = ? AND tree = ?", STEWARD, TREE);
  await store.accounts().run("UPDATE membership SET role = 'contributor' WHERE user = ? AND tree = ?", MEMBER, TREE);
  cookie = undefined;
});

test('deleting a family takes its previews with it', async () => {
  const sql = (await store.accounts().get<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'view_as'"))!.sql;
  assert.match(sql, /\btree\s+TEXT NOT NULL/, 'a `tree` column, which deleteFamily finds');
});

test('every refusal ends the same way, so the browser shows it as a notice', async () => {
  const { translate } = await load<typeof import('../i18n/dictionary.ts')>('/src/lib/i18n/dictionary.ts');
  const { isViewAsRefusal } = await load<typeof import('../view-as.ts')>('/src/lib/view-as.ts');
  for (const v of [{ kind: 'role', role: 'viewer' }, { kind: 'role', role: 'contributor' }, { kind: 'role', role: 'editor' }, { kind: 'guest', role: 'viewer' }, { kind: 'member', role: 'editor', member: { id: MEMBER, name: 'Milo Member' } }] as const) {
    const e = viewAsServer.viewAsRefused(v);
    assert.ok(isViewAsRefusal(e), e.message);
    assert.equal(e.status, 403);
  }
  assert.ok(!isViewAsRefusal(new Error(translate('en', 'viewas.err_not_steward'))));
});
