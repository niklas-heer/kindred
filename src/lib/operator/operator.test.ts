// node --test src/lib/operator/operator.test.ts: hosting many families (docs/hosting-many-families.md). The migration that makes
// the earliest account the operator, the first new account becoming one, the operator guard (403 for anyone else, and no
// family's records for the operator), who may make a family in each `family_creation` mode, a family made for someone else
// with its steward invitation, the waiting list (approve, decline, the closed form, the hidden field, the limit per network),
// Turnstile with a fake verifier (no network), data requests, storage caps on uploads, suspension, and the last operator.
// Invented names only.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-operator-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;
delete process.env.KINDRED_DEFAULT_TREE;
delete process.env.KINDRED_AUTH;
delete process.env.KINDRED_TURNSTILE_SITE_KEY;
delete process.env.KINDRED_TURNSTILE_SECRET;

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
      export const getRequestIP = () => globalThis.__ip ?? '203.0.113.1';
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

const ops = await load<typeof import('./operator.server.ts')>('/src/lib/operator/operator.server.ts');
const reqs = await load<typeof import('./requests.server.ts')>('/src/lib/operator/requests.server.ts');
const fns = await load<typeof import('./operator.functions.ts')>('/src/lib/operator/operator.functions.ts');
const settings = await load<typeof import('./settings.server.ts')>('/src/lib/operator/settings.server.ts');
const storage = await load<typeof import('./storage.server.ts')>('/src/lib/operator/storage.server.ts');
const turnstile = await load<typeof import('./turnstile.server.ts')>('/src/lib/operator/turnstile.server.ts');
const fam = await load<typeof import('../families.server.ts')>('/src/lib/families.server.ts');
const famFns = await load<typeof import('../families.functions.ts')>('/src/lib/families.functions.ts');
const dbs = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const acc = await load<typeof import('../auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const guard = await load<typeof import('../auth/guard.server.ts')>('/src/lib/auth/guard.server.ts');
const { resetThrottle } = await load<typeof import('../auth/throttle.server.ts')>('/src/lib/auth/throttle.server.ts');
const { closeDatabases } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');

after(async () => {
  turnstile.setTurnstileVerifier(undefined);
  await vite.close();
  closeDatabases();
  rmSync(dir, { recursive: true, force: true });
});

const g = globalThis as unknown as { __signedIn?: unknown; __request?: Request; __ip?: string };
const T = Date.now();
type U = { id: string; name: string; email: string | null; handle: string; created: number; last_seen: null; locale: null; operator: number };
const user = (n: number, name: string, operator = 0): U => ({ id: `00000000-0000-4000-8000-00000000000${n}`, name, email: `${name.toLowerCase()}@example.org`, handle: `h-${n}`, created: T + n, last_seen: null, locale: null, operator });
const OP = user(1, 'Orla', 1);
const STEWARD = user(2, 'Sten');
const VIEWER = user(3, 'Vida');
const OTHER = user(4, 'Otto');
const sql = (s: string, ...p: (string | number | null)[]) => acc.accounts().run(s, ...p);
const one = <R>(s: string, ...p: (string | number | null)[]) => acc.accounts().get<R>(s, ...p);

before(async () => {
  for (const u of [OP, STEWARD, VIEWER, OTHER]) await sql('INSERT INTO user (id, name, email, handle, created, operator) VALUES (?, ?, ?, ?, ?, ?)', u.id, u.name, u.email, u.handle, u.created, u.operator);
  await dbs.provisionFamily('alderby', 'The Alderbys');
  await dbs.provisionFamily('brackwell', 'The Brackwells');
  await acc.accounts().batch([acc.upsertMembership(STEWARD.id, 'alderby', 'steward'), acc.upsertMembership(VIEWER.id, 'alderby', 'viewer')]);
});
/** Signs `u` in for the calls that follow: a new request, as the guard reads the session once per request. */
const asUser = (u: unknown) => { g.__signedIn = u; g.__request = undefined; };
beforeEach(() => { asUser(undefined); resetThrottle(); });

const status = (e: unknown) => (e as { status?: number }).status;
const setMode = async (mode: 'operator' | 'stewards' | 'requests') => {
  const s = await settings.instanceSettings();
  await acc.accounts().batch(settings.saveSettings({ ...s, familyCreation: mode }, OP.id));
};

test('migration 0034 makes the earliest account the operator of an install that already has accounts', () => {
  const db = new DatabaseSync(':memory:');
  const files = readdirSync('migrations/accounts').filter((f) => f.endsWith('.sql')).sort();
  for (const f of files.filter((x) => x < '0034')) db.exec(readFileSync(join('migrations/accounts', f), 'utf8'));
  const add = db.prepare('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)');
  add.run('later', 'Later', 'h1', 2000);
  add.run('earliest', 'Earliest', 'h2', 1000);
  add.run('tied', 'Tied', 'h3', 1000);
  for (const f of files.filter((x) => x >= '0034')) db.exec(readFileSync(join('migrations/accounts', f), 'utf8'));
  const rows = db.prepare('SELECT id, operator FROM user ORDER BY id').all() as { id: string; operator: number }[];
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.id, r.operator])), { earliest: 1, later: 0, tied: 0 });
  db.close();
});

