-- More ways in besides a passkey (src/lib/auth/methods.server.ts, docs/self-host.md "Choosing how people sign in"). The
-- account stays `user.id`; each way in is its own table, so a later way (single sign-on) adds a table of its own.
--   user.username     the name a password sign-in types: lower case (normalised before it is stored), unique however it is
--                     written. NULL for an account that has no password.
--   password          one per account: the hash (src/lib/auth/password.server.ts names its scheme and parameters inside it,
--                     `params` repeats the scheme so old hashes can be found) and when it was set.
--   totp              an account's two-step codes (an authenticator app): the secret, sealed with the server secret, the last
--                     30-second step that was used (a code works once), and when it was confirmed (NULL while being set up).
--   recovery_code     ten one-use codes per account, stored only as hashes; `used_at` once used.
--   auth_attempt      failed tries per key (a hashed username, a hashed network, or the whole server), in the database so
--                     one limit holds across every Worker isolate and on Node. `level` lengthens the window after a lockout.
--   session.method    how the session was started: 'passkey' or 'password' (NULL for sessions from before: a passkey's).
--                     Turning a way in off ends the sessions it started.
--   session.proved_via how the session's last fresh proof was given ('passkey' or 'password').
-- Plain SQL, so D1 and node:sqlite both run it.
ALTER TABLE user ADD COLUMN username TEXT COLLATE NOCASE;
CREATE UNIQUE INDEX user_username ON user (username);

CREATE TABLE password (
  user TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  params TEXT NOT NULL,
  set_at INTEGER NOT NULL
);

CREATE TABLE totp (
  user TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  secret_sealed TEXT NOT NULL,
  last_step INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  confirmed_at INTEGER
);

CREATE TABLE recovery_code (
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  created INTEGER NOT NULL,
  used_at INTEGER,
  PRIMARY KEY (user, hash)
);

CREATE TABLE auth_attempt (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE session ADD COLUMN method TEXT;
ALTER TABLE session ADD COLUMN proved_via TEXT;
CREATE INDEX session_by_method ON session (method);
