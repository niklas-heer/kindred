// The limits on guessing a password, a two-step code or a recovery code, kept in the accounts database (`auth_attempt`,
// accounts migration 0040) so they hold across every Worker isolate and every Node process alike. Every try is counted
// BEFORE anything is checked, in one batch whose statements each count and answer the new count (`RETURNING`): the answer
// decides whether the try may go on, so thirty tries sent at once are thirty counts, and only those within the limit are
// checked at all. A try that succeeds gives its count back (`succeeded`).
//
//   username + network   5 tries in 15 minutes, then refused until the window ends. A window that ended in a lockout makes
//                        the next one twice as long (30 minutes, an hour, …, 16 hours at most): a growing delay, never a
//                        permanent lock, and only for the network that did the guessing.
//   username             5 tries in 15 minutes from anywhere: from then on each try needs a Turnstile answer, when the server
//                        has its keys, or else waits a short fixed delay. Never a lock: someone guessing a known username
//                        (an operator's) from many networks cannot keep its owner out.
//   network              20 tries an hour from one address (its hash), across usernames: refused.
//   server-wide          500 tries an hour: from then on the sign-in form asks for Cloudflare Turnstile, when the server has its keys.
//
// Usernames and addresses are hashed, so the table names nobody; an unknown username is counted exactly like a real one.
import { accounts, now, q } from './store.server.ts';
import { hashToken } from './tokens.server.ts';
import { normalizeUsername } from './methods.ts';

export const PAIR_LIMIT = 5;
export const PAIR_WINDOW_MS = 15 * 60_000;
/** The longest a username-and-network window grows to: 15 minutes × 2^6 = 16 hours. */
export const MAX_LEVEL = 6;
export const USER_LIMIT = 5;
export const USER_WINDOW_MS = 15 * 60_000;
/** What a try waits once its username is over USER_LIMIT and the server has no Turnstile keys. */
export const USER_SLOW_MS = 2_000;
export const NETWORK_LIMIT = 20;
export const NETWORK_WINDOW_MS = 60 * 60_000;
export const SERVER_TURNSTILE_AFTER = 500;
export const SERVER_WINDOW_MS = 60 * 60_000;

interface Row { count: number; level: number; window_start: number }

/** The keys of one try: the username's, the username's from this network, and the network's. */
export interface AttemptKeys { user: string; pair: string; network: string }

const userHash = (username: string) => hashToken('auth-user', normalizeUsername(username));
export const networkKey = async (ip: string) => `n:${await hashToken('auth-ip', ip)}`;

export async function attemptKeys(username: string, ip: string): Promise<AttemptKeys> {
  const u = await userHash(username);
  return { user: `u:${u}`, pair: `p:${await hashToken('auth-ip', `${u}\n${ip}`)}`, network: await networkKey(ip) };
}
const SERVER_KEY = 'all';

/**
 * One try against `key`. The window restarts when it is over; a window that ended at or over `limit` raises the level
 * (doubling the next window), one that did not resets it. SQLite evaluates every SET from the old row, so this is one atomic
 * step, and RETURNING answers the count it made. Exported for the D1 check.
 */
export const BUMP_SQL = `INSERT INTO auth_attempt (key, window_start, count, level) VALUES (?, ?, 1, 0)
  ON CONFLICT (key) DO UPDATE SET
    level = CASE WHEN window_start + (? << level) <= ? THEN (CASE WHEN count >= ? THEN min(level + 1, ?) ELSE 0 END) ELSE level END,
    count = CASE WHEN window_start + (? << level) <= ? THEN 1 ELSE count + 1 END,
    window_start = CASE WHEN window_start + (? << level) <= ? THEN ? ELSE window_start END
  RETURNING count, level, window_start`;

const bumpQuery = (key: string, t: number, windowMs: number, limit: number, maxLevel: number) =>
  q(BUMP_SQL, key, t, windowMs, t, limit, maxLevel, windowMs, t, windowMs, t, t);

/** What the counts say about one try. */
export interface Verdict {
  /** This username from this network, or this network, has used up its tries: refuse before any hashing. */
  locked: boolean;
  /** The username has had many tries from anywhere: Turnstile, when the server has its keys, or a short delay. */
  slow: boolean;
  /** The server has seen so many tries this hour that the sign-in form must carry a Turnstile answer. */
  turnstile: boolean;
}

const over = (rows: unknown, limit: number) => ((rows as Row[])[0]?.count ?? 0) > limit;

/** Counts one try for the username (from this network and from anywhere), the network and the server, and judges it. */
export async function begin(keys: AttemptKeys, t = now()): Promise<Verdict> {
  const [, pair, user, network, server] = await accounts().batch([
    q('DELETE FROM auth_attempt WHERE window_start < ?', t - PAIR_WINDOW_MS * 2 ** MAX_LEVEL),
    bumpQuery(keys.pair, t, PAIR_WINDOW_MS, PAIR_LIMIT, MAX_LEVEL),
    bumpQuery(keys.user, t, USER_WINDOW_MS, USER_LIMIT, 0),
    bumpQuery(keys.network, t, NETWORK_WINDOW_MS, NETWORK_LIMIT, 0),
    bumpQuery(SERVER_KEY, t, SERVER_WINDOW_MS, SERVER_TURNSTILE_AFTER, 0),
  ]);
  return {
    locked: over(pair!.rows, PAIR_LIMIT) || over(network!.rows, NETWORK_LIMIT),
    slow: over(user!.rows, USER_LIMIT),
    turnstile: over(server!.rows, SERVER_TURNSTILE_AFTER),
  };
}

/**
 * Counts one try for the network alone (an answer that would tell whether a username exists, such as "taken"), and whether
 * the network is over its limit.
 */
export async function beginNetwork(ip: string, t = now()): Promise<boolean> {
  const [network] = await accounts().batch([bumpQuery(await networkKey(ip), t, NETWORK_WINDOW_MS, NETWORK_LIMIT, 0)]);
  return over(network!.rows, NETWORK_LIMIT);
}

/** Gives back a network try that turned out harmless (a free username). */
export const refundNetwork = async (ip: string) =>
  accounts().run('UPDATE auth_attempt SET count = count - 1 WHERE key = ? AND count > 0', await networkKey(ip));

/**
 * A try that went all the way through: the username starts over (from every network), and the network's and the server's
 * count of this try is given back, so a household that signs in often is never throttled.
 */
export const succeeded = (keys: AttemptKeys) => accounts().batch([
  q('DELETE FROM auth_attempt WHERE key IN (?, ?)', keys.user, keys.pair),
  q('UPDATE auth_attempt SET count = count - 1 WHERE key IN (?, ?) AND count > 0', keys.network, SERVER_KEY),
]);

/** Gives back one try on every counter: a right password whose account still asks for its two-step code. */
export const refund = (keys: AttemptKeys) =>
  accounts().run('UPDATE auth_attempt SET count = count - 1 WHERE key IN (?, ?, ?, ?) AND count > 0', keys.user, keys.pair, keys.network, SERVER_KEY);

/** Reads the counters without counting (the console and the tests): whether this username from this network is locked now. */
export async function lockedNow(keys: AttemptKeys, t = now()): Promise<boolean> {
  const rows = await accounts().all<Row & { key: string }>('SELECT key, count, level, window_start FROM auth_attempt WHERE key IN (?, ?)', keys.pair, keys.network);
  return rows.some((r) => r.count >= (r.key === keys.pair ? PAIR_LIMIT : NETWORK_LIMIT)
    && t < r.window_start + (r.key === keys.pair ? PAIR_WINDOW_MS : NETWORK_WINDOW_MS) * 2 ** r.level);
}
