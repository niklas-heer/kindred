// node --test src/lib/auth/methods.test.ts — which ways in a server offers (src/lib/auth/methods.server.ts): where the list
// comes from (KINDRED_AUTH_METHODS, the console, KINDRED_AUTH, the default), the rules for turning one off (never an operator
// without a way in; how many accounts lose their only one; its sessions end), the fresh proof by password, and linking and
// unlinking ways in from the account. Scratch accounts database only; invented names.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-methods-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'methods-test-secret';
for (const k of ['KINDRED_AUTH', 'KINDRED_AUTH_METHODS', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'KINDRED_ORIGIN', 'KINDRED_GUEST_ORIGIN', 'KINDRED_DEMO']) delete process.env[k];

const store = await import('./store.server.ts');
const m = await import('./methods.server.ts');
const pw = await import('./password.server.ts');
const { parseMethods } = await import('./methods.ts');
const { authSetting } = await import('./method.server.ts');
const proof = await import('./proof.server.ts');
const passkeys = await import('./passkeys.server.ts');
const mine = await import('./my-signin.server.ts');
const { q } = await import('../store/index.ts');

const SITE = 'http://family.example.org';
const browser = (token?: string) => new Request(`${SITE}/api/auth/x`, { headers: token ? { cookie: `kindred_session=${token}` } : {} });
const GOOD = 'a quiet harbour at dusk';
const noAudit = () => q('SELECT 1');

const TABLES = ['session', 'credential', 'password', 'totp', 'recovery_code', 'auth_attempt', 'signin_step', 'password_reset', 'membership', 'instance_setting', 'operator_audit', 'challenge', 'user'];
beforeEach(() => store.accounts().batch(TABLES.map((t) => store.q(`DELETE FROM ${t}`))));
after(async () => {
  (await import('../store/node.ts')).closeAccounts();
  rmSync(dir, { recursive: true, force: true });
});

