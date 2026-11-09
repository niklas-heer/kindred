-- Which passkey started a session, so removing a lost device's passkey also signs that device out. NULL for sessions
-- made before this column existed: they keep working until they expire or their reader signs out everywhere else.
-- No foreign key: a column added by ALTER TABLE cannot cascade on D1 and node:sqlite alike, so removing a passkey
-- deletes its sessions in the same batch (src/lib/auth/store.server.ts, removeCredential).
-- Plain SQL, so D1 and node:sqlite both run it.
ALTER TABLE session ADD COLUMN credential TEXT;
CREATE INDEX IF NOT EXISTS session_by_credential ON session(credential);
