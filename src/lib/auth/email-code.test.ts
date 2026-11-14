// node --test src/lib/auth/email-code.test.ts — "Email me a sign-in code" (./email-code.server.ts, accounts migration 0058): one
// answer for every address, at once and in about the same time; a code only to an account's confirmed address; limits that hold
// under concurrency; single use, ten minutes, five tries; the code works only in the browser that asked; two-step codes still
// asked; the session is a fresh proof for a member and never for an operator; the security notice; demo and "View as" refuse;
// the console's card, its counts, the last-operator rule and turning it off (its sessions end). Scratch accounts only; a
// captured mailer; invented names.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-email-code-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'email-code-test-secret';
for (const k of ['KINDRED_AUTH', 'KINDRED_AUTH_METHODS', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'KINDRED_GUEST_ORIGIN', 'KINDRED_DEMO', 'KINDRED_MAIL_FAKE', 'KINDRED_MAIL_API_KEY', 'KINDRED_SMTP_PASSWORD']) delete process.env[k];
const SITE = 'http://family.example.org';
process.env.KINDRED_ORIGIN = SITE;

const store = await import('./store.server.ts');
const code = await import('./email-code.server.ts');
const send = await import('../email/send.server.ts');
const methods = await import('./methods.server.ts');
const { requireFreshProof } = await import('./proof.server.ts');
const { onRequestReadOnly } = await import('../read-only.ts');
const { viewAsRefused } = await import('./view-as.server.ts');

type Sent = import('../email/mailer.ts').MailMessage;
let sent: Sent[] = [];
const capture = { mailer: { send: async (m: Sent) => { sent.push(m); } } };
const ip = '203.0.113.9';

