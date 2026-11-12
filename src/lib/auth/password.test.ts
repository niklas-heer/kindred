// node --test src/lib/auth/password.test.ts — username and password sign-in (accounts migrations 0040 and 0041,
// src/lib/auth/password.server.ts): the hash, one answer for unknown usernames and wrong passwords alike, the throttle in the
// database (one limit across "isolates": a second copy of the module, and the table itself), two-step codes used once,
// recovery codes used once, a new session on every sign-in, and the places a password must never work (the guest host, a
// demo, a preview). Scratch accounts database only; invented names.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-password-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'password-test-secret';
for (const k of ['KINDRED_AUTH', 'KINDRED_AUTH_METHODS', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'KINDRED_ORIGIN', 'KINDRED_GUEST_ORIGIN', 'KINDRED_DEMO']) delete process.env[k];

const store = await import('./store.server.ts');
const pw = await import('./password.server.ts');
const attempts = await import('./attempts.server.ts');
const totp = await import('./totp.server.ts');
const { startSession, getSession } = await import('./session.server.ts');
const { onRequestReadOnly } = await import('../read-only.ts');
const { viewAsRefused } = await import('./view-as.server.ts');

const SITE = 'http://family.example.org';
const req = (cookie?: string, url = `${SITE}/api/auth/password-signin`) => new Request(url, { headers: cookie ? { cookie } : {} });
const ip = '203.0.113.7';
const at = { ip };
const code = (e: unknown) => (e as Error).message;

const TABLES = ['session', 'credential', 'password', 'totp', 'recovery_code', 'auth_attempt', 'signin_step', 'password_reset', 'membership', 'instance_setting', 'signin_daily', 'user'];
beforeEach(async () => {
  await store.accounts().batch(TABLES.map((t) => store.q(`DELETE FROM ${t}`)));
  await store.accounts().run("INSERT INTO instance_setting (key, value, updated_at) VALUES ('auth_methods', '[\"passkey\",\"password\"]', 0)");
});
after(async () => {
  (await import('../store/node.ts')).closeAccounts();
  rmSync(dir, { recursive: true, force: true });
});

const GOOD = 'a quiet harbour at dusk';
async function account(name: string, username: string, password = GOOD) {
  const made = store.newUser(name, null);
  await store.accounts().batch([made.insert, ...(await pw.passwordWrites(made.user.id, username, password))]);
  return (await store.userById(made.user.id))!;
}
const tokenOf = (setCookie: string) => /kindred_session=([^;]+)/.exec(setCookie)![1];

// ---------- the hash ----------

test('the hash names its scheme, salts every password and checks only the right one', async () => {
  const a = await pw.hashAccountPassword(GOOD);
  const b = await pw.hashAccountPassword(GOOD);
  assert.match(a, /^pbkdf2-sha256-6x100k-v1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b, 'a random salt each time');
  assert.equal(await pw.verifyAccountPassword(GOOD, a), true);
  assert.equal(await pw.verifyAccountPassword(`${GOOD}.`, a), false);
  assert.equal(await pw.verifyAccountPassword(GOOD, a.replace('v1', 'v0')), false, 'an unknown scheme never matches');
  assert.equal(pw.needsRehash(a), false);
  assert.equal(pw.needsRehash('pbkdf2-sha512$100000$x$y'), true, 'an older scheme is stored again at the next sign-in');
});

test('the pepper comes from KINDRED_SECRET: the same salt and password under another secret do not match', async () => {
  const stored = await pw.hashAccountPassword(GOOD);
  process.env.KINDRED_SECRET = 'another-secret';
  try {
    assert.equal(await pw.verifyAccountPassword(GOOD, stored), false);
  } finally {
    process.env.KINDRED_SECRET = 'password-test-secret';
  }
});

