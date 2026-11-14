-- The guided setup of single sign-on providers (src/components/operator/OperatorOidcWizard.tsx, src/lib/auth/oidc.server.ts;
-- docs/self-host.md, "Single sign-on").
--   auth_provider.secret_expires  the day the client secret stops working (YYYY-MM-DD, as the provider showed it), typed by the
--                                 operator; Microsoft's secrets expire. The console warns 30 days before. NULL: not known.
--   auth_provider.last_success    when a sign-in with this provider last got a good ID token (any purpose, the operator's test
--                                 included). Google deletes sign-in clients unused for six months; the console warns at five.
--   auth_provider.last_error      what went wrong the last time Kindred read the discovery document or called the token endpoint
--   auth_provider.last_error_at   (the provider's own error words when it gave some), and when. Shown while newer than
--                                 last_success.
--   auth_provider.tested_at       when the operator's test sign-in last worked with the current client ID and secret; changing
--                                 either clears it. The console offers "Enable" for a new provider only after a test.
--   oidc_flow                     made again with the purpose 'test' (the operator's test sign-in: it signs nobody in, makes no
--                                 account and links nothing). A flow lasts ten minutes, so the rows in flight are simply dropped.
-- Plain SQL, so D1 and node:sqlite both run it.
ALTER TABLE auth_provider ADD COLUMN secret_expires TEXT;
ALTER TABLE auth_provider ADD COLUMN last_success INTEGER;
ALTER TABLE auth_provider ADD COLUMN last_error TEXT;
ALTER TABLE auth_provider ADD COLUMN last_error_at INTEGER;
ALTER TABLE auth_provider ADD COLUMN tested_at INTEGER;

DROP TABLE oidc_flow;
CREATE TABLE oidc_flow (
  hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('signin', 'invite', 'link', 'proof', 'signup', 'test')),
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