test('a new install: the first account made becomes the operator, the next does not', () => {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations/accounts').filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(join('migrations/accounts', f), 'utf8'));
  for (const name of ['First', 'Second']) {
    const { insert } = acc.newUser(name, null);
    db.prepare(insert.sql).run(...(insert.params as (string | number | null)[]));
  }
  assert.deepEqual(db.prepare('SELECT name, operator FROM user ORDER BY created, rowid').all().map((r) => ({ ...r })), [{ name: 'First', operator: 1 }, { name: 'Second', operator: 0 }]);
  db.close();
});

test('the operator guard: 401 signed out, 403 for a steward or anyone else, the operator through', async () => {
  await assert.rejects(guard.requireOperator(), (e) => status(e) === 401);
  for (const u of [STEWARD, VIEWER]) {
    asUser(u);
    await assert.rejects(guard.requireOperator(), (e) => status(e) === 403);
    asUser(u);
    await assert.rejects(fns.fetchOperatorConsole(), (e) => status(e) === 403);
    asUser(u);
    await assert.rejects(fns.operatorSetStatus({ data: { tree: 'alderby', status: 'suspended' } }), (e) => status(e) === 403);
    asUser(u);
    await assert.rejects(fns.fetchAudit({ data: {} }), (e) => status(e) === 403);
  }
  asUser(OP);
  assert.equal((await guard.requireOperator()).id, OP.id);
  asUser(OP);
  const c = await fns.fetchOperatorConsole();
  assert.deepEqual(c.families.map((f) => f.id), ['alderby', 'brackwell']);
});

test('the operator reads no family: every family guard refuses them, and the console carries no record content', async () => {
  for (const check of [() => guard.requireMember('alderby'), () => guard.requireReader('alderby'), () => guard.requireCan('alderby', 'view')]) {
    asUser(OP);
    await assert.rejects(check(), (e) => status(e) === 403);
  }
  // A family's own server function, through its guard: the operator is not a member.
  asUser(OP);
  await assert.rejects(famFns.editFamily({ data: { tree: 'alderby', opKey: 'operator-edit-1', name: 'X', tagline: '', theme: 'codex' } }), (e) => status(e) === 403);
  asUser(OP);
  const c = await fns.fetchOperatorConsole();
  const alderby = c.families.find((f) => f.id === 'alderby')!;
  assert.deepEqual(Object.keys(alderby).sort(), ['capBytes', 'created', 'id', 'lastActivity', 'members', 'name', 'pendingSteward', 'status', 'stewards', 'usedBytes']);
  assert.equal(alderby.members, 2);
  assert.deepEqual(alderby.stewards, [{ name: 'Sten', email: 'sten@example.org' }]);
});

test('who may make a family, in each family_creation mode', async () => {
  const may = async (u: U) => fam.mayCreate(u, await acc.membershipsOf(u.id));
  assert.equal((await settings.instanceSettings()).familyCreation, 'stewards', 'the default keeps a self-hosted install as it was');
  assert.deepEqual([await may(OP), await may(STEWARD), await may(VIEWER)], [true, true, false]);
  await setMode('operator');
  assert.deepEqual([await may(OP), await may(STEWARD), await may(VIEWER)], [true, false, false]);
  asUser(STEWARD);
  await assert.rejects(famFns.createFamily({ data: { id: 'stens-own', name: 'Mine', tagline: '', theme: 'codex' } }), /Only a steward|can make another/);
  await setMode('requests');
  assert.deepEqual([await may(OP), await may(STEWARD), await may(VIEWER)], [true, false, false]);
  await setMode('stewards');
});