test('the rules: twelve characters, spaces allowed, nothing from the common list, not the username', () => {
  assert.throws(() => pw.checkNewPassword('short pass'), /pw\.err\.short/);
  assert.equal(pw.checkNewPassword('twelve chars'), 'twelve chars', 'spaces count and are fine');
  for (const common of ['password1234', 'Password2024!', 'P@ssw0rd1234', 'qwertyuiop123', '123456789012', 'aaaaaaaaaaaaaa', 'sommersommer', 'familytree1234']) {
    assert.throws(() => pw.checkNewPassword(common), /pw\.err\.common/, common);
  }
  assert.throws(() => pw.checkNewPassword('ada.example.1', 'ada.example.1'), /pw\.err\.like_username/);
  assert.throws(() => pw.checkNewPassword('x'.repeat(257)), /pw\.err\.long/);
  assert.equal(pw.cleanUsername('  Ada.Example  '), 'ada.example');
  assert.throws(() => pw.cleanUsername('a'), /pw\.err\.username/);
});

// ---------- one answer for everyone ----------

test('an unknown username and a wrong password get the same answer, after the same work, and count the same', async () => {
  await account('Ada Example', 'ada');
  const time = async (input: object) => {
    const t = performance.now();
    const e = await pw.passwordSignIn(req(), input, at).catch((x) => x);
    return { ms: performance.now() - t, message: code(e) };
  };
  const wrong = await time({ username: 'ada', password: 'not the right one' });
  const unknown = await time({ username: 'nobody-here', password: 'not the right one' });
  assert.equal(wrong.message, 'pw.err.wrong');
  assert.equal(unknown.message, 'pw.err.wrong');
  // Both ran one full hash: the slower is well under twice the faster (a missing hash would be a hundred times faster).
  assert.ok(Math.max(wrong.ms, unknown.ms) < 2 * Math.min(wrong.ms, unknown.ms) + 50, `wrong ${wrong.ms.toFixed(0)} ms, unknown ${unknown.ms.toFixed(0)} ms`);
  const rows = await store.accounts().all<{ key: string; count: number }>('SELECT key, count FROM auth_attempt ORDER BY key');
  assert.equal(rows.filter((r) => r.key.startsWith('u:')).length, 2, 'each username has its counter, known or not');
  assert.ok(rows.every((r) => !r.key.includes('ada') && !r.key.includes('nobody')), 'the table names nobody: usernames are hashed');
});

test('a right password signs in; with the username typed in another case too', async () => {
  const ada = await account('Ada Example', 'ada');
  assert.deepEqual(await pw.passwordSignIn(req(), { username: 'ADA', password: GOOD }, at), { kind: 'session', user: ada.id });
});

// ---------- the throttle ----------

test('five wrong passwords from one network lock the username there, even for the right password, and the lock holds in another copy of the module', async () => {
  await account('Ada Example', 'ada');
  for (let i = 0; i < attempts.PAIR_LIMIT; i++) await assert.rejects(pw.passwordSignIn(req(), { username: 'ada', password: `wrong ${i} guess here` }, at), /pw\.err\.wrong/);
  await assert.rejects(pw.passwordSignIn(req(), { username: 'ada', password: GOOD }, at), /pw\.err\.throttled/);
  // Another isolate: a fresh copy of the module code, with nothing in memory. It reads the same table.
  const other = await import(`./password.server.ts?isolate=${Date.now()}`) as typeof pw;
  await assert.rejects(other.passwordSignIn(req(), { username: 'ada', password: GOOD }, at), /pw\.err\.throttled/);
  const row = await store.accounts().get<{ count: number }>('SELECT count FROM auth_attempt WHERE key = ?', (await attempts.attemptKeys('ada', ip)).pair);
  assert.equal(row!.count, attempts.PAIR_LIMIT + 2, 'every try is counted, a refused one too (and refused before any hashing)');
});

