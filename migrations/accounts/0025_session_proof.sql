-- A fresh passkey proof for the session: adding another passkey and "sign out everywhere else" ask the reader to confirm
-- with a passkey (user verification) on this very session within the last few minutes (src/lib/auth/proof.server.ts), so
-- a borrowed, unlocked browser cannot add a passkey of its own or throw its owner's devices out. `proved` is when that
-- last happened, in milliseconds; NULL means never. A sign-in with user verification counts as one.
--
-- The confirmation is a passkey ceremony of its own, so `challenge` gains the purpose 'confirm'. A CHECK cannot be
-- changed in place, so the table is made again; its rows live five minutes, and the ones in flight are copied over.
-- No PRAGMA, BEGIN or COMMIT: D1 and node:sqlite both run it.
ALTER TABLE session ADD COLUMN proved INTEGER;

CREATE TABLE challenge_next (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('setup', 'invite', 'add', 'login', 'confirm')),
  subject TEXT,                      -- the invite id ('invite'), the user id ('add'), or the user and session ('confirm')
  name TEXT,                         -- the display name chosen before the passkey exists
  expires INTEGER NOT NULL
);
INSERT INTO challenge_next (id, challenge, purpose, subject, name, expires) SELECT id, challenge, purpose, subject, name, expires FROM challenge;
DROP TABLE challenge;
ALTER TABLE challenge_next RENAME TO challenge;
