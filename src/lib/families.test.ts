// node --test src/lib/families.test.ts: making, changing and deleting a family (src/lib/families.server.ts). The id rules and
// the reserved words (every first path segment the app answers itself), who may make a family, a database that already exists,
// a family a failed attempt left half-made, rows a deletion left behind, and that deleting removes the family's database, its
// files and every accounts row that names it, while another family keeps all of its own. Invented names only.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-families-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;
delete process.env.KINDRED_DEFAULT_TREE;
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
      export const getRequest = () => globalThis.__request ?? (globalThis.__request = new Request('http://localhost/'));
      export const getRequestIP = () => '203.0.113.1';
      export const setResponseStatus = () => {};
      export const appendResponseHeader = () => {};
      export const getRequestHeader = () => undefined;`;
    if (id === STUB_SESSION) return `export const getSession = async () => ({ user: globalThis.__signedIn ?? null, via: globalThis.__signedIn ? 'passkey' : null });`;
    return undefined;
  },
};
const vite = await createServer({
  configFile: false, root: process.cwd(), logLevel: 'error', plugins: [framework],
  resolve: { alias: { '~': resolve('src') } }, ssr: { noExternal: [/^@tanstack\/react-start/] },
  server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
});
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;

const fam = await load<typeof import('./families.server.ts')>('/src/lib/families.server.ts');
const fns = await load<typeof import('./families.functions.ts')>('/src/lib/families.functions.ts');
const dbs = await load<typeof import('./db.server.ts')>('/src/lib/db.server.ts');
const acc = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const trees = await load<typeof import('./auth/trees.server.ts')>('/src/lib/auth/trees.server.ts');
const st = await load<typeof import('./store/index.ts')>('/src/lib/store/index.ts');
const { closeDatabases } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');

after(async () => {
  await vite.close();
  closeDatabases();
  rmSync(dir, { recursive: true, force: true });
});

const g = globalThis as unknown as { __signedIn?: unknown; __request?: Request };
const T = Date.now();
const user = (id: string, created: number, operator = 0) => ({ id, name: id, email: null, handle: `h-${id}`, created, last_seen: null, locale: null, operator });
// The server's first account: its operator (migration 0034).
const FIRST = user('00000000-0000-4000-8000-000000000001', T - 1000, 1);
const STEWARD = user('00000000-0000-4000-8000-000000000002', T);
const VIEWER = user('00000000-0000-4000-8000-000000000003', T + 1);
const PENDING = '00000000-0000-4000-8000-000000000009';
const sql = (s: string, ...p: (string | number | null)[]) => acc.accounts().run(s, ...p);

before(async () => {
  for (const u of [FIRST, STEWARD, VIEWER]) await sql('INSERT INTO user (id, name, handle, created, operator) VALUES (?, ?, ?, ?, ?)', u.id, u.name, u.handle, u.created, u.operator);
  await dbs.provisionFamily('oakhaven', 'The Oakhavens');
  await acc.accounts().batch([acc.upsertMembership(STEWARD.id, 'oakhaven', 'steward'), acc.upsertMembership(VIEWER.id, 'oakhaven', 'viewer')]);
});
/** Signs `u` in for the calls that follow: a new request, as the guard reads the session once per request. */
const asUser = (u: unknown) => { g.__signedIn = u; g.__request = undefined; };
beforeEach(() => asUser(undefined));

const memberships = (id: string) => acc.membershipsOf(id);
const { translate } = await load<typeof import('./i18n/dictionary.ts')>('/src/lib/i18n/dictionary.ts');
type Key = Parameters<typeof translate>[1];
/** The refusal is exactly that sentence, filled in. */
const rejectsWith = (p: Promise<unknown>, key: Key, vars: Record<string, string> = {}) =>
  assert.rejects(p, (e: Error) => { assert.equal(e.message, translate('en', key, vars)); return true; });

test('an id: letters first, single dashes, 2 to 40 characters, and never a word the app uses itself', () => {
  for (const ok of ['ab', 'lindqvist', 'the-lindqvists', 'clan-2', 'a'.repeat(40)]) assert.equal(fam.idProblem(ok), null, ok);
  for (const bad of ['a', 'a'.repeat(41), '2clan', '-clan', 'clan-', 'clan--two', 'Clan', 'clan_two', 'clan.two', 'clän', '']) assert.ok(fam.idProblem(bad), bad);
  for (const word of ['api', 'setup', 'signin', 'share', 'invite', 'ui', 'families', 'accounts', 'gazetteer', 'cdn-cgi', 'assets']) {
    assert.match(fam.idProblem(word)?.message ?? '', /used by Kindred itself/, word);
  }
});

test('every first path segment the app answers itself is reserved, so a family there could always be opened', () => {
  const roots = new Set<string>();
  for (const f of readdirSync('src/routes', { withFileTypes: true })) {
    const first = f.name.replace(/\.tsx?$/, '').split('.')[0].replace(/_$/, '');
    if (first && !first.startsWith('$') && !first.startsWith('__') && first !== 'index') roots.add(first);
  }
  assert.ok(roots.has('api') && roots.has('families') && roots.has('setup'), [...roots].join(', '));
  for (const r of roots) assert.ok(fam.RESERVED_IDS.has(r), `${r} is reserved`);
});

test('the id suggested for a name', () => {
  assert.equal(fam.suggestId('The Lindqvist Family'), 'the-lindqvist-family');
  assert.equal(fam.suggestId('Æsir & Ström'), 'sir-strom');
  assert.equal(fam.suggestId('1st House'), 'st-house');
  assert.equal(fam.suggestId('Groß'), 'gross');
});

test('who may make a family: a steward of one here, or an operator (the first account); nobody else', async () => {
  assert.equal(await fam.mayCreate(STEWARD, await memberships(STEWARD.id)), true);
  assert.equal(await fam.mayCreate(FIRST, await memberships(FIRST.id)), true, 'the operator, even with no membership left');
  assert.equal(await fam.mayCreate(VIEWER, await memberships(VIEWER.id)), false);
  asUser(VIEWER);
  await assert.rejects(fns.createFamily({ data: { id: 'viewers-own', name: 'Mine', tagline: '', theme: 'codex' } }), /Only a steward/);
  assert.equal(existsSync(join(dir, 'viewers-own.db')), false);
  asUser(undefined);
  await assert.rejects(fns.createFamily({ data: { id: 'nobodys', name: 'Nobody', tagline: '', theme: 'codex' } }), /sign in/i);
});

test('making a family: its database, its details, and its maker as its steward', async () => {
  asUser(STEWARD);
  const { id } = await fns.createFamily({ data: { id: 'birchmoor', name: '  The   Birchmoors ', tagline: 'Roots and rain', theme: 'modern' } });
  assert.equal(id, 'birchmoor');
  assert.ok(existsSync(join(dir, 'birchmoor.db')));
  const made = await trees.family('birchmoor');
  assert.deepEqual([made?.name, made?.tagline, made?.theme, made?.people], ['The Birchmoors', 'Roots and rain', 'modern', 0]);
  assert.equal((await acc.membership(STEWARD.id, 'birchmoor'))?.role, 'steward');
  // The overview shows it to its steward (on their next request), with the empty databases only to someone who may make a family.
  asUser(STEWARD);
  const view = await fns.fetchFamilies();
  assert.ok(view.families.some((f) => f.id === 'birchmoor' && f.steward));
  assert.equal(view.mayCreate, true);
  asUser(VIEWER);
  const theirs = await fns.fetchFamilies();
  assert.deepEqual(theirs.families.map((f) => f.id), ['oakhaven'], 'a reader sees only their own families');
  assert.deepEqual(theirs.empty, []);
});

test('a family that exists is never made again, and bad input is refused before anything is written', async () => {
  await rejectsWith(fam.createFamily(STEWARD, { id: 'birchmoor', name: 'Again', tagline: '', theme: 'codex' }), 'families.err_exists', { id: 'birchmoor' });
  await rejectsWith(fam.createFamily(STEWARD, { id: 'oakhaven', name: 'Again', tagline: '', theme: 'codex' }), 'families.err_exists', { id: 'oakhaven' });
  await assert.rejects(fam.createFamily(STEWARD, { id: 'setup', name: 'Setup', tagline: '', theme: 'codex' }), /used by Kindred itself/);
  await assert.rejects(fam.createFamily(STEWARD, { id: 'no-name', name: '   ', tagline: '', theme: 'codex' }), /needs a name/);
  await assert.rejects(fam.createFamily(STEWARD, { id: 'bad-theme', name: 'X', tagline: '', theme: 'night' as never }), /themes/);
  for (const id of ['setup', 'no-name', 'bad-theme']) assert.equal(existsSync(join(dir, `${id}.db`)), false, id);
  assert.equal((await trees.family('oakhaven'))?.name, 'The Oakhavens');
});

test('a family left half-made (details, no people, no members) is finished by making it again', async () => {
  await dbs.provisionFamily('halfway', 'Half');
  const id = await fam.createFamily(VIEWER, { id: 'halfway', name: 'Halfway House', tagline: 't', theme: 'codex' });
  assert.equal(id, 'halfway');
  assert.equal((await trees.family('halfway'))?.name, 'Halfway House');
  assert.equal((await acc.membership(VIEWER.id, 'halfway'))?.role, 'steward');
  // Once it has a member it is a family like any other.
  await rejectsWith(fam.createFamily(STEWARD, { id: 'halfway', name: 'Taken', tagline: '', theme: 'codex' }), 'families.err_exists', { id: 'halfway' });
});

test('a database file with people but no family details is not written over', async () => {
  const d = await st.store.ensureTree('strayfile');
  await d.run("INSERT INTO person (id, given) VALUES ('p1', 'Stray')");
  await rejectsWith(fam.createFamily(STEWARD, { id: 'strayfile', name: 'Mine now', tagline: '', theme: 'codex' }), 'families.err_not_empty', { id: 'strayfile' });
  assert.equal((await d.get<{ n: number }>('SELECT count(*) AS n FROM person'))?.n, 1);
});

test('an empty database waiting for a family is listed, and setting it up uses it', async () => {
  await st.store.ensureTree('waiting');
  asUser(STEWARD);
  assert.ok((await fns.fetchFamilies()).empty.some((e) => e.id === 'waiting' && e.binding === 'TREE_WAITING'));
  await fns.createFamily({ data: { id: 'waiting', name: 'The Waitings', tagline: '', theme: 'codex' } });
  asUser(STEWARD);
  assert.ok(!(await fns.fetchFamilies()).empty.some((e) => e.id === 'waiting'));
});

test('rows a deletion left under an id are forgotten before a new family takes it, so nobody inherits access', async () => {
  await acc.accounts().batch([acc.upsertMembership(VIEWER.id, 'ghost', 'steward')]);
  mkdirSync(join(dir, 'media', 'ghost', 'photo'), { recursive: true });
  writeFileSync(join(dir, 'media', 'ghost', 'photo', 'old.jpg'), 'x');
  await fam.createFamily(STEWARD, { id: 'ghost', name: 'The Ghosts', tagline: '', theme: 'codex' });
  assert.equal(await acc.membership(VIEWER.id, 'ghost'), undefined);
  assert.equal(existsSync(join(dir, 'media', 'ghost', 'photo', 'old.jpg')), false);
});

test('changing a family: its stewards only, through once', async () => {
  asUser(VIEWER);
  await assert.rejects(fns.editFamily({ data: { tree: 'oakhaven', opKey: 'edit-key-1', name: 'Hijacked', tagline: '', theme: 'codex' } }), /permission/);
  asUser(STEWARD);
  const saved = await fns.editFamily({ data: { tree: 'oakhaven', opKey: 'edit-key-2', name: 'The Oakhaven Line', tagline: 'Since 1820', theme: 'modern' } });
  assert.deepEqual(saved, { name: 'The Oakhaven Line', tagline: 'Since 1820', theme: 'modern' });
  const f = await trees.family('oakhaven');
  assert.deepEqual([f?.name, f?.tagline, f?.theme], ['The Oakhaven Line', 'Since 1820', 'modern']);
});

test('deleting needs a steward of that family and a fresh passkey proof on this session', async () => {
  asUser(VIEWER);
  await assert.rejects(fns.deleteFamily({ data: { tree: 'birchmoor', confirm: 'birchmoor' } }), /access|permission/);
  asUser(STEWARD);
  await assert.rejects(fns.deleteFamily({ data: { tree: 'birchmoor', confirm: 'birchmoor' } }), /passkey/);
  assert.ok(await trees.family('birchmoor'));
});

test('deleting a family removes its database, its files and every accounts row that names it; another family keeps its own', async () => {
  const A = 'doomed';
  const B = 'oakhaven';
  await fam.createFamily(STEWARD, { id: A, name: 'The Doomed', tagline: '', theme: 'codex' });
  await dbs.db(A).run("INSERT INTO person (id, given) VALUES ('d1', 'Ada')");
  await st.store.media.put(A, 'photo/a.jpg', new Uint8Array([1]), 'image/jpeg');
  await st.store.media.put(B, 'photo/b.jpg', new Uint8Array([2]), 'image/jpeg');
  for (const tree of [A, B]) {
    const s = `${tree}-`;
    await acc.accounts().batch([
      acc.upsertMembership(VIEWER.id, tree, 'viewer'),
      st.q('INSERT INTO invite (id, hash, tree, role, expires, created) VALUES (?, ?, ?, ?, ?, ?)', `${s}inv`, `${s}hash`, tree, 'viewer', T + 1e6, T),
      st.q('INSERT INTO share_link (id, tree, token_hash, created) VALUES (?, ?, ?, ?)', `${s}link`, tree, `${s}tok`, T),
      st.q('INSERT INTO share_session (hash, link, generation, created, expires) VALUES (?, ?, 1, ?, ?)', `${s}sess`, `${s}link`, T, T + 1e6),
      st.q('INSERT INTO ai_settings (tree) VALUES (?)', tree),
      st.q('INSERT INTO ai_thread (tree, user, conv, created, updated) VALUES (?, ?, ?, ?, ?)', tree, STEWARD.id, `${s}conv`, T, T),
      st.q('INSERT INTO ai_turn (conv, claim, at) VALUES (?, ?, ?)', `${s}conv`, 'c', T),
      st.q("INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES (?, ?, ?, ?, 'user', 'hi', ?)", `${s}chat`, tree, STEWARD.id, `${s}conv`, T),
      st.q("INSERT INTO stats_daily (tree, day, kind, name, n) VALUES (?, '2026-11-10', 'view', 'x', 1)", tree),
      st.q("INSERT INTO push_subscription (id, user, tree, endpoint, p256dh, auth, offsets, kinds, created, last_seen) VALUES (?, ?, ?, ?, 'k', 'a', '[]', '[]', ?, ?)", `${s}push`, STEWARD.id, tree, `https://push.example/${s}`, T, T),
      st.q('INSERT INTO guest_visitor (hash, link, tree, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)', `${s}visitor`, `${s}link`, tree, T, T),
      st.q('INSERT INTO family_visit (user, tree, since, last_seen) VALUES (?, ?, ?, ?)', STEWARD.id, tree, T, T),
      st.q("INSERT INTO presence (tree, account, tab, route, seen) VALUES (?, ?, 'tab-00000001', 'tree', ?)", tree, STEWARD.id, T),
      st.q("INSERT INTO feedback (id, tree, kind, body, context, user, user_name, created_at, updated_at) VALUES (?, ?, 'bug', 'b', '{}', ?, 'n', ?, ?)", `${s}fb`, tree, STEWARD.id, T, T),
      st.q("INSERT INTO view_as (hash, user, tree, kind, role, created, last_used) VALUES (?, ?, ?, 'role', 'viewer', ?, ?)", `${s}view-as`, STEWARD.id, tree, T, T),
      st.q('INSERT INTO family_admin (tree, cap_bytes) VALUES (?, 1000) ON CONFLICT(tree) DO UPDATE SET cap_bytes = excluded.cap_bytes', tree),
      st.q('INSERT INTO media_usage (tree, key, bytes, at) VALUES (?, ?, 1, ?)', tree, `photo/${s}counted.jpg`, T),
      st.q("INSERT INTO family_import (tree, id, user, mode, schema, expected, started_at) VALUES (?, ?, ?, 'new', '0001_x.sql', '{}', ?)", tree, `00000000-0000-4000-8000-${s.padEnd(12, '0').slice(0, 12)}`, STEWARD.id, T),
      st.q('INSERT INTO subject_restriction (tree, person, since) VALUES (?, ?, ?)', tree, `${s}person`, T),
      st.q("INSERT INTO subject_action (tree, kind, at) VALUES (?, 'restrict', ?)", tree, T),
      st.q('INSERT INTO family_left (user, tree, left_at) VALUES (?, ?, ?)', VIEWER.id, tree, T),
