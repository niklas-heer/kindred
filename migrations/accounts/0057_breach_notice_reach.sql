-- Whom a breach notice reached by email (src/lib/email/notify.server.ts, src/lib/gdpr/breach.server.ts; docs/gdpr.md).
--   breach_mail   one row per steward and affected family a breach's current notice is for: `breach`, `user` (the steward's
--                 account; the row goes with it), `family` (an id, not a `tree` column: like `breach_family` it outlives a deleted
--                 family), `at` (when the notice was set), `sent_at` (when the email went out; NULL until then), `tries` and
--                 `result` (the last attempt's: sent, off, throttled, failed, invalid, no_address). A changed notice replaces the
--                 rows, so every steward gets the new text. The breach register shows reached of total; the daily
--                 `breach-notices` job retries the rows not sent while the breach is open and its notice shown.
-- Additive only. Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE breach_mail (
  breach TEXT NOT NULL REFERENCES breach(id) ON DELETE CASCADE,
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  family TEXT NOT NULL,
  at INTEGER NOT NULL,
  sent_at INTEGER,
  tries INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  PRIMARY KEY (breach, user, family)
);
CREATE INDEX breach_mail_open ON breach_mail (sent_at, breach);
