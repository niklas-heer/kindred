-- The accounts database, separate from the family trees: who people are, their passkeys, sessions,
-- invitations and memberships. Tokens are stored only as hashes. data/accounts.db on Node, the ACCOUNTS
-- D1 database on Cloudflare.
--
-- This is the schema as it was before versioned migrations, so files made earlier pass through it
-- unchanged (every statement is IF NOT EXISTS). Never edit a migration that has shipped: add a new one.

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
