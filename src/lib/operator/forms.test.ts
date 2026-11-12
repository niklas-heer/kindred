// node --test src/lib/operator/forms.test.ts: the operator's second round (docs/hosting-many-families.md, accounts migration
// 0037). The public forms reserve and store in one guarded batch, under a server-wide ceiling of open requests; the console
// pages through decided requests and warns when the forms have no Turnstile; data requests reach a family's stewards only once
// forwarded; a family can be read-only or closed (members refused, guests and share links refused); operators' devices are told
// of a new request, with nothing of it, at most once in ten minutes; the terms are accepted when a family is made and a
// steward invitation taken; and an account's families are limited while stewards make them. Invented names only.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-forms-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;
delete process.env.KINDRED_DEFAULT_TREE;
delete process.env.KINDRED_AUTH;
delete process.env.KINDRED_TURNSTILE_SITE_KEY;
delete process.env.KINDRED_TURNSTILE_SECRET;
for (const k of ['KINDRED_VAPID_PUBLIC_KEY', 'KINDRED_VAPID_PRIVATE_JWK', 'KINDRED_VAPID_SUBJECT']) delete process.env[k];

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

const reqs = await load<typeof import('./requests.server.ts')>('/src/lib/operator/requests.server.ts');
const fns = await load<typeof import('./operator.functions.ts')>('/src/lib/operator/operator.functions.ts');
const settings = await load<typeof import('./settings.server.ts')>('/src/lib/operator/settings.server.ts');
const push = await load<typeof import('./operator-push.server.ts')>('/src/lib/operator/operator-push.server.ts');
const terms = await load<typeof import('./terms.server.ts')>('/src/lib/operator/terms.server.ts');
const famFns = await load<typeof import('../families.functions.ts')>('/src/lib/families.functions.ts');
const dbs = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const acc = await load<typeof import('../auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const authFns = await load<typeof import('../auth/functions.ts')>('/src/lib/auth/functions.ts');
const share = await load<typeof import('../auth/share.server.ts')>('/src/lib/auth/share.server.ts');
const shareFns = await load<typeof import('../auth/share.functions.ts')>('/src/lib/auth/share.functions.ts');
const guard = await load<typeof import('../auth/guard.server.ts')>('/src/lib/auth/guard.server.ts');
const reminders = await load<typeof import('../reminders.server.ts')>('/src/lib/reminders.server.ts');
const webpush = await load<typeof import('../webpush.ts')>('/src/lib/webpush.ts');
const { resetThrottle } = await load<typeof import('../auth/throttle.server.ts')>('/src/lib/auth/throttle.server.ts');
const { closeDatabases } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');

after(async () => {
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
const save = async (change: Partial<Awaited<ReturnType<typeof settings.instanceSettings>>>) => {
  const s = await settings.instanceSettings();
  await acc.accounts().batch(settings.saveSettings({ ...s, ...change }, OP.id));
};
/** The networks the ceiling test sends from: one address in each of many /24s. */
const ip = (i: number) => `10.${Math.floor(i / 256)}.${i % 256}.9`;

test('migration 0037: a new install limits each account to 5 families; one that had accounts keeps no limit', () => {
  const files = readdirSync('migrations/accounts').filter((f) => f.endsWith('.sql')).sort();
  const fresh = new DatabaseSync(':memory:');
  for (const f of files) fresh.exec(readFileSync(join('migrations/accounts', f), 'utf8'));
  assert.deepEqual({ ...fresh.prepare("SELECT value FROM instance_setting WHERE key = 'families_per_account'").get() }, { value: '5' });
  fresh.close();
  const old = new DatabaseSync(':memory:');
  for (const f of files.filter((x) => x < '0037')) old.exec(readFileSync(join('migrations/accounts', f), 'utf8'));
  old.prepare('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)').run('u', 'Una', 'h', 1);
  for (const f of files.filter((x) => x >= '0037')) old.exec(readFileSync(join('migrations/accounts', f), 'utf8'));
  assert.equal(old.prepare("SELECT value FROM instance_setting WHERE key = 'families_per_account'").get(), undefined);
  old.close();
});

test('the forms: the ceiling of open requests is held in the batch that stores, and the form then says it is closed', async () => {
  await save({ familyCreation: 'requests' });
  const ask = (i: number) => reqs.submitFamilyRequest({ name: `Asker ${i}`, email: `asker${i}@example.org`, familyName: 'The Askers', message: '' }, { ip: ip(i) });
  // 199 wait already; two arrive at once from two networks: one takes the last place, the other is told the form is full.
  const rows = Array.from({ length: 199 }, (_, i) => `('pre-${i}', 'Pre ${i}', 'pre@example.org', 'The Pres', ${T - 1000}, 'xx${i}')`);
  await sql(`INSERT INTO family_request (id, name, email, family_name, created, network) VALUES ${rows.join(', ')}`);
  assert.equal((await settings.publicInstance()).full.family, false);
  const raced = await Promise.allSettled([ask(1000), ask(1001)]);
  assert.deepEqual(raced.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  const refused = raced.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.equal(status(refused.reason), 403);
  assert.match(refused.reason.message, /err_form_full/);
  assert.equal((await one<{ n: number }>("SELECT count(*) AS n FROM family_request WHERE status = 'open'"))!.n, 200);
  assert.equal((await settings.publicInstance()).full.family, true);
  // A bot that fills the hidden field is still only thanked.
  assert.deepEqual(await reqs.submitFamilyRequest({ name: 'Bot', email: 'bot@example.org', familyName: 'X', message: '' }, { ip: ip(2000), honeypot: 'x' }), { email: 'bot@example.org' });
  // Answering one opens a place again.
  asUser(OP);
  await fns.operatorDeclineRequest({ data: { id: 'pre-0' } });
  await ask(1002);
  await sql("DELETE FROM family_request WHERE id LIKE 'pre-%' OR name LIKE 'Asker %'");
  await save({ familyCreation: 'stewards' });
});

test('the console: open requests in full, decided ones a page at a time; a warning when the forms have no Turnstile', async () => {
  const rows = Array.from({ length: 120 }, (_, i) => `('old-${String(i).padStart(3, '0')}', 'Old ${i}', 'old@example.org', 'The Olds', ${T - 10_000}, 'declined', ${T - 10_000 + i})`);
  await sql(`INSERT INTO family_request (id, name, email, family_name, created, status, decided_at) VALUES ${rows.join(', ')}`);
  asUser(OP);
  const c = await fns.fetchOperatorConsole();
  assert.equal(c.familyRequests.decided.items.length, 50);
  assert.equal(c.familyRequests.decided.items[0].name, 'Old 119', 'newest first');
  assert.equal(c.familyRequests.decided.more, true);
  assert.equal(c.turnstile, false);
  asUser(OP);
  const second = await fns.fetchOlderRequests({ data: { kind: 'family', offset: 50 } });
  asUser(OP);
  const third = await fns.fetchOlderRequests({ data: { kind: 'family', offset: 100 } });
  assert.deepEqual([second.items.length, second.more, third.items.length, third.more], [50, true, 20, false]);
  assert.equal(new Set([...c.familyRequests.decided.items, ...second.items, ...third.items].map((r) => r.id)).size, 120);
  asUser(STEWARD);
  await assert.rejects(fns.fetchOlderRequests({ data: { kind: 'family', offset: 0 } }), (e) => status(e) === 403);
  Object.assign(process.env, { KINDRED_TURNSTILE_SITE_KEY: 'site', KINDRED_TURNSTILE_SECRET: 'secret' });
  try {
    asUser(OP);
    assert.equal((await fns.fetchOperatorConsole()).turnstile, true);
  } finally {
    delete process.env.KINDRED_TURNSTILE_SITE_KEY;
    delete process.env.KINDRED_TURNSTILE_SECRET;
  }
  await sql("DELETE FROM family_request WHERE id LIKE 'old-%'");
});

test('a data request reaches the stewards only while forwarded; open again takes it back; answered without them, never', async () => {
  await reqs.submitDataRequest({ name: 'Dana Dell', email: 'dana@example.org', family: 'alderby', kind: 'access', message: 'What do you hold about me?' }, { ip: '192.0.2.70' });
  await reqs.submitDataRequest({ name: 'Eda Ell', email: 'eda@example.org', family: 'alderby', kind: 'deletion', message: 'Please remove me.' }, { ip: '192.0.2.71' });
  const [dana, eda] = (await reqs.dataRequests()).open;
  const forStewards = async () => { asUser(STEWARD); return (await fns.fetchFamilyDataRequests({ data: { tree: 'alderby' } })).map((r) => r.name); };
  assert.deepEqual(await forStewards(), []);
  // Not forwarded: a steward cannot mark it answered either.
  asUser(STEWARD);
  await assert.rejects(fns.stewardDataRequestDone({ data: { tree: 'alderby', id: dana.id } }), /already been answered|gone/i);
  asUser(OP);
  await fns.operatorDataRequestStatus({ data: { id: dana.id, status: 'forwarded' } });
  assert.deepEqual(await forStewards(), ['Dana Dell']);
  asUser(OP);
  await fns.operatorDataRequestStatus({ data: { id: dana.id, status: 'open' } });
  assert.deepEqual(await forStewards(), [], 'taken back');
  assert.equal((await one<{ forwarded_at: number | null }>('SELECT forwarded_at FROM data_request WHERE id = ?', dana.id))!.forwarded_at, null);
  asUser(OP);
  await fns.operatorDataRequestStatus({ data: { id: eda.id, status: 'done' } });
  assert.deepEqual(await forStewards(), []);
  assert.equal(await reqs.waitingCount(), 1, 'Dana’s, open again; Eda’s is answered');
  await sql('DELETE FROM data_request');
});

test('closed: members are refused with the reason, guests and the share link too; read-only keeps guests reading; both logged', async () => {
  const link = await share.makeShareLink({ tree: 'alderby', password: false, days: null, createdBy: STEWARD.id });
  const row = (await share.shareLinkOf('alderby'))!;
  const before = (await share.startGuestVisit(row))!;
  // Read-only: guests keep reading, members read.
  asUser(OP);
  await fns.operatorSetStatus({ data: { tree: 'alderby', status: 'suspended' } });
  assert.ok(await share.guestVisitByToken(before.token), 'a guest keeps reading a read-only family');
  asUser(STEWARD);
  await guard.requireMember('alderby');
  // Closed.
  asUser(OP);
  await fns.operatorSetStatus({ data: { tree: 'alderby', status: 'closed' } });
  asUser(OP);
  assert.equal((await fns.fetchOperatorConsole()).families.find((f) => f.id === 'alderby')?.status, 'closed');
  for (const u of [STEWARD, VIEWER]) {
    asUser(u);
    await assert.rejects(guard.requireMember('alderby'), (e: Error) => status(e) === 403 && /closed by the server’s operator/.test(e.message));
    asUser(u);
    await assert.rejects(guard.requireReader('alderby'), (e: Error) => status(e) === 403 && /closed/.test(e.message));
  }
  assert.equal((await acc.membership(STEWARD.id, 'alderby'))?.closed, 1);
  assert.equal(await share.guestVisitByToken(before.token), undefined, 'the guest inside is out');
  assert.equal(await share.startGuestVisit(row), undefined, 'and no new visit starts');
  assert.deepEqual(await shareFns.fetchShareEntry({ data: { token: link.token } }), { status: 'closed' });
  // A family closed for one member's family leaves their other families alone.
  asUser(OP);
  await fns.operatorSetStatus({ data: { tree: 'alderby', status: 'active' } });
  asUser(STEWARD);
  await guard.requireCan('alderby', 'add-story');
  assert.ok(await share.startGuestVisit((await share.shareLinkOf('alderby'))!));
  const log = (await settings.auditLog()).map((e) => e.action);
  assert.deepEqual(log.slice(0, 3), ['family.resume', 'family.close', 'family.suspend']);
  await share.revokeShareLink('alderby');
});

test('operators’ devices hear of a new request: nothing of it, once in ten minutes, never another account’s', async () => {
  const b64 = webpush.b64url;
  const device = async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    return { p256dh: b64(await crypto.subtle.exportKey('raw', kp.publicKey)), auth: b64(crypto.getRandomValues(new Uint8Array(16))) };
  };
  const signer = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const vapid = { publicKey: b64(await crypto.subtle.exportKey('raw', signer.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', signer.privateKey), subject: 'mailto:test@example.org' };
  const opDevice = 'https://fcm.googleapis.com/fcm/send/orla';
  const otherDevice = 'https://fcm.googleapis.com/fcm/send/otto';
  await push.saveOperatorPush(OP.id, { endpoint: opDevice, keys: await device() }, 'de');
  await push.saveOperatorPush(OTHER.id, { endpoint: otherDevice, keys: await device() }, 'en');
  await assert.rejects(push.saveOperatorPush(OP.id, { endpoint: 'https://evil.example/relay', keys: await device() }, 'en'), /push service/);
  const sent: { url: string; bytes: number }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => { sent.push({ url, bytes: (init.body as Uint8Array).byteLength }); return new Response(null, { status: 201 }); }) as unknown as typeof fetch;
  const t0 = Date.now();
  assert.equal(await push.notifyOperators('family', vapid, fakeFetch, t0), 1);
  assert.deepEqual(sent.map((s) => s.url), [opDevice], 'only an operator’s device');
  // An operator who steps down hears nothing more, though the device row stays until it is turned off.
  await sql('UPDATE user SET operator = 0 WHERE id = ?', OP.id);
  assert.equal(await push.notifyOperators('family', vapid, fakeFetch, t0 + 2 * push.OPERATOR_PUSH_GAP_MS), 0);
  await sql('UPDATE user SET operator = 1 WHERE id = ?', OP.id);
  assert.equal(await push.notifyOperators('data', vapid, fakeFetch, t0 + 60_000), 0, 'not again within ten minutes');
  assert.equal(await push.notifyOperators('data', vapid, fakeFetch, t0 + 2 * push.OPERATOR_PUSH_GAP_MS + 1), 1);
  assert.equal(await push.notifyOperators('family', null, fakeFetch, t0 + 3 * push.OPERATOR_PUSH_GAP_MS), 0, 'without VAPID keys nothing is sent');
  // A device the push service reports gone is removed.
  const gone = (async () => new Response(null, { status: 410 })) as unknown as typeof fetch;
  await push.notifyOperators('family', vapid, gone, t0 + 4 * push.OPERATOR_PUSH_GAP_MS);
  assert.equal(await push.operatorPushOn(OP.id, opDevice), false);
  // Signing out on a device forgets it; turning reminders off for a family keeps the browser's subscription while this uses it.
  await push.saveOperatorPush(OP.id, { endpoint: opDevice, keys: await device() }, 'en');
  assert.equal(await reminders.removeRegistration(OP.id, 'alderby', opDevice), 1);
  await reminders.forgetDevice(OP.id, opDevice);
  assert.equal(await push.operatorPushOn(OP.id, opDevice), false);
  // Through the console: an operator only, and the switch reads back.
  asUser(OP);
  await fns.setOperatorPush({ data: { on: true, endpoint: opDevice, keys: await device(), locale: 'af' } });
  asUser(OP);
  assert.deepEqual(await fns.fetchOperatorPush({ data: { endpoint: opDevice } }), { on: true });
  asUser(STEWARD);
  await assert.rejects(fns.fetchOperatorPush({ data: { endpoint: opDevice } }), (e) => status(e) === 403);
  asUser(OP);
  assert.deepEqual(await fns.setOperatorPush({ data: { on: false, endpoint: opDevice } }), { remaining: 0 });
  await sql('DELETE FROM operator_push');
});

test('a new request counts in the account menu’s badge, for operators only', async () => {
  assert.equal(await reqs.waitingCount(), 0);
  await reqs.submitDataRequest({ name: 'Fay', email: 'fay@example.org', family: '', kind: 'other', message: 'Hello' }, { ip: '192.0.2.80' });
  assert.equal(await reqs.waitingCount(), 1);
  asUser(OP);
  assert.equal((await authFns.fetchSession()).operatorWaiting, 1);
  asUser(STEWARD);
  assert.equal((await authFns.fetchSession()).operatorWaiting, undefined, 'only an operator is told');
  await sql('DELETE FROM data_request');
});

test('the terms: asked of whoever makes a family and takes a steward invitation, recorded with their version; never of an operator', async () => {
  assert.equal(await terms.termsVersion(), null);
  await save({ terms: 'Be kind to each other.' });
  const version = await terms.termsVersion();
  assert.match(version ?? '', /^[0-9a-f]{16}$/);
  // Making a family.
  asUser(STEWARD);
  await assert.rejects(famFns.createFamily({ data: { id: 'stens-two', name: 'Sten’s Second', tagline: '', theme: 'codex' } }), /accept the terms/);
  assert.equal(await dbs.store.treeIds().then((ids) => ids.includes('stens-two')), false, 'nothing made');
  asUser(STEWARD);
  assert.equal((await famFns.fetchFamilies()).terms, true);
  asUser(STEWARD);
  await famFns.createFamily({ data: { id: 'stens-two', name: 'Sten’s Second', tagline: '', theme: 'codex', acceptTerms: true } });
  assert.deepEqual({ ...(await one<Record<string, unknown>>('SELECT user, version, action, family FROM terms_acceptance WHERE family = ?', 'stens-two')) },
    { user: STEWARD.id, version, action: 'family.create', family: 'stens-two' });
  asUser(OP);
  assert.equal((await famFns.fetchFamilies()).terms, undefined, 'the operator wrote them');
  // A steward invitation asks; a viewer's does not.
  const steward = await acc.createInvite({ tree: 'alderby', role: 'steward', email: null, createdBy: STEWARD.id });
  const viewer = await acc.createInvite({ tree: 'brackwell', role: 'viewer', email: null, createdBy: OP.id });
  asUser(OTHER);
  assert.equal((await authFns.fetchInvite({ data: { token: steward.token } })).terms, true);
  asUser(OTHER);
  assert.equal((await authFns.fetchInvite({ data: { token: viewer.token } })).terms, undefined);
  asUser(OTHER);
  await assert.rejects(authFns.acceptInvite({ data: { token: steward.token } }), /accept the terms/);
  assert.equal(await acc.membership(OTHER.id, 'alderby'), undefined);
  asUser(OTHER);
  await authFns.acceptInvite({ data: { token: steward.token, acceptTerms: true } });
  assert.equal((await acc.membership(OTHER.id, 'alderby'))?.role, 'steward');
  asUser(OTHER);
  await authFns.acceptInvite({ data: { token: viewer.token } });
  assert.deepEqual((await acc.accounts().all<{ action: string; family: string }>('SELECT action, family FROM terms_acceptance WHERE user = ?', OTHER.id)).map((r) => ({ ...r })),
    [{ action: 'invite.steward', family: 'alderby' }]);
  // Changed terms are a new version.
  await save({ terms: 'Be kind to each other, always.' });
  assert.notEqual(await terms.termsVersion(), version);
  await save({ terms: '' });
  await sql('DELETE FROM membership WHERE user = ?', OTHER.id);
});

test('families per account: counted while stewards make families, shown on the Families page; operators unlimited', async () => {
  // This test database was made fresh, so migration 0037 set 5.
  assert.equal((await settings.instanceSettings()).familiesPerAccount, 5);
  await save({ familiesPerAccount: 2 });
  asUser(STEWARD);
  const before = (await famFns.fetchFamilies()).limit;
  assert.deepEqual(before, { max: 2, made: 1 }, 'stens-two, from the terms test');
  asUser(STEWARD);
  await famFns.createFamily({ data: { id: 'stens-three', name: 'Sten’s Third', tagline: '', theme: 'codex' } });
  asUser(STEWARD);
  await assert.rejects(famFns.createFamily({ data: { id: 'stens-four', name: 'Sten’s Fourth', tagline: '', theme: 'codex' } }), (e: Error) => status(e) === 403 && /2 families/.test(e.message));
  asUser(STEWARD);
  assert.deepEqual((await famFns.fetchFamilies()).limit, { max: 2, made: 2 });
  // Two requests at the last slot at once: both pass the check before writing, and the batch that records the family lets
  // exactly one through. The refused one leaves no database behind.
  await save({ familiesPerAccount: 3 });
  asUser(STEWARD);
  const raced = await Promise.allSettled(['stens-five', 'stens-six'].map((id) => famFns.createFamily({ data: { id, name: 'Sten’s Race', tagline: '', theme: 'codex' } })));
  assert.equal(raced.filter((r) => r.status === 'fulfilled').length, 1, 'one family made');
  const lost = raced.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.ok(status(lost.reason) === 403 && /3 families/.test(lost.reason.message), String(lost.reason));
  asUser(STEWARD);
  assert.deepEqual((await famFns.fetchFamilies()).limit, { max: 3, made: 3 });
  assert.equal((await dbs.store.treeIds()).filter((id) => id === 'stens-five' || id === 'stens-six').length, 1, 'the refused family\'s database is gone');
  await save({ familiesPerAccount: 2 });
  asUser(OP);
  assert.equal((await famFns.fetchFamilies()).limit, undefined);
  asUser(OP);
  await famFns.createFamily({ data: { id: 'orlas-own', name: 'Orla’s Own', tagline: '', theme: 'codex' } });
  // Through the console's settings, and none again.
  asUser(OP);
  await fns.operatorSaveSettings({ data: { ...(await settings.instanceSettings()), familiesPerAccount: null } });
  asUser(STEWARD);
  await famFns.createFamily({ data: { id: 'stens-four', name: 'Sten’s Fourth', tagline: '', theme: 'codex' } });
});
