// A family's share link: a URL and, by default, a password, so a relative can look around without an account. The token and
// the password are stored only as hashes. A guest is not an account: they get a short-lived visit that the guard treats as a
// viewer for the reads that allow it (guard.server.ts, requireReader) and refuses for everything else.
//
// A link can protect living people (migration 0023): its guests then get the living reduced to their names, their place in the
// tree and their pictures. Which reads do that is src/lib/protect-living.ts; the guard hands the link's choice to every read.
//
// Schema in migrations/accounts/0015_share_link.sql and 0023_share_protect_living.sql. The rate limit lives in the database,
// so it holds on Workers (where each isolate has its own memory) as well as on Node.
import { commit, accounts, guard, isGuardError, now, q } from './store.server.ts';
import { hashPassword, hashToken, randomToken, verifyPassword } from './tokens.server.ts';

const DAY = 86_400_000;
/** How long a guest's visit lasts. It does not slide: after this the password is asked for again. */
export const SHARE_SESSION_MS = 12 * 3_600_000;
export const ATTEMPT_WINDOW_MS = 15 * 60_000;
/** Tries per link and address, and per link across all addresses, in one window. */
export const ATTEMPTS_PER_IP = 8;
export const ATTEMPTS_PER_LINK = 40;
/** The expiry choices a steward has, in days; null is "no end date". */
export const SHARE_DAYS = [1, 7, 30, 90, null] as const;

export interface ShareLinkRow {
  id: string; tree: string; token_hash: string; password_hash: string | null; generation: number; expires: number | null; created: number; created_by: string | null;
  /** 1 when the link's guests get living people's names and pictures only. 0 for links made before the setting existed. */
  protect_living: number;
  /** 1 when the link's guests may ask for an account of their own (migration 0024, src/lib/auth/join.server.ts). */
  ask_to_join: number;
}

export const shareLinkOf = (tree: string) => accounts().get<ShareLinkRow>('SELECT * FROM share_link WHERE tree = ?', tree);
export const shareLinkByToken = async (token: string) => accounts().get<ShareLinkRow>('SELECT * FROM share_link WHERE token_hash = ?', await hashToken('share', token));
export const linkOpen = (l: Pick<ShareLinkRow, 'expires'>) => l.expires === null || l.expires > now();

// ---------- the password ----------

// Letters and digits that cannot be misread for one another: no 0/O, 1/I/L.
const PASSWORD_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const PASSWORD_LENGTH = 12;

/** A new password, as three groups of four characters: about 59 bits, far beyond guessing. */
export function newSharePassword(): string {
  const out: string[] = [];
  const limit = 256 - (256 % PASSWORD_ALPHABET.length);
  while (out.length < PASSWORD_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < limit && out.length < PASSWORD_LENGTH) out.push(PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]);
    }
  }
  return `${out.slice(0, 4).join('')}-${out.slice(4, 8).join('')}-${out.slice(8).join('')}`;
}

/** What is hashed and compared: the same password however it was typed (lower case, spaces, without the dashes). */
export const normalizeSharePassword = (typed: string) => typed.toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---------- making, replacing and removing the link ----------

export interface MadeShareLink { id: string; generation: number; token: string; password: string | null; expires: number | null; protectLiving: boolean }

/**
 * Makes the family's link, or replaces the one it has. Replacing changes the token and the password, ends every guest's visit
 * and forgets the link's failed tries. A new link protects living people unless the steward said otherwise.
 */
