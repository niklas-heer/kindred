-- A family's share link: a URL and (by default) a password, so a relative can look around without an account. A guest gets
-- viewer-level access at most, through the same server checks as a viewer (docs/roles-and-privacy.md).
--   share_link     at most one per family. The token is stored as a hash and the password as a PBKDF2 hash, so a copy of
--                  this database opens nothing. `generation` goes up each time the link is replaced.
--   share_session  a guest's short-lived visit (a hash of the cookie's token). It is deleted when the link is revoked or
--                  replaced, and it is only honoured while its generation is the link's.
--   share_attempt  how many tries a link has had in the current window, per link and per link and address (the address is
--                  hashed). Kept here, not in memory, so one limit holds across every Worker isolate and on Node.
-- Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE share_link (
  id TEXT PRIMARY KEY,
  tree TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  generation INTEGER NOT NULL DEFAULT 1,
  expires INTEGER,
  created INTEGER NOT NULL,
  created_by TEXT
);

CREATE TABLE share_session (
  hash TEXT PRIMARY KEY,
  link TEXT NOT NULL,
  generation INTEGER NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX share_session_link ON share_session (link);

CREATE TABLE share_attempt (
  key TEXT PRIMARY KEY,
  started INTEGER NOT NULL,
  count INTEGER NOT NULL
);
