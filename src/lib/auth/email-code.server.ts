// "Email me a sign-in code", the fourth way into a Kindred account (./methods.server.ts turns it on, only while the server sends
// email). Schema in accounts migration 0058 (`email_signin`, `signin_step.method`); docs/self-host.md, "Ways in", says what a
// self-hoster decides, docs/roles-and-privacy.md, "Sign-in and sessions", what it means for the people who use it.
//
// Asking (`requestSignInCode`): someone types an address on the sign-in page. The try is counted against that address from this
// network and against the network (./attempts.server.ts) before anything else; then Kindred records a row for this browser and
// answers at once, the same for every address. Only after the answer, in the background, does it look for an account whose
// CONFIRMED address it is (`email_verified`, never an address a steward typed into an invitation, never an unconfirmed one) and
// mail that address a six-digit code, as a security email (from the reserve of the server's hourly emails, no unsubscribe).
// The address typed is never stored, and nothing in the answer, its time or the row tells whether an account has it.
//
// The binding: the row belongs to the browser that asked. Asking sets a cookie (`__Host-kindred_mailcode` over HTTPS) holding a
// random value only that browser has, HttpOnly and SameSite=Strict, and the row keeps only its hash. A code is checked only
// against the rows of the browser that sends it, so a code works in the browser that asked for it and nowhere else. That
// protects a code the member asked for themselves: whoever gets them to read it out, or to type it into another site, cannot
// use it elsewhere. It does not stop the phone scam, where the caller asks from their own browser and talks the member into
// reading out the code that arrives (that code is bound to the caller's browser), nor a site that relays the whole sign-in as
// it happens. The defence against both is the email: never tell the code to anyone, nobody from this server asks for it, and
// this server's address, so its reader can tell. Its link only opens the sign-in page here (it carries no code).
//
// A code lives only while its email does, for the address it went to: issuing it counts the account's codes this hour (at
// most CODES_PER_HOUR, however many networks ask) and checks the address is still the account's confirmed one, in one
// statement; a code whose email was not sent is cleared at once; and its hash includes that address, checked again when it is
// spent, so a confirmed change of address (../email/verify.server.ts) voids it and the two-step ticket it opened.
//
// Checking (`checkSignInCode`): every try is counted on each of this browser's live rows before any code is compared (five
// tries a code), and against the network; a right code is spent in a statement whose count is the check (single use), and
// ends this browser's other rows. Ten minutes, then a code is gone. Then, as for a password: an account with two-step codes
// gets a five-minute ticket for one (./password.server.ts, `stepTicket`), and every sign-in is a new session with `method`
// 'email-code'. That session is a fresh proof for a few minutes (./proof.server.ts), so someone who lost every device can add
// a new passkey at once; never for an operator, whose console a mailbox alone must not open. Each sign-in this way sends the
// address a security notice. Nothing here works on the guest host, in a demo or in a preview.
import { attemptKeys, begin, beginNetwork, refundNetwork } from './attempts.server.ts';
import { AuthError } from './errors.ts';
import { authMethod } from './method.server.ts';
import { requireMethod } from './methods.server.ts';
import { onGuestHost } from './origin.ts';
import { readCookie, siteOrigin } from './session.server.ts';
import { accounts, now, q, userByEmail, userById, type UserRow } from './store.server.ts';
import { hashToken, randomToken, safeEqual } from './tokens.server.ts';
import { isDemo } from '../demo.ts';
import { refuseReadOnly } from '../read-only.ts';
import type { Locale } from '../i18n/languages.ts';
import { isLocale } from '../i18n/types.ts';

/** How long a code holds, and how many tries it has. */
export const SIGNIN_CODE_MS = 10 * 60_000;
export const SIGNIN_CODE_TRIES = 5;
/** Rows are kept a day after they run out, then deleted as new ones come. */
const KEEP_MS = 24 * 60 * 60_000;

const invalid = (key: string) => new AuthError('invalid', key);
const throttled = () => new AuthError('throttled', 'pw.err.throttled');
const BROWSER = /^[A-Za-z0-9_-]{43}$/;
const secure = (request: Request) => siteOrigin(request).protocol === 'https:';
const cookieName = (request: Request) => (secure(request) ? '__Host-kindred_mailcode' : 'kindred_mailcode');

/** The Set-Cookie value that gives this browser its value for SIGNIN_CODE_MS (or clears it, with ''). */
function browserCookie(request: Request, value: string): string {
  return [`${cookieName(request)}=${value}`, 'Path=/', `Max-Age=${value ? SIGNIN_CODE_MS / 1000 : 0}`, 'HttpOnly', 'SameSite=Strict', ...(secure(request) ? ['Secure'] : [])].join('; ');
}
const browserOf = (request: Request) => {
  const v = readCookie(request, cookieName(request));
  return v && BROWSER.test(v) ? v : undefined;
};

