// node --test src/lib/email/email.test.ts — optional email (src/lib/email/, accounts migrations 0053 and 0054): the providers'
// requests (a fake fetch; no test reaches a provider), header injection, escaping, links only to this server, the sealed key,
// the limits, unsubscribing, verification links and sign-up codes (single use, expiry, tries), the password reset by email (one
// answer for every address, at once, throttled, only to a verified address of an account with a password), security notices
// only to verified addresses, and nothing sent in a demo or a preview. Scratch accounts database only; invented names.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-email-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'email-test-secret';
for (const k of ['KINDRED_AUTH', 'KINDRED_AUTH_METHODS', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'KINDRED_GUEST_ORIGIN', 'KINDRED_DEMO', 'KINDRED_MAIL_FAKE', 'KINDRED_MAIL_API_KEY', 'KINDRED_SMTP_PASSWORD']) delete process.env[k];
const SITE = 'http://family.example.org';
process.env.KINDRED_ORIGIN = SITE;

const store = await import('../auth/store.server.ts');
const pw = await import('../auth/password.server.ts');
const send = await import('./send.server.ts');
const settings = await import('./settings.server.ts');
const mailer = await import('./mailer.ts');
const { renderMail, escapeHtml, ownLink } = await import('./render.ts');
const verify = await import('./verify.server.ts');
const { requestPasswordReset } = await import('./reset.server.ts');
const notify = await import('./notify.server.ts');
const { onRequestReadOnly } = await import('../read-only.ts');
const { viewAsRefused } = await import('../auth/view-as.server.ts');
const { configuration, subprocessorsOf } = await import('../gdpr/subprocessors.ts');

const req = (url = `${SITE}/api/x`) => new Request(url);
const ip = '203.0.113.9';
type Sent = import('./mailer.ts').MailMessage;
let sent: Sent[] = [];
const capture = { mailer: { send: async (m: Sent) => { sent.push(m); } } };

const TABLES = ['session', 'credential', 'password', 'totp', 'recovery_code', 'auth_attempt', 'password_reset', 'membership', 'instance_setting', 'email_token', 'email_send', 'email_optout', 'invite', 'user'];
beforeEach(async () => {
  await store.accounts().batch(TABLES.map((t) => store.q(`DELETE FROM ${t}`)));
  await store.accounts().run("INSERT INTO instance_setting (key, value, updated_at) VALUES ('auth_methods', '[\"passkey\",\"password\"]', 0)");
  await store.accounts().run("INSERT INTO instance_setting (key, value, updated_at) VALUES ('instance_name', 'Sample Hall', 0)");
  sent = [];
  send.setMailerForTests(capture);
});
after(async () => {
  send.setMailerForTests(undefined);
  (await import('../store/node.ts')).closeAccounts();
  rmSync(dir, { recursive: true, force: true });
});

const GOOD = 'a quiet harbour at dusk';
async function account(name: string, opts: { email?: string; verified?: boolean; username?: string; locale?: string } = {}) {
  const made = store.newUser(name, opts.email ?? null, undefined, (opts.locale ?? null) as never, !!opts.verified);
  const writes = [made.insert, ...(opts.username ? await pw.passwordWrites(made.user.id, opts.username, GOOD) : [])];
  await store.accounts().batch(writes);
  return (await store.userById(made.user.id))!;
}
const linkIn = (m: Sent, path: string) => new RegExp(`${SITE.replace(/\./g, '\\.')}${path}([A-Za-z0-9_-]+)`).exec(m.text)?.[1];

// ---------- the providers ----------

function fakeFetch(status = 200, body = '{}') {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url: String(url), init }); return new Response(body, { status }); }) as unknown as typeof fetch;
  return { calls, f };
}
const message = (over: Partial<Sent> = {}): Sent => ({
  from: { name: 'Sample Hall', address: 'kindred@mail.example.org' }, to: 'ada@example.org', subject: 'Hello', text: 'Hi', html: '<p>Hi</p>',
  headers: { 'Auto-Submitted': 'auto-generated' }, ...over,
});

