// The accounts store: data/accounts.db, separate from the family trees (one file per tree).
// Who people are, their passkeys, sessions, invites and memberships. Tokens are stored only as hashes.
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Role } from '../roles';
import { hashToken, randomToken } from './tokens.server.ts';

const DATA = resolve(process.cwd(), 'data');
const PATH = process.env.KINDRED_ACCOUNTS_DB ? resolve(process.env.KINDRED_ACCOUNTS_DB) : join(DATA, 'accounts.db');
/** data/*.db files that are not family trees. */
export const NOT_TREES = new Set(['gazetteer', 'accounts']);

const SCHEMA = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 3000;
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT COLLATE NOCASE UNIQUE,
  -- WebAuthn user handle: random, so a passkey reveals nothing about the account.
  handle TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL,
  last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS credential (
  id TEXT PRIMARY KEY,               -- base64url credential id
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  device TEXT,
  synced INTEGER NOT NULL DEFAULT 0, -- backed up to a passkey manager (iCloud Keychain, Google, 1Password)
  created INTEGER NOT NULL,
  last_used INTEGER
);
CREATE INDEX IF NOT EXISTS credential_by_user ON credential(user);
CREATE TABLE IF NOT EXISTS session (
  hash TEXT PRIMARY KEY,             -- SHA-256 of the cookie's token
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  refreshed INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS session_by_user ON session(user);
CREATE TABLE IF NOT EXISTS invite (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,         -- SHA-256 of the link's token
  tree TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'contributor', 'editor', 'steward')),
  email TEXT COLLATE NOCASE,
  expires INTEGER NOT NULL,
  created INTEGER NOT NULL,
  created_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  used_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS invite_by_tree ON invite(tree);