test('a family made for someone: no member, not the operator, and a one-time steward invitation nobody can take over', async () => {
  asUser(OP);
  const made = await fns.operatorCreateFamily({ data: { id: 'corrie', name: 'The Corries', theme: 'codex', stewardName: 'Cara Corrie', stewardEmail: 'cara@example.org' } });
  assert.equal(made.id, 'corrie');
  assert.match(made.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await one<{ n: number }>('SELECT count(*) AS n FROM membership WHERE tree = ?', 'corrie'))!.n, 0);
  const invite = await acc.openInvite(made.token);
  assert.equal(invite?.role, 'steward');
  assert.equal(invite?.email, 'cara@example.org');
  assert.equal((await one<{ invited_name: string }>('SELECT invited_name FROM family_admin WHERE tree = ?', 'corrie'))!.invited_name, 'Cara Corrie');
  // A steward of another family cannot "finish" it as theirs while the invitation waits.
  await assert.rejects(fam.createFamily(STEWARD, { id: 'corrie', name: 'Mine now', tagline: '', theme: 'codex' }), /already a family/);
  asUser(OP);
  const c = await fns.fetchOperatorConsole();
  assert.equal(c.families.find((f) => f.id === 'corrie')?.pendingSteward?.email, 'cara@example.org');
  const log = await settings.auditLog();
  assert.equal(log[0].action, 'family.create');
  assert.equal(log[0].family, 'corrie');
  // A new link replaces the old one.
  asUser(OP);
  const renewed = await fns.operatorRenewLink({ data: { tree: 'corrie' } });
  assert.equal(await acc.openInvite(made.token), undefined);
  assert.ok(await acc.openInvite(renewed.token));
});

test('the waiting list: closed unless the server takes requests; the hidden field; a limit per network; approve and decline', async () => {
  const ask = (over: Partial<Parameters<typeof reqs.submitFamilyRequest>[0]> = {}, ip = '198.51.100.7', honeypot?: string) =>
    reqs.submitFamilyRequest({ name: 'Rhea Rowan', email: 'Rhea@Example.org', familyName: 'The Rowans', message: 'Hello', ...over }, { ip, honeypot });
  await assert.rejects(ask(), (e) => status(e) === 403);
  await setMode('requests');
  assert.deepEqual(await ask(), { email: 'rhea@example.org' });
  // A bot that filled the field nobody sees is thanked, and nothing is kept.
  assert.deepEqual(await ask({ name: 'Bot' }, '198.51.100.99', 'https://spam.example'), { email: 'rhea@example.org' });
  assert.equal((await one<{ n: number }>("SELECT count(*) AS n FROM family_request WHERE name = 'Bot'"))!.n, 0);
  await assert.rejects(ask({ email: 'not-an-email' }), /email address/);
  // Three an hour from one network, then a brake.
  await ask();
  await ask();
  await assert.rejects(ask(), (e) => status(e) === 429);
  // Five a day from one network, even with a fresh process brake (another isolate, a restart).
  resetThrottle();
  await ask();
  await ask();
  resetThrottle();
  await assert.rejects(ask(), (e) => status(e) === 429);
  // Another network is not braked by this one.
  await ask({ name: 'Elsewhere' }, '192.0.2.200');
  await sql("DELETE FROM family_request WHERE name = 'Elsewhere'");

  const open = (await reqs.familyRequests()).filter((r) => r.status === 'open');
  assert.equal(open.length, 5);
  asUser(OP);
  const made = await fns.operatorApproveRequest({ data: { id: open[0].id, familyId: 'rowan', familyName: 'The Rowans', theme: 'modern' } });
  assert.equal(made.id, 'rowan');
  assert.equal((await acc.openInvite(made.token))?.email, 'rhea@example.org');
  asUser(OP);
  await assert.rejects(fns.operatorApproveRequest({ data: { id: open[0].id, familyId: 'rowan-2', familyName: 'Again', theme: 'codex' } }), /already been answered/);
  asUser(OP);
  await fns.operatorDeclineRequest({ data: { id: open[1].id } });
  const after = await reqs.familyRequests();
  assert.equal(after.find((r) => r.id === open[0].id)?.status, 'approved');
  assert.equal(after.find((r) => r.id === open[0].id)?.family, 'rowan');
  assert.equal(after.find((r) => r.id === open[1].id)?.status, 'declined');
  asUser(STEWARD);
  await assert.rejects(fns.operatorDeclineRequest({ data: { id: open[2].id } }), (e) => status(e) === 403);
  await setMode('stewards');
});

