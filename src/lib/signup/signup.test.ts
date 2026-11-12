// node --test src/lib/signup/signup.test.ts: hosting and sign-up (docs/hosting-many-families.md, accounts migration 0043).
// An install that never opened the Hosting tab is `single` and takes no sign-ups; sign-up is refused until the server is
// ready; one step makes the account, the family and its steward, records the terms, the processing agreement and the age;
// the limits (per day, the ceiling, per network, per account, a code's uses) hold when sign-ups race; codes open sign-up
// while the server takes requests; Turnstile is checked by the server (faked here); the public facts name no family and
// count nothing; a demo and a "View as" preview change nothing. Invented names only.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-signup-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
for (const k of ['KINDRED_DEMO', 'KINDRED_DEFAULT_TREE', 'KINDRED_AUTH', 'KINDRED_TURNSTILE_FAKE', 'KINDRED_JURISDICTION']) delete process.env[k];
process.env.KINDRED_TURNSTILE_SITE_KEY = 'site-key';
process.env.KINDRED_TURNSTILE_SECRET = 'secret';

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

const signup = await load<typeof import('./signup.server.ts')>('/src/lib/signup/signup.server.ts');
const hosting = await load<typeof import('./settings.server.ts')>('/src/lib/signup/settings.server.ts');
const fns = await load<typeof import('./signup.functions.ts')>('/src/lib/signup/signup.functions.ts');
const opFns = await load<typeof import('../operator/operator.functions.ts')>('/src/lib/operator/operator.functions.ts');
const opSettings = await load<typeof import('../operator/settings.server.ts')>('/src/lib/operator/settings.server.ts');
const turnstile = await load<typeof import('../operator/turnstile.server.ts')>('/src/lib/operator/turnstile.server.ts');
const acc = await load<typeof import('../auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const dbs = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const { store } = await load<typeof import('../store/index.ts')>('/src/lib/store/index.ts');
const { AuthError } = await load<typeof import('../auth/errors.ts')>('/src/lib/auth/errors.ts');
const { resetThrottle } = await load<typeof import('../auth/throttle.server.ts')>('/src/lib/auth/throttle.server.ts');
const { closeDatabases } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');

after(async () => {
  turnstile.setTurnstileVerifier(undefined);
  await vite.close();
  closeDatabases();
  rmSync(dir, { recursive: true, force: true });
});

const g = globalThis as unknown as { __signedIn?: unknown; __request?: Request; __ip?: string; __kindredRequestRefusal?: () => unknown };
const T = Date.now();
type U = { id: string; name: string; email: string | null; handle: string; created: number; last_seen: null; locale: null; operator: number };
const user = (n: number, name: string, operator = 0): U => ({ id: `00000000-0000-4000-8000-00000000000${n}`, name, email: `${name.toLowerCase()}@example.org`, handle: `h-${n}`, created: T + n, last_seen: null, locale: null, operator });
const OP = user(1, 'Orla', 1);
const SIGNED = user(2, 'Sigrun');
const sql = (s: string, ...p: (string | number | null)[]) => acc.accounts().run(s, ...p);
const one = <R>(s: string, ...p: (string | number | null)[]) => acc.accounts().get<R>(s, ...p);
const count = async (s: string, ...p: (string | number | null)[]) => (await one<{ n: number }>(s, ...p))!.n;
const asUser = (u: unknown) => { g.__signedIn = u; g.__request = undefined; };
const message = (e: unknown) => (e as Error).message;
const status = (e: unknown) => (e as { status?: number }).status;

before(async () => {
  for (const u of [OP, SIGNED]) await sql('INSERT INTO user (id, name, email, handle, created, operator) VALUES (?, ?, ?, ?, ?, ?)', u.id, u.name, u.email, u.handle, u.created, u.operator);
  await dbs.provisionFamily('alderby', 'The Alderbys');
  // Turnstile, faked: "good" passes, anything else fails. Nothing reaches Cloudflare.
  turnstile.setTurnstileVerifier(async (token) => token === 'good');
});
beforeEach(() => { asUser(undefined); resetThrottle(); g.__ip = undefined; });

const saveOp = async (change: Partial<Awaited<ReturnType<typeof opSettings.instanceSettings>>>) => {
  const s = await opSettings.instanceSettings();
  await acc.accounts().batch(opSettings.saveSettings({ ...s, ...change }, OP.id));
};
const saveHosting = async (change: Partial<Awaited<ReturnType<typeof hosting.hostingSettings>>>) => {
  const s = await hosting.hostingSettings();
  await acc.accounts().batch(hosting.saveHosting({ ...s, ...change }, OP.id));
};
const READY = { impressum: 'Orla Example, 1 Example Street', privacy: 'We keep what you write.', terms: 'Be kind.', defaultCapBytes: 500_000_000 };
/** A server ready for sign-up, with sign-up on and these limits. */
const open = async (limits: Partial<Awaited<ReturnType<typeof hosting.hostingSettings>>> = {}) => {
  await saveHosting({ mode: 'hosting', perAccount: 1, perDay: 20, total: 200, unverified: 'open', ...limits });
  await saveOp({ ...READY, familyCreation: 'signup' });
};

let n = 0;
/** A fresh family id and form for each sign-up. */
const form = (extra: Partial<Parameters<typeof signup.cleanForm>[0]> = {}) => {
  n++;
  return signup.cleanForm({ name: `Ines ${n}`, familyName: `The Ivers ${n}`, familyId: `ivers-${n}`, email: `ines${n}@example.org`, accept: true, age16: true, ...extra }, true);
};
/** A new account signing up with a passkey its device made (the WebAuthn check itself is passkeys.server.ts's). */
const newAccount = (name: string): Parameters<typeof signup.completeSignup>[0] => ({
  kind: 'passkey', name, handle: `handle-${name}-${Math.random()}`, locale: null,
  credential: { id: `cred-${name}-${Math.random()}`, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: [], synced: false, device: 'Mac' },
});
/** The network key of an address (an IPv4 address is its own network). */
const net = (i: number) => signup.networkKey(`10.${i}.0.9`);

test('migration 0043 runs on every earlier schema; an install that never opened the Hosting tab is `single`, with sign-up closed', async () => {
  const fresh = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations/accounts').filter((x) => x.endsWith('.sql')).sort()) fresh.exec(readFileSync(join('migrations/accounts', f), 'utf8'));
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE name = 'signup_code'").get());
  // A new account's passkey ceremony has a challenge of its own.
  fresh.prepare("INSERT INTO challenge (id, challenge, purpose, expires) VALUES ('c', 'x', 'signup', 1)").run();
  fresh.close();
  const h = await hosting.hostingSettings();
  assert.equal(h.mode, 'single');
  assert.equal((await opSettings.instanceSettings()).familyCreation, 'stewards');
  const pub = await hosting.publicHosting();
  assert.equal(pub.mode, 'single');
  assert.deepEqual({ open: pub.signup.open, reason: pub.signup.reason, requests: pub.signup.requests }, { open: false, reason: 'closed', requests: false });
  await assert.rejects(signup.completeSignup(newAccount('Early'), form(), await net(1)), /does not take new families/);
});

test('sign-up is refused until the server is ready, with what is missing; hosting cannot be left while sign-up is on', async () => {
  asUser(OP);
  const settings = await opSettings.instanceSettings();
  await assert.rejects(opFns.operatorSaveSettings({ data: { ...settings, familyCreation: 'signup' } }), (e: Error) =>
    status(e) === 400 && /needs a few things first: hosting, impressum, privacy, terms, cap\./.test(e.message));
  // Turnstile's keys are set in this test's environment; without them it is missing too.
  const keys = [process.env.KINDRED_TURNSTILE_SITE_KEY, process.env.KINDRED_TURNSTILE_SECRET];
  delete process.env.KINDRED_TURNSTILE_SITE_KEY;
  assert.equal((await hosting.readiness()).turnstile, false);
  [process.env.KINDRED_TURNSTILE_SITE_KEY, process.env.KINDRED_TURNSTILE_SECRET] = keys;
  await fns.saveHostingSettings({ data: { ...(await hosting.hostingSettings()), mode: 'hosting' } });
  await opFns.operatorSaveSettings({ data: { ...settings, ...READY, familyCreation: 'signup' } });
  assert.equal((await opSettings.instanceSettings()).familyCreation, 'signup');
  await assert.rejects(fns.saveHostingSettings({ data: { ...(await hosting.hostingSettings()), mode: 'single' } }), /needs the hosting mode/);
  const audit = await acc.accounts().all<{ action: string }>('SELECT action FROM operator_audit ORDER BY id');
  assert.ok(audit.some((a) => a.action === 'hosting.settings'));
  // A required item that goes missing later pauses sign-up rather than leaving it open.
  await saveOp({ privacy: '' });
  assert.equal((await hosting.signupState()).reason, 'not_ready');
  await open();
  assert.equal((await hosting.signupState()).open, true);
});

test('one step makes the account, its passkey, the family and its steward; records the terms, the age and the sign-up; the email stays the sign-up’s', async () => {
  await open();
  const f = form({ familyName: 'The Quillons', familyId: 'quillons', email: 'Ines@Example.org' });
  const { tree, user: id } = await signup.completeSignup(newAccount('Ines Quillon'), f, await net(2));
  assert.equal(tree, 'quillons');
  const u = await one<{ name: string; email: string | null; operator: number }>('SELECT name, email, operator FROM user WHERE id = ?', id);
  assert.deepEqual({ ...u }, { name: 'Ines Quillon', email: null, operator: 0 }, 'an unverified email never becomes the account’s');
  assert.equal(await count('SELECT count(*) AS n FROM credential WHERE user = ?', id), 1);
  assert.deepEqual({ ...(await one<object>('SELECT role FROM membership WHERE user = ? AND tree = ?', id, tree)) }, { role: 'steward' });
  assert.deepEqual({ ...(await one<object>('SELECT self_signed, created_by, cap_bytes FROM family_admin WHERE tree = ?', tree)) }, { self_signed: 1, created_by: id, cap_bytes: READY.defaultCapBytes });
  assert.deepEqual({ ...(await one<object>('SELECT email, verified, age_confirmed, family FROM signup WHERE user = ?', id)) }, { email: 'ines@example.org', verified: 0, age_confirmed: 1, family: 'quillons' });
  assert.equal(await count("SELECT count(*) AS n FROM terms_acceptance WHERE user = ? AND action = 'family.create' AND family = ?", id, tree), 1);
  assert.ok((await store.treeIds()).includes(tree));
  assert.ok(await acc.saveChallenge({ challenge: 'x', purpose: 'signup', subject: 'handle', name: 'Ines' }));
  // The form's own refusals, before anything else.
  assert.throws(() => signup.cleanForm({ name: 'A', familyName: 'B', familyId: 'b-family', email: 'a@example.org', accept: false, age16: true }, true), /accept the terms/);
  assert.throws(() => signup.cleanForm({ name: 'A', familyName: 'B', familyId: 'b-family', email: 'a@example.org', accept: true, age16: false }, true), /16 or older/);
  assert.throws(() => signup.cleanForm({ name: 'A', familyName: 'B', familyId: 'signup', email: 'a@example.org', accept: true, age16: true }, true), /used by Kindred itself/);
});

test('Turnstile is checked by the server; the hidden field stops a bot; one network has three sign-ups a day', async () => {
  await open();
  const f = form();
  await assert.rejects(signup.precheck(f, { ip: '10.9.0.1', turnstile: 'bad' }), /operator.err_turnstile/);
  await assert.rejects(signup.precheck(f, { ip: '10.9.0.1' }), /operator.err_turnstile/);
  assert.equal(await signup.precheck(f, { ip: '10.9.0.1', turnstile: 'good', honeypot: 'http://spam' }), null);
  assert.ok(await signup.precheck(f, { ip: '10.9.0.1', turnstile: 'good' }));
  // Three sign-ups from one network, the fourth refused by the batch's own guard (two of them at once).
  const network = await net(9);
  await signup.completeSignup(newAccount('N1'), form(), network);
  const raced = await Promise.allSettled([signup.completeSignup(newAccount('N2'), form(), network), signup.completeSignup(newAccount('N3'), form(), network), signup.completeSignup(newAccount('N4'), form(), network)]);
  assert.deepEqual(raced.map((r) => r.status).sort(), ['fulfilled', 'fulfilled', 'rejected']);
  assert.match(message((raced.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason), /Too many families were started from your network/);
  await assert.rejects(signup.precheck(form(), { ip: '10.9.0.9', turnstile: 'good' }), /Too many families/);
  // The browser journeys' stand-in (KINDRED_TURNSTILE_FAKE=1) serves sign-up alone, and accepts only its own token.
  const fake = { KINDRED_TURNSTILE_FAKE: '1' };
  assert.equal(turnstile.signupTurnstileSite(fake), 'fake');
  assert.equal(await turnstile.passesSignupTurnstile('kindred-fake-turnstile-pass', undefined, fake), true);
  assert.equal(await turnstile.passesSignupTurnstile('good', undefined, fake), false);
  assert.equal(await turnstile.passesSignupTurnstile('good', undefined, {}), false, 'no keys, no sign-up');
  assert.equal(await turnstile.passesTurnstile('kindred-fake-turnstile-pass', undefined, { ...fake, ...process.env }), false, 'the request forms ignore it');
});

test('the day’s limit and the ceiling hold when sign-ups race; the loser leaves no family behind; then the page offers the request form', async () => {
  await sql('DELETE FROM signup');
  await open({ perDay: 1 });
  const ids = [form(), form()];
  const raced = await Promise.allSettled(ids.map((f, i) => signup.completeSignup(newAccount(`Day${i}`), f, `d${i}`)));
  assert.deepEqual(raced.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  const lost = ids[raced.findIndex((r) => r.status === 'rejected')]!;
  assert.match(message((raced.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason), /Today’s new families are taken/);
  assert.equal((await store.treeIds()).includes(lost.familyId), false, 'the family database the loser made is gone');
  assert.equal(await count('SELECT count(*) AS n FROM user WHERE name = ?', lost.name), 0, 'and no account');
  const state = await hosting.signupState();
  assert.deepEqual({ open: state.open, reason: state.reason, requests: state.requests }, { open: false, reason: 'day', requests: true });

  // The ceiling: families from sign-up on the server at once.
  await sql('DELETE FROM signup');
  const total = await count('SELECT count(*) AS n FROM family_admin WHERE self_signed = 1');
  await open({ perDay: 100, total: total + 1 });
  const race2 = await Promise.allSettled([0, 1, 2].map((i) => signup.completeSignup(newAccount(`Cap${i}`), form(), `c${i}`)));
  assert.equal(race2.filter((r) => r.status === 'fulfilled').length, 1);
  assert.match(message((race2.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason), /no more new families/);
  assert.equal((await hosting.signupState()).reason, 'full');
  // The request form stays open while sign-up is on, as the way in.
  g.__ip = '10.77.0.1';
  const { submitFamilyRequest } = await load<typeof import('../operator/requests.server.ts')>('/src/lib/operator/requests.server.ts');
  assert.deepEqual(await submitFamilyRequest({ name: 'Wen', email: 'wen@example.org', familyName: 'The Wens', message: '' }, { ip: '10.77.0.1', turnstile: 'good' }), { email: 'wen@example.org' });
});

test('an account signed in starts families within its limit, also when two requests race', async () => {
  await sql('DELETE FROM signup');
  await open({ perAccount: 1, total: null, perDay: 100 });
  const raced = await Promise.allSettled([0, 1].map((i) => signup.completeSignup({ kind: 'existing', user: SIGNED as never }, form(), `s${i}`)));
  assert.deepEqual(raced.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.match(message((raced.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason), /families|sign-up allows/);
  assert.equal(await count('SELECT count(*) AS n FROM family_admin WHERE created_by = ?', SIGNED.id), 1);
  // Raised by the operator: one more.
  await open({ perAccount: 2, total: null, perDay: 100 });
  await signup.completeSignup({ kind: 'existing', user: SIGNED as never }, form(), 's9');
  assert.equal(await count('SELECT count(*) AS n FROM family_admin WHERE created_by = ?', SIGNED.id), 2);
  // Through the server function: signed in, Turnstile checked, and refused for the third.
  asUser(SIGNED);
  const f = { familyName: 'The Thirds', familyId: 'sigruns-third', email: 'sigrun@example.org', accept: true, age16: true, turnstile: 'good' };
  await assert.rejects(fns.signupSignedIn({ data: f }), (e: Error) => status(e) === 403);
});

test('codes: made, used once each even when raced, passing the day’s limit; withdrawn and expired codes open nothing; all logged', async () => {
  await sql('DELETE FROM signup');
  await open({ perDay: 0 });
  await saveOp({ familyCreation: 'requests' });
  asUser(OP);
  const { code, id } = await fns.makeSignupCode({ data: { label: 'For the Ottleys', usesMax: 1, expires: null } });
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(await count('SELECT count(*) AS n FROM signup_code WHERE hash = ?', code), 0, 'only its hash is kept');
  asUser(undefined);
  assert.equal((await hosting.signupState()).reason, 'closed', 'requests only: closed without a code');
  assert.equal((await hosting.signupState(code)).open, true, 'a code opens it, past the day’s limit of 0');
  assert.equal((await hosting.signupState(code.toLowerCase().replace(/-/g, ' '))).open, true, 'as people type it');
  const raced = await Promise.allSettled([0, 1].map((i) => signup.completeSignup(newAccount(`Code${i}`), form({ code }), `k${i}`)));
  assert.deepEqual(raced.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.match(message((raced.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason), /sign-up code doesn’t work/);
  assert.deepEqual({ ...(await one<object>('SELECT uses FROM signup_code WHERE id = ?', id)) }, { uses: 1 });
  assert.equal(await count('SELECT count(*) AS n FROM signup WHERE code = ?', id), 1);

  asUser(OP);
  const many = await fns.makeSignupCode({ data: { label: '', usesMax: 5, expires: null } });
  await fns.revokeSignupCode({ data: { id: many.id } });
  assert.equal((await hosting.signupState(many.code)).reason, 'code');
  const old = await fns.makeSignupCode({ data: { label: 'old', usesMax: 5, expires: Date.now() + 60_000 } });
  assert.equal((await hosting.signupState(old.code, Date.now() + 120_000)).reason, 'code');
  assert.equal((await hosting.signupState('NOPE-NOPE-NOPE')).reason, 'code');
  const listed = (await fns.fetchHostingConsole()).codes;
  assert.ok(listed.every((c) => !('hash' in c) && !('code' in c)), 'the console lists codes, never the codes themselves');
  assert.equal(listed.find((c) => c.id === many.id)?.revoked, true);
  const actions = (await acc.accounts().all<{ action: string }>('SELECT action FROM operator_audit')).map((a) => a.action);
  assert.ok(actions.includes('signup_code.create') && actions.includes('signup_code.revoke'));
  // Only operators.
  asUser(SIGNED);
  await assert.rejects(fns.makeSignupCode({ data: { label: '', usesMax: 1, expires: null } }), (e: Error) => status(e) === 403);
  await assert.rejects(fns.fetchHostingConsole(), (e: Error) => status(e) === 403);
});

test('unverified sign-ups to the waiting list: the form becomes a request, no account is made; a code still signs up', async () => {
  await sql('DELETE FROM signup');
  await open({ unverified: 'waitlist', perDay: 50 });
  const state = await hosting.signupState();
  assert.equal(state.waitlist, true);
  await assert.rejects(signup.completeSignup(newAccount('Wait1'), form(), 'w1'), /does not take new families/);
  const users = await count('SELECT count(*) AS n FROM user');
  g.__ip = '10.88.0.1';
  const f = form({ email: 'wait@example.org' });
  assert.deepEqual(await fns.signupWaitlist({ data: { ...f, accept: true, age16: true, turnstile: 'good' } }), { email: 'wait@example.org' });
  assert.equal(await count('SELECT count(*) AS n FROM user'), users);
  assert.equal(await count("SELECT count(*) AS n FROM family_request WHERE email = 'wait@example.org' AND status = 'open'"), 1);
  asUser(OP);
  const { code } = await fns.makeSignupCode({ data: { label: '', usesMax: 1, expires: null } });
  asUser(undefined);
  assert.equal((await hosting.signupState(code)).waitlist, false);
  await signup.completeSignup(newAccount('Coded'), form({ code }), 'w2');
});

test('the public facts name no family and count nothing', async () => {
  await open();
  await saveHosting({ landingText: 'Run by Orla for the village.\n\nWrite any time.', demoUrl: 'javascript:alert(1)' });
  const pub = await hosting.publicHosting();
  const text = JSON.stringify(pub);
  for (const name of ['alderby', 'Alderbys', 'quillons', 'Quillons', 'Ines', 'ines@example.org']) assert.equal(text.includes(name), false, name);
  assert.deepEqual(Object.keys(pub.signup).sort(), ['methods', 'open', 'requests', 'waitlist']);
  const numbers = JSON.stringify(pub, (_k, v) => (typeof v === 'number' ? '#' : v)).match(/"#"/g) ?? [];
  assert.equal(numbers.length, 1, 'only the storage cap a new family gets');
  assert.equal(pub.demoUrl, '', 'only a web address is linked');
  assert.equal(pub.landingText, 'Run by Orla for the village.\n\nWrite any time.');
  assert.equal(pub.turnstileSiteKey, 'site-key');
});

test('a demo and a "View as" preview change nothing', async () => {
  await open();
  // A preview: the guard registers its refusal for the request; every change refuses before anything is written.
  g.__kindredRequestRefusal = () => new AuthError('forbidden', 'viewas.err.read_only');
  try {
    asUser(SIGNED);
    const before = await count('SELECT count(*) AS n FROM family_admin');
    await assert.rejects(fns.signupSignedIn({ data: { familyName: 'Preview', familyId: 'preview-fam', email: 'p@example.org', accept: true, age16: true, turnstile: 'good' } }), /read_only/);
    asUser(OP);
    await assert.rejects(fns.makeSignupCode({ data: { label: '', usesMax: 1, expires: null } }), /read_only/);
    await assert.rejects(fns.saveHostingSettings({ data: await hosting.hostingSettings() }), /read_only/);
    assert.equal(await count('SELECT count(*) AS n FROM family_admin'), before);
  } finally {
    g.__kindredRequestRefusal = undefined;
  }
  process.env.KINDRED_DEMO = '1';
  try {
    asUser(SIGNED);
    await assert.rejects(fns.signupSignedIn({ data: { familyName: 'Demo', familyId: 'demo-fam', email: 'd@example.org', accept: true, age16: true, turnstile: 'good' } }));
    await assert.rejects(signup.completeSignup(newAccount('Demo'), form(), 'demo'));
  } finally {
    delete process.env.KINDRED_DEMO;
  }
});

test('the processing agreement is recorded with kind "dpa" once terms_acceptance has the column (the gdpr lane adds it)', async () => {
  assert.deepEqual(await signup.dpaAcceptance(SIGNED.id, 'alderby', 1), [], 'no column yet: the terms’ own row is the record');
  await sql("ALTER TABLE terms_acceptance ADD COLUMN kind TEXT NOT NULL DEFAULT 'terms'");
  await open({ perDay: 100, total: null });
  const { user: id, tree } = await signup.completeSignup(newAccount('Dora'), form(), 'dpa');
  const rows = await acc.accounts().all<{ kind: string; family: string }>('SELECT kind, family FROM terms_acceptance WHERE user = ? ORDER BY id', id);
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ kind: 'terms', family: tree }, { kind: 'dpa', family: tree }]);
});