test('Resend, Postmark and Mailgun get the message as their APIs want it, with no tracking, and the key only in the header', async () => {
  const r = fakeFetch();
  await mailer.resendMailer('re_key_1', r.f).send(message({ replyTo: 'help@example.org' }));
  assert.equal(r.calls[0]!.url, 'https://api.resend.com/emails');
  assert.equal((r.calls[0]!.init.headers as Record<string, string>).authorization, 'Bearer re_key_1');
  const rb = JSON.parse(String(r.calls[0]!.init.body));
  assert.deepEqual(rb.to, ['ada@example.org']);
  assert.equal(rb.from, '"Sample Hall" <kindred@mail.example.org>');
  assert.deepEqual(rb.reply_to, ['help@example.org']);
  assert.ok(!String(r.calls[0]!.init.body).includes('re_key_1'));

  const p = fakeFetch();
  await mailer.postmarkMailer('pm_key', p.f).send(message());
  const pb = JSON.parse(String(p.calls[0]!.init.body));
  assert.equal(p.calls[0]!.url, 'https://api.postmarkapp.com/email');
  assert.equal(pb.TrackOpens, false);
  assert.equal(pb.TrackLinks, 'None');
  assert.deepEqual(pb.Headers, [{ Name: 'Auto-Submitted', Value: 'auto-generated' }]);

  const m = fakeFetch();
  await mailer.mailgunMailer('mg_key', 'mg.example.org', 'eu', m.f).send(message());
  assert.equal(m.calls[0]!.url, 'https://api.eu.mailgun.net/v3/mg.example.org/messages');
  const form = new URLSearchParams(String(m.calls[0]!.init.body));
  assert.equal(form.get('o:tracking'), 'no');
  assert.equal((m.calls[0]!.init.headers as Record<string, string>).authorization, `Basic ${btoa('api:mg_key')}`);
  assert.throws(() => mailer.mailgunMailer('k', 'mg.example.org/../v4', 'us', m.f), /invalid Mailgun domain/, 'the domain cannot change the path');
});

test('a provider’s error is one short line without the key', async () => {
  const bad = fakeFetch(401, 'invalid key re_secret_9\r\nX-Injected: yes');
  await assert.rejects(mailer.resendMailer('re_secret_9', bad.f).send(message()), (e: Error) => {
    assert.ok(e instanceof mailer.MailError);
    assert.ok(!e.message.includes('re_secret_9'), 'the key is never in the error');
    assert.ok(!/[\r\n]/.test(e.message));
    return true;
  });
});

test('header injection is impossible: names and subjects are one line, addresses one mailbox, headers only Kindred’s', () => {
  const m = mailer.checkedMessage(message({ subject: 'Hello\r\nBcc: victim@example.org', from: { name: 'Ada\nBcc: x@example.org "q"', address: 'kindred@mail.example.org' } }));
  assert.ok(!/[\r\n]/.test(m.subject) && !/[\r\n]/.test(m.from.name));
  assert.equal(mailer.formatAddress('Ada "the" \\Bold\r\nBcc: x', 'a@example.org'), '"Ada \\"the\\" \\\\Bold Bcc: x" <a@example.org>');
  for (const to of ['a@example.org\r\nBcc: b@example.org', 'a@example.org, b@example.org', 'Ada <a@example.org>', 'a@localhost', '']) {
    assert.throws(() => mailer.checkedMessage(message({ to })), /invalid address/, to);
  }
  assert.throws(() => mailer.checkedMessage(message({ headers: { Bcc: 'b@example.org' } })), /header not allowed/);
  const h = mailer.checkedMessage(message({ headers: { 'List-Unsubscribe': '<https://x>\r\nBcc: b@example.org' } }));
  assert.ok(!/[\r\n]/.test(h.headers['List-Unsubscribe']!));
});

// ---------- the body ----------

test('every variable is escaped in the HTML, and there is no image, no pixel and no link elsewhere', () => {
  const evil = '<img src=https://evil.example/p.gif onerror=alert(1)> & "quotes" \'single\'';
  const out = renderMail({
    locale: 'en', subject: `Hi ${evil}`, greeting: `Hello ${evil},`, paragraphs: [`Family ${evil}`], quote: `Notice ${evil}`, code: '123456',
    action: { label: `Go ${evil}`, url: `${SITE}/invite/abc` }, footer: [`Sent by ${evil}`], unsubscribe: { question: 'Q?', label: 'Unsubscribe', url: `${SITE}/unsubscribe?r=a&c=family&t=b` },
  }, SITE);
  assert.ok(!out.html.includes('<img'), 'no unescaped tag');
  assert.ok(out.html.includes(escapeHtml(evil)));
  assert.ok(!/<img|<script|<link|<iframe|\ssrc="|url\(/i.test(out.html), 'nothing loaded from elsewhere');
  const hrefs = [...out.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1]!.replace(/&amp;/g, '&'));
  assert.ok(hrefs.length === 2 && hrefs.every((h) => h.startsWith(`${SITE}/`)), 'only links to this server');
  assert.ok(out.text.includes(`${SITE}/invite/abc`) && out.text.includes(evil), 'the text version is plain');
  assert.throws(() => ownLink('https://evil.example/x', SITE), /only to this server/);
  assert.throws(() => ownLink('javascript:alert(1)', SITE));
});

// ---------- the settings ----------