const TABLES = ['session', 'credential', 'password', 'totp', 'recovery_code', 'auth_attempt', 'signin_step', 'signin_daily', 'email_signin', 'email_token', 'membership', 'instance_setting', 'email_send', 'join_request', 'user'];
const setMethods = (list: string[]) => store.accounts().run("INSERT INTO instance_setting (key, value, updated_at) VALUES ('auth_methods', ?, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(list));
beforeEach(async () => {
  await send.settleSends();
  await store.accounts().batch(TABLES.map((t) => store.q(`DELETE FROM ${t}`)));
  await setMethods(['passkey', 'email-code']);
  sent = [];
  send.setMailerForTests(capture);
});
after(async () => {
  send.setMailerForTests(undefined);
  (await import('../store/node.ts')).closeAccounts();
  rmSync(dir, { recursive: true, force: true });
});

async function account(name: string, opts: { email?: string; verified?: boolean; operator?: boolean; passkey?: boolean } = {}) {
  const made = store.newUser(name, opts.email ?? null, undefined, null, !!opts.verified);
  await store.accounts().batch([
    made.insert,
    // The first account is the server's operator (store.server.ts, newUser): each test says who is.
    store.q('UPDATE user SET operator = ? WHERE id = ?', opts.operator ? 1 : 0, made.user.id),
    ...(opts.passkey ? [store.insertCredential({ id: `k-${made.user.id}`, user: made.user.id, publicKey: new Uint8Array([1]), counter: 0, transports: ['internal'], device: 'Mac', synced: false })] : []),
  ]);
  return (await store.userById(made.user.id))!;
}

/** A browser: the cookies the server set for it, sent back with each request. */
function browser() {
  const jar = new Map<string, string>();
  const keep = (cookies: string[]) => {
    for (const c of cookies) {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      const [k, v] = [pair!.slice(0, i), pair!.slice(i + 1)];
      if (v && !/Max-Age=0(;|$)/.test(c)) jar.set(k, v); else jar.delete(k);
    }
  };
  const req = () => new Request(`${SITE}/api/auth/x`, { headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
  return {
    jar, req, keep,
    ask: async (email: string, from = ip) => { const r = await code.requestSignInCode(req(), email, from); keep([r.cookie]); return r; },
    signIn: async (typed: string, from = ip) => { const r = await code.signInWithCode(req(), typed, from); keep(r.cookies); return r; },
  };
}
const codeIn = (m: Sent) => /\b(\d{6})\b/.exec(m.text)?.[1];
const lastCode = async () => { await send.settleSends(); return codeIn(sent.filter((m) => /sign-in code/.test(m.subject)).at(-1)!)!; };
const reauth = (e: unknown) => (e as { code?: string }).code === 'reauth';

test('one answer for every address, at once: a code only to an account’s confirmed address, never to one a steward typed', async () => {
  await account('Ada Example', { email: 'ada@example.org', verified: true, passkey: true });
  await account('Ben Example', { email: 'ben@example.org', verified: false, passkey: true });
  // The provider takes its time: the answer must not wait for it.
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  send.setMailerForTests({ mailer: { send: async (m) => { await gate; sent.push(m); } } });
  const answers: string[] = [];
  const rows: unknown[] = [];
  for (const email of ['ada@example.org', 'ben@example.org', 'nobody@example.org']) {
    const b = browser();
    const started = performance.now();
    const r = await b.ask(email);
    assert.ok(performance.now() - started < 1000, 'answered without waiting for the provider');
    answers.push(r.cookie.replace(/=[^;]+;/, '=…;'));
    rows.push(await store.accounts().get('SELECT user, secret, tries, used_at FROM email_signin ORDER BY created DESC, rowid DESC LIMIT 1'));
  }
  assert.ok(answers.every((a) => a === answers[0]), 'the same cookie for all, but its value');
  assert.match(answers[0]!, /^kindred_mailcode=…; Path=\/; Max-Age=600; HttpOnly; SameSite=Strict$/);
  assert.ok(rows.every((r) => JSON.stringify(r) === JSON.stringify({ user: null, secret: null, tries: 0, used_at: null })), 'every row looks the same at the answer');
  release();
  await send.settleSends();
  send.setMailerForTests(capture);
  assert.deepEqual(sent.map((m) => m.to), ['ada@example.org'], 'only the confirmed address');
  const mail = sent[0]!;
  assert.match(mail.subject, /^Your sign-in code for /);
  assert.match(mail.text, /family\.example\.org/, 'names this server');
  assert.match(mail.text, /only in the browser where you asked/);
  assert.match(mail.text, new RegExp(`${SITE.replace(/\./g, '\\.')}/signin\\?code=1`), 'the link opens the code page');
  assert.ok(!mail.text.includes(`code=${codeIn(mail)}`), 'and carries no code');
  assert.equal(mail.headers['List-Unsubscribe'], undefined, 'a security email: no unsubscribe');
  assert.equal(JSON.stringify(await store.accounts().all('SELECT category FROM email_send')), JSON.stringify([{ category: 'signin' }]));
});

test('the time of an answer does not tell whether an account has the address', async () => {
  await account('Ada Example', { email: 'ada@example.org', verified: true, passkey: true });
  const time = async (email: string, n: number) => {
    let total = 0;
    for (let i = 0; i < n; i++) {
      const started = performance.now();
      await browser().ask(email, `198.51.100.${i + 1}`);
      total += performance.now() - started;
    }
    await send.settleSends();
    await store.accounts().run('DELETE FROM email_send');
    return total / n;
  };
  await time('warm@example.org', 3);
  const known = await time('ada@example.org', 12);
  const unknown = await time('nobody@example.org', 12);
  // The same statements either way: no lookup happens before the answer. Generous bounds, so a busy machine stays green.
  assert.ok(Math.abs(known - unknown) < Math.max(15, 0.5 * Math.max(known, unknown)), `known ${known.toFixed(2)} ms, unknown ${unknown.toFixed(2)} ms`);
});

test('a right code signs in once, starts an email-code session, counts it and sends the notice', async () => {
  const ada = await account('Ada Example', { email: 'ada@example.org', verified: true, passkey: true });
  const b = browser();
  await b.ask('ada@example.org');
  const c = await lastCode();
  const r = await b.signIn(c);
  assert.equal(r.kind, 'session');
  const s = await store.accounts().get<{ user: string; method: string; proved_via: string | null }>('SELECT user, method, proved_via FROM session');
  assert.deepEqual({ ...s }, { user: ada.id, method: 'email-code', proved_via: 'email-code' });
  assert.equal(b.jar.has('kindred_mailcode'), false, 'the browser’s binding is cleared');
  assert.ok(b.jar.has('kindred_session'));
  // Single use, even in the same browser with the binding put back.
  const again = browser();
  again.jar.set('kindred_mailcode', 'x'.repeat(43));
  await assert.rejects(code.signInWithCode(again.req(), c, ip), /email\.err\.code/);
  const daily = await store.accounts().get<{ count: number }>("SELECT count FROM signin_daily WHERE method = 'email-code'");
  assert.equal(daily?.count, 1, 'the statistics count it by its way in');
  await send.settleSends();
  assert.match(sent.at(-1)!.text, /You signed in to your account on .* with a code we emailed to this address/);
  assert.equal(sent.at(-1)!.to, 'ada@example.org');
});

test('a code is spent once even when two requests race with it', async () => {
  await account('Ada Example', { email: 'ada@example.org', verified: true, passkey: true });
  const b = browser();
  await b.ask('ada@example.org');
  const c = await lastCode();
  const results = await Promise.allSettled([1, 2, 3, 4].map(() => code.signInWithCode(b.req(), c, ip)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await store.accounts().get<{ n: number }>('SELECT count(*) AS n FROM session'))!.n, 1);
});

test('the code works only in the browser that asked for it', async () => {
  await account('Ada Example', { email: 'ada@example.org', verified: true, passkey: true });
  const mine = browser();
  await mine.ask('ada@example.org');
  const c = await lastCode();
  // Someone who got the code (read out, typed into another site) tries it on their own device: with no binding, or their own.
  await assert.rejects(code.signInWithCode(browser().req(), c, '192.0.2.50'), /email\.err\.code/);
  const theirs = browser();
  await theirs.ask('mallory@example.org', '192.0.2.50');
  await assert.rejects(theirs.signIn(c, '192.0.2.50'), /email\.err\.code/);
  // The device that asked still can.
  assert.equal((await mine.signIn(c)).kind, 'session');
});

test('five tries a code, counted before checking, even sent all at once; then even the right code is refused', async () => {
  await account('Ada Example', { email: 'ada@example.org', verified: true, passkey: true });
  const b = browser();
  await b.ask('ada@example.org');
  const c = await lastCode();
  const wrongCode = c === '000000' ? '111111' : '000000';
  const tries = await Promise.allSettled(Array.from({ length: 12 }, () => code.signInWithCode(b.req(), wrongCode, ip)));
  assert.ok(tries.every((r) => r.status === 'rejected'));
  const row = await store.accounts().get<{ tries: number }>('SELECT tries FROM email_signin');
  assert.equal(row?.tries, 5, 'no more than five counted');
  await assert.rejects(b.signIn(c), /email\.err\.code/, 'the code is used up');
});

test('a code runs out after ten minutes', async () => {
  await account('Ada Example', { email: 'ada@example.org', verified: true, passkey: true });
  const b = browser();
  await b.ask('ada@example.org');
  const c = await lastCode();
  await store.accounts().run('UPDATE email_signin SET expires = ?', Date.now() - 1);
  await assert.rejects(b.signIn(c), /email\.err\.code/);
});

test('asking is limited per address and network, the same for an address with an account and one without, under concurrency', async () => {
  await account('Ada Example', { email: 'ada@example.org', verified: true, passkey: true });
  for (const email of ['ada@example.org', 'nobody@example.org']) {
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => browser().ask(email, '192.0.2.1')));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 5, email);
    assert.ok(results.filter((r) => r.status === 'rejected').every((r) => /pw\.err\.throttled/.test(String((r as PromiseRejectedResult).reason))));
  }
  await send.settleSends();
  // The address's inbox gets no more than the code limit an hour, whichever networks ask.
  for (let i = 0; i < 6; i++) await browser().ask('ada@example.org', `198.51.100.${i + 1}`);
  await send.settleSends();
  assert.equal(sent.filter((m) => m.to === 'ada@example.org').length, send.CODES_PER_HOUR);
});