<<<<<<< HEAD
      st.q("INSERT INTO family_lifecycle (tree, stage, quiet_since, warned_at) VALUES (?, 'warned', ?, ?)", tree, T, T),
      st.q("INSERT INTO steward_notice (tree, kind, vars, at) VALUES (?, 'lifecycle_warning', '{}', ?)", tree, T),
      st.q("INSERT INTO steward_notice_dismissal (user, tree, kind, until) VALUES (?, ?, 'lifecycle_warning', ?)", STEWARD.id, tree, T),
=======
      st.q('INSERT INTO recovery_point (tree, bookmark, at) VALUES (?, ?, ?)', tree, `${s}bookmark`, T),
      // An automatic backup's row names the family in `family`, not `tree`: it outlasts the family for the grace period.
      st.q("INSERT INTO family_backup (family, name, created_at) VALUES (?, '20261110T060000000Z', ?)", tree, T),
>>>>>>> ec5702c3 (fix(backup): report the file's size from the backup itself, and test that backups outlast a deleted family)
    ]);
  }
  // Someone who asked to join A and is not yet approved: their pending account goes with the request.
  await acc.accounts().batch([
    st.q('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', PENDING, 'Pending', 'h-pending', T),
    st.q('INSERT INTO credential (id, user, public_key, created) VALUES (?, ?, ?, ?)', 'pending-cred', PENDING, new Uint8Array([1]), T),
    st.q("INSERT INTO join_request (id, tree, link, user, browser, name, created, expires) VALUES ('jr', ?, ?, ?, 'b', 'Pending', ?, ?)", A, `${A}-link`, PENDING, T, T + 1e6),
  ]);

  await rejectsWith(fam.deleteFamily(A, 'the doomed'), 'families.err_confirm', { id: A });
  assert.ok(await trees.family(A));
  await fam.deleteFamily(A, ` ${A} `);

  assert.equal(existsSync(join(dir, `${A}.db`)), false, 'the database file is gone');
  assert.equal(existsSync(join(dir, `${A}.db-wal`)), false);
  assert.equal(existsSync(join(dir, 'media', A)), false, 'its files are gone');
  assert.equal(await trees.family(A), undefined);
  assert.ok(!(await st.store.treeIds()).includes(A));
  const tables = (await acc.accounts().all<{ name: string; sql: string }>("SELECT name, sql FROM sqlite_master WHERE type = 'table'"))
    .filter((t) => /[(,]\s*tree\s+[A-Za-z]/i.test(t.sql)).map((t) => t.name);
  assert.ok(tables.includes('membership') && tables.includes('stats_daily') && tables.includes('join_request'), tables.join());
  for (const t of tables) {
    assert.equal((await acc.accounts().get<{ n: number }>(`SELECT count(*) AS n FROM "${t}" WHERE tree = ?`, A))?.n, 0, `${t} holds nothing of ${A}`);
  }
  assert.equal((await acc.accounts().get<{ n: number }>("SELECT count(*) AS n FROM share_session WHERE link = 'doomed-link'"))?.n, 0);
  const kept = await acc.accounts().get<{ gone_at: number | null }>('SELECT gone_at FROM family_backup WHERE family = ?', A);
  assert.ok(kept?.gone_at, 'its backups are kept, marked with when the family was deleted');
  assert.equal((await acc.accounts().get<{ gone_at: number | null }>('SELECT gone_at FROM family_backup WHERE family = ?', B))?.gone_at, null);
  assert.equal((await acc.accounts().get<{ n: number }>("SELECT count(*) AS n FROM ai_turn WHERE conv = 'doomed-conv'"))?.n, 0);
  assert.equal(await acc.userById(PENDING), undefined, 'the pending account went with its request');
  assert.equal(await acc.accounts().get("SELECT 1 FROM credential WHERE id = 'pending-cred'"), undefined);
  assert.ok(await acc.userById(VIEWER.id), 'members keep their accounts');

  // The other family keeps everything. `family_store` lists only families in Durable Objects, so on Node it is empty.
  assert.ok(await trees.family(B));
  assert.ok(await st.store.media.get(B, 'photo/b.jpg'));
  for (const t of tables) {
    const n = (await acc.accounts().get<{ n: number }>(`SELECT count(*) AS n FROM "${t}" WHERE tree = ?`, B))?.n ?? 0;
    assert.ok(n > 0 || ['ai_background', 'ai_background_spend', 'ai_background_task', 'ai_conversation', 'ai_chat_image', 'ai_portrait', 'ai_provider', 'ai_route', 'ai_spend', 'ai_task_giveup', 'ai_task_run', 'ai_usage', 'ai_operator_spend', 'ai_operator_booking', 'family_policy', 'family_store', 'join_request', 'stats_member', 'stats_once', 'stats_setting'].includes(t), `${t} keeps ${B}'s rows`);
  }
  assert.equal((await acc.accounts().get<{ n: number }>("SELECT count(*) AS n FROM share_session WHERE link = 'oakhaven-link'"))?.n, 1);
});

