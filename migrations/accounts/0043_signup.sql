-- Sign-up: a server that hosts families lets people start one themselves (docs/hosting-many-families.md, src/lib/signup/).
--   signup                 one row per sign-up that made a family: the account (`user`, deleted with it, since the row
--                          holds their name and contact email), the family it made (`family`, an id, deliberately not a
--                          `tree` column so the row, and with it the day's count, outlives the family), the name and contact
--                          email they gave, whether that email was verified (only a single sign-on provider can say so; a
--                          passkey sign-up is unverified), that they said they are 16 or older (`age_confirmed`), the code
--                          they used (`code`, a signup_code id), the short hash of their network (never the address) and
--                          when. The limits per day and per network count these rows inside the batch that adds one.
--   signup_code            a code an operator made that opens sign-up while it is otherwise closed: the SHA-256 of the code
--                          (`hash`; the code itself is shown once), a label, how many sign-ups it allows (`uses_max`) and
--                          has had (`uses`), when it expires (NULL: never), who made it and when, and when it was revoked.
--   family_admin.self_signed  1 for a family made by sign-up: the server's ceiling of signed-up families counts these.
--   challenge              gains the purpose 'signup' (a new account's passkey ceremony). A CHECK cannot be changed in place,
--                          so the table is made again, as in 0025; its rows live five minutes, and those in flight are copied.
-- The settings (instance_mode, the sign-up limits, the landing page's paragraph) are rows of instance_setting; a missing row
-- is the default, so an install that never opens the console's Hosting tab behaves as before (`single`).
-- Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE signup (
  id TEXT PRIMARY KEY,
  user TEXT REFERENCES user(id) ON DELETE CASCADE,
  family TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  age_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (age_confirmed IN (0, 1)),
  code TEXT,
  network TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX signup_created ON signup (created);
CREATE INDEX signup_network ON signup (network, created);
CREATE INDEX signup_user ON signup (user);

CREATE TABLE signup_code (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  uses_max INTEGER NOT NULL CHECK (uses_max >= 1),
  uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
  expires INTEGER,
  created INTEGER NOT NULL,
  created_by TEXT,
  revoked_at INTEGER
);

CREATE TABLE challenge_next (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('setup', 'invite', 'add', 'login', 'confirm', 'signup')),
  subject TEXT,                      -- the invite id ('invite'), the user id ('add'), the user and session ('confirm'), the new handle ('signup')
  name TEXT,                         -- the display name chosen before the passkey exists
  expires INTEGER NOT NULL
);
INSERT INTO challenge_next (id, challenge, purpose, subject, name, expires) SELECT id, challenge, purpose, subject, name, expires FROM challenge;
DROP TABLE challenge;
ALTER TABLE challenge_next RENAME TO challenge;

ALTER TABLE family_admin ADD COLUMN self_signed INTEGER NOT NULL DEFAULT 0 CHECK (self_signed IN (0, 1));