test('two copies counting at once lose no failure: the count is one statement', async () => {
  const other = await import(`./attempts.server.ts?isolate=${Date.now()}`) as typeof attempts;
  const keys = await attempts.attemptKeys('ada', ip);
  const verdicts = await Promise.all(Array.from({ length: 6 }, (_, i) => (i % 2 ? other : attempts).begin(keys)));
  const row = await store.accounts().get<{ count: number }>('SELECT count FROM auth_attempt WHERE key = ?', keys.pair);
  assert.equal(row!.count, 6);
  assert.equal(verdicts.filter((v) => v.locked).length, 1, 'only the sixth is over the limit');
  assert.equal(await attempts.lockedNow(keys), true);
});

test('the delay grows after a lockout and never becomes permanent; a success starts over', async () => {
  const keys = await attempts.attemptKeys('ada', ip);
  const t0 = 1_000_000_000_000;
  for (let i = 0; i < 5; i++) await attempts.begin(keys, t0);
  assert.equal((await attempts.begin(keys, t0 + attempts.PAIR_WINDOW_MS - 1)).locked, true);
  assert.equal((await attempts.begin(keys, t0 + attempts.PAIR_WINDOW_MS)).locked, false, 'after fifteen minutes the username may try again from there');
  const t1 = t0 + attempts.PAIR_WINDOW_MS;
  for (let i = 0; i < 5; i++) await attempts.begin(keys, t1);
  assert.equal(await attempts.lockedNow(keys, t1 + attempts.PAIR_WINDOW_MS), true, 'a second lockout lasts longer');
  assert.equal(await attempts.lockedNow(keys, t1 + 2 * attempts.PAIR_WINDOW_MS), false, 'thirty minutes, then free again');
  await attempts.succeeded(keys);
  assert.equal(await store.accounts().get('SELECT 1 FROM auth_attempt WHERE key IN (?, ?)', keys.user, keys.pair), undefined);
});

test('one network gets twenty failures an hour across usernames', async () => {
  for (let i = 0; i < attempts.NETWORK_LIMIT; i++) await attempts.begin(await attempts.attemptKeys(`user${i}`, ip));
  assert.equal((await attempts.begin(await attempts.attemptKeys('fresh-name', ip))).locked, true);
  assert.equal((await attempts.begin(await attempts.attemptKeys('fresh-name', '198.51.100.99'))).locked, false, 'another network is not affected');
});

test('after 500 failures an hour on the server, the form needs a Turnstile answer', async () => {
  await account('Ada Example', 'ada');
  await store.accounts().run("INSERT INTO auth_attempt (key, window_start, count, level) VALUES ('all', ?, 500, 0)", Date.now());
  const refuse = { ip, turnstile: async (t: string | undefined) => t === 'good-token' };
  await assert.rejects(pw.passwordSignIn(req(), { username: 'ada', password: GOOD }, refuse), /pw\.err\.turnstile/);
  assert.equal((await pw.passwordSignIn(req(), { username: 'ada', password: GOOD, turnstile: 'good-token' }, refuse)).kind, 'session');
});

// ---------- two-step codes and recovery codes ----------

async function withTotp(name: string, username: string) {
  const user = await account(name, username);
  const secret = (await totp.beginTotp(user.id)) as string;
  assert.ok(secret);
  assert.equal(await totp.consumeTotp(user.id, await totp.codeAt(secret, totp.stepAt(Date.now())), { pending: true }), true);
  const { codes, writes } = await totp.newRecoveryCodes(user.id);
  await store.accounts().batch(writes);
  return { user, secret, codes };
}

test('with two-step codes a right password is a ticket, not a session; a code works once', async () => {
  const { user, secret } = await withTotp('Ada Example', 'ada');
  const first = await pw.passwordSignIn(req(), { username: 'ada', password: GOOD }, at);
  assert.equal(first.kind, 'second');
  const ticket = (first as { ticket: string }).ticket;
  // The code just used to confirm the setup is spent: the next valid one is a later step.
  await assert.rejects(pw.passwordSecondStep(req(), { ticket, code: await totp.codeAt(secret, totp.stepAt(Date.now())) }, at), /pw\.err\.code/, 'a replayed code is refused');
  const next = await totp.codeAt(secret, totp.stepAt(Date.now()) + 1);
  assert.deepEqual(await pw.passwordSecondStep(req(), { ticket, code: next }, at), { user: user.id });
  // The ticket is spent, and so is the code.
  await assert.rejects(pw.passwordSecondStep(req(), { ticket, code: next }, at), /pw\.err\.step_expired/);
  const again = await pw.passwordSignIn(req(), { username: 'ada', password: GOOD }, at) as { ticket: string };
  await assert.rejects(pw.passwordSecondStep(req(), { ticket: again.ticket, code: next }, at), /pw\.err\.code/, 'the same code from another ticket is refused');
});