test('the key is sealed in the database and never comes back; the environment’s wins', async () => {
  const writes = await settings.mailSettingsWrites({
    provider: 'resend', fromName: 'Sample\r\nHall', fromAddress: 'kindred@mail.example.org', replyTo: '', mailgunDomain: '', mailgunRegion: 'eu',
    smtpHost: '', smtpPort: 587, smtpSecurity: 'starttls', smtpUser: '', perHour: 300, secret: 're_plain_secret_42',
  }, 'op');
  await store.accounts().batch(writes);
  const rows = await store.accounts().all<{ key: string; value: string }>("SELECT key, value FROM instance_setting WHERE key LIKE 'mail_%'");
  assert.ok(!JSON.stringify(rows).includes('re_plain_secret_42'), 'never stored in the clear');
  assert.match(rows.find((r) => r.key === 'mail_secret_sealed')!.value, /^s1\./);
  const view = await settings.mailSettingsView({});
  assert.ok(!JSON.stringify(view).includes('re_plain_secret_42') && !JSON.stringify(view).includes('s1.'), 'the console never gets the key');
  assert.equal(view.secret, 'stored');
  assert.equal(view.fromName, 'Sample Hall', 'a name is one line');
  assert.equal(view.on, true);
  assert.equal((await settings.mailSettingsView({ KINDRED_MAIL_API_KEY: 'env-key' })).secret, 'env');
  // Leaving the key out keeps it; '' removes it.
  const keep = await settings.mailSettingsWrites({ ...view, secret: undefined }, 'op');
  await store.accounts().batch(keep);
  assert.equal((await settings.mailSettingsView({})).secret, 'stored');
  await store.accounts().batch(await settings.mailSettingsWrites({ ...view, secret: '' }, 'op'));
  assert.equal((await settings.mailSettingsView({})).on, false, 'no key, no sending');
  await assert.rejects(settings.mailSettingsWrites({ ...view, fromAddress: 'not an address' }, 'op'), /email\.err\.from/);
});

test('the provider becomes a subprocessor; Mailgun’s EU region is named', async () => {
  await store.accounts().batch(await settings.mailSettingsWrites({
    provider: 'mailgun', fromName: '', fromAddress: 'k@mg.example.org', replyTo: '', mailgunDomain: 'mg.example.org', mailgunRegion: 'eu',
    smtpHost: '', smtpPort: 587, smtpSecurity: 'starttls', smtpUser: '', perHour: 300, secret: 'k',
  }, 'op'));
  const subs = subprocessorsOf(await configuration(() => undefined, {}));
  const mg = subs.find((s) => s.purpose === 'email');
  assert.equal(mg?.id, 'mailgun');
  assert.equal(mg?.where, 'EU');
  assert.equal(subprocessorsOf({ workers: false, aiProviders: [], addressLookup: false, githubArchive: false, push: false, turnstile: false }).length, 0, 'none while off');
});

// ---------- sending ----------

const plain = (to: string, category: import('./shared.ts').MailCategory = 'test') =>
  send.sendMail({ to, locale: 'en', category, body: (t) => ({ subject: 'Test', paragraphs: [t('email.mail.test_body')] }) });

test('the limits hold per address and per server, and a code category has its own', async () => {
  for (let i = 0; i < send.RECIPIENT_PER_HOUR; i++) assert.equal((await plain('ada@example.org')).result, 'sent');
  assert.equal((await plain('ada@example.org')).result, 'throttled', 'a seventh email this hour to one address waits');
  assert.equal((await plain('ben@example.org')).result, 'sent', 'another address is not held');
  for (let i = 0; i < send.CODES_PER_HOUR; i++) assert.equal((await plain('cy@example.org', 'signup')).result, 'sent');
  assert.equal((await plain('cy@example.org', 'reset')).result, 'throttled', 'codes and links have their own, smaller limit');
  // Ten counted so far this hour (the held ones do not count): a ceiling of ten holds the next.
  await store.accounts().run("INSERT INTO instance_setting (key, value, updated_at) VALUES ('mail_per_hour', '10', 0)");
  assert.equal((await plain('dee@example.org')).result, 'throttled', 'the server’s hourly ceiling');
  const rows = await store.accounts().all<{ recipient: string }>('SELECT recipient FROM email_send');
  assert.ok(rows.every((r) => !r.recipient.includes('@')), 'the log keeps a keyed hash, never the address');
});