test('an account with two-step codes still gives one; a password ticket never finishes a code sign-in, nor the reverse', async () => {
  const ada = await account('Ada Example', { email: 'ada@example.org', verified: true, passkey: true });
  const { beginTotp, codeAt, stepAt } = await import('./totp.server.ts');
  const secret = await beginTotp(ada.id);
  assert.ok(secret);
  await store.accounts().run('UPDATE totp SET confirmed_at = ? WHERE user = ?', Date.now(), ada.id);
  const b = browser();
  await b.ask('ada@example.org');
  const r = await b.signIn(await lastCode());
  assert.equal(r.kind, 'second');
  assert.equal((await store.accounts().get<{ n: number }>('SELECT count(*) AS n FROM session'))!.n, 0, 'no session before the code');
  const ticket = (r as { ticket: string }).ticket;
  const pw = await import('./password.server.ts');
  await setMethods(['passkey', 'password', 'email-code']);
  await assert.rejects(pw.passwordSecondStep(b.req(), { ticket, code: await codeAt(secret, stepAt(Date.now())) }, { ip }), /pw\.err\.step_expired/, 'not a password ticket');
  await assert.rejects(code.signInCodeSecondStep(b.req(), { ticket, code: '000000' === (await codeAt(secret, stepAt(Date.now()))) ? '111111' : '000000' }, ip), /pw\.err\.code/);
  const done = await code.signInCodeSecondStep(b.req(), { ticket, code: await codeAt(secret, stepAt(Date.now())) }, ip);
  assert.equal(done.kind, 'session');
  assert.equal((await store.accounts().get<{ method: string }>('SELECT method FROM session'))?.method, 'email-code');
});