test('two requests with the same code at once: only one gets in', async () => {
  const { secret } = await withTotp('Ada Example', 'ada');
  const a = await pw.passwordSignIn(req(), { username: 'ada', password: GOOD }, at) as { ticket: string };
  const b = await pw.passwordSignIn(req(), { username: 'ada', password: GOOD }, at) as { ticket: string };
  const c = await totp.codeAt(secret, totp.stepAt(Date.now()) + 1);
  const results = await Promise.allSettled([pw.passwordSecondStep(req(), { ticket: a.ticket, code: c }, at), pw.passwordSecondStep(req(), { ticket: b.ticket, code: c }, at)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});

test('a recovery code stands in for a code once; used again it is refused', async () => {
  const { user, codes } = await withTotp('Ada Example', 'ada');
  assert.equal(codes.length, 10);
  const t1 = await pw.passwordSignIn(req(), { username: 'ada', password: GOOD }, at) as { ticket: string };
  assert.deepEqual(await pw.passwordSecondStep(req(), { ticket: t1.ticket, recovery: codes[0].toLowerCase() }, at), { user: user.id }, 'in any case');
  const t2 = await pw.passwordSignIn(req(), { username: 'ada', password: GOOD }, at) as { ticket: string };
  await assert.rejects(pw.passwordSecondStep(req(), { ticket: t2.ticket, recovery: codes[0] }, at), /pw\.err\.code/);
  assert.equal(await totp.recoveryLeft(user.id), 9);
});

test('wrong codes count against the username, and five end the ticket', async () => {
  await withTotp('Ada Example', 'ada');
  const t = await pw.passwordSignIn(req(), { username: 'ada', password: GOOD }, at) as { ticket: string };
  for (let i = 0; i < 4; i++) await assert.rejects(pw.passwordSecondStep(req(), { ticket: t.ticket, code: '000000' }, at), /pw\.err\.code/);
  // The fifth failure locks the username (five failures in the window) before the ticket's own count runs out.
  await assert.rejects(pw.passwordSecondStep(req(), { ticket: t.ticket, code: '000000' }, at), /pw\.err\.code/);
  await assert.rejects(pw.passwordSecondStep(req(), { ticket: t.ticket, code: '000000' }, at), /pw\.err\.(step_expired|throttled)/);
  assert.equal(await store.accounts().get('SELECT 1 FROM signin_step'), undefined, 'the ticket is gone');
});

test('a forgotten password: a recovery code (and the current code) sets a new one and ends every session', async () => {
  const { user, secret, codes } = await withTotp('Ada Example', 'ada');
  const old = (await store.createSession(user.id, null, false, 'password')).token;
  await assert.rejects(pw.resetWithRecoveryCode(req(), { username: 'ada', recovery: codes[1], password: 'a brand new evening' }, at), /pw\.err\.recovery/, 'the two-step code is needed too');
  const next = await totp.codeAt(secret, totp.stepAt(Date.now()) + 1);
  assert.deepEqual(await pw.resetWithRecoveryCode(req(), { username: 'ada', recovery: codes[1], code: next, password: 'a brand new evening' }, at), { user: user.id });
  assert.equal(await store.sessionByToken(old), undefined);
  assert.equal((await pw.passwordSignIn(req(), { username: 'ada', password: 'a brand new evening' }, at)).kind, 'second');
});

// ---------- sessions ----------

test('every sign-in is a new session: the cookie a browser came with is ended, never reused', async () => {
  const ada = await account('Ada Example', 'ada');
  const planted = (await store.createSession(ada.id, null, false, 'password')).token;
  const setCookie = await startSession(req(`kindred_session=${planted}`), ada.id, null, true, 'password');
  const fresh = tokenOf(setCookie);
  assert.notEqual(fresh, planted);
  assert.equal(await store.sessionByToken(planted), undefined);
  const row = (await store.sessionByToken(fresh))!;
  assert.equal(row.method, 'password');
  assert.ok(row.proved, 'a password sign-in counts as a fresh proof for a few minutes');
});

test('a session of a way in that is off is no session (KINDRED_AUTH_METHODS, which deletes nothing)', async () => {
  const ada = await account('Ada Example', 'ada');
  const { token } = await store.createSession(ada.id, null, false, 'password');
  assert.equal((await getSession(req(`kindred_session=${token}`, `${SITE}/`))).user?.id, ada.id);
  process.env.KINDRED_AUTH_METHODS = 'passkey';
  try {
    assert.equal((await getSession(req(`kindred_session=${token}`, `${SITE}/`))).user, null);
  } finally {
    delete process.env.KINDRED_AUTH_METHODS;
  }
});

// ---------- where a password never works ----------

test('the guest host honours no password: sign-in and every password form are refused there', async () => {
  await account('Ada Example', 'ada');
  process.env.KINDRED_GUEST_ORIGIN = 'https://guests.example.org';
  try {
    const onGuests = req(undefined, 'https://guests.example.org/api/auth/password-signin');
    await assert.rejects(pw.passwordSignIn(onGuests, { username: 'ada', password: GOOD }, at), /pw\.err\.method_off/);
    await assert.rejects(pw.resetWithRecoveryCode(onGuests, { username: 'ada', recovery: 'AAAAA-BBBBB', password: 'a brand new evening' }, at), /pw\.err\.method_off/);
  } finally {
    delete process.env.KINDRED_GUEST_ORIGIN;
  }
});

test('passwords turned off: every password form refuses', async () => {
  await account('Ada Example', 'ada');
  await store.accounts().run("UPDATE instance_setting SET value = '[\"passkey\"]' WHERE key = 'auth_methods'");
  await assert.rejects(pw.passwordSignIn(req(), { username: 'ada', password: GOOD }, at), /pw\.err\.method_off/);
});

test('a demo refuses a password sign-in before anything is read or written', async () => {
  await account('Ada Example', 'ada');
  process.env.KINDRED_DEMO = '1';
  try {
    await assert.rejects(pw.passwordSignIn(req(), { username: 'ada', password: GOOD }, at), (e: Error & { status?: number }) => e.status === 403);
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  assert.equal(await store.accounts().get('SELECT 1 FROM auth_attempt'), undefined);
});

test('a "View as" preview request writes nothing: password changes are refused', async () => {
  const ada = await account('Ada Example', 'ada');
  const preview = { tree: 'testfield', kind: 'role', role: 'viewer', expires: Date.now() + 60_000 } as never;
  onRequestReadOnly(() => viewAsRefused(preview));
  try {
    await assert.rejects(pw.passwordSignIn(req(), { username: 'ada', password: GOOD }, at), (e: Error & { status?: number }) => e.status === 403);
    const { setMyPassword } = await import('./my-signin.server.ts');
    await assert.rejects(setMyPassword(req(), ada, { password: 'another quiet harbour' }), (e: Error & { status?: number }) => e.status === 403);
  } finally {
    onRequestReadOnly(() => undefined);
  }
  assert.equal(await pw.verifyAccountPassword(GOOD, (await pw.passwordOf(ada.id))!.hash), true, 'the password is unchanged');
});

// ---------- an operator's reset link ----------

test('an operator’s reset link sets a password once, within the hour, ends the sessions and adds no family', async () => {
  const ada = await account('Ada Example', 'ada');
  await store.accounts().run("INSERT INTO membership (user, tree, role, created) VALUES (?, 'testfield', 'viewer', 0)", ada.id);
  const old = (await store.createSession(ada.id, null, false, 'password')).token;
  const { token, writes } = await pw.makeResetLink(ada.id, 'operator-id', false);
  await store.accounts().batch(writes);
  assert.deepEqual(await pw.redeemResetLink(req(), { token, password: 'a reset evening light' }, at), { user: ada.id });
  assert.equal(await store.sessionByToken(old), undefined);
  await assert.rejects(pw.redeemResetLink(req(), { token, password: 'once more the light' }, at), /pw\.err\.reset_gone/, 'a link works once');
  const memberships = await store.membershipsOf(ada.id);
  assert.deepEqual(memberships.map((m) => [m.tree, m.role]), [['testfield', 'viewer']]);
  const expired = await pw.makeResetLink(ada.id, 'operator-id', false);
  await store.accounts().batch(expired.writes);
  await store.accounts().run('UPDATE password_reset SET expires = ? WHERE used_at IS NULL', Date.now() - 1);
  await assert.rejects(pw.redeemResetLink(req(), { token: expired.token, password: 'once more the light' }, at), /pw\.err\.reset_gone/);
});

test('a reset link for an account with two-step codes asks for a code, unless the operator turned them off with it', async () => {
  const { user } = await withTotp('Ada Example', 'ada');
  const keep = await pw.makeResetLink(user.id, 'op', false);
  await store.accounts().batch(keep.writes);
  await assert.rejects(pw.redeemResetLink(req(), { token: keep.token, password: 'a reset evening light' }, at), /pw\.err\.code/);
  const clear = await pw.makeResetLink(user.id, 'op', true);
  await store.accounts().batch(clear.writes);
  await pw.redeemResetLink(req(), { token: clear.token, password: 'a reset evening light' }, at);
  assert.equal(await totp.totpOn(user.id), false);
  assert.equal((await pw.passwordSignIn(req(), { username: 'ada', password: 'a reset evening light' }, at)).kind, 'session');
});

// ---------- council round 7: the throttle counts before it checks, and never locks the right person out ----------

test('thirty guesses at once: the try is counted before the hash, so at most the limit are checked', async () => {
  await account('Ada Example', 'ada');
  const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => pw.passwordSignIn(req(), { username: 'ada', password: `wrong guess number ${i}` }, at)));
  const checked = results.filter((r) => r.status === 'rejected' && code(r.reason) === 'pw.err.wrong').length;
  const refused = results.filter((r) => r.status === 'rejected' && code(r.reason) === 'pw.err.throttled').length;
  assert.ok(checked <= attempts.PAIR_LIMIT, `${checked} guesses were hashed; at most ${attempts.PAIR_LIMIT} may be`);
  assert.equal(checked + refused, 30);
});

test('thirty codes at once on one ticket: at most the ticket’s tries are checked', async () => {
  await withTotp('Ada Example', 'ada');
  const t = await pw.passwordSignIn(req(), { username: 'ada', password: GOOD }, at) as { ticket: string };
  const results = await Promise.allSettled(Array.from({ length: 30 }, () => pw.passwordSecondStep(req(), { ticket: t.ticket, code: '000000' }, at)));
  const checked = results.filter((r) => r.status === 'rejected' && code(r.reason) === 'pw.err.code').length;
  assert.ok(checked <= 5, `${checked} codes were checked; at most five may be`);
});

test('thirty recovery tries at once: at most the limit are checked', async () => {
  await withTotp('Ada Example', 'ada');
  const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) =>
    pw.resetWithRecoveryCode(req(), { username: 'ada', recovery: `AAAAA-BBBB${'CDEFGHJKLMNPQRSTUVWXYZ234567'[i]}`, code: '000000', password: 'a brand new evening' }, at)));
  const checked = results.filter((r) => r.status === 'rejected' && code(r.reason) === 'pw.err.recovery').length;
  assert.ok(checked <= attempts.PAIR_LIMIT, `${checked} recovery codes were checked`);
});

