-- Single sign-on with OpenID Connect, the third way into a Kindred account (src/lib/auth/oidc.server.ts, docs/self-host.md
-- "Single sign-on"). The operator adds providers in the console; each is a client registered at the provider.
--   auth_provider    one provider: its id (the slug in the redirect URI /api/auth/oidc/<id>/callback, never changed), the
--                    label on the button, the issuer URL (compared exactly), the client id, the client secret sealed with
--                    the server secret (empty for a public client), the scopes asked for, `trust_email` (an account may be
--                    found by a verified email the provider vouches for: off unless the operator turns it on), `enabled`,
--                    and the provider's discovery document and keys as last fetched (a cache; NULL until the first fetch).
--   oidc_identity    an account's identity at a provider: (provider, subject) is the provider's `sub`, unique per provider, so
--                    one identity belongs to one account; an account has at most one identity per provider. The email and
--                    whether the provider said it was verified, as the last sign-in said (the `signup` lane reads it).
--   oidc_flow        a sign-in in flight (ten minutes): a hash of its `state`, the provider, what it is for (`signin`,
--                    `invite`, `link`, `proof`), a hash of the browser's flow cookie, the `nonce` and PKCE verifier, whom it
--                    concerns (the user and session for `link` and `proof`), where to go after (`next`, a same-site path)
--                    and the invitation's details. A callback deletes its row before anything else, so a state works once.
--   session.provider which provider started a session (method 'oidc'): turning that provider off ends its sessions.
-- Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE auth_provider (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'generic',
  label TEXT NOT NULL,
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  secret_sealed TEXT,
  scopes TEXT NOT NULL DEFAULT 'openid email profile',
  trust_email INTEGER NOT NULL DEFAULT 0 CHECK (trust_email IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  discovery TEXT,
  discovered_at INTEGER,
  jwks TEXT,
  jwks_at INTEGER,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);

CREATE TABLE oidc_identity (
  provider TEXT NOT NULL REFERENCES auth_provider(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  created INTEGER NOT NULL,
  last_used INTEGER,
  PRIMARY KEY (provider, subject)
);
CREATE UNIQUE INDEX oidc_identity_user ON oidc_identity (user, provider);

CREATE TABLE oidc_flow (
  hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('signin', 'invite', 'link', 'proof')),
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

ALTER TABLE session ADD COLUMN provider TEXT;
CREATE INDEX session_by_provider ON session (provider);