const setMethods = (list: string[]) =>
  store.accounts().run("INSERT INTO instance_setting (key, value, updated_at) VALUES ('auth_methods', ?, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(list));

async function account(name: string, o: { passkey?: string; username?: string; operator?: boolean } = {}) {
  const made = store.newUser(name, null);
  await store.accounts().batch([
    made.insert,
    ...(o.passkey ? [store.insertCredential({ id: o.passkey, user: made.user.id, publicKey: new Uint8Array([1]), counter: 0, transports: [], device: 'Mac', synced: false })] : []),
    ...(o.username ? await pw.passwordWrites(made.user.id, o.username, GOOD) : []),
    store.q('UPDATE user SET operator = ? WHERE id = ?', o.operator ? 1 : 0, made.user.id),
  ]);
  return (await store.userById(made.user.id))!;
}

// ---------- where the list comes from ----------

test('the list: break-glass first, then the console, then KINDRED_AUTH, then passkeys only', () => {
  assert.deepEqual(m.resolveMethods(undefined, {}), { methods: ['passkey'], source: 'default' });
  assert.deepEqual(m.resolveMethods(undefined, { KINDRED_AUTH: 'password,passkey' }), { methods: ['passkey', 'password'], source: 'KINDRED_AUTH' });
  assert.deepEqual(m.resolveMethods('["password"]', { KINDRED_AUTH: 'passkey' }), { methods: ['password'], source: 'console' }, 'once saved, the console holds');
  assert.deepEqual(m.resolveMethods('["password"]', { KINDRED_AUTH_METHODS: 'passkey' }), { methods: ['passkey'], source: 'break-glass' });
  assert.deepEqual(m.resolveMethods('["password"]', { KINDRED_AUTH_METHODS: 'pasword' }).source, 'console', 'a typo in the override is ignored');
  assert.equal(parseMethods('passkey,sms'), null);
  assert.equal(parseMethods('[]'), null);
});

test('KINDRED_AUTH may list methods: that is Kindred’s own sign-in; cloudflare-access stays its own mode', () => {
  assert.deepEqual(authSetting({ KINDRED_AUTH: 'passkey,password' }), { method: 'kindred' });
  assert.deepEqual(authSetting({ KINDRED_AUTH: 'password' }), { method: 'kindred' });
  assert.deepEqual(authSetting({ KINDRED_AUTH: 'magic-link' }), { method: null, problem: 'unknown-value' });
});

test('an upgrade changes nothing: no setting means passkeys only, and passwords are refused', async () => {
  assert.deepEqual(await m.enabledMethods(), ['passkey']);
  await assert.rejects(pw.passwordSignIn(browser(), { username: 'x', password: GOOD }, { ip: '203.0.113.1' }), /pw\.err\.method_off/);
});

// ---------- turning methods off ----------

test('the console counts who can use each method and who would have nothing else', async () => {
  await setMethods(['passkey', 'password']);
  await account('Ada Example', { passkey: 'k-ada' });
  await account('Bo Testfield', { username: 'bo.t' });
  await account('Cy Sample', { passkey: 'k-cy', username: 'cy.s' });
  const s = await m.signInSettings({});
  assert.equal(s.mode, 'kindred');
  assert.equal(s.source, 'console');
  assert.deepEqual(s.methods.map((c) => [c.id, c.state, c.accounts, c.onlyWay]), [['passkey', 'enabled', 2, 1], ['password', 'enabled', 2, 1], ['oidc', 'unavailable', 0, 0]]);
  // Single sign-on shows, unavailable until the operator adds a provider (src/lib/auth/oidc.server.ts).
  assert.equal((await m.previewMethods(['passkey'])).lockedOut, 1, 'turning passwords off locks out Bo');
  assert.deepEqual((await m.previewMethods(['passkey'])).removed, ['password']);
});

test('the console shows every method unavailable behind Cloudflare Access, and refuses to save there', async () => {
  const env = { KINDRED_AUTH: 'cloudflare-access', CF_ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com', CF_ACCESS_AUD: 'aud' };
  const s = await m.signInSettings(env);
  assert.equal(s.mode, 'cloudflare-access');
  assert.ok(s.methods.every((c) => c.state === 'unavailable'));
  await assert.rejects(m.saveMethods(['password'], 'op', noAudit, env), /pw\.err\.access_mode/);
});

test('turning a method off is refused when an operator would have no way in (the last-operator rule)', async () => {
  await setMethods(['passkey', 'password']);
  await account('Olu Operator', { username: 'olu', operator: true });
  await account('Pia Operator', { passkey: 'k-pia', operator: true });
  await assert.rejects(m.saveMethods(['passkey'], 'op', noAudit, {}), /pw\.err\.operator_locked_out/);
  assert.deepEqual(await m.enabledMethods(), ['passkey', 'password'], 'nothing changed');
  await assert.rejects(m.saveMethods([], 'op', noAudit, {}), /pw\.err\.no_method/);
});

test('turning a method off ends every session it started, and only those', async () => {
  await setMethods(['passkey', 'password']);
  const cy = await account('Cy Sample', { passkey: 'k-cy', username: 'cy.s' });
  const byPassword = (await store.createSession(cy.id, null, false, 'password')).token;
  const byPasskey = (await store.createSession(cy.id, 'k-cy', false, 'passkey')).token;
  const older = (await store.createSession(cy.id)).token;
  const { hashToken } = await import('./tokens.server.ts');
  await store.accounts().run('UPDATE session SET method = NULL WHERE hash = ?', await hashToken('session', older));
  const change = await m.saveMethods(['passkey'], 'op', noAudit, {});
  assert.deepEqual(change.removed, ['password']);
  assert.equal(await store.sessionByToken(byPassword), undefined);
  assert.ok(await store.sessionByToken(byPasskey));
  assert.ok(await store.sessionByToken(older), 'a session from before the column is a passkey’s');
  await m.saveMethods(['password'], 'op', noAudit, {});
  assert.equal(await store.sessionByToken(byPasskey), undefined, 'and the other way round');
});

test('while KINDRED_AUTH_METHODS overrides, the console cannot change the list', async () => {
  await assert.rejects(m.saveMethods(['password'], 'op', noAudit, { KINDRED_AUTH_METHODS: 'passkey' }), /pw\.err\.break_glass/);
});

test('passkeys turned off: passkey sign-in, adding and proofs by passkey are refused', async () => {
  await setMethods(['password']);
  await assert.rejects(passkeys.signInOptions(browser()), /auth\.passkeys_off/);
  const bo = await account('Bo Testfield', { username: 'bo.t' });
  const { token } = await store.createSession(bo.id, null, false, 'password');
  await assert.rejects(proof.proofOptions(browser(token), bo), /auth\.passkeys_off/);
  assert.deepEqual(await proof.proofKinds(bo), { passkey: false, password: true, totp: false, oidc: [] });
});

// ---------- the fresh proof by password ----------

test('an account with no passkey proves itself with its password on this session; a wrong one counts as a failure', async () => {
  await setMethods(['passkey', 'password']);
  const bo = await account('Bo Testfield', { username: 'bo.t' });
  const { token } = await store.createSession(bo.id, null, false, 'password');
  await assert.rejects(proof.requireFreshProof(browser(token), bo), (e: { code?: string }) => e.code === 'reauth');
  await assert.rejects(proof.finishPasswordProof(browser(token), bo, { password: 'not the right one' }, { ip: '203.0.113.1' }), /pw\.err\.wrong/);
  await proof.finishPasswordProof(browser(token), bo, { password: GOOD }, { ip: '203.0.113.1' });
  await proof.requireFreshProof(browser(token), bo);
  assert.equal((await store.sessionByToken(token))!.proved_via, 'password');
  const other = (await store.createSession(bo.id, null, false, 'password')).token;
  await assert.rejects(proof.requireFreshProof(browser(other), bo), (e: { code?: string }) => e.code === 'reauth', 'another browser’s proof does not count');
});

// ---------- linking and unlinking ways in ----------

async function proved(user: Awaited<ReturnType<typeof account>>, method: 'passkey' | 'password' = 'passkey', credential: string | null = null) {
  const { token } = await store.createSession(user.id, credential, true, method);
  return browser(token);
}

test('a passkey account adds a password (choosing its username) only with a fresh proof, and can then sign in with it', async () => {
  await setMethods(['passkey', 'password']);
  const ada = await account('Ada Example', { passkey: 'k-ada' });
  const stale = browser((await store.createSession(ada.id, 'k-ada')).token);
  await assert.rejects(mine.setMyPassword(stale, ada, { username: 'ada', password: 'linking a password now' }), (e: { code?: string }) => e.code === 'reauth');
  assert.deepEqual(await mine.setMyPassword(await proved(ada), ada, { username: 'Ada', password: 'linking a password now' }), { username: 'ada' });
  assert.equal((await pw.passwordSignIn(browser(), { username: 'ada', password: 'linking a password now' }, { ip: '203.0.113.2' })).kind, 'session');
});

test('a taken username is refused when linking', async () => {
  await setMethods(['passkey', 'password']);
  await account('Bo Testfield', { username: 'bo.t' });
  const ada = await account('Ada Example', { passkey: 'k-ada' });
  await assert.rejects(mine.setMyPassword(await proved(ada), ada, { username: 'BO.T', password: 'linking a password now' }), /pw\.err\.username_taken/);
});

test('changing the password ends the other password sessions, keeping this one', async () => {
  await setMethods(['passkey', 'password']);
  const bo = await account('Bo Testfield', { username: 'bo.t' });
  const elsewhere = (await store.createSession(bo.id, null, false, 'password')).token;
  const { token } = await store.createSession(bo.id, null, true, 'password');
  await mine.setMyPassword(browser(token), bo, { password: 'a different harbour now' });
  assert.equal(await store.sessionByToken(elsewhere), undefined);
  assert.ok(await store.sessionByToken(token), 'this session stays');
});

test('the last way in stays: the last passkey goes only with a password the server accepts, the password only with a passkey', async () => {
  await setMethods(['passkey', 'password']);
  const ada = await account('Ada Example', { passkey: 'k-ada' });
  assert.equal(await passkeys.removePasskey(await proved(ada), ada, 'k-ada'), 'last');
  const cy = await account('Cy Sample', { passkey: 'k-cy', username: 'cy.s' });
  assert.equal(await passkeys.removePasskey(await proved(cy), cy, 'k-cy'), 'removed', 'a password is a way in too');
  await assert.rejects(mine.removeMyPassword(await proved(cy, 'password'), cy), /pw\.err\.last_way_in/);
  const dee = await account('Dee Sample', { passkey: 'k-dee', username: 'dee' });
  await mine.removeMyPassword(await proved(dee), dee);
  assert.equal(await pw.passwordOf(dee.id), undefined);
  assert.equal((await store.userById(dee.id))!.username, null, 'the username goes with it');
  await setMethods(['passkey']);
  const eve = await account('Eve Sample', { passkey: 'k-eve', username: 'eve' });
  assert.equal(await passkeys.removePasskey(await proved(eve), eve, 'k-eve'), 'last', 'a password the server no longer accepts is no way in');
});

test('an operator whose only way in is a password keeps two-step codes on', async () => {
  await setMethods(['passkey', 'password']);
  const olu = await account('Olu Operator', { username: 'olu', operator: true });
  const req = await proved(olu, 'password');
  const { secret } = await mine.startMyTotp(req, olu);
  const totp = await import('./totp.server.ts');
  await mine.confirmMyTotp(req, olu, await totp.codeAt(secret, totp.stepAt(Date.now())));
  await assert.rejects(mine.stopMyTotp(req, olu), /pw\.err\.operator_totp/);
});
