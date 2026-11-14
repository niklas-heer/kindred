// Username and password, the second way into a Kindred account (./methods.server.ts turns it on). Schema in accounts
// migrations 0040 (`user.username`, `password`, `totp`, `recovery_code`, `auth_attempt`) and 0041 (`signin_step`,
// `password_reset`); docs/self-host.md, "Choosing how people sign in", says what a self-hoster decides.
//
// The hash: PBKDF2-HMAC-SHA-256, 600,000 iterations in all, run as six chained derivations of 100,000 (the most one WebCrypto
// call may do on Workers), over a 16-byte random salt, of the password after an HMAC pepper keyed from KINDRED_SECRET (so a
// copied database alone cannot be guessed against). The stored text names its scheme (`pbkdf2-sha256-6x100k-v1`); a sign-in
// with an older scheme stores the password again in the current one. Comparisons take the same time whatever matches. An
// unknown username is checked against a dummy hash, so it costs as long as a real one and gets the same answer.
//
// Guessing is limited in the database (./attempts.server.ts): every try is counted before anything is checked, and only a try
// within the limits is checked at all (`admit`). A right password whose account has
// two-step codes is not a sign-in yet: it gets a five-minute ticket (`signin_step`) for the code, or a recovery code. Every
// sign-in is a new session (session.server.ts, startSession). Nothing here works on the guest host, in a demo or in a preview.
import { attemptKeys, begin, beginNetwork, refund, refundNetwork, succeeded, USER_SLOW_MS, type AttemptKeys } from './attempts.server.ts';
import { isCommonPassword } from './common-passwords.ts';
import { AuthError } from './errors.ts';
import { authMethod } from './method.server.ts';
import { requireMethod } from './methods.server.ts';
import { normalizeUsername, PASSWORD_MAX, PASSWORD_MIN, passwordLength, USERNAME } from './methods.ts';
import { onGuestHost } from './origin.ts';
import { serverHmac } from './seal.server.ts';
import { accounts, guard, isGuardError, now, q, userById, userByUsername, type UserRow } from './store.server.ts';
import { isUniqueError, type Query } from '../store/index.ts';
import { hashToken, randomToken, safeEqual } from './tokens.server.ts';
import { removeTotp, totpOn, consumeRecoveryCode, consumeTotp } from './totp.server.ts';
import { refuseReadOnly } from '../read-only.ts';

export const PASSWORD_SCHEME = 'pbkdf2-sha256-6x100k-v1';
const ROUNDS = 6;
const ROUND_ITERATIONS = 100_000;
const SIGNIN_STEP_MS = 5 * 60_000;
const SIGNIN_STEP_TRIES = 5;
export const RESET_MS = 60 * 60_000;

const enc = new TextEncoder();
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const invalid = (key: string) => new AuthError('invalid', key);

// ---------- hashing ----------

async function derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
  let material = await serverHmac('password-pepper', enc.encode(password.normalize('NFC')));
  for (let i = 0; i < ROUNDS; i++) {
    const key = await crypto.subtle.importKey('raw', material as BufferSource, 'PBKDF2', false, ['deriveBits']);
    material = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ROUND_ITERATIONS }, key, 256));
  }
  return material;
}