test('Turnstile: off without both keys; with them, only a token the (fake) verifier accepts passes', async () => {
  const env = { KINDRED_TURNSTILE_SITE_KEY: 'site-key', KINDRED_TURNSTILE_SECRET: 'secret-key' };
  assert.equal(await turnstile.passesTurnstile(undefined, '198.51.100.1', {}), true);
  assert.equal(await turnstile.passesTurnstile(undefined, '198.51.100.1', { KINDRED_TURNSTILE_SITE_KEY: 'only-site' }), true);
  const seen: [string, string, string | undefined][] = [];
  turnstile.setTurnstileVerifier(async (token, secret, ip) => { seen.push([token, secret, ip]); return token === 'good'; });
  try {
    assert.equal(await turnstile.passesTurnstile(undefined, '198.51.100.1', env), false);
    assert.equal(await turnstile.passesTurnstile('bad', '198.51.100.1', env), false);
    assert.equal(await turnstile.passesTurnstile('good', '198.51.100.1', env), true);
    assert.deepEqual(seen, [['bad', 'secret-key', '198.51.100.1'], ['good', 'secret-key', '198.51.100.1']]);
    // Through a form, with the server's own settings.
    Object.assign(process.env, env);
    assert.equal((await settings.publicInstance()).turnstileSiteKey, 'site-key');
    await assert.rejects(reqs.submitDataRequest({ name: 'Tess', email: 'tess@example.org', family: '', kind: 'access', message: 'Hi' }, { ip: '192.0.2.50', turnstile: 'bad' }), /err_turnstile/);
    await reqs.submitDataRequest({ name: 'Tess', email: 'tess@example.org', family: '', kind: 'access', message: 'Hi' }, { ip: '192.0.2.50', turnstile: 'good' });
  } finally {
    delete process.env.KINDRED_TURNSTILE_SITE_KEY;
    delete process.env.KINDRED_TURNSTILE_SECRET;
    turnstile.setTurnstileVerifier(undefined);
  }
});

test('a data request names a family by its address, reaches its stewards, and is moved on by the operator', async () => {
  await reqs.submitDataRequest({ name: 'Dana Dell', email: 'dana@example.org', family: 'https://kin.example.org/alderby/people', kind: 'deletion', message: 'Please remove my birthday.' }, { ip: '192.0.2.60' });
  await reqs.submitDataRequest({ name: 'Dov', email: 'dov@example.org', family: 'Somebody Else', kind: 'other', message: 'Hm' }, { ip: '192.0.2.61' });
  asUser(STEWARD);
  const theirs = await fns.fetchFamilyDataRequests({ data: { tree: 'alderby' } });
  assert.deepEqual(theirs.map((r) => [r.name, r.kind, r.family]), [['Dana Dell', 'deletion', 'alderby']]);
  asUser(VIEWER);
  await assert.rejects(fns.fetchFamilyDataRequests({ data: { tree: 'alderby' } }), (e) => status(e) === 403);
  asUser(OP);
  await assert.rejects(fns.fetchFamilyDataRequests({ data: { tree: 'alderby' } }), (e) => status(e) === 403, 'the operator is not the family’s steward');
  asUser(OP);
  const all = (await fns.fetchOperatorConsole()).dataRequests;
  assert.ok(all.some((r) => r.name === 'Dov' && r.family === null && r.familyText === 'Somebody Else'));
  asUser(OP);
  await fns.operatorDataRequestStatus({ data: { id: theirs[0].id, status: 'forwarded' } });
  asUser(STEWARD);
  await fns.stewardDataRequestDone({ data: { tree: 'alderby', id: theirs[0].id } });
  assert.equal((await reqs.dataRequests('alderby'))[0].status, 'done');
});