/** Every step starts here: Kindred's own sign-in, codes by email on, the site's own host, a request that may write, email on. */
async function codeAllowed(request: Request): Promise<void> {
  if (isDemo() || authMethod() !== 'kindred' || onGuestHost(request)) throw invalid('email.err.code_off');
  refuseReadOnly();
  await requireMethod('email-code');
  if (!(await (await import('../email/send.server.ts')).emailOn(request))) throw invalid('email.err.code_off');
}

/** A code's hash names the row, the code and the address it was sent to: the same code read with another address is no match. */
const codeSecret = (id: string, code: string, address: string) => hashToken('signin-code', `${id}:${code}:${address}`);
/** Account `?`'s confirmed address is still `?` (lower-cased): what binds a code to the address it went to. */
const STILL_CONFIRMED = 'SELECT 1 FROM user WHERE user.id = ? AND user.email_verified = 1 AND user.retiring IS NULL AND lower(user.email) = ?';
const HOUR = 60 * 60_000;

/**
 * Asks for a code. Resolves with the cookie for this browser and nothing the caller could tell apart: the same for an unknown
 * address, an unconfirmed one and a real one. The email is sent after the answer (tests wait with settleSends).
 */
export async function requestSignInCode(request: Request, typed: unknown, ip: string): Promise<{ cookie: string }> {
  await codeAllowed(request);
  const email = typeof typed === 'string' ? typed.trim().toLowerCase() : '';
  const { isMailAddress } = await import('../email/shared.ts');
  if (!isMailAddress(email)) throw invalid('email.err.address');
  // Counted like a sign-in try of the address, from this network: over the limit is the same refusal for every address.
  if ((await begin(await attemptKeys(`signin-code:${email}`, ip))).locked) throw throttled();
  // One value per browser while it waits, so a second code asked for in the same browser does not undo the first.
  const browser = browserOf(request) ?? randomToken(32);
  const id = crypto.randomUUID();
  const t = now();
  await accounts().batch([
    q('DELETE FROM email_signin WHERE expires < ?', t - KEEP_MS),
    q('INSERT INTO email_signin (id, browser, created, expires) VALUES (?, ?, ?, ?)', id, await hashToken('signin-browser', browser), t, t + SIGNIN_CODE_MS),
  ]);
  const { sendLater } = await import('../email/send.server.ts');
  sendLater(() => sendCode(id, email, request));
  return { cookie: browserCookie(request, browser) };
}

/** The work behind the answer: a code to an account's confirmed address, and to no other. */
async function sendCode(id: string, email: string, request: Request): Promise<void> {
  const user = await userByEmail(email);
  if (!user || user.email_verified !== 1 || user.retiring || user.email?.toLowerCase() !== email) return;
  const [{ sixDigits }, { sendMail, mailName, CODES_PER_HOUR }] = await Promise.all([import('../email/verify.server.ts'), import('../email/send.server.ts')]);
  const code = sixDigits();
  // Issued in one statement that is also its two checks: the address is still the account's confirmed one, and the account has
  // had fewer than CODES_PER_HOUR codes this hour, however many networks and browsers ask at once.
  const set = await accounts().run(
    `UPDATE email_signin SET user = ?, secret = ? WHERE id = ? AND user IS NULL AND used_at IS NULL
       AND (SELECT count(*) FROM email_signin AS issued WHERE issued.user = ? AND issued.created > ?) < ? AND EXISTS (${STILL_CONFIRMED})`,
    user.id, await codeSecret(id, code, email), id, user.id, now() - HOUR, CODES_PER_HOUR, user.id, email);
  if (set.changes !== 1) return;
  const locale: Locale = isLocale(user.locale) ? user.locale : 'en';
  const { result } = await sendMail({
    to: email, locale, category: 'signin', request,
    body: (t, { server, origin }) => ({
      subject: t('email.mail.signin_subject', { server }), greeting: t('email.mail.greeting', { name: mailName(user.name) }),
      paragraphs: [t('email.mail.signin_body', { address: new URL(origin).host }), t('email.mail.signin_device'), t('email.mail.signin_ignore')],
      code,
      action: { label: t('email.mail.signin_action'), url: `${origin}/signin?code=1` },
    }),
  });
  // A code exists only while its email does: one the provider refused, or the limits held back, is gone at once, so the codes
  // that could sign in never outnumber the emails sent. (It is not counted against the account's hour either.)
  if (result !== 'sent') await accounts().run('UPDATE email_signin SET user = NULL, secret = NULL WHERE id = ?', id);
}

/**
 * Checks a code from this browser. Every try is counted on each of the browser's live rows before any code is compared, and
 * against the network; a right code works once. Returns the account; the caller asks for a two-step code or starts the session.
 */
