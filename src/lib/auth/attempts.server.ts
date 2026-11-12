// The limits on guessing a password, a two-step code or a recovery code, kept in the accounts database (`auth_attempt`,
// accounts migration 0040) so they hold across every Worker isolate and every Node process alike: each failure is one
// statement that counts it and answers how many there are, so concurrent guesses cannot slip past each other.
//
//   per username   5 failures in 15 minutes, then wait until the window ends. A window that ended in a lockout makes the next
//                  one twice as long (30 minutes, an hour, …, 16 hours at most): a growing delay, never a permanent lock. The
//                  username is hashed, so the table names nobody; an unknown username is counted exactly like a real one.
//   per network    20 failures an hour from one address (its hash).
//   server-wide    500 failures an hour: from then on the form asks for Cloudflare Turnstile, when the server has its keys.
//
// A success forgets the username's failures (and only those).
import { accounts, now, q } from './store.server.ts';
import { hashToken } from './tokens.server.ts';
import { normalizeUsername } from './methods.ts';

export const USER_LIMIT = 5;
export const USER_WINDOW_MS = 15 * 60_000;
/** The longest a username's window grows to: 15 minutes × 2^6 = 16 hours. */
export const MAX_LEVEL = 6;
export const NETWORK_LIMIT = 20;
export const NETWORK_WINDOW_MS = 60 * 60_000;
export const SERVER_TURNSTILE_AFTER = 500;
export const SERVER_WINDOW_MS = 60 * 60_000;

interface Row { count: number; level: number; window_start: number }

/** The keys of one try: the username's, the network's and the server's. */
export interface AttemptKeys { user: string; network: string }

export async function attemptKeys(username: string, ip: string): Promise<AttemptKeys> {
  return { user: `u:${await hashToken('auth-user', normalizeUsername(username))}`, network: `n:${await hashToken('auth-ip', ip)}` };
}
/** The username key of an account (a two-step code or a recovery code is counted against the account's username). */
export const userKey = async (username: string) => `u:${await hashToken('auth-user', normalizeUsername(username))}`;
const SERVER_KEY = 'all';

/**
 * One failure against `key`. The window restarts when it is over; a window that ended at or over `limit` raises the level
 * (doubling the next window), one that did not resets it. SQLite evaluates every SET from the old row, so this is one atomic
 * step. Exported for the D1 check.
 */
export const BUMP_SQL = `INSERT INTO auth_attempt (key, window_start, count, level) VALUES (?, ?, 1, 0)
  ON CONFLICT (key) DO UPDATE SET
    level = CASE WHEN window_start + (? << level) <= ? THEN (CASE WHEN count >= ? THEN min(level + 1, ?) ELSE 0 END) ELSE level END,
    count = CASE WHEN window_start + (? << level) <= ? THEN 1 ELSE count + 1 END,
    window_start = CASE WHEN window_start + (? << level) <= ? THEN ? ELSE window_start END
  RETURNING count, level, window_start`;

const bumpQuery = (key: string, t: number, windowMs: number, limit: number, maxLevel: number) =>
  q(BUMP_SQL, key, t, windowMs, t, limit, maxLevel, windowMs, t, windowMs, t, t);

/** Whether a row is over its limit right now. */
const locked = (r: Row | undefined, limit: number, windowMs: number, t: number) => !!r && r.count >= limit && t < r.window_start + windowMs * 2 ** r.level;

export interface Gate {
  /** The username or the network has used up its tries: refuse before any hashing. */
  locked: boolean;
  /** The server has seen so many failures this hour that the form must carry a Turnstile answer. */
  turnstile: boolean;
}

/** Reads the three counters in one round trip, before any password is hashed. */
export async function gate(keys: AttemptKeys, t = now()): Promise<Gate> {
  const [u, n, s] = (await accounts().readBatch([
    q('SELECT count, level, window_start FROM auth_attempt WHERE key = ?', keys.user),
    q('SELECT count, level, window_start FROM auth_attempt WHERE key = ?', keys.network),
    q('SELECT count, level, window_start FROM auth_attempt WHERE key = ?', SERVER_KEY),
  ])) as unknown as [Row[], Row[], Row[]];
  return {
    locked: locked(u[0], USER_LIMIT, USER_WINDOW_MS, t) || locked(n[0], NETWORK_LIMIT, NETWORK_WINDOW_MS, t),
    turnstile: locked(s[0], SERVER_TURNSTILE_AFTER, SERVER_WINDOW_MS, t),
  };
}

/** Counts one failure for the username, the network and the server, in one batch. */
export async function fail(keys: AttemptKeys, t = now()): Promise<void> {
  await accounts().batch([
    q('DELETE FROM auth_attempt WHERE window_start < ?', t - USER_WINDOW_MS * 2 ** MAX_LEVEL),
    bumpQuery(keys.user, t, USER_WINDOW_MS, USER_LIMIT, MAX_LEVEL),
    bumpQuery(keys.network, t, NETWORK_WINDOW_MS, NETWORK_LIMIT, 0),
    bumpQuery(SERVER_KEY, t, SERVER_WINDOW_MS, SERVER_TURNSTILE_AFTER, 0),
  ]);
}

/** A sign-in that went all the way through: the username starts over. The network's and the server's counts stay. */
export const succeeded = (keys: Pick<AttemptKeys, 'user'>) => accounts().run('DELETE FROM auth_attempt WHERE key = ?', keys.user);