export async function makeShareLink(i: { tree: string; password: boolean; days: number | null; createdBy: string | null; protectLiving?: boolean }): Promise<MadeShareLink> {
  const protect = i.protectLiving === false ? 0 : 1;
  const token = randomToken(32);
  const password = i.password ? newSharePassword() : null;
  const passwordHash = password ? await hashPassword(normalizeSharePassword(password)) : null;
  const tokenHash = await hashToken('share', token);
  const t = now();
  const expires = i.days === null ? null : t + i.days * DAY;
  return commit(async () => {
    const current = await shareLinkOf(i.tree);
    const id = current?.id ?? crypto.randomUUID();
    const generation = (current?.generation ?? 0) + 1;
    return {
      writes: [
        current
          ? q('UPDATE share_link SET token_hash = ?, password_hash = ?, generation = ?, expires = ?, created = ?, created_by = ?, protect_living = ? WHERE id = ? AND generation = ?',
              tokenHash, passwordHash, generation, expires, t, i.createdBy, protect, id, current.generation)
          : q('INSERT INTO share_link (id, tree, token_hash, password_hash, generation, expires, created, created_by, protect_living) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              id, i.tree, tokenHash, passwordHash, generation, expires, t, i.createdBy, protect),
        // Another replace got there first when this generation is not the one stored: the batch writes nothing, and it is decided again.
        guard('EXISTS (SELECT 1 FROM share_link WHERE id = ? AND generation = ? AND token_hash = ?)', id, generation, tokenHash),
        q('DELETE FROM share_session WHERE link = ?', id),
        q('DELETE FROM share_attempt WHERE key LIKE ?', `${id}:%`),
        // A guest browser's usage belongs to the link it was measured on (join.server.ts): a new link starts with none.
        q('DELETE FROM guest_visitor WHERE link = ?', id),
      ],
      result: { id, generation, token, password, expires, protectLiving: protect === 1 },
    };
  });
}

/**
 * Turns the protection of living people on or off for the family's link, without replacing it: the URL and the password keep
 * working, and the guests already looking around see the change with their next read, since every read asks the link again.
 * False when the family has no link.
 */
export async function setShareProtectLiving(tree: string, on: boolean): Promise<boolean> {
  const r = await accounts().run('UPDATE share_link SET protect_living = ? WHERE tree = ?', on ? 1 : 0, tree);
  return r.changes > 0;
}

/** Lets the link's guests ask for an account of their own, or not (join.server.ts). Requests already sent stay. False when the family has no link. */
export async function setShareAskToJoin(tree: string, on: boolean): Promise<boolean> {
  const r = await accounts().run('UPDATE share_link SET ask_to_join = ? WHERE tree = ?', on ? 1 : 0, tree);
  return r.changes > 0;
}

/** Removes the family's link: the URL and the password stop working and every guest's visit ends, at once. */
export async function revokeShareLink(tree: string): Promise<void> {
  const link = await shareLinkOf(tree);
  if (!link) return;
  await accounts().batch([
    q('DELETE FROM share_session WHERE link = ?', link.id),
    q('DELETE FROM share_attempt WHERE key LIKE ?', `${link.id}:%`),
    q('DELETE FROM guest_visitor WHERE link = ?', link.id),
    q('DELETE FROM share_link WHERE id = ?', link.id),
  ]);
}

// ---------- trying the password ----------

/** One try against a counter: the window restarts when the old one is over. One statement, so tries cannot race. Exported for the D1 check. */
export const BUMP_ATTEMPT_SQL = `INSERT INTO share_attempt (key, started, count) VALUES (?, ?, 1)
  ON CONFLICT (key) DO UPDATE SET count = CASE WHEN started <= ? THEN 1 ELSE count + 1 END, started = CASE WHEN started <= ? THEN ? ELSE started END
  RETURNING count`;

async function bump(key: string, t: number): Promise<number> {
  const cutoff = t - ATTEMPT_WINDOW_MS;
  const row = await accounts().get<{ count: number }>(BUMP_ATTEMPT_SQL, key, t, cutoff, cutoff, t);
  return row?.count ?? 1;
}

const ipKey = async (link: string, ip: string) => `${link}:${await hashToken('share-ip', ip)}`;

/**
 * Counts one try for this link from this address, before any password hashing. False when the address or the link has used up
 * its tries for this window. A refused address does not count against the link, so one guesser cannot lock out the family.
 */
export async function spendAttempt(link: string, ip: string): Promise<boolean> {
  const t = now();
  await accounts().run('DELETE FROM share_attempt WHERE started <= ?', t - ATTEMPT_WINDOW_MS);
  if ((await bump(await ipKey(link, ip), t)) > ATTEMPTS_PER_IP) return false;
  return (await bump(`${link}:all`, t)) <= ATTEMPTS_PER_LINK;
}

/** A correct password: this address starts over, and the link's count gives this try back, so a family arriving together is not locked out. */
export async function forgetAttempts(link: string, ip: string): Promise<void> {
  await accounts().batch([
    q('DELETE FROM share_attempt WHERE key = ?', await ipKey(link, ip)),
    q('UPDATE share_attempt SET count = max(count - 1, 0) WHERE key = ?', `${link}:all`),
  ]);
}

export async function checkPassword(link: ShareLinkRow, typed: string | undefined): Promise<boolean> {
  if (link.password_hash === null) return true;
  return typeof typed === 'string' && verifyPassword(normalizeSharePassword(typed), link.password_hash);
}

// ---------- a guest's visit ----------

/** A guest's visit. `protectLiving` is the link's setting as it is now, read with the visit on every request. */
export interface GuestSession { link: string; tree: string; expires: number; protectLiving: boolean }

/** Starts a visit, unless the link was replaced, removed or ended in the meantime. It never outlasts the link. */
export async function startGuestVisit(link: ShareLinkRow): Promise<{ token: string; expires: number } | undefined> {
  const token = randomToken(32);
  const t = now();
  const expires = Math.min(t + SHARE_SESSION_MS, link.expires ?? Number.MAX_SAFE_INTEGER);
  try {
    await accounts().batch([
      q('DELETE FROM share_session WHERE expires <= ?', t),
      guard('EXISTS (SELECT 1 FROM share_link WHERE id = ? AND generation = ? AND (expires IS NULL OR expires > ?))', link.id, link.generation, t),
      q('INSERT INTO share_session (hash, link, generation, created, expires) VALUES (?, ?, ?, ?, ?)', await hashToken('guest', token), link.id, link.generation, t, expires),
    ]);
  } catch (e) {
    if (isGuardError(e)) return undefined;
    throw e;
  }
  return { token, expires };
}

/** The visit behind a cookie's token: only while the session, the link and its generation all still hold. */
export async function guestVisitByToken(token: string): Promise<GuestSession | undefined> {
  const t = now();
  const row = await accounts().get<Omit<GuestSession, 'protectLiving'> & { protect_living: number }>(
    `SELECT s.link AS link, l.tree AS tree, s.expires AS expires, l.protect_living AS protect_living FROM share_session s JOIN share_link l ON l.id = s.link
      WHERE s.hash = ? AND s.expires > ? AND s.generation = l.generation AND (l.expires IS NULL OR l.expires > ?)`,
    await hashToken('guest', token), t, t,
  );
  return row && { link: row.link, tree: row.tree, expires: row.expires, protectLiving: row.protect_living === 1 };
}

export const endGuestVisit = async (token: string) => accounts().run('DELETE FROM share_session WHERE hash = ?', await hashToken('guest', token));