test('a username guessed at from one network still signs in with the right password from another (no lockout by name)', async () => {
  const ada = await account('Ada Example', 'ada');
  for (let i = 0; i < 12; i++) await pw.passwordSignIn(req(), { username: 'ada', password: `wrong guess number ${i}` }, { ip: '198.51.100.1' }).catch(() => undefined);
  await assert.rejects(pw.passwordSignIn(req(), { username: 'ada', password: GOOD }, { ip: '198.51.100.1' }), /pw\.err\.throttled/, 'the guessing network is locked for that name');
  let waited = 0;
  const elsewhere = { ip: '192.0.2.50', wait: async (ms: number) => { waited += ms; } };
  assert.deepEqual(await pw.passwordSignIn(req(), { username: 'ada', password: GOOD }, elsewhere), { kind: 'session', user: ada.id });
  assert.ok(waited > 0 && waited <= 5_000, 'without Turnstile keys, a short fixed delay instead of a lock');
});

test('a username guessed at: with Turnstile keys the next try from anywhere needs a Turnstile answer, never a lock', async () => {
  const ada = await account('Ada Example', 'ada');
  for (let i = 0; i < 6; i++) await pw.passwordSignIn(req(), { username: 'ada', password: `wrong guess number ${i}` }, { ip: `198.51.100.${i + 10}` }).catch(() => undefined);
  const withKeys = { ip: '192.0.2.51', turnstileOn: true, turnstile: async (t: string | undefined) => t === 'good-token', wait: async () => assert.fail('no delay when Turnstile asks') };
  await assert.rejects(pw.passwordSignIn(req(), { username: 'ada', password: GOOD }, withKeys), /pw\.err\.turnstile/);
  assert.deepEqual(await pw.passwordSignIn(req(), { username: 'ada', password: GOOD, turnstile: 'good-token' }, withKeys), { kind: 'session', user: ada.id });
});