test('storage caps: every upload counts, one over the cap is refused with what is used, deleting makes room, a recount rebuilds', async () => {
  const bytes = (n: number) => new Uint8Array(n).fill(7);
  await dbs.media.put('alderby', 'gallery/one.jpg', bytes(600), 'image/jpeg');
  assert.equal((await storage.storageOf('alderby')).usedBytes, 600);
  asUser(OP);
  await fns.operatorSetCap({ data: { tree: 'alderby', capBytes: 1000 } });
  await assert.rejects(dbs.media.put('alderby', 'gallery/two.jpg', bytes(600), 'image/jpeg'), (e: Error) => {
    assert.equal(status(e), 403);
    assert.match(e.message, /storage is full: 600 B of 1 KB used/);
    return true;
  });
  assert.equal(await dbs.media.get('alderby', 'gallery/two.jpg'), undefined, 'the refused file was never stored');
  await dbs.media.put('alderby', 'gallery/small.jpg', bytes(400), 'image/jpeg');
  await dbs.media.delete('alderby', 'gallery/one.jpg');
  await dbs.media.put('alderby', 'gallery/two.jpg', bytes(600), 'image/jpeg');
  assert.equal((await storage.storageOf('alderby')).usedBytes, 1000);
  // Another family is not touched by this one's cap.
  await dbs.media.put('brackwell', 'gallery/big.jpg', bytes(5000), 'image/jpeg');

  // The stewards see what their family uses.
  asUser(STEWARD);
  const overview = await famFns.fetchFamilies();
  assert.deepEqual(overview.families.find((f) => f.id === 'alderby')?.storage, { usedBytes: 1000, capBytes: 1000 });
  assert.equal(overview.families.find((f) => f.id === 'alderby')?.people, 0);

  // Drift: a row with no file, and a file the records point at that was never counted. The recount fixes both.
  await sql('INSERT INTO media_usage (tree, key, bytes, at) VALUES (?, ?, ?, ?)', 'alderby', 'gallery/ghost.jpg', 999, 1);
  await dbs.db('alderby').run("INSERT INTO media (key, mime, width, height, uploaded_by, uploaded_at) VALUES ('gallery/small.jpg', 'image/jpeg', 1, 1, 'x', '2026-01-01')");
  await dbs.db('alderby').run("INSERT INTO media (key, mime, width, height, uploaded_by, uploaded_at) VALUES ('gallery/two.jpg', 'image/jpeg', 1, 1, 'x', '2026-01-01')");
  await sql("DELETE FROM media_usage WHERE key = 'gallery/two.jpg'");
  asUser(OP);
  assert.deepEqual(await fns.operatorRecount({ data: { tree: 'alderby' } }), { usedBytes: 1000 });
  assert.ok((await one<{ counted_at: number }>('SELECT counted_at FROM family_admin WHERE tree = ?', 'alderby'))!.counted_at > 0);
  assert.deepEqual(await storage.dueForRecount(['alderby', 'brackwell']), ['brackwell']);
  asUser(OP);
  await fns.operatorSetCap({ data: { tree: 'alderby', capBytes: null } });
});

test('a suspended family is read-only for its members, with the reason; resuming opens it again', async () => {
  asUser(OP);
  await fns.operatorSetStatus({ data: { tree: 'alderby', status: 'suspended' } });
  asUser(STEWARD);
  assert.equal((await guard.requireMember('alderby')).role, 'steward', 'reading goes on');
  await assert.rejects(dbs.db('alderby').run("INSERT INTO meta (key, value) VALUES ('x', 'y')"), /suspended/);
  asUser(STEWARD);
  await assert.rejects(guard.requireCan('alderby', 'add-story'), (e: Error) => status(e) === 403 && /suspended/.test(e.message));
  asUser(STEWARD);
  assert.equal((await famFns.fetchFamilies()).families.find((f) => f.id === 'alderby')?.suspended, true);
  // Another family of the same member, in another request, is not touched.
  asUser(OP);
  await fns.operatorSetStatus({ data: { tree: 'alderby', status: 'active' } });
  asUser(STEWARD);
  await guard.requireCan('alderby', 'add-story');
  const log = await settings.auditLog();
  assert.deepEqual(log.slice(0, 2).map((e) => e.action), ['family.resume', 'family.suspend']);
});

