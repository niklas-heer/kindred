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
// Guessing is limited in the database (./attempts.server.ts), counted before any hashing. A right password whose account has
// two-step codes is not a sign-in yet: it gets a five-minute ticket (`signin_step`) for the code, or a recovery code. Every
// sign-in is a new session (session.server.ts, startSession). Nothing here works on the guest host, in a demo or in a preview.
import { attemptKeys, fail as failAttempt, gate, succeeded, userKey, type AttemptKeys } from './attempts.server.ts';
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
// real account's (no hash is made first), and nothing ever matches it.
const DUMMY = `${PASSWORD_SCHEME}$${randomToken(16)}$${randomToken(32)}`;
async function dummyVerify(password: string): Promise<false> {
  await verifyAccountPassword(password, DUMMY);
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
/** Refuses a username another account has (the UNIQUE index still decides a race; rethrowTaken names it). */
export async function requireFreeUsername(username: string): Promise<void> {
  if (await userByUsername(username)) throw usernameTaken();
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
const throttled = () => new AuthError('throttled', 'pw.err.throttled');
export const turnstileNeeded = () => new AuthError('invalid', 'pw.err.turnstile');

export interface Attempt { ip: string; turnstile?: (token: string | undefined) => Promise<boolean> }

/**
 * Checks a username and password. Returns the account when the password is right; throws one answer for a wrong password
 * and an unknown username alike, after the same work. Counted against the username, the network and the server.
 */
async function checkPassword(username: unknown, password: unknown, a: Attempt, turnstileToken?: string): Promise<{ user: UserRow; keys: AttemptKeys; rehash: boolean }> {
  const typed = typeof username === 'string' ? username.slice(0, 200) : '';
  const pw = typeof password === 'string' ? password.slice(0, PASSWORD_MAX * 4) : '';
  const keys = await attemptKeys(typed, a.ip);
  const g = await gate(keys);
  if (g.locked) throw throttled();
  if (g.turnstile && a.turnstile && !(await a.turnstile(turnstileToken))) throw turnstileNeeded();
  const name = normalizeUsername(typed);
  const user = USERNAME.test(name) ? await userByUsername(name) : undefined;
  const stored = user ? await passwordOf(user.id) : undefined;
  const ok = stored ? await verifyAccountPassword(pw, stored.hash) : await dummyVerify(pw);
  if (!ok || !user) {
    await failAttempt(keys);
    throw wrong();
  }
  return { user, keys, rehash: needsRehash(stored!.hash) };
}

export type SignInResult = { kind: 'session'; user: string } | { kind: 'second'; ticket: string };

/** A password sign-in. With two-step codes on, a ticket for the code instead of a session. */
export async function passwordSignIn(request: Request, input: { username?: unknown; password?: unknown; turnstile?: unknown }, a: Attempt): Promise<SignInResult> {
  await passwordAllowed(request);
  const { user, keys, rehash } = await checkPassword(input.username, input.password, a, typeof input.turnstile === 'string' ? input.turnstile : undefined);
  if (rehash) await accounts().batch((await passwordWrites(user.id, user.username!, input.password as string)).slice(1));
  if (await totpOn(user.id)) {
    const ticket = randomToken(32);
    const t = now();
    await accounts().batch([
      q('DELETE FROM signin_step WHERE expires < ?', t),
      q('INSERT INTO signin_step (hash, user, tries, created, expires) VALUES (?, ?, 0, ?, ?)', await hashToken('signin-step', ticket), user.id, t, t + SIGNIN_STEP_MS),
    ]);
    return { kind: 'second', ticket };
  }
  await succeeded(keys);
  return { kind: 'session', user: user.id };
}

/**
 * The second step: a two-step code, or one of the recovery codes, for the account behind a ticket. A wrong code counts against
 * the username like a wrong password, and five wrong codes end the ticket.
 */
export async function passwordSecondStep(request: Request, input: { ticket?: unknown; code?: unknown; recovery?: unknown }, a: Attempt): Promise<{ user: string }> {
  await passwordAllowed(request);
  const expired = invalid('pw.err.step_expired');
  if (typeof input.ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.ticket)) throw expired;
  const hash = await hashToken('signin-step', input.ticket);
  const step = await accounts().get<{ user: string; tries: number }>('SELECT user, tries FROM signin_step WHERE hash = ? AND expires > ?', hash, now());
  const user = step && (await userById(step.user));
  if (!step || !user?.username) throw expired;
  const keys = await attemptKeys(user.username, a.ip);
  if ((await gate(keys)).locked) throw throttled();
  const ok = typeof input.recovery === 'string' && input.recovery
    ? await consumeRecoveryCode(user.id, input.recovery)
    : typeof input.code === 'string' && (await consumeTotp(user.id, input.code));
  if (!ok) {
    await failAttempt(keys);
    await accounts().batch([
      q('UPDATE signin_step SET tries = tries + 1 WHERE hash = ?', hash),
      q('DELETE FROM signin_step WHERE hash = ? AND tries >= ?', hash, SIGNIN_STEP_TRIES),
    ]);
    throw invalid('pw.err.code');
  }
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
  const { keys } = await checkPassword(user.username, input.password, a);
  if (await totpOn(user.id)) {
    const ok = typeof input.recovery === 'string' && input.recovery
      ? await consumeRecoveryCode(user.id, input.recovery)
      : typeof input.code === 'string' && (await consumeTotp(user.id, input.code));
    if (!ok) {
      await failAttempt(keys);
      throw invalid('pw.err.code');
    }
  }
  await succeeded(keys);
}

// ---------- a forgotten password ----------

/**
 * A forgotten password, reset with one of the account's recovery codes (and its current two-step code, when those are on: a
 * recovery code stands in for a lost password or a lost phone, not both). Counted like a sign-in. Returns the account; every
 * session it had is ended, and the caller starts a new one.
 */
export async function resetWithRecoveryCode(request: Request, input: { username?: unknown; recovery?: unknown; code?: unknown; password?: unknown }, a: Attempt): Promise<{ user: string }> {
  await passwordAllowed(request);
  const typed = typeof input.username === 'string' ? input.username.slice(0, 200) : '';
  const keys = await attemptKeys(typed, a.ip);
  if ((await gate(keys)).locked) throw throttled();
  const name = normalizeUsername(typed);
  const user = USERNAME.test(name) ? await userByUsername(name) : undefined;
  // The new password's rules first: a typo there should not cost a try.
  const password = checkNewPassword(input.password, user?.username ?? name);
  const codeOk = async (u: UserRow) => !(await totpOn(u.id)) || (typeof input.code === 'string' && (await consumeTotp(u.id, input.code)));
  const ok = !!user && typeof input.recovery === 'string' && (await codeOk(user)) && (await consumeRecoveryCode(user.id, input.recovery));
  if (!ok || !user) {
    await failAttempt(keys);
    throw invalid('pw.err.recovery');
  }
  await accounts().batch([...(await passwordWrites(user.id, user.username!, password)), q('DELETE FROM session WHERE user = ?', user.id)]);
  await succeeded(keys);
  return { user: user.id };
}

// ---------- an operator's reset link ----------

export interface ResetLinkRow { hash: string; user: string; created: number; created_by: string | null; expires: number; used_at: number | null; clear_totp: number }

/** A one-hour link for `user`, made by an operator: the statements and the token (shown once). */
export async function makeResetLink(user: string, by: string, clearTotp: boolean): Promise<{ token: string; expires: number; writes: Query[] }> {
  const token = randomToken(32);
  const t = now();
  return {
    token, expires: t + RESET_MS,
    writes: [
      q('DELETE FROM password_reset WHERE expires < ? OR (user = ? AND used_at IS NULL)', t, user),
      q('INSERT INTO password_reset (hash, user, created, created_by, expires, clear_totp) VALUES (?, ?, ?, ?, ?, ?)', await hashToken('reset', token), user, t, by, t + RESET_MS, clearTotp ? 1 : 0),
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
  if (!link || !user) return { ok: false };
  return { ok: true, name: user.name, username: user.username ?? null, needsCode: !link.clear_totp && (await totpOn(user.id)) };
}

/**
 * Uses an operator's link: sets the password (and a username, when the account had none), turns two-step codes off when the
 * operator said so, and ends every session of the account. Using the link is the batch's first statement and its check, so a
 * link works once. It adds the account to no family and changes no role.
 */
export async function redeemResetLink(request: Request, input: { token?: unknown; username?: unknown; password?: unknown; code?: unknown }, a: Attempt): Promise<{ user: string }> {
  await passwordAllowed(request);
  const gone = invalid('pw.err.reset_gone');
  const link = typeof input.token === 'string' ? await resetLinkByToken(input.token) : undefined;
  const user = link && (await userById(link.user));
  if (!link || !user) throw gone;
  const username = user.username ?? cleanUsername(input.username);
  const password = checkNewPassword(input.password, username);
  if (!link.clear_totp && (await totpOn(user.id))) {
    const keys = { user: await userKey(username), network: (await attemptKeys(username, a.ip)).network };
    if ((await gate(keys)).locked) throw throttled();
    if (typeof input.code !== 'string' || !(await consumeTotp(user.id, input.code))) {
      await failAttempt(keys);
      throw invalid('pw.err.code');
    }
  }
  const t = now();
  try {
    await accounts().batch([
      q('UPDATE password_reset SET used_at = ? WHERE hash = ? AND used_at IS NULL AND expires > ?', t, link.hash, t),
      guard('EXISTS (SELECT 1 FROM password_reset WHERE hash = ? AND used_at = ?)', link.hash, t),
      ...(await passwordWrites(user.id, username, password)),
      ...(link.clear_totp ? [removeTotp(user.id)] : []),
      q('DELETE FROM session WHERE user = ?', user.id),
    ]);
  } catch (e) {
    if (isGuardError(e)) throw gone;
    rethrowTaken(e);
  }
  return { user: user.id };
}