test('nothing is sent in a demo or a "View as" preview', async () => {
  process.env.KINDRED_DEMO = '1';
  try {
    assert.equal((await plain('ada@example.org')).result, 'read-only');
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  const preview = { tree: 'testfield', kind: 'role', role: 'viewer', expires: Date.now() + 60_000 } as never;
  onRequestReadOnly(() => viewAsRefused(preview));
  try {
    assert.equal((await plain('ada@example.org')).result, 'read-only');
    const ada = await account('Ada Example', { email: 'ada@example.org', verified: true, username: 'ada' }).catch(() => undefined);
    assert.equal(ada, undefined, 'and the preview writes nothing anyway');
  } finally {
    onRequestReadOnly(() => undefined);
  }
  assert.equal(sent.length, 0);
});

test('a non-security email carries a one-click unsubscribe that leaves that address and category alone; security emails carry none', async () => {
  assert.equal((await plain('ada@example.org', 'family')).result, 'sent');
  const m = sent[0]!;
  assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const one = new URL(/^<(.+)>$/.exec(m.headers['List-Unsubscribe']!)![1]!);
  assert.equal(one.pathname, '/api/unsubscribe');
  const [r, c, t] = ['r', 'c', 't'].map((k) => one.searchParams.get(k)!);
  // Someone else's address with this proof, or another category, is refused.
  const ben = await send.recipientHash('ben@example.org');
  assert.equal(await send.unsubscribe(ben, c, t), false);
  assert.equal(await send.unsubscribe(r, 'operator', t), false);
  assert.equal(await send.unsubscribe(r, 'security', t), false, 'security emails cannot be left');
  assert.equal(await send.unsubscribe(r, c, `${t.slice(0, -1)}x`), false);
  assert.equal(await send.unsubscribe(r, c, t), true);
  assert.equal((await plain('ada@example.org', 'family')).result, 'unsubscribed');
  assert.equal((await plain('ada@example.org', 'operator')).result, 'sent', 'another category still comes');
  sent = [];
  await plain('ada@example.org', 'security');
  assert.equal(sent[0]!.headers['List-Unsubscribe'], undefined);
});

// ---------- verifying an address ----------

test('a confirmation link works once, before it runs out, and only then changes the account’s address', async () => {
  const ada = await account('Ada Example', { email: 'old@example.org' });
  await verify.startVerification(req(), ada, 'Ada.New@Example.org', async () => {});
  assert.equal((await store.userById(ada.id))!.email, 'old@example.org', 'nothing changes before the link is opened');
  assert.equal(sent[0]!.to, 'ada.new@example.org');
  const token = linkIn(sent[0]!, '/verify-email/')!;
  assert.deepEqual(await verify.verificationInfo(token, ada.id), { ok: true, email: 'ada.new@example.org', who: 'mine' });
  await verify.redeemVerification(token, ada.id);
  const after = (await store.userById(ada.id))!;
  assert.equal(after.email, 'ada.new@example.org');
  assert.equal(after.email_verified, 1);
  await assert.rejects(verify.redeemVerification(token, ada.id), /email\.verify_gone/, 'single use');

  // Expired.
  await verify.startVerification(req(), after, 'third@example.org', async () => {});
  const late = linkIn(sent.at(-1)!, '/verify-email/')!;
  await store.accounts().run("UPDATE email_token SET expires = 1 WHERE purpose = 'verify' AND used_at IS NULL");
  await assert.rejects(verify.redeemVerification(late, ada.id), /email\.verify_gone/);
});

test('setting or changing an address needs a fresh proof; an address another account has cannot be taken', async () => {
  const ada = await account('Ada Example', { email: 'ada@example.org', verified: true });
  const needed = async () => { throw new Error('proof needed'); };
  await assert.rejects(verify.startVerification(req(), ada, 'other@example.org', needed), /proof needed/);
  const eve = await account('Eve Example');
  await assert.rejects(verify.startVerification(req(), eve, 'eve@example.org', needed), /proof needed/, 'setting the first address needs one too');
  assert.equal(sent.length, 0);
  await account('Ben Example', { email: 'ben@example.org', verified: true });
  await verify.startVerification(req(), ada, 'ben@example.org', async () => {});
  await assert.rejects(verify.redeemVerification(linkIn(sent.at(-1)!, '/verify-email/'), ada.id), /email\.err\.taken/);
  assert.equal((await store.userById(ada.id))!.email, 'ada@example.org');
});

test('a sign-up code: five tries, then gone; the proof proves that address once', async () => {
  const { ticket } = await verify.sendSignupCode(req(), 'new@example.org', 'en', async () => false);
  const code = /\b(\d{6})\b/.exec(sent[0]!.text)![1]!;
  assert.ok(!sent[0]!.text.includes('Ada'), 'nothing typed into the form but the address');
  for (let i = 0; i < 4; i++) await assert.rejects(verify.checkSignupCode(ticket, code === '000000' ? '111111' : '000000'), /email\.err\.code/);
  const { proof, email } = await verify.checkSignupCode(ticket, code);
  assert.equal(email, 'new@example.org');
  await assert.rejects(verify.checkSignupCode(ticket, code), /email\.err\.code/, 'a ticket gives one proof');
  assert.equal(await verify.signupProof('other@example.org', proof), undefined, 'a proof proves its own address only');
  const p = await verify.signupProof('new@example.org', proof);
  assert.ok(p);
  await store.accounts().batch(verify.spendProof(p.id, Date.now()));
  await assert.rejects(store.accounts().batch(verify.spendProof(p.id, Date.now() + 1)), 'spent once');
  assert.equal(await verify.signupProof('new@example.org', proof), undefined);

  const second = await verify.sendSignupCode(req(), 'two@example.org', 'en', async () => false);
  const right = /\b(\d{6})\b/.exec(sent.at(-1)!.text)![1]!;
  const wrong = right === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) await assert.rejects(verify.checkSignupCode(second.ticket, wrong));
  await assert.rejects(verify.checkSignupCode(second.ticket, right), /email\.err\.code/, 'after five wrong codes the right one is refused');
  await assert.rejects(verify.sendSignupCode(req(), 'three@example.org', 'en', async () => true), /email\.err\.throttled/, 'the network’s count');
});

