-- Optional email (docs/hosting-many-families.md, "Email"; src/lib/email/). Off until an operator sets a provider; the settings
-- are rows of instance_setting (`mail_*`, the provider's key sealed with the server secret), so a missing row is "off".
--   email_token     a one-time proof of an address: `purpose` 'verify' (a link from the account menu, for `user`, the account
--                   it verifies; deleted with it) or 'signup' (a six-digit code typed into the sign-up form, before any account
--                   exists). `secret` is the SHA-256 of the link's token or of the code (never the token or code itself),
--                   `email` the address it proves, `created`, `expires` (ms) and `tries` (wrong codes so far). A sign-up code,
--                   once typed right, gets `proof` (the hash of a token the form sends with the sign-up) and `proved_at`; the
--                   sign-up that uses it sets `used_at` in the batch that makes the account, so one proof makes one sign-up.
--   email_send      one row per email Kindred meant to send, for the limits (per recipient, per server) and the console's
--                   Health tab: `at` (ms), `recipient` (a keyed hash of the address under the server secret, so the table names
--                   nobody), `category` (what it was: 'verify', 'signup', 'reset', 'security', 'invitation', 'operator',
--                   'family', 'receipt', 'test'), `status` ('sending', 'sent', 'failed', 'skipped') and the provider's `error`
--                   for a failed one (never the message). Rows older than 30 days are deleted as new ones come.
--   email_optout    one row per address and category its holder unsubscribed from (one click in any non-security email):
--                   `recipient` (the same keyed hash) and `category`, and when. Security emails have no category to leave.
-- None of these name a family, so none has a `tree` column. Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE email_token (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'signup')),
  user TEXT REFERENCES user(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  secret TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  proof TEXT UNIQUE,
  proved_at INTEGER,
  used_at INTEGER
);
CREATE INDEX email_token_secret ON email_token (secret);
CREATE INDEX email_token_user ON email_token (user);
CREATE INDEX email_token_expires ON email_token (expires);

CREATE TABLE email_send (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed', 'skipped')),
  error TEXT
);
CREATE INDEX email_send_recipient ON email_send (recipient, at);
CREATE INDEX email_send_at ON email_send (at);

CREATE TABLE email_optout (
  recipient TEXT NOT NULL,
  category TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (recipient, category)
);