test('a right password gives back the network’s and the server’s count: signing in often never throttles a household', async () => {
  await account('Ada Example', 'ada');
  for (let i = 0; i < attempts.NETWORK_LIMIT + 5; i++) assert.equal((await pw.passwordSignIn(req(), { username: 'ada', password: GOOD }, at)).kind, 'session');
});

test('“username taken” counts against the network, so names cannot be listed by trying them', async () => {
  await account('Ada Example', 'ada');
  for (let i = 0; i < attempts.NETWORK_LIMIT; i++) await assert.rejects(pw.requireFreeUsername('ada', ip), /pw\.err\.username_taken/);
  await assert.rejects(pw.requireFreeUsername('a-free-name', ip), /pw\.err\.throttled/, 'the network has used its tries');
  await pw.requireFreeUsername('a-free-name', '192.0.2.77');
});

test('recovery codes are stored under the server’s keyed hash, not a plain SHA-256; codes stored the old way still work once', async () => {
  const { user, codes } = await withTotp('Ada Example', 'ada');
  const { hashToken } = await import('./tokens.server.ts');
  const plain = await hashToken('recovery', `${user.id}:${codes[0].replace('-', '')}`);
  const stored = await store.accounts().all<{ hash: string }>('SELECT hash FROM recovery_code WHERE user = ?', user.id);
  assert.equal(stored.length, 10);
  assert.ok(stored.every((r) => r.hash !== plain && r.hash.startsWith('h1:')), 'a copied database alone cannot be guessed against');
  process.env.KINDRED_SECRET = 'another-secret';
  try {
    assert.equal(await totp.consumeRecoveryCode(user.id, codes[0]), false, 'the key comes from KINDRED_SECRET');
  } finally {
    process.env.KINDRED_SECRET = 'password-test-secret';
  }
  assert.equal(await totp.consumeRecoveryCode(user.id, codes[0]), true);
  // A code stored before this change: the plain hash keeps working, once, and the account is asked to make new codes.
  await store.accounts().run('INSERT INTO recovery_code (user, hash, created) VALUES (?, ?, 0)', user.id, await hashToken('recovery', `${user.id}:OLDCODE234`));
  assert.equal(await totp.recoveryNeedsRenewal(user.id), true);
  assert.equal(await totp.consumeRecoveryCode(user.id, 'oldco-de234'), true);
  assert.equal(await totp.consumeRecoveryCode(user.id, 'OLDCO-DE234'), false);
});

