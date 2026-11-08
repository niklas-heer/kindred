-- Web Push reminders: one row per device and family. A device (its push subscription) holds its own choices of
-- days and kinds for that family, in the language it was registered with. The keys are the device's public key
-- and auth secret (RFC 8291), so the server can encrypt for it; nothing here is the family's data.
--
-- `offsets` is a JSON array of 0, 1 and 7 (days before), `kinds` a JSON array of birthday, wedding and memorial.
-- A row goes when the user leaves the family (src/lib/auth/functions.ts removeMember), when the push service says the
-- device is gone (404 or 410), or when it has not been seen for 60 days (src/lib/reminders.server.ts).
CREATE TABLE IF NOT EXISTS push_subscription (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  tree TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  offsets TEXT NOT NULL,
  kinds TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'de', 'af')),
  created INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  UNIQUE (tree, endpoint)
);
CREATE INDEX IF NOT EXISTS push_subscription_by_user ON push_subscription (user);
CREATE INDEX IF NOT EXISTS push_subscription_by_endpoint ON push_subscription (endpoint);