// ---------- a forgotten password ----------

test('a reset by email: the same answer for every address, at once; a link only to a verified address of an account with a password', async () => {
  await account('Ada Example', { email: 'ada@example.org', verified: true, username: 'ada' });
  await account('Ben Example', { email: 'ben@example.org', verified: false, username: 'ben' });
  await account('Cy Example', { email: 'cy@example.org', verified: true });
  // The provider takes its time: the answer must not wait for it.
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  send.setMailerForTests({ mailer: { send: async (m) => { await gate; sent.push(m); } } });
  const answers: { ok: true }[] = [];
  for (const email of ['ada@example.org', 'ben@example.org', 'cy@example.org', 'nobody@example.org']) {
    const started = performance.now();
    answers.push(await requestPasswordReset(req(), email, ip));
    assert.ok(performance.now() - started < 1000, 'answered without waiting for the provider');
  }
  assert.ok(answers.every((a) => JSON.stringify(a) === JSON.stringify(answers[0])), 'one answer for all');
  release();
  await send.settleSends();
  send.setMailerForTests(capture);
  assert.deepEqual(sent.map((m) => m.to), ['ada@example.org'], 'only the verified address of an account with a password');
  const rows = await store.accounts().all<{ via: string; created_by: string | null }>('SELECT via, created_by FROM password_reset');
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ via: 'email', created_by: null }]);
});

test('a reset link by email works once, for an hour, ends every session and leaves the notice; two-step codes still apply', async () => {
  const ada = await account('Ada Example', { email: 'ada@example.org', verified: true, username: 'ada' });
  const other = (await store.createSession(ada.id, 'k-ada', false, 'passkey')).token;
  await requestPasswordReset(req(), 'ada@example.org', ip);
  await send.settleSends();
  const token = linkIn(sent[0]!, '/reset/')!;
  await pw.redeemResetLink(req(`${SITE}/api/auth/password-reset`), { token, password: 'a new evening light' }, { ip });
  assert.equal(await store.sessionByToken(other), undefined, 'every other session ended');
  await assert.rejects(pw.redeemResetLink(req(), { token, password: 'another evening light' }, { ip }), /pw\.err\.reset_gone/, 'single use');
  const notice = await pw.resetNoticeOf(ada.id, 'passkey');
  assert.equal(notice?.via, 'email');
  await send.settleSends();
  assert.match(sent.at(-1)!.text, /was reset on .* with a link sent to this address/, 'and a security email');
  // An hour later the next link is gone.
  await requestPasswordReset(req(), 'ada@example.org', '198.51.100.4');
  await send.settleSends();
  const late = linkIn(sent.filter((m) => m.subject === 'Reset your password').at(-1)!, '/reset/')!;
  await store.accounts().run('UPDATE password_reset SET expires = ? WHERE used_at IS NULL', Date.now() - 1);
  await assert.rejects(pw.redeemResetLink(req(), { token: late, password: 'a third evening light' }, { ip }), /pw\.err\.reset_gone/);
  // With two-step codes on, the reset page asks for a code too.
  const { beginTotp, totpOn } = await import('../auth/totp.server.ts');
  await beginTotp(ada.id);
  await store.accounts().run('UPDATE totp SET confirmed_at = ? WHERE user = ?', Date.now(), ada.id);
  assert.equal(await totpOn(ada.id), true);
  await requestPasswordReset(req(), 'ada@example.org', '198.51.100.5');
  await send.settleSends();
  assert.match(sent.at(-1)!.text, /two-step codes stay on/);
  const withCode = linkIn(sent.at(-1)!, '/reset/')!;
  assert.equal((await pw.resetLinkInfo(withCode) as { needsCode: boolean }).needsCode, true);
  await assert.rejects(pw.redeemResetLink(req(), { token: withCode, password: 'a fourth evening light' }, { ip }), /pw\.err\.code/);
});

test('reset requests are throttled the same for an address with an account and one without', async () => {
  await account('Ada Example', { email: 'ada@example.org', verified: true, username: 'ada' });
  for (const email of ['ada@example.org', 'nobody@example.org']) {
    for (let i = 0; i < 5; i++) await requestPasswordReset(req(), email, '192.0.2.1');
    await assert.rejects(requestPasswordReset(req(), email, '192.0.2.1'), /pw\.err\.throttled/);
  }
  await send.settleSends();
});

// ---------- notices ----------

