// The accounts store, separate from the family trees: who people are, their passkeys, sessions,
// invitations and memberships. Tokens are stored only as hashes. data/accounts.db on Node (or
// KINDRED_ACCOUNTS_DB), the ACCOUNTS D1 database on Workers; schema in migrations/accounts/.
//
// Changes that must hold together are batches (one atomic transaction), not a held write lock: the
// statements below that build a change return a `Query` to put in a batch, and rules that used to
// rely on the lock are guards in that batch (see `guard` in ../store/db.ts), backed by UNIQUE keys.
import type { Role } from '../roles';
import type { Locale } from '../i18n/types';
import { guard, isGuardError, isUniqueError, NOT_TREES as NOT_TREE_FILES, q, store, type Db, type Query } from '../store/index.ts';
import { hashToken, randomToken } from './tokens.server.ts';

/** data/*.db files that are not family trees. */
export const NOT_TREES = NOT_TREE_FILES;

export { guard, isGuardError, q } from '../store/index.ts';

export const accounts = (): Db => store.accounts();

/**
 * Runs a change built from fresh reads as one batch. When a guard or a UNIQUE key stops it (another
 * request got there first), `build` runs again on fresh reads, up to three times: it then refuses with
 * the right message, or writes what is right now.
 */
export async function commit<T>(build: () => Promise<{ writes: Query[]; result: T; refused?: () => Error }>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const plan = await build();
    try {
      if (plan.writes.length) await accounts().batch(plan.writes);
      return plan.result;
    } catch (e) {
      if (!(isGuardError(e) || isUniqueError(e))) throw e;
      if (attempt >= 3) throw plan.refused?.() ?? e;
    }
  }
}

export const now = () => Date.now();
const DAY = 86_400_000;
export const SESSION_DAYS = 30;
export const SESSION_MAX_DAYS = 365;
export const INVITE_DAYS = 14;
const CHALLENGE_MS = 5 * 60_000;

// ---------- users ----------

export interface UserRow { id: string; name: string; email: string | null; handle: string; created: number; last_seen: number | null; locale: Locale | null }

export const userCount = async () => (await accounts().get<{ n: number }>('SELECT count(*) AS n FROM user'))!.n;
export const userById = (id: string) => accounts().get<UserRow>('SELECT * FROM user WHERE id = ?', id);
export const userByEmail = (email: string) => accounts().get<UserRow>('SELECT * FROM user WHERE email = ?', email);
export const userByHandle = (handle: string) => accounts().get<UserRow>('SELECT * FROM user WHERE handle = ?', handle);

/**
 * A new account and the statement that stores it. `locale` is the language the reader picked before they had an account
 * (session.server.ts, guestChoice), so the account keeps it from its first visit on.
 */
export function newUser(name: string, email: string | null, handle = randomToken(32), locale: Locale | null = null): { user: UserRow; insert: Query } {
  const user: UserRow = { id: crypto.randomUUID(), name, email, handle, created: now(), last_seen: now(), locale };
  return { user, insert: q('INSERT INTO user (id, name, email, handle, created, last_seen, locale) VALUES (?, ?, ?, ?, ?, ?, ?)', user.id, user.name, user.email, user.handle, user.created, user.last_seen, user.locale) };
}

/** Guards that nobody has an account yet: what makes the first account the only first steward. */
export const noUsersYet = () => guard('NOT EXISTS (SELECT 1 FROM user)');

export const renameUser = (id: string, name: string) => accounts().run('UPDATE user SET name = ? WHERE id = ?', name, id);
/** The reader's own language, saved on the account. null clears it. */
export const setUserLocale = (id: string, locale: Locale | null) => accounts().run('UPDATE user SET locale = ? WHERE id = ?', locale, id);

/** At most every five minutes, so reading the tree doesn't write on every request. */
export async function touchUser(id: string, lastSeen: number | null) {
  if (lastSeen && now() - lastSeen < 5 * 60_000) return;
  await accounts().run('UPDATE user SET last_seen = ? WHERE id = ?', now(), id);
}

// ---------- passkeys ----------

export interface CredentialRow { id: string; user: string; public_key: Uint8Array; counter: number; transports: string; device: string | null; synced: number; created: number; last_used: number | null }

export const credentialById = (id: string) => accounts().get<CredentialRow>('SELECT * FROM credential WHERE id = ?', id);
export const credentialsOf = (user: string) => accounts().all<CredentialRow>('SELECT * FROM credential WHERE user = ? ORDER BY created', user);