test('operators: another can be made by email; one can step down, never the last', async () => {
  asUser(OP);
  await assert.rejects(fns.operatorRemove({ data: { account: OP.id } }), /at least one operator/);
  asUser(OP);
  await assert.rejects(fns.operatorAdd({ data: { email: 'nobody@example.org' } }), /no account with that email/);
  asUser(OP);
  await fns.operatorAdd({ data: { email: 'otto@example.org' } });
  assert.equal((await one<{ operator: number }>('SELECT operator FROM user WHERE id = ?', OTHER.id))!.operator, 1);
  asUser(OP);
  await fns.operatorRemove({ data: { account: OP.id } });
  assert.equal((await one<{ operator: number }>('SELECT operator FROM user WHERE id = ?', OP.id))!.operator, 0);
  // Back as it was, by the other operator.
  asUser({ ...OTHER, operator: 1 });
  await fns.operatorAdd({ data: { email: 'orla@example.org' } });
  asUser({ ...OTHER, operator: 1 });
  await fns.operatorRemove({ data: { account: OTHER.id } });
  const actions = (await settings.auditLog()).slice(0, 4).map((e) => e.action);
  assert.deepEqual(actions, ['operator.step_down', 'operator.add', 'operator.step_down', 'operator.add']);
});

test('a demo has no operator, and the console writes nothing in one', async () => {
  process.env.KINDRED_DEMO = '1';
  try {
    asUser(OP);
    await assert.rejects(guard.requireOperator(), (e) => status(e) === 403);
    asUser(OP);
    await assert.rejects(fns.operatorSaveSettings({ data: { ...(await settings.instanceSettings()), instanceName: 'Demo' } }), (e) => status(e) === 403);
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  assert.equal((await settings.instanceSettings()).instanceName, '');
});

test('instance settings: the legal links show only for what is filled in', async () => {
  assert.deepEqual((await settings.publicInstance()).legal, { impressum: false, privacy: false, terms: false, report: false });
  asUser(OP);
  const s = await settings.instanceSettings();
  await fns.operatorSaveSettings({ data: { ...s, impressum: 'Orla Example\nSample Street 1', privacy: 'https://example.org/privacy', defaultCapBytes: 2_000_000 } });
  const pub = await settings.publicInstance();
  assert.deepEqual(pub.legal, { impressum: true, privacy: true, terms: false, report: false });
  assert.equal((await settings.legalTexts()).impressum, 'Orla Example\nSample Street 1');
  // A family made from now on gets the default cap.
  asUser(OP);
  await fns.operatorCreateFamily({ data: { id: 'dunmore', name: 'The Dunmores', theme: 'codex', stewardName: 'Dee', stewardEmail: '' } });
  assert.equal((await storage.storageOf('dunmore')).capBytes, 2_000_000);
  asUser(OP);
  await fns.operatorSaveSettings({ data: { ...s } });
  assert.equal((await settings.publicInstance()).legal.impressum, false);
});

test('deleting a family as the operator: its id typed, logged, and its storage rows go with it', async () => {
  await dbs.media.put('dunmore', 'gallery/d.jpg', new Uint8Array(10), 'image/jpeg');
  asUser(OP);
  // Kindred's own sign-in asks for a fresh passkey proof first, as for a steward.
  await assert.rejects(fns.operatorDeleteFamily({ data: { tree: 'dunmore', confirm: 'dunmore' } }), (e) => (e as { code?: string }).code === 'reauth');
  await assert.rejects(ops.deleteFamilyAsOperator(OP, 'dunmore', 'wrong'), /Type/i);
  await ops.deleteFamilyAsOperator(OP, 'dunmore', 'dunmore');
  assert.equal((await one<{ n: number }>('SELECT count(*) AS n FROM media_usage WHERE tree = ?', 'dunmore'))!.n, 0);
  assert.equal((await settings.auditLog())[0].action, 'family.delete');
});