test('the sign-in is a fresh proof for a member (to add a passkey after losing every device), never for an operator', async () => {
  const ada = await account('Ada Example', { email: 'ada@example.org', verified: true });
  const ops = await account('Opal Example', { email: 'opal@example.org', verified: true, passkey: true, operator: true });
  for (const [who, email, proved] of [[ada, 'ada@example.org', true], [ops, 'opal@example.org', false]] as const) {
    const b = browser();
    await b.ask(email);
    await b.signIn(await lastCode());
    const check = requireFreshProof(b.req(), (await store.userById(who.id))!);
    if (proved) await check;
    else await assert.rejects(check, reauth);
  }
  // Even an account made an operator right after its code sign-in is not proven by it.
  await store.accounts().run('UPDATE user SET operator = 1 WHERE id = ?', ada.id);
  const b = browser();
  await b.ask('ada@example.org');
  await b.signIn(await lastCode());
  await store.accounts().run("UPDATE session SET proved = ?, proved_via = 'email-code'", Date.now());
  await assert.rejects(requireFreshProof(b.req(), (await store.userById(ada.id))!), reauth);
});

test('nothing in a demo or a "View as" preview, nothing on the guest host, nothing while the method or email is off', async () => {
  await account('Ada Example', { email: 'ada@example.org', verified: true, passkey: true });
  process.env.KINDRED_DEMO = '1';
  try {
    await assert.rejects(browser().ask('ada@example.org'), /email\.err\.code_off/);
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  const preview = { tree: 'testfield', kind: 'role', role: 'viewer', expires: Date.now() + 60_000 } as never;
  onRequestReadOnly(() => viewAsRefused(preview));
  try {
    await assert.rejects(browser().ask('ada@example.org'));
    await assert.rejects(code.signInWithCode(browser().req(), '123456', ip));
  } finally {
    onRequestReadOnly(() => undefined);
  }
  await setMethods(['passkey']);
  await assert.rejects(browser().ask('ada@example.org'), /email\.err\.code_off/);
  await setMethods(['passkey', 'email-code']);
  send.setMailerForTests(null);
  await assert.rejects(browser().ask('ada@example.org'), /email\.err\.code_off/, 'email off');
  send.setMailerForTests(capture);
  await send.settleSends();
  assert.equal(sent.length, 0);
});

test('the console: a card with its counts; turning it off ends its sessions; an operator keeps a way in a code cannot be', async () => {
  const ops = await account('Opal Example', { email: 'opal@example.org', verified: true, passkey: true, operator: true });
  await account('Ada Example', { email: 'ada@example.org', verified: true });
  await account('Ben Example', { email: 'ben@example.org', verified: false, passkey: true });
  const settings = await methods.signInSettings();
  const card = settings.methods.find((m) => m.id === 'email-code')!;
  assert.deepEqual({ ...card }, { id: 'email-code', state: 'enabled', accounts: 2, onlyWay: 1 }, 'Ada has nothing else');
  assert.equal(settings.methods.find((m) => m.id === 'passkey')!.onlyWay, 1, 'Ben: his confirmed address is no way in');
  // Turning it off: Ada would be left with no way in, and every code session ends.
  const b = browser();
  await b.ask('ada@example.org');
  await b.signIn(await lastCode());
  assert.equal((await methods.previewMethods(['passkey'])).lockedOut, 1);
  const audit = () => store.q('SELECT 1');
  await methods.saveMethods(['passkey'], ops.id, audit);
  assert.equal((await store.accounts().get<{ n: number }>("SELECT count(*) AS n FROM session WHERE method = 'email-code'"))!.n, 0);
  // Codes alone would leave the operator without a lasting way in: refused, though their address is confirmed.
  await assert.rejects(methods.saveMethods(['email-code'], ops.id, audit), /pw\.err\.operator_locked_out/);
  // Unavailable while email is off: it cannot be turned on.
  send.setMailerForTests(null);
  assert.equal((await methods.signInSettings()).methods.find((m) => m.id === 'email-code')!.state, 'unavailable');
  await assert.rejects(methods.saveMethods(['passkey', 'email-code'], ops.id, audit), /pw\.err\.unavailable/);
});

test('a session of a code is not honoured once the method is off by the break-glass list', async () => {
  await account('Ada Example', { email: 'ada@example.org', verified: true });
  const b = browser();
  await b.ask('ada@example.org');
  await b.signIn(await lastCode());
  const { getSession } = await import('./session.server.ts');
  assert.ok((await getSession(b.req())).user, 'signed in');
  process.env.KINDRED_AUTH_METHODS = 'passkey';
  try {
    assert.equal((await getSession(b.req())).user, null);
  } finally {
    delete process.env.KINDRED_AUTH_METHODS;
  }
  assert.equal((await getSession(b.req())).method, 'email-code');
});

// ---------- a code exists only while its email does, and only for the address it went to ----------

/** Codes that could still sign someone in: issued (an account and a secret), not used, not run out. */
const liveCodes = async () => (await store.accounts().get<{ n: number }>('SELECT count(*) AS n FROM email_signin WHERE secret IS NOT NULL AND used_at IS NULL AND expires > ?', Date.now()))!.n;

test('live codes never outnumber the emails sent: one address asked for from forty networks, five times each', async () => {
  await account('Ada Example', { email: 'ada@example.org', verified: true, passkey: true });
  // The probe: one browser, a new IPv6 /64 for each five asks, every ask within the per-address-and-network limit.
  const asker = browser();
  for (let n = 0; n < 40; n++) {
    for (let i = 0; i < 5; i++) await asker.ask('ada@example.org', `2001:db8:${n.toString(16)}::${i + 1}`);
  }
  await send.settleSends();
  const delivered = sent.filter((m) => m.to === 'ada@example.org').length;
  assert.equal(delivered, send.CODES_PER_HOUR);
  assert.ok((await liveCodes()) <= delivered, `${await liveCodes()} live codes, ${delivered} emails`);
});

test('a code whose email was not sent is no code; an account gets no more than the hour’s codes, even asked for all at once', async () => {
  await account('Ada Example', { email: 'ada@example.org', verified: true, passkey: true });
  send.setMailerForTests({ mailer: { send: async () => { throw new Error('the provider refused'); } } });
  await browser().ask('ada@example.org');
  await send.settleSends();
  assert.equal(await liveCodes(), 0, 'a failed send leaves no code behind');
  // While every email is still on its way, the account's codes are counted as they are issued, not as they are sent.
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  send.setMailerForTests({ mailer: { send: async (m) => { await gate; sent.push(m); } } });
  await Promise.all(Array.from({ length: 10 }, (_, i) => browser().ask('ada@example.org', `198.51.100.${i + 1}`)));
  await new Promise((r) => setTimeout(r, 50));
  assert.ok((await liveCodes()) <= send.CODES_PER_HOUR, `${await liveCodes()} codes issued at once`);
  release();
  await send.settleSends();
  send.setMailerForTests(capture);
  assert.ok((await liveCodes()) <= sent.length);
});

/** Confirms a new address for `user` the way the account page does (email/verify.server.ts). */
async function confirmAddress(user: Awaited<ReturnType<typeof account>>, to: string) {
  const verify = await import('../email/verify.server.ts');
  send.setMailerForTests(capture);
  await verify.startVerification(new Request(`${SITE}/settings`), user, to, async () => {});
  const token = /verify-email\/([A-Za-z0-9_-]{43})/.exec(sent.filter((m) => m.to === to).at(-1)!.text)![1]!;
  await verify.redeemVerification(token, user.id);
}

test('a code is void once the account’s confirmed address changes, even if it changes back', async () => {
  const ada = await account('Ada Example', { email: 'ada@example.org', verified: true, passkey: true });
  const b = browser();
  await b.ask('ada@example.org');
  const c = await lastCode();
  await confirmAddress(ada, 'ada.new@example.org');
  await assert.rejects(b.signIn(c), /email\.err\.code/, 'sent to the old address');
  const b2 = browser();
  await b2.ask('ada.new@example.org');
  const c2 = await lastCode();
  await confirmAddress(ada, 'ada@example.org');
  await assert.rejects(b2.signIn(c2), /email\.err\.code/, 'changed away and back');
});

test('a code is void when the address changes while its email is being sent, or is no longer confirmed when it is used', { timeout: 20_000 }, async () => {
  const ada = await account('Ada Example', { email: 'ada@example.org', verified: true, passkey: true });
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let inFlight!: () => void;
  const sending = new Promise<void>((r) => { inFlight = r; });
  send.setMailerForTests({ mailer: { send: async (m) => { if (/sign-in code/.test(m.subject)) { inFlight(); await gate; } sent.push(m); } } });
  const b = browser();
  await b.ask('ada@example.org');
  await sending;
  // The change lands while the provider still has the email.
  const verify = await import('../email/verify.server.ts');
  await verify.startVerification(new Request(`${SITE}/settings`), ada, 'ada.new@example.org', async () => {});
  const token = /verify-email\/([A-Za-z0-9_-]{43})/.exec(sent.at(-1)!.text)![1]!;
  await verify.redeemVerification(token, ada.id);
  release();
  const c = await lastCode();
  send.setMailerForTests(capture);
  await assert.rejects(b.signIn(c), /email\.err\.code/);
  // The binding is checked when the code is spent, whatever ended the address.
  const b2 = browser();
  await b2.ask('ada.new@example.org');
  const c2 = await lastCode();
  await store.accounts().run('UPDATE user SET email_verified = 0 WHERE id = ?', ada.id);
  await assert.rejects(b2.signIn(c2), /email\.err\.code/, 'no longer confirmed');
});

test('the two-step ticket of a code ends when the address changes while the browser waits for the two-step code', async () => {
  const ada = await account('Ada Example', { email: 'ada@example.org', verified: true, passkey: true });
  const { beginTotp, codeAt, stepAt } = await import('./totp.server.ts');
  const secret = (await beginTotp(ada.id)) as string;
  await store.accounts().run('UPDATE totp SET confirmed_at = ? WHERE user = ?', Date.now(), ada.id);
  const b = browser();
  await b.ask('ada@example.org');
  const r = await b.signIn(await lastCode());
  assert.equal(r.kind, 'second');
  await confirmAddress(ada, 'ada.new@example.org');
  await assert.rejects(code.signInCodeSecondStep(b.req(), { ticket: (r as { ticket: string }).ticket, code: await codeAt(secret, stepAt(Date.now())) }, ip), /pw\.err\.step_expired/);
  assert.equal((await store.accounts().get<{ n: number }>('SELECT count(*) AS n FROM session'))!.n, 0);
});