test('security notices go to verified addresses only; an invitation’s typed address is never verified', async () => {
  const ada = await account('Ada Example', { email: 'ada@example.org', verified: true });
  const ben = await account('Ben Example', { email: 'ben@example.org', verified: false });
  notify.securityNotice(ada.id, 'totp_off');
  notify.securityNotice(ben.id, 'totp_off');
  await send.settleSends();
  assert.deepEqual(sent.map((m) => m.to), ['ada@example.org'], 'no email to an unverified address but the confirmation itself');
  assert.match(sent[0]!.text, /Two-step codes were turned off/);
  assert.match(sent[0]!.text, /cannot be turned off/);

  const { invite, token } = await store.createInvite({ tree: 'testfield', role: 'viewer', email: 'cy@example.org', createdBy: ada.id });
  sent = [];
  await assert.rejects(notify.emailInvitation(req(), invite, 'not-the-token', 'Ada <b>Example</b>', 'Testfield', 'en'), /email\.err\.invite/);
  assert.equal(await notify.emailInvitation(req(), invite, token, 'Ada <b>Example</b>', 'Testfield', 'en'), 'sent');
  assert.equal(sent[0]!.to, 'cy@example.org');
  assert.ok(sent[0]!.html.includes('Ada &lt;b&gt;Example&lt;/b&gt;'), 'the steward’s name is escaped');
  assert.equal(linkIn(sent[0]!, '/invite/'), token);
  assert.equal(await store.accounts().get("SELECT 1 FROM user WHERE email = 'cy@example.org'"), undefined, 'an invitation makes no account and verifies nothing');
});

test('operators hear of a new request at most every ten minutes; a receipt carries nothing the requester wrote', async () => {
  const op = await account('Olu Operator', { email: 'olu@example.org', verified: true });
  await store.accounts().run('UPDATE user SET operator = 1 WHERE id = ?', op.id);
  notify.emailOperators('data');
  await send.settleSends();
  notify.emailOperators('family');
  await send.settleSends();
  assert.equal(sent.filter((m) => m.to === 'olu@example.org').length, 1);
  notify.emailDataReceipt('someone@example.org', Date.UTC(2026, 0, 31), Date.UTC(2026, 1, 28, 23, 59), 'de');
  await send.settleSends();
  const receipt = sent.at(-1)!;
  assert.equal(receipt.to, 'someone@example.org');
  assert.match(receipt.text, /28\. Februar 2026/, 'in the requester’s language, with the deadline');
  assert.ok(receipt.headers['List-Unsubscribe']);
});

// ---------- round eight: the origin, who sends, the reserve, the account a link is for ----------

test('without KINDRED_ORIGIN no link is built from the request’s Host: email is off, and the Email tab refuses to turn it on', async () => {
  await account('Ada Example', { email: 'ada@example.org', verified: true, username: 'ada' });
  delete process.env.KINDRED_ORIGIN;
  try {
    const poisoned = new Request('https://evil.example/api/x');
    assert.equal(send.mailOrigin(poisoned), undefined, 'a Host header names no origin');
    assert.equal(send.mailOrigin(), undefined, 'nor does a job');
    assert.equal(send.mailOrigin(new Request('http://localhost:4653/api/x')), 'http://localhost:4653', 'a local server (tests, development) may');
    // In production a Host of localhost is believed only from a loopback peer that no proxy forwarded.
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const from = (peer: string | undefined, headers: Record<string, string> = {}) =>
        Object.assign(new Request('http://localhost:4653/api/x', { headers }), peer === undefined ? {} : { runtime: { node: { req: { socket: { remoteAddress: peer } } } } });
      assert.equal(send.mailOrigin(from(undefined)), undefined, 'no socket to ask');
      assert.equal(send.mailOrigin(from('203.0.113.5')), undefined, 'a remote peer that set Host: localhost');
      assert.equal(send.mailOrigin(from('127.0.0.1', { 'x-forwarded-for': '203.0.113.5' })), undefined, 'a proxy on this machine forwarding someone else');
      assert.equal(send.mailOrigin(from('127.0.0.1')), 'http://localhost:4653');
      assert.equal(send.mailOrigin(from('::ffff:127.0.0.1')), 'http://localhost:4653');
      assert.equal(send.mailOrigin(from('::1')), 'http://localhost:4653');
    } finally {
      if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
    }
    assert.equal(await send.emailOn(poisoned), false);
    assert.equal((await send.sendMail({ to: 'ada@example.org', locale: 'en', category: 'security', request: poisoned, body: (t) => ({ subject: 'x', paragraphs: [t('email.mail.test_body')] }) })).result, 'off');
    await assert.rejects(requestPasswordReset(poisoned, 'ada@example.org', ip), /email\.err\.off/, 'no reset link to a poisoned origin');
    await assert.rejects(verify.sendSignupCode(poisoned, 'new@example.org', 'en', async () => false), /email\.err\.off/);
    await send.settleSends();
    assert.equal(sent.length, 0);
    const input = {
      provider: 'resend', fromName: '', fromAddress: 'kindred@mail.example.org', replyTo: '', mailgunDomain: '', mailgunRegion: 'eu',
      smtpHost: '', smtpPort: 587, smtpSecurity: 'starttls', smtpUser: '', perHour: 300, secret: 'k',
    } as const;
    await assert.rejects(settings.mailSettingsWrites(input, 'op'), /email\.err\.origin/);
    assert.ok(await settings.mailSettingsWrites({ ...input, provider: 'off' }, 'op'), 'turning it off is always allowed');
    assert.equal((await settings.mailSettingsView({})).origin, null, 'the tab says why');
  } finally {
    process.env.KINDRED_ORIGIN = SITE;
  }
  assert.equal((await settings.mailSettingsView({})).origin, SITE);
});

