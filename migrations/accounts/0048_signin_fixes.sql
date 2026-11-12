-- Fixes to the ways in from the council's review (docs/self-host.md, "Ways in"; docs/hosting-many-families.md).
--   password_reset.seen_at  when the account's holder dismissed the notice that an operator's reset link was used on their
--                           account (src/lib/auth/password.server.ts, resetNoticeOf). A used link's row is kept until then, so
--                           the holder sees it at their next sign-in by another way in, however long that takes.
--   signin_daily            how many sign-ins each way in started on each day (UTC): `day` (YYYY-MM-DD), `method` ('passkey',
--                           'password' or 'oidc') and `count`. Aggregates only, for the operator's statistics
--                           (src/lib/operator/stats.server.ts): a session row cannot say this, as a new sign-in deletes the old one.
--   oidc_flow               made again with the purpose 'signup' (starting a family by signing in at a single sign-on provider,
--                           src/lib/signup/). A flow lasts ten minutes, so the rows in flight are simply dropped.
-- Plain SQL, so D1 and node:sqlite both run it.
ALTER TABLE password_reset ADD COLUMN seen_at INTEGER;

CREATE TABLE signin_daily (
  day TEXT NOT NULL,
  method TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, method)
);

DROP TABLE oidc_flow;
CREATE TABLE oidc_flow (
  hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('signin', 'invite', 'link', 'proof', 'signup')),
  browser TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  subject TEXT,
  next TEXT,
  data TEXT,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX oidc_flow_expires ON oidc_flow (expires);
