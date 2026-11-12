-- Two short-lived kinds of row for password sign-in (src/lib/auth/password.server.ts):
--   signin_step     a password that was right, waiting for the account's two-step code (or a recovery code): a hash of the
--                   ticket the browser holds, the account, how many codes were tried (five at most) and when it runs out
--                   (five minutes). It never is a session: only the code's check starts one.
--   password_reset  a one-hour link an operator made for someone who cannot sign in (docs/hosting-many-families.md): a hash
--                   of its token, the account, the operator, when it runs out, when it was used, and whether it also turns
--                   the account's two-step codes off (a lost phone). It sets a password and nothing else: no family, no role.
-- Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE signin_step (
  hash TEXT PRIMARY KEY,
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  tries INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX signin_step_expires ON signin_step (expires);

CREATE TABLE password_reset (
  hash TEXT PRIMARY KEY,
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  created_by TEXT,
  expires INTEGER NOT NULL,
  used_at INTEGER,
  clear_totp INTEGER NOT NULL DEFAULT 0 CHECK (clear_totp IN (0, 1))
);
CREATE INDEX password_reset_user ON password_reset (user);