test('one account and one network send a few confirmation links and invitations a day', async () => {
  const L = send.SENDER_LIMITS;
  const from = (user: string, network: string, category: 'verify' | 'invitation', i: number) =>
    send.sendMail({ to: `${user}-${i}@example.org`, locale: 'en', category, from: { user, network }, body: (t) => ({ subject: 'x', paragraphs: [t('email.mail.test_body')] }) });
  for (let i = 0; i < L.verify.account; i++) assert.equal((await from('u1', '192.0.2.1', 'verify', i)).result, 'sent');
  assert.equal((await from('u1', '192.0.2.2', 'verify', 99)).result, 'throttled', 'the account’s links for today are used up, from any network');
  assert.equal((await from('u1', '192.0.2.2', 'invitation', 0)).result, 'sent', 'invitations count apart');
  for (let i = L.verify.account; i < L.verify.network; i++) assert.equal((await from(`u${i}`, '192.0.2.1', 'verify', i)).result, 'sent');
  assert.equal((await from('u-new', '192.0.2.1', 'verify', 0)).result, 'throttled', 'the network’s links for today are used up, for any account');
  assert.equal((await from('u-new', '192.0.2.3', 'verify', 0)).result, 'sent');
  const rows = await store.accounts().all<{ sender: string | null; network: string | null }>('SELECT sender, network FROM email_send WHERE sender IS NOT NULL');
  assert.ok(rows.length && rows.every((r) => r.sender!.length === 43 && r.network!.length === 43 && !r.network!.includes('192')), 'kept as keyed hashes');

  // Through the account menu: the server function's account and network are counted.
  sent = [];
  const ada = await account('Ada Example');
  for (let i = 0; i < L.verify.account; i++) await verify.startVerification(req(), ada, `ada${i}@example.org`, async () => {}, '198.51.100.7');
  await assert.rejects(verify.startVerification(req(), ada, 'ada-late@example.org', async () => {}, '198.51.100.8'), /email\.err\.throttled/);
  assert.equal(sent.length, L.verify.account);
});

test('part of the server’s hourly emails is kept for password resets and security notices', async () => {
  await store.accounts().run("INSERT INTO instance_setting (key, value, updated_at) VALUES ('mail_per_hour', '10', 0)");
  const reserve = send.reserveOf(10);
  assert.ok(reserve >= 1 && reserve < 10);
  for (let i = 0; i < 10 - reserve; i++) assert.equal((await plain(`p${i}@example.org`, 'family')).result, 'sent');
  assert.equal((await plain('late@example.org', 'invitation')).result, 'throttled', 'other emails stop short of the reserve');
  assert.equal((await plain('r@example.org', 'reset')).result, 'sent', 'a reset link still goes');
  assert.equal((await plain('s@example.org', 'security')).result, 'sent', 'and a security notice');
});

test('names in an email are one short line: an account’s name cannot carry a message', async () => {
  const long = `Ada ${'Buy cheap things at example dot com '.repeat(20)}`;
  const ada = await account(long, { email: 'ada@example.org', verified: true });
  const { invite, token } = await store.createInvite({ tree: 'testfield', role: 'viewer', email: 'cy@example.org', createdBy: ada.id });
  assert.equal(await notify.emailInvitation(req(), invite, token, `${long}\nSecond line`, `The ${'Long '.repeat(60)}Family`, 'en', { user: ada.id, network: ip }), 'sent');
  const m = sent[0]!;
  assert.ok(!m.text.includes('Buy cheap things at example dot com '.repeat(3)), 'the name is cut');
  assert.ok(!m.text.includes('Second line'), 'one line');
  assert.ok(m.subject.length <= 2 * send.MAIL_NAME_MAX + 40, `a short subject (${m.subject.length})`);
  assert.equal(send.mailName('  Ada\r\n  Example  '), 'Ada Example');
  assert.equal(send.mailName('x'.repeat(200)).length, send.MAIL_NAME_MAX);
});