CREATE TABLE IF NOT EXISTS membership (
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  tree TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'contributor', 'editor', 'steward')),
  person TEXT,                       -- who they are in that tree (a person id, or '-' for "just browsing")
  created INTEGER NOT NULL,
  PRIMARY KEY (user, tree)
);
CREATE INDEX IF NOT EXISTS membership_by_tree ON membership(tree);
CREATE TABLE IF NOT EXISTS challenge (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('setup', 'invite', 'add', 'login')),
  subject TEXT,                      -- the invite id ('invite') or user id ('add')
  name TEXT,                         -- the display name chosen before the passkey exists
  expires INTEGER NOT NULL
);
`;

// One connection per process, kept across dev hot reloads. Reopened if the file is deleted (a reset).
const g = globalThis as unknown as { __kindredAccounts?: DatabaseSync };
export function accounts(): DatabaseSync {
  if (g.__kindredAccounts && !existsSync(PATH)) {
    try { g.__kindredAccounts.close(); } catch {}
    g.__kindredAccounts = undefined;
  }
  if (!g.__kindredAccounts) {
    mkdirSync(DATA, { recursive: true });
    const d = new DatabaseSync(PATH);
    d.exec(SCHEMA);
    g.__kindredAccounts = d;
  }
  return g.__kindredAccounts;
}

/** Runs `fn` in one write transaction (BEGIN IMMEDIATE, so two first-steward setups can't race). */
export function tx<T>(fn: (d: DatabaseSync) => T): T {
  const d = accounts();
  d.exec('BEGIN IMMEDIATE');
  try {
    const r = fn(d);
    d.exec('COMMIT');
    return r;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

export const now = () => Date.now();
const DAY = 86_400_000;
export const SESSION_DAYS = 30;
export const SESSION_MAX_DAYS = 365;
export const INVITE_DAYS = 14;
const CHALLENGE_MS = 5 * 60_000;

// ---------- users ----------

export interface UserRow { id: string; name: string; email: string | null; handle: string; created: number; last_seen: number | null }

export const userCount = () => (accounts().prepare('SELECT count(*) AS n FROM user').get() as { n: number }).n;
export const userById = (id: string) => accounts().prepare('SELECT * FROM user WHERE id = ?').get(id) as UserRow | undefined;
export const userByEmail = (email: string) => accounts().prepare('SELECT * FROM user WHERE email = ?').get(email) as UserRow | undefined;
export const userByHandle = (handle: string) => accounts().prepare('SELECT * FROM user WHERE handle = ?').get(handle) as UserRow | undefined;

export function createUser(d: DatabaseSync, name: string, email: string | null, handle = randomToken(32)): UserRow {
  const row: UserRow = { id: crypto.randomUUID(), name, email, handle, created: now(), last_seen: now() };
  d.prepare('INSERT INTO user (id, name, email, handle, created, last_seen) VALUES (?, ?, ?, ?, ?, ?)').run(row.id, row.name, row.email, row.handle, row.created, row.last_seen);
  return row;
}

export const renameUser = (id: string, name: string) => accounts().prepare('UPDATE user SET name = ? WHERE id = ?').run(name, id);

/** At most every five minutes, so reading the tree doesn't write on every request. */
export function touchUser(id: string, lastSeen: number | null) {
  if (lastSeen && now() - lastSeen < 5 * 60_000) return;
  accounts().prepare('UPDATE user SET last_seen = ? WHERE id = ?').run(now(), id);
}

// ---------- passkeys ----------

export interface CredentialRow { id: string; user: string; public_key: Uint8Array; counter: number; transports: string; device: string | null; synced: number; created: number; last_used: number | null }

export const credentialById = (id: string) => accounts().prepare('SELECT * FROM credential WHERE id = ?').get(id) as CredentialRow | undefined;
export const credentialsOf = (user: string) => accounts().prepare('SELECT * FROM credential WHERE user = ? ORDER BY created').all(user) as unknown as CredentialRow[];

export function addCredential(d: DatabaseSync, c: { id: string; user: string; publicKey: Uint8Array; counter: number; transports: string[]; device: string; synced: boolean }) {
  d.prepare('INSERT INTO credential (id, user, public_key, counter, transports, device, synced, created, last_used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(c.id, c.user, c.publicKey, c.counter, JSON.stringify(c.transports), c.device, c.synced ? 1 : 0, now(), now());
}

export const credentialUsed = (id: string, counter: number) => accounts().prepare('UPDATE credential SET counter = ?, last_used = ? WHERE id = ?').run(counter, now(), id);

// ---------- sessions ----------

export interface SessionRow { hash: string; user: string; created: number; expires: number; refreshed: number }

/** A new session for `user`; returns the cookie's token (only its hash is stored). */
export function createSession(user: string): { token: string; expires: number } {
  const token = randomToken(32);
  const t = now();
  const expires = t + SESSION_DAYS * DAY;
  const d = accounts();
  d.prepare('DELETE FROM session WHERE expires < ?').run(t);
  d.prepare('INSERT INTO session (hash, user, created, expires, refreshed) VALUES (?, ?, ?, ?, ?)').run(hashToken('session', token), user, t, expires, t);
  return { token, expires };
}

export function sessionByToken(token: string): SessionRow | undefined {
  const row = accounts().prepare('SELECT * FROM session WHERE hash = ?').get(hashToken('session', token)) as SessionRow | undefined;
  return row && row.expires > now() ? row : undefined;
}

/** Sliding expiry: a session used within 30 days lives on, up to a year from sign-in. Refreshed at most daily. */
export function slideSession(row: SessionRow): number | undefined {
  const t = now();
  if (t - row.refreshed < DAY) return undefined;
  const expires = Math.min(t + SESSION_DAYS * DAY, row.created + SESSION_MAX_DAYS * DAY);
  if (expires <= row.expires) return undefined;
  accounts().prepare('UPDATE session SET expires = ?, refreshed = ? WHERE hash = ?').run(expires, t, row.hash);
  return expires;
}

export const deleteSession = (token: string) => accounts().prepare('DELETE FROM session WHERE hash = ?').run(hashToken('session', token));

// ---------- memberships ----------

export interface MembershipRow { user: string; tree: string; role: Role; person: string | null; created: number }

export const membershipsOf = (user: string) => accounts().prepare('SELECT * FROM membership WHERE user = ? ORDER BY created').all(user) as unknown as MembershipRow[];
export const membership = (user: string, tree: string) => accounts().prepare('SELECT * FROM membership WHERE user = ? AND tree = ?').get(user, tree) as MembershipRow | undefined;

const RANK: Record<Role, number> = { viewer: 0, contributor: 1, editor: 2, steward: 3 };

/** Adds a membership; an existing one keeps the higher of the two roles. */
export function addMembership(d: DatabaseSync, user: string, tree: string, role: Role) {
  const had = d.prepare('SELECT role FROM membership WHERE user = ? AND tree = ?').get(user, tree) as { role: Role } | undefined;
  if (!had) d.prepare('INSERT INTO membership (user, tree, role, created) VALUES (?, ?, ?, ?)').run(user, tree, role, now());
  else if (RANK[role] > RANK[had.role]) d.prepare('UPDATE membership SET role = ? WHERE user = ? AND tree = ?').run(role, user, tree);
}

export const stewardCount = (d: DatabaseSync, tree: string) =>
  (d.prepare("SELECT count(*) AS n FROM membership WHERE tree = ? AND role = 'steward'").get(tree) as { n: number }).n;

export interface MemberRow { id: string; name: string; email: string | null; role: Role; person: string | null; last_seen: number | null; joined: number; passkeys: number }
export const membersOf = (tree: string) =>
  accounts()
    .prepare(`SELECT u.id, u.name, u.email, m.role, m.person, u.last_seen, m.created AS joined, (SELECT count(*) FROM credential c WHERE c.user = u.id) AS passkeys
      FROM membership m JOIN user u ON u.id = m.user WHERE m.tree = ? ORDER BY m.created`)
    .all(tree) as unknown as MemberRow[];

export const setPerson = (user: string, tree: string, person: string | null) =>
  accounts().prepare('UPDATE membership SET person = ? WHERE user = ? AND tree = ?').run(person, user, tree);

// ---------- invites ----------

export interface InviteRow {
  id: string; hash: string; tree: string; role: Role; email: string | null; expires: number; created: number;
  created_by: string | null; used_by: string | null; used_at: number | null; revoked_at: number | null;
}

export function createInvite(i: { tree: string; role: Role; email: string | null; createdBy: string; days?: number }): { invite: InviteRow; token: string } {
  const token = randomToken(32);
  const t = now();
  const invite: InviteRow = {
    id: crypto.randomUUID(), hash: hashToken('invite', token), tree: i.tree, role: i.role, email: i.email, expires: t + (i.days ?? INVITE_DAYS) * DAY,
    created: t, created_by: i.createdBy, used_by: null, used_at: null, revoked_at: null,
  };
  accounts().prepare('INSERT INTO invite (id, hash, tree, role, email, expires, created, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(invite.id, invite.hash, invite.tree, invite.role, invite.email, invite.expires, invite.created, invite.created_by);
  return { invite, token };
}

/** A fresh link for a pending invite; the old link stops working. */
export function renewInvite(id: string, days = INVITE_DAYS): string {
  const token = randomToken(32);
  accounts().prepare('UPDATE invite SET hash = ?, expires = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL').run(hashToken('invite', token), now() + days * DAY, id);
  return token;
}

export const inviteById = (id: string) => accounts().prepare('SELECT * FROM invite WHERE id = ?').get(id) as InviteRow | undefined;

/** The invite behind a link's token, if it can still be used. */
export function openInvite(token: string): InviteRow | undefined {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  const row = accounts().prepare('SELECT * FROM invite WHERE hash = ?').get(hashToken('invite', token)) as InviteRow | undefined;
  return row && usable(row) ? row : undefined;
}
export const usable = (i: InviteRow) => !i.used_at && !i.revoked_at && i.expires > now();

export const invitesOf = (tree: string) => accounts().prepare('SELECT * FROM invite WHERE tree = ? ORDER BY created DESC').all(tree) as unknown as InviteRow[];

export function useInvite(d: DatabaseSync, invite: InviteRow, user: string) {
  // Only an unused invite can be used: the WHERE makes two simultaneous acceptances impossible.
  const r = d.prepare('UPDATE invite SET used_by = ?, used_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires > ?').run(user, now(), invite.id, now());
  if (r.changes !== 1) throw new Error('This invitation has already been used.');
  addMembership(d, user, invite.tree, invite.role);
}

export const pendingInvitesFor = (email: string) =>
  (accounts().prepare('SELECT * FROM invite WHERE email = ? AND used_at IS NULL AND revoked_at IS NULL AND expires > ? ORDER BY created').all(email, now()) as unknown as InviteRow[]);

// ---------- WebAuthn challenges ----------

export function saveChallenge(c: { challenge: string; purpose: 'setup' | 'invite' | 'add' | 'login'; subject?: string; name?: string }): string {
  const id = randomToken(24);
  const d = accounts();
  d.prepare('DELETE FROM challenge WHERE expires < ?').run(now());
  d.prepare('INSERT INTO challenge (id, challenge, purpose, subject, name, expires) VALUES (?, ?, ?, ?, ?, ?)').run(id, c.challenge, c.purpose, c.subject ?? null, c.name ?? null, now() + CHALLENGE_MS);
  return id;
}

/** A challenge can be answered once. */
export function takeChallenge(id: string): { challenge: string; purpose: string; subject: string | null; name: string | null } | undefined {
  const row = accounts().prepare('DELETE FROM challenge WHERE id = ? AND expires > ? RETURNING challenge, purpose, subject, name').get(id, now()) as
    | { challenge: string; purpose: string; subject: string | null; name: string | null }
    | undefined;
  return row;
}