export const insertCredential = (c: { id: string; user: string; publicKey: Uint8Array; counter: number; transports: string[]; device: string; synced: boolean }) =>
  q('INSERT INTO credential (id, user, public_key, counter, transports, device, synced, created, last_used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    c.id, c.user, c.publicKey, c.counter, JSON.stringify(c.transports), c.device, c.synced ? 1 : 0, now(), now());

export const credentialUsed = (id: string, counter: number) => accounts().run('UPDATE credential SET counter = ?, last_used = ? WHERE id = ?', counter, now(), id);

// ---------- sessions ----------

export interface SessionRow { hash: string; user: string; created: number; expires: number; refreshed: number }

/** A new session for `user`; returns the cookie's token (only its hash is stored). */
export async function createSession(user: string): Promise<{ token: string; expires: number }> {
  const token = randomToken(32);
  const t = now();
  const expires = t + SESSION_DAYS * DAY;
  await accounts().batch([
    q('DELETE FROM session WHERE expires < ?', t),
    q('INSERT INTO session (hash, user, created, expires, refreshed) VALUES (?, ?, ?, ?, ?)', await hashToken('session', token), user, t, expires, t),
  ]);
  return { token, expires };
}

export async function sessionByToken(token: string): Promise<SessionRow | undefined> {
  const row = await accounts().get<SessionRow>('SELECT * FROM session WHERE hash = ?', await hashToken('session', token));
  return row && row.expires > now() ? row : undefined;
}

/** Sliding expiry: a session used within 30 days lives on, up to a year from sign-in. Refreshed at most daily. */
export async function slideSession(row: SessionRow): Promise<number | undefined> {
  const t = now();
  if (t - row.refreshed < DAY) return undefined;
  const expires = Math.min(t + SESSION_DAYS * DAY, row.created + SESSION_MAX_DAYS * DAY);
  if (expires <= row.expires) return undefined;
  await accounts().run('UPDATE session SET expires = ?, refreshed = ? WHERE hash = ?', expires, t, row.hash);
  return expires;
}

export const deleteSession = async (token: string) => accounts().run('DELETE FROM session WHERE hash = ?', await hashToken('session', token));

// ---------- memberships ----------

export interface MembershipRow { user: string; tree: string; role: Role; person: string | null; person_confirmed: number; created: number }

export const membershipsOf = (user: string) => accounts().all<MembershipRow>('SELECT * FROM membership WHERE user = ? ORDER BY created', user);
export const membership = (user: string, tree: string) => accounts().get<MembershipRow>('SELECT * FROM membership WHERE user = ? AND tree = ?', user, tree);

const rank = (col: string) => `CASE ${col} WHEN 'viewer' THEN 0 WHEN 'contributor' THEN 1 WHEN 'editor' THEN 2 WHEN 'steward' THEN 3 END`;

/** Adds a membership; an existing one keeps the higher of the two roles. One statement, so no race. */
export const upsertMembership = (user: string, tree: string, role: Role) =>
  q(`INSERT INTO membership (user, tree, role, created) VALUES (?, ?, ?, ?)
     ON CONFLICT (user, tree) DO UPDATE SET role = excluded.role WHERE ${rank('excluded.role')} > ${rank('membership.role')}`, user, tree, role, now());

export const stewardCount = async (tree: string) =>
  (await accounts().get<{ n: number }>("SELECT count(*) AS n FROM membership WHERE tree = ? AND role = 'steward'", tree))!.n;

/** Guards that a family still has a steward after the batch's changes (put it after them). */
export const keepsASteward = (tree: string) => guard("EXISTS (SELECT 1 FROM membership WHERE tree = ? AND role = 'steward')", tree);

export interface MemberRow { id: string; name: string; email: string | null; role: Role; person: string | null; last_seen: number | null; joined: number; passkeys: number }
export const membersOf = (tree: string) =>
  accounts().all<MemberRow>(
    `SELECT u.id, u.name, u.email, m.role, m.person, u.last_seen, m.created AS joined, (SELECT count(*) FROM credential c WHERE c.user = u.id) AS passkeys
      FROM membership m JOIN user u ON u.id = m.user WHERE m.tree = ? ORDER BY m.created`,
    tree,
  );

/**
 * Saves who a member says they are. A different answer clears the steward's confirmation; the same answer keeps it. `trusted`
 * confirms it straight away (someone who can paint anyway, naming a person). One statement, so no race.
 */
export const setPerson = (user: string, tree: string, person: string | null, trusted = false) =>
  accounts().run(
    'UPDATE membership SET person_confirmed = CASE WHEN person IS ? THEN max(person_confirmed, ?) ELSE ? END, person = ? WHERE user = ? AND tree = ?',
    person, trusted ? 1 : 0, trusted ? 1 : 0, person, user, tree,
  );

/**
 * A steward confirms who a member says they are. Only that answer: if the member has changed it since the steward looked,
 * nothing changes and this returns false.
 */
export const confirmPerson = async (user: string, tree: string, person: string) =>
  (await accounts().run('UPDATE membership SET person_confirmed = 1 WHERE user = ? AND tree = ? AND person = ?', user, tree, person)).changes === 1;

/** A steward declines who a member says they are, which unlinks them. Like confirmPerson, only that answer. */
export const declinePerson = async (user: string, tree: string, person: string) =>
  (await accounts().run('UPDATE membership SET person = NULL, person_confirmed = 0 WHERE user = ? AND tree = ? AND person = ?', user, tree, person)).changes === 1;

/** A new role. Someone who stops being an editor loses a confirmation they only had for being one, so their link goes to a steward. */
export const changeRole = (user: string, tree: string, role: Role) =>
  q(`UPDATE membership SET person_confirmed = CASE WHEN role IN ('editor', 'steward') AND ? IN ('viewer', 'contributor') THEN 0 ELSE person_confirmed END, role = ?
     WHERE user = ? AND tree = ?`, role, role, user, tree);

// ---------- invites ----------

export interface InviteRow {
  id: string; hash: string; tree: string; role: Role; email: string | null; expires: number; created: number;
  created_by: string | null; used_by: string | null; used_at: number | null; revoked_at: number | null;
}

export async function createInvite(i: { tree: string; role: Role; email: string | null; createdBy: string; days?: number }): Promise<{ invite: InviteRow; token: string }> {
  const token = randomToken(32);
  const t = now();
  const invite: InviteRow = {
    id: crypto.randomUUID(), hash: await hashToken('invite', token), tree: i.tree, role: i.role, email: i.email, expires: t + (i.days ?? INVITE_DAYS) * DAY,
    created: t, created_by: i.createdBy, used_by: null, used_at: null, revoked_at: null,
  };
  await accounts().run('INSERT INTO invite (id, hash, tree, role, email, expires, created, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    invite.id, invite.hash, invite.tree, invite.role, invite.email, invite.expires, invite.created, invite.created_by);
  return { invite, token };
}

/** A fresh link for a pending invite; the old link stops working. */
export async function renewInvite(id: string, days = INVITE_DAYS): Promise<string> {
  const token = randomToken(32);
  await accounts().run('UPDATE invite SET hash = ?, expires = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL', await hashToken('invite', token), now() + days * DAY, id);
  return token;
}

export const inviteById = (id: string) => accounts().get<InviteRow>('SELECT * FROM invite WHERE id = ?', id);
export const inviteByToken = async (token: string) => accounts().get<InviteRow>('SELECT * FROM invite WHERE hash = ?', await hashToken('invite', token));

/** The invite behind a link's token, if it can still be used. */
export async function openInvite(token: string): Promise<InviteRow | undefined> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  const row = await inviteByToken(token);
  return row && usable(row) ? row : undefined;
}
export const usable = (i: InviteRow) => !i.used_at && !i.revoked_at && i.expires > now();

export const invitesOf = (tree: string) => accounts().all<InviteRow>('SELECT * FROM invite WHERE tree = ? ORDER BY created DESC', tree);

export const revokeInvite = (id: string, tree: string) =>
  accounts().run('UPDATE invite SET revoked_at = ? WHERE id = ? AND tree = ? AND used_at IS NULL AND revoked_at IS NULL', now(), id, tree);

export const inviteUsed = () => new Error('This invitation has already been used.');

/**
 * The statements that accept `invite` for `user`. Only an unused invite can be used: the UPDATE's WHERE
 * and the guard after it make the batch fail if another acceptance got there first, so two simultaneous
 * acceptances can never both grant the membership.
 */
export function useInvite(invite: InviteRow, user: string): Query[] {
  const t = now();
  return [
    q('UPDATE invite SET used_by = ?, used_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires > ?', user, t, invite.id, t),
    guard('EXISTS (SELECT 1 FROM invite WHERE id = ? AND used_by = ? AND used_at = ?)', invite.id, user, t),
    upsertMembership(user, invite.tree, invite.role),
  ];
}

export const pendingInvitesFor = (email: string) =>
  accounts().all<InviteRow>('SELECT * FROM invite WHERE email = ? AND used_at IS NULL AND revoked_at IS NULL AND expires > ? ORDER BY created', email, now());

// ---------- WebAuthn challenges ----------

export async function saveChallenge(c: { challenge: string; purpose: 'setup' | 'invite' | 'add' | 'login'; subject?: string; name?: string }): Promise<string> {
  const id = randomToken(24);
  await accounts().batch([
    q('DELETE FROM challenge WHERE expires < ?', now()),
    q('INSERT INTO challenge (id, challenge, purpose, subject, name, expires) VALUES (?, ?, ?, ?, ?, ?)', id, c.challenge, c.purpose, c.subject ?? null, c.name ?? null, now() + CHALLENGE_MS),
  ]);
  return id;
}

/** A challenge can be answered once: deleting it and reading it are one statement. */
export function takeChallenge(id: string): Promise<{ challenge: string; purpose: string; subject: string | null; name: string | null } | undefined> {
  return accounts().get('DELETE FROM challenge WHERE id = ? AND expires > ? RETURNING challenge, purpose, subject, name', id, now());
}