test('a confirmation link is redeemed only by the account it was made for, signed in; the old address hears of the change', async () => {
  const ada = await account('Ada Example', { email: 'old@example.org', verified: true });
  const ben = await account('Ben Example');
  await verify.startVerification(req(), ada, 'new@example.org', async () => {});
  const token = linkIn(sent.at(-1)!, '/verify-email/')!;
  assert.deepEqual(await verify.verificationInfo(token, null), { ok: true, email: 'new@example.org', who: 'signed-out' });
  assert.deepEqual(await verify.verificationInfo(token, ben.id), { ok: true, email: 'new@example.org', who: 'other' });
  assert.deepEqual(await verify.verificationInfo(token, ada.id), { ok: true, email: 'new@example.org', who: 'mine' });
  await assert.rejects(verify.redeemVerification(token, ben.id), /email\.err\.other_account/, 'another account is refused');
  assert.equal((await store.userById(ben.id))!.email, null);
  sent = [];
  await verify.redeemVerification(token, ada.id);
  await send.settleSends();
  const notice = sent.find((m) => m.to === 'old@example.org');
  assert.ok(notice, 'the old verified address is told');
  assert.match(notice.text, /email address of your account was changed/);
  assert.ok(!notice.text.includes('new@example.org'), 'without naming the new one');
});

test('a data request’s receipt goes to one address at most once a day', async () => {
  for (let i = 0; i < 3; i++) notify.emailDataReceipt('someone@example.org', Date.UTC(2026, 0, 31), Date.UTC(2026, 1, 28), 'en');
  await send.settleSends();
  assert.equal(sent.filter((m) => m.to === 'someone@example.org').length, 1);
});

const breachInput = (now: number, notice: string) => ({
  title: 'Stolen disk', awareAt: now - 1000, occurredAt: null, description: '', dataCategories: '', subjects: '', consequences: '', measures: '', risk: 'risk' as const,
  authorityAt: null, authorityRef: '', lateReason: '', subjectsAt: null, notice, noticeUntil: null, closedAt: null, families: ['testfield'],
});

test('a breach notice and the lifecycle’s final notice are notices that cannot be unsubscribed; the stewards’ email reports what it delivered', async () => {
  const ada = await account('Ada Example', { email: 'ada@example.org', verified: true });
  await store.accounts().batch([store.upsertMembership(ada.id, 'testfield', 'steward')]);
  await (await import('../gdpr/breach.server.ts')).saveBreach({ id: ada.id, name: 'Orla' }, breachInput(Date.now(), 'Our backup disk was stolen.'));
  await send.settleSends();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.headers['List-Unsubscribe'], undefined, 'no unsubscribe on a breach notice');
  const r = await send.recipientHash('ada@example.org');
  await store.accounts().run("INSERT INTO email_optout (recipient, category, at) VALUES (?, 'family', 0)", r);
  const delivered = await notify.mailStewards('testfield', (t) => ({ subject: 'Final', paragraphs: [t('email.mail.test_body')] }), { category: 'notice' });
  assert.equal(delivered, 1, 'an unsubscribe from family notices does not stop a final notice');
  assert.equal(await notify.mailStewards('testfield', (t) => ({ subject: 'News', paragraphs: [t('email.mail.test_body')] }), { category: 'family' }), 0);
});

test('a breach notice records how many stewards it reached, and the daily job retries those it did not reach', async () => {
  const breach = await import('../gdpr/breach.server.ts');
  const ada = await account('Ada Example', { email: 'ada@example.org', verified: true });
  const bo = await account('Bo Example', { email: 'bo@example.org', verified: true });
  await store.accounts().batch([store.upsertMembership(ada.id, 'testfield', 'steward'), store.upsertMembership(bo.id, 'testfield', 'steward')]);
  // Bo has had all their email for this hour already: the notice is throttled for them, not lost.
  const r = await send.recipientHash('bo@example.org');
  const now = Date.now();
  for (let i = 0; i < send.RECIPIENT_PER_HOUR; i++) await store.accounts().run("INSERT INTO email_send (at, recipient, category, status) VALUES (?, ?, 'security', 'sent')", now - 1000, r);
  const OP = { id: ada.id, name: 'Orla' };
  const input = breachInput(now, 'Our backup disk was stolen.');
  const id = await breach.saveBreach(OP, input, undefined, now);
  await send.settleSends();
  assert.deepEqual(sent.map((m) => m.to), ['ada@example.org']);
  assert.deepEqual((await breach.breaches(now)).find((x) => x.id === id)!.noticeReach, { reached: 1, total: 2 });
  // The next day the job sends the one left, and only that one.
  const later = await notify.deliverBreachNotices(now + 2 * 3_600_000);
  assert.deepEqual(later, { sent: 1, left: 0 });
  assert.deepEqual(sent.map((m) => m.to), ['ada@example.org', 'bo@example.org']);
  assert.deepEqual((await breach.breaches(now)).find((x) => x.id === id)!.noticeReach, { reached: 2, total: 2 });
  assert.deepEqual(await notify.deliverBreachNotices(now + 3 * 3_600_000), { sent: 0, left: 0 });
  // A changed notice starts over: every steward gets the new text.
  await breach.saveBreach(OP, { ...input, notice: 'The disk was found again.' }, id, now + 4 * 3_600_000);
  await send.settleSends();
  assert.equal(sent.length, 4);
  assert.deepEqual((await breach.breaches(now)).find((x) => x.id === id)!.noticeReach, { reached: 2, total: 2 });
});
