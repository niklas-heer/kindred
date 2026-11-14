-- "Email me a sign-in code" (src/lib/auth/email-code.server.ts; docs/self-host.md, "Ways in"): a fourth way into an account,
-- `email-code`, off until an operator turns it on in the console's Sign-in tab, and only while email is on.
--   email_signin    one row per "email me a code" asked in one browser: `id` (random), `browser` (the hash of a random value
--                   in that browser's own cookie, which only that browser holds: a code works only where it was asked for),
--                   `user` and `secret` (the account and the hash of its six-digit code, set after the answer, only when the
--                   address typed is an account's CONFIRMED address; both stay NULL for any other address, so the row looks
--                   the same either way), `created`, `expires` (ten minutes), `tries` (five at most, counted before a code is
--                   checked) and `used_at` (the code was used: it signs in once). The address typed is never stored.
--   signin_step.method  which way in the ticket continues: 'password' (every row from before) or 'email-code' (a right code
--                   whose account has two-step codes, waiting for one).
-- No family is named, so no `tree` column. Additive only. Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE email_signin (
  id TEXT PRIMARY KEY,
  browser TEXT NOT NULL,
  user TEXT REFERENCES user(id) ON DELETE CASCADE,
  secret TEXT,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER
);
CREATE INDEX email_signin_browser ON email_signin (browser);
CREATE INDEX email_signin_expires ON email_signin (expires);
CREATE INDEX email_signin_user ON email_signin (user);

ALTER TABLE signin_step ADD COLUMN method TEXT NOT NULL DEFAULT 'password' CHECK (method IN ('password', 'email-code'));