export async function checkSignInCode(request: Request, code: unknown, ip: string): Promise<{ user: UserRow; address: string; cookie: string }> {
  await codeAllowed(request);
  const wrong = invalid('email.err.code');
  const browser = browserOf(request);
  if (!browser) throw wrong;
  if (await beginNetwork(ip)) throw throttled();
  const typed = typeof code === 'string' ? code.replace(/\s+/g, '').slice(0, 20) : '';
  const t = now();
  // Each row comes back with its account's confirmed address as it is now: a code is hashed with the address it was sent to,
  // so after a change of address (or with none confirmed) the right code no longer matches.
  const rows = await accounts().all<{ id: string; user: string | null; secret: string | null; address: string | null }>(
    `UPDATE email_signin SET tries = tries + 1 WHERE browser = ? AND expires > ? AND used_at IS NULL AND tries < ?
       RETURNING id, user, secret, (SELECT lower(user.email) FROM user WHERE user.id = email_signin.user AND user.email_verified = 1 AND user.retiring IS NULL) AS address`,
    await hashToken('signin-browser', browser), t, SIGNIN_CODE_TRIES);
  // The same work for every row, whether or not a code was sent for it.
  let match: { id: string; user: string; address: string } | undefined;
  for (const r of rows) {
    const ok = await safeEqual(await codeSecret(r.id, /^\d{6}$/.test(typed) ? typed : 'x', r.address ?? '-'), r.secret ?? '-');
    if (ok && r.user && r.address && !match) match = { id: r.id, user: r.user, address: r.address };
  }
  if (!match) throw wrong;
  // Spending it is the check, twice over: two requests with one code cannot both sign in, and the address the code went to must
  // still be the account's confirmed one at this moment.
  const spent = await accounts().run(`UPDATE email_signin SET used_at = ? WHERE id = ? AND used_at IS NULL AND user = ? AND EXISTS (${STILL_CONFIRMED})`, t, match.id, match.user, match.user, match.address);
  if (spent.changes !== 1) throw wrong;
  // The browser's other codes die but their rows stay: they still count toward the account's codes this hour.
  await accounts().run('UPDATE email_signin SET secret = NULL, used_at = coalesce(used_at, ?) WHERE browser = ? AND id <> ?', t, await hashToken('signin-browser', browser), match.id);
  await refundNetwork(ip);
  const user = await userById(match.user);
  if (!user || user.retiring || user.email_verified !== 1 || user.email?.toLowerCase() !== match.address) throw wrong;
  return { user, address: match.address, cookie: browserCookie(request, '') };
}

/** What a right code leads to: a session (the Set-Cookie values to send), or a ticket for the account's two-step code. */
export type CodeSignIn = { kind: 'session'; cookies: string[] } | { kind: 'second'; ticket: string; cookies: string[] };

/** A sign-in with a code from this browser. An account with two-step codes gets a ticket for one first. */
export async function signInWithCode(request: Request, code: unknown, ip: string): Promise<CodeSignIn> {
  const { user, address, cookie } = await checkSignInCode(request, code, ip);
  if (await (await import('./totp.server.ts')).totpOn(user.id)) {
    // The ticket is bound to the address too: issued only while it is still confirmed, and ended by a change (verify.server.ts).
    return { kind: 'second', ticket: await (await import('./password.server.ts')).stepTicket(user.id, 'email-code', address), cookies: [cookie] };
  }
  return { kind: 'session', cookies: [cookie, await codeSession(request, user)] };
}

/** The two-step code (or a recovery code) after a right code by email (./password.server.ts, secondStep); then the session. */
export async function signInCodeSecondStep(request: Request, input: { ticket?: unknown; code?: unknown; recovery?: unknown }, ip: string): Promise<CodeSignIn> {
  await codeAllowed(request);
  const { user } = await (await import('./password.server.ts')).secondStep(input, { ip }, 'email-code');
  const row = await userById(user);
  if (!row) throw invalid('pw.err.step_expired');
  return { kind: 'session', cookies: [await codeSession(request, row)] };
}

/**
 * A sign-in by a code that went all the way: the same checks as any other, a brand-new session with `method` 'email-code', and
 * the security notice to the address. The session is a fresh proof for a few minutes, unless the account is an operator's.
 */
async function codeSession(request: Request, user: UserRow): Promise<string> {
  const allowed = await (await import('./join.server.ts')).signInAllowed(user.id);
  if (allowed !== 'ok') throw invalid(allowed === 'pending' ? 'join.err_signin_pending' : 'join.err_signin_expired');
  const cookie = await (await import('./session.server.ts')).startSession(request, user.id, null, user.operator !== 1, 'email-code');
  (await import('../email/notify.server.ts')).securityNotice(user.id, 'code_signin', request);
  return cookie;
}