/** The stored form: `pbkdf2-sha256-6x100k-v1$<salt>$<key>`. */
export async function hashAccountPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${PASSWORD_SCHEME}$${b64u(salt)}$${b64u(await derive(password, salt))}`;
}

/** Whether `password` is the one behind `stored`. A scheme Kindred does not know, or a malformed value, never matches. */
export async function verifyAccountPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== PASSWORD_SCHEME || !salt || !key) return false;
  let saltBytes: Uint8Array;
  try { saltBytes = fromB64u(salt); } catch { return false; }
  return safeEqual(b64u(await derive(password, saltBytes)), key);
}

/** Whether a stored hash is of an older scheme, to be stored again at the next sign-in. */
export const needsRehash = (stored: string) => !stored.startsWith(`${PASSWORD_SCHEME}$`);

// What unknown usernames are checked against: a stored form of random bytes, so checking it is exactly one derivation, like a
// real account's (no hash is made first), and nothing ever matches it. Made at first use: a Worker may not draw random
// values while its modules load.
let dummy: string | undefined;
async function dummyVerify(password: string): Promise<false> {
  dummy ??= `${PASSWORD_SCHEME}$${randomToken(16)}$${randomToken(32)}`;
  await verifyAccountPassword(password, dummy);
  return false;
}

// ---------- rules ----------

/** A new password's rules: 12 characters at least (spaces count), 256 at most, not on the common list, not the username. */
export function checkNewPassword(password: unknown, username?: string | null): string {
  if (typeof password !== 'string' || passwordLength(password) < PASSWORD_MIN) throw invalid('pw.err.short');
  if (passwordLength(password) > PASSWORD_MAX) throw invalid('pw.err.long');
  if (isCommonPassword(password)) throw invalid('pw.err.common');
  if (username && password.trim().toLowerCase() === username.toLowerCase()) throw invalid('pw.err.like_username');
  return password;
}

/** A username as stored: normalised, and within the rules. */
export function cleanUsername(typed: unknown): string {
  const u = typeof typed === 'string' ? normalizeUsername(typed) : '';
  if (!USERNAME.test(u)) throw invalid('pw.err.username');
  return u;
}

/** The statements that give `user` this username and password (both replace what it had). */
export async function passwordWrites(user: string, username: string, password: string): Promise<Query[]> {
  return passwordRows(user, username, await hashAccountPassword(password));
}

/** The same, with the password already hashed (a batch that may be built more than once hashes once). */
export function passwordRows(user: string, username: string, hash: string): Query[] {
  return [
    q('UPDATE user SET username = ? WHERE id = ?', username, user),
    q(`INSERT INTO password (user, hash, params, set_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user) DO UPDATE SET hash = excluded.hash, params = excluded.params, set_at = excluded.set_at`, user, hash, PASSWORD_SCHEME, now()),
  ];
}

/** A taken username, as the error the form shows. */
export const usernameTaken = () => invalid('pw.err.username_taken');
/**
 * Refuses a username another account has (the UNIQUE index still decides a race; rethrowTaken names it). "Taken" tells
 * whether an account exists, so with `ip` each such answer costs the network one of its tries (./attempts.server.ts): names
 * cannot be listed by trying them. A free name gives its try back.
 */
export async function requireFreeUsername(username: string, ip?: string): Promise<void> {
  if (ip !== undefined && (await beginNetwork(ip))) throw throttled();
  if (await userByUsername(username)) throw usernameTaken();
  if (ip !== undefined) await refundNetwork(ip);
}
export const rethrowTaken = (e: unknown): never => {
  throw isUniqueError(e) && /username/i.test(String((e as Error).message) + String((e as { cause?: unknown }).cause ?? '')) ? usernameTaken() : e;
};

export const passwordOf = (user: string) => accounts().get<{ hash: string; params: string; set_at: number }>('SELECT hash, params, set_at FROM password WHERE user = ?', user);

// ---------- where a password may be used ----------

/**
 * Every password form starts here: Kindred's own sign-in, passwords turned on, the site's own host (never the guest host, which
 * honours no account), and a request that may write (not a demo, not a preview).
 */
export async function passwordAllowed(request: Request): Promise<void> {
  if (authMethod() !== 'kindred' || onGuestHost(request)) throw invalid('pw.err.method_off');
  refuseReadOnly();
  await requireMethod('password');
}

const wrong = () => invalid('pw.err.wrong');
function throttled() { return new AuthError('throttled', 'pw.err.throttled'); }
export const turnstileNeeded = () => new AuthError('invalid', 'pw.err.turnstile');

export interface Attempt {
  ip: string;
  /** Checks the form's Turnstile answer (true while the server has no keys). */
  turnstile?: (token: string | undefined) => Promise<boolean>;
  /** Whether the server has Turnstile keys: a username tried many times then asks for an answer instead of waiting. */
  turnstileOn?: boolean;
  /** How a slowed try waits (tests replace it). */
  wait?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Counts one try, then decides whether it may be checked: refused when this username from this network (or the network) is
 * over its limit; a Turnstile answer when the server is flooded or the username has had many tries and the form carries
 * one (`token` is undefined for a form that has no Turnstile, null when it has none to send); otherwise a short delay.
 */
async function admit(keys: AttemptKeys, a: Attempt, token: string | undefined | null): Promise<void> {
  const v = await begin(keys);
  if (v.locked) throw throttled();
  const form = token !== undefined && !!a.turnstile;
  if (form && (v.turnstile || (v.slow && a.turnstileOn)) && !(await a.turnstile!(token ?? undefined))) throw turnstileNeeded();
  if (v.slow && !(form && a.turnstileOn)) await (a.wait ?? sleep)(USER_SLOW_MS);
}

/**
 * Checks a username and password. Returns the account when the password is right; throws one answer for a wrong password
 * and an unknown username alike, after the same work. Counted against the username, the network and the server.
 */
async function checkPassword(username: unknown, password: unknown, a: Attempt, turnstileToken: string | undefined | null): Promise<{ user: UserRow; keys: AttemptKeys; rehash: boolean }> {
  const typed = typeof username === 'string' ? username.slice(0, 200) : '';
  const pw = typeof password === 'string' ? password.slice(0, PASSWORD_MAX * 4) : '';
  const keys = await attemptKeys(typed, a.ip);
  await admit(keys, a, turnstileToken);
  const name = normalizeUsername(typed);
  const user = USERNAME.test(name) ? await userByUsername(name) : undefined;
  const stored = user ? await passwordOf(user.id) : undefined;
  const ok = stored ? await verifyAccountPassword(pw, stored.hash) : await dummyVerify(pw);
  if (!ok || !user) throw wrong();
  return { user, keys, rehash: needsRehash(stored!.hash) };
}

export type SignInResult = { kind: 'session'; user: string } | { kind: 'second'; ticket: string };

/** A password sign-in. With two-step codes on, a ticket for the code instead of a session. */
export async function passwordSignIn(request: Request, input: { username?: unknown; password?: unknown; turnstile?: unknown }, a: Attempt): Promise<SignInResult> {
  await passwordAllowed(request);
  const { user, keys, rehash } = await checkPassword(input.username, input.password, a, typeof input.turnstile === 'string' ? input.turnstile : null);
  if (rehash) await accounts().batch((await passwordWrites(user.id, user.username!, input.password as string)).slice(1));
  if (await totpOn(user.id)) {
    // The password was right: its try is given back; the code's tries are counted on their own.
    await refund(keys);
    return { kind: 'second', ticket: await stepTicket(user.id, 'password') };
  }
  await succeeded(keys);
  return { kind: 'session', user: user.id };
}

/** The ways in whose right first step may wait for the account's two-step code (accounts migration 0058, `signin_step.method`). */
export type StepMethod = 'password' | 'email-code';

/** A five-minute ticket for the two-step code, after a right first step of `method`. Never a session by itself. */
export async function stepTicket(user: string, method: StepMethod): Promise<string> {
  const ticket = randomToken(32);
  const t = now();
  await accounts().batch([
    q('DELETE FROM signin_step WHERE expires < ?', t),
    q('INSERT INTO signin_step (hash, user, tries, created, expires, method) VALUES (?, ?, 0, ?, ?, ?)', await hashToken('signin-step', ticket), user, t, t + SIGNIN_STEP_MS, method),
  ]);
  return ticket;
}

/**
 * The second step: a two-step code, or one of the recovery codes, for the account behind a ticket. A wrong code counts against
 * the username like a wrong password, and five wrong codes end the ticket.
 */
export async function passwordSecondStep(request: Request, input: { ticket?: unknown; code?: unknown; recovery?: unknown }, a: Attempt): Promise<{ user: string }> {
  await passwordAllowed(request);
  return secondStep(input, a, 'password');
}

/**
 * The two-step code for a ticket of `method`: a ticket of one way in never finishes another's. The caller checked that the way
 * in may be used. Tries count against the username (a code by email: the account) like a wrong password.
 */
export async function secondStep(input: { ticket?: unknown; code?: unknown; recovery?: unknown }, a: Attempt, method: StepMethod): Promise<{ user: string }> {
  const expired = invalid('pw.err.step_expired');
  if (typeof input.ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.ticket)) throw expired;
  const hash = await hashToken('signin-step', input.ticket);
  // The ticket's try is counted before the code is checked, like the username's: the count the update answers decides.
  const step = await accounts().get<{ user: string; tries: number }>('UPDATE signin_step SET tries = tries + 1 WHERE hash = ? AND expires > ? AND method = ? RETURNING user, tries', hash, now(), method);
  if (step && step.tries > SIGNIN_STEP_TRIES) await accounts().run('DELETE FROM signin_step WHERE hash = ?', hash);
  const user = step && step.tries <= SIGNIN_STEP_TRIES ? await userById(step.user) : undefined;
  if (!step || !user || (method === 'password' && !user.username)) throw expired;
  const keys = await attemptKeys(method === 'password' ? user.username! : `two-step:${user.id}`, a.ip);
  await admit(keys, a, undefined);
  const ok = await secondFactor(user.id, input);
  if (!ok) throw invalid('pw.err.code');
  // The ticket is spent: deleting it is the check, so two requests with one ticket cannot both start a session.
  const spent = await accounts().run('DELETE FROM signin_step WHERE hash = ?', hash);
  if (spent.changes !== 1) throw expired;
  await succeeded(keys);
  return { user: user.id };
}

/**
 * The password (and, when it is on, the two-step code) typed again on a signed-in session: the fresh proof for accounts that
 * have no passkey here (proof.server.ts). Counted like a sign-in.
 */
export async function checkOwnPassword(request: Request, user: UserRow, input: { password?: unknown; code?: unknown; recovery?: unknown }, a: Attempt): Promise<void> {
  await passwordAllowed(request);
  if (!user.username) throw invalid('pw.err.no_password');
  const { keys } = await checkPassword(user.username, input.password, a, undefined);
  if (await totpOn(user.id)) {
    // The code is a try of its own, counted before it is checked.
    await admit(keys, a, undefined);
    if (!(await secondFactor(user.id, input))) throw invalid('pw.err.code');
  }
  await succeeded(keys);
}

/** A two-step code, or a recovery code in its place: used once. */
const secondFactor = async (user: string, input: { code?: unknown; recovery?: unknown }) => typeof input.recovery === 'string' && input.recovery
  ? consumeRecoveryCode(user, input.recovery)
  : typeof input.code === 'string' && consumeTotp(user, input.code);

/** The security email after a change to the ways in (src/lib/email/notify.server.ts): sent later, never in the way. */
const notice = async (user: string, kind: 'password_reset' | 'operator_reset' | 'recovery_reset', request: Request) =>
  (await import('../email/notify.server.ts')).securityNotice(user, kind, request);

// ---------- a forgotten password ----------

/**
 * A forgotten password, reset with one of the account's recovery codes (and its current two-step code, when those are on: a
 * recovery code stands in for a lost password or a lost phone, not both). Counted like a sign-in. Returns the account; every
 * session it had is ended, and the caller starts a new one.
 */
export async function resetWithRecoveryCode(request: Request, input: { username?: unknown; recovery?: unknown; code?: unknown; password?: unknown }, a: Attempt): Promise<{ user: string }> {
  await passwordAllowed(request);
  const typed = typeof input.username === 'string' ? input.username.slice(0, 200) : '';
  const name = normalizeUsername(typed);
  // The new password's rules first: a typo there should not cost a try.
  const password = checkNewPassword(input.password, name);
  const keys = await attemptKeys(typed, a.ip);
  await admit(keys, a, undefined);
  const user = USERNAME.test(name) ? await userByUsername(name) : undefined;
  const codeOk = async (u: UserRow) => !(await totpOn(u.id)) || (typeof input.code === 'string' && (await consumeTotp(u.id, input.code)));
  const ok = !!user && typeof input.recovery === 'string' && (await codeOk(user)) && (await consumeRecoveryCode(user.id, input.recovery));
  if (!ok || !user) throw invalid('pw.err.recovery');
  await accounts().batch([...(await passwordWrites(user.id, user.username!, password)), q('DELETE FROM session WHERE user = ?', user.id)]);
  await succeeded(keys);
  await notice(user.id, 'recovery_reset', request);
  return { user: user.id };
}

// ---------- an operator's reset link ----------

export interface ResetLinkRow { hash: string; user: string; created: number; created_by: string | null; expires: number; used_at: number | null; clear_totp: number; via?: 'operator' | 'email' }

/**
 * A one-hour link for `user`: the statements and the token (shown once). Made by an operator (`by`), or sent to the account's
 * verified address when its holder asked (`via` 'email', `by` null; src/lib/email/reset.server.ts, accounts migration 0054).
 */
export async function makeResetLink(user: string, by: string | null, clearTotp: boolean, via: 'operator' | 'email' = 'operator'): Promise<{ token: string; expires: number; writes: Query[] }> {
  const token = randomToken(32);
  const t = now();
  return {
    token, expires: t + RESET_MS,
    writes: [
      // A used link stays until its notice is seen (resetNoticeOf); an unused one goes when it runs out or is replaced by one
      // made the same way (a link asked for by email never cancels an operator's).
      q('DELETE FROM password_reset WHERE (expires < ? AND (used_at IS NULL OR seen_at IS NOT NULL)) OR (user = ? AND used_at IS NULL AND via = ?)', t, user, via),
      q('INSERT INTO password_reset (hash, user, created, created_by, expires, clear_totp, via) VALUES (?, ?, ?, ?, ?, ?, ?)', await hashToken('reset', token), user, t, by, t + RESET_MS, clearTotp ? 1 : 0, via),
    ],
  };
}

export async function resetLinkByToken(token: string): Promise<ResetLinkRow | undefined> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  const row = await accounts().get<ResetLinkRow>('SELECT * FROM password_reset WHERE hash = ?', await hashToken('reset', token));
  return row && !row.used_at && row.expires > now() ? row : undefined;
}

/** What the reset page shows: whether the link holds, the account's name and username, and whether it asks for a code. */
export async function resetLinkInfo(token: string): Promise<{ ok: false } | { ok: true; name: string; username: string | null; needsCode: boolean }> {
  const link = await resetLinkByToken(token);
  const user = link && (await userById(link.user));
  if (!link || !user || !user.username || !(await passwordOf(user.id))) return { ok: false };
  return { ok: true, name: user.name, username: user.username ?? null, needsCode: !link.clear_totp && (await totpOn(user.id)) };
}

/**
 * Uses an operator's link: sets a new password for an account that has one, turns two-step codes off when the operator said
 * so, and ends every session of the account. Using the link is the batch's first statement and its check, so a link works
 * once. It never gives an account its first password (that would let whoever holds the link take over an account that signs
 * in another way), adds the account to no family and changes no role. The holder sees a notice at their next sign-in by
 * another way in (resetNoticeOf).
 */
export async function redeemResetLink(request: Request, input: { token?: unknown; username?: unknown; password?: unknown; code?: unknown }, a: Attempt): Promise<{ user: string }> {
  await passwordAllowed(request);
  const gone = invalid('pw.err.reset_gone');
  const link = typeof input.token === 'string' ? await resetLinkByToken(input.token) : undefined;
  const user = link && (await userById(link.user));
  if (!link || !user || !user.username || !(await passwordOf(user.id))) throw gone;
  const username = user.username;
  const password = checkNewPassword(input.password, username);
  if (!link.clear_totp && (await totpOn(user.id))) {
    await admit(await attemptKeys(username, a.ip), a, undefined);
    if (typeof input.code !== 'string' || !(await consumeTotp(user.id, input.code))) throw invalid('pw.err.code');
  }
  const t = now();
  try {
    await accounts().batch([
      q('UPDATE password_reset SET used_at = ? WHERE hash = ? AND used_at IS NULL AND expires > ?', t, link.hash, t),
      guard('EXISTS (SELECT 1 FROM password_reset WHERE hash = ? AND used_at = ?)', link.hash, t),
      guard('EXISTS (SELECT 1 FROM password WHERE user = ?)', user.id),
      ...(await passwordWrites(user.id, username, password)),
      ...(link.clear_totp ? [removeTotp(user.id)] : []),
      q('DELETE FROM session WHERE user = ?', user.id),
    ]);
  } catch (e) {
    if (isGuardError(e)) throw gone;
    rethrowTaken(e);
  }
  await notice(user.id, link.via === 'email' ? 'password_reset' : 'operator_reset', request);
  return { user: user.id };
}

/** How long a password session shows the notice it cannot dismiss. */
export const RESET_NOTICE_PASSWORD_DAYS = 30;

/**
 * The notice that an operator's reset link was used on this account: when, and whether this session may dismiss it. A session
 * another way in started (a passkey, a provider) sees it until it is dismissed. A password session sees it too, so a holder
 * with only a password learns of it, but cannot dismiss it (whoever used the link with the new password could hide it from the
 * holder): there it runs out by itself after 30 days.
 */
export async function resetNoticeOf(user: string, method: string | null | undefined, at = now()): Promise<{ at: number; dismissible: boolean; via: 'operator' | 'email' } | null> {
  const row = await accounts().get<{ at: number | null; via: string }>('SELECT used_at AS at, via FROM password_reset WHERE user = ? AND used_at IS NOT NULL AND seen_at IS NULL ORDER BY used_at DESC LIMIT 1', user);
  if (!row?.at) return null;
  const via = row.via === 'email' ? 'email' as const : 'operator' as const;
  if (method !== 'password') return { at: row.at, dismissible: true, via };
  return at - row.at < RESET_NOTICE_PASSWORD_DAYS * 86_400_000 ? { at: row.at, dismissible: false, via } : null;
}

/** Dismisses the notice, from a session another way in started. */
export async function dismissResetNotice(user: string, method: string | null | undefined): Promise<void> {
  if (method === 'password') throw invalid('pw.err.reset_notice_method');
  await accounts().run('UPDATE password_reset SET seen_at = ? WHERE user = ? AND used_at IS NOT NULL AND seen_at IS NULL', now(), user);
}