test('a deletion that stopped after the database is finished by deleting again', async () => {
  await fam.createFamily(STEWARD, { id: 'interrupted', name: 'Interrupted', tagline: '', theme: 'codex' });
  await st.store.dropTree('interrupted');
  assert.ok(await acc.membership(STEWARD.id, 'interrupted'), 'the accounts rows are still there');
  await fam.deleteFamily('interrupted', 'interrupted');
  assert.equal(await acc.membership(STEWARD.id, 'interrupted'), undefined);
});

test('the default family and the last family cannot be deleted', async () => {
  process.env.KINDRED_DEFAULT_TREE = 'birchmoor';
  try {
    await rejectsWith(fam.deleteFamily('birchmoor', 'birchmoor'), 'families.err_default', { id: 'birchmoor' });
  } finally {
    delete process.env.KINDRED_DEFAULT_TREE;
  }
  for (const f of await trees.families()) if (f.id !== 'oakhaven') await fam.deleteFamily(f.id, f.id);
  assert.deepEqual((await trees.families()).map((f) => f.id), ['oakhaven']);
  await rejectsWith(fam.deleteFamily('oakhaven', 'oakhaven'), 'families.err_last');
  assert.ok(await trees.family('oakhaven'));
});

test('emptying a database (deleting on Workers) leaves it as freshly migrated, ready for a family again', async () => {
  await dbs.provisionFamily('emptied', 'Emptied');
  const d = dbs.db('emptied');
  await d.batch([
    st.q("INSERT INTO person (id, given) VALUES ('a', 'Ada'), ('b', 'Bo')"),
    st.q("INSERT INTO parent (child, parent) VALUES ('b', 'a')"),
  ]);
  await st.emptyDatabase(d);
  const left = await d.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  for (const { name } of left) {
    const n = (await d.get<{ n: number }>(`SELECT count(*) AS n FROM "${name}"`))?.n ?? 0;
    if (name === 'd1_migrations' || st.SEEDED_TABLES.has(name)) assert.ok(n > 0, `${name} kept`);
    else assert.equal(n, 0, `${name} is empty`);
  }
  assert.equal(await trees.family('emptied'), undefined);
  assert.equal(await dbs.provisionFamily('emptied', 'Again'), 'created');
});