// ---------- council round 7: an operator's reset link cannot take over an account quietly ----------

test('a reset link is refused for an account that has no password (it would add one: a takeover)', async () => {
  const made = store.newUser('Cy Passkey', null);
  await store.accounts().batch([made.insert, store.q("UPDATE user SET email = 'cy@example.org' WHERE id = ?", made.user.id)]);
  const { resetLinkFor } = await import('../operator/signin.server.ts');
  const op = (await account('Olu Operator', 'olu'));
  await assert.rejects(resetLinkFor(op, 'cy@example.org', false), /pw\.err\.reset_no_password/);
  assert.equal(await store.accounts().get('SELECT 1 FROM password_reset'), undefined);
  // A link made before this rule cannot add a password either.
  const { token, writes } = await pw.makeResetLink(made.user.id, op.id, false);
  await store.accounts().batch(writes);
  await assert.rejects(pw.redeemResetLink(req(), { token, username: 'cy.new', password: 'a reset evening light' }, at), /pw\.err\.reset_gone/);
  assert.equal(await pw.passwordOf(made.user.id), undefined);
});

test('a used reset link leaves a lasting notice for the holder’s next sign-in by another way, and ends every other session', async () => {
  const ada = await account('Ada Example', 'ada');
  const passkeySession = (await store.createSession(ada.id, 'k-ada', false, 'passkey')).token;
  const { token, writes } = await pw.makeResetLink(ada.id, 'operator-id', false);
  await store.accounts().batch(writes);
  await pw.redeemResetLink(req(), { token, password: 'a reset evening light' }, at);
  assert.equal(await store.sessionByToken(passkeySession), undefined, 'the other sessions end');
  assert.equal(await pw.resetNoticeOf(ada.id, 'password'), null, 'whoever used the link (a password session) sees no notice to dismiss');
  await assert.rejects(pw.dismissResetNotice(ada.id, 'password'), /pw\.err\.reset_notice_method/);
  const notice = await pw.resetNoticeOf(ada.id, 'passkey');
  assert.ok(notice && notice.at > 0, 'the holder signing in with a passkey sees when the operator reset the password');
  // Another link later does not wipe the notice while it is unseen.
  await store.accounts().batch((await pw.makeResetLink(ada.id, 'operator-id', false)).writes);
  await store.accounts().run('UPDATE password_reset SET expires = 1 WHERE used_at IS NOT NULL');
  await store.accounts().batch((await pw.makeResetLink(ada.id, 'operator-id', false)).writes);
  assert.ok(await pw.resetNoticeOf(ada.id, 'passkey'), 'still there until dismissed');
  await pw.dismissResetNotice(ada.id, 'passkey');
  assert.equal(await pw.resetNoticeOf(ada.id, 'oidc'), null);
});

test('every new session counts one sign-in of its way in for the day, though the next sign-in deletes the session', async () => {
  const ada = await account('Ada Example', 'ada');
  const first = await startSession(req(), ada.id, null, true, 'password');
  await startSession(req(`kindred_session=${tokenOf(first)}`), ada.id, null, true, 'password');
  await startSession(req(), ada.id, 'k-ada', true, 'passkey');
  const day = new Date().toISOString().slice(0, 10);
  const rows = await store.accounts().all<{ method: string; count: number }>('SELECT method, count FROM signin_daily WHERE day = ? ORDER BY method', day);
  assert.deepEqual(rows.map((r) => [r.method, r.count]), [['passkey', 1], ['password', 2]]);
});
