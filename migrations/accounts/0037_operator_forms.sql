-- The operator's second round (docs/hosting-many-families.md, src/lib/operator/):
--   family_admin.closed      1 when a suspended family is closed outright: its members see a page that says so and how to
--                            reach the operator, and its share links and guests are refused. A family with status
--                            'suspended' and closed 0 is read-only, as before. Closed implies suspended, so everything that
--                            treats a suspended family as read-only still holds.
--   data_request.forwarded_at when the operator handed the request to the family's stewards (ms). Its stewards see a request
--                            only from then on; moving it back to 'open' clears it.
--   terms_acceptance         one row per time someone accepted the server's terms: the account (`user`, no foreign key, so the
--                            record stays), the terms' `version` (a short hash of their text), when (`at`, ms), what they were
--                            doing (`action`: 'family.create' or 'invite.steward') and the family it concerned (`family`, an id,
--                            not a `tree` column, like the audit log, so it outlives the family).
--   operator_push            an operator's device that asked to be told about new requests: its push subscription, the
--                            language, and when it was last told (`sent_at`, ms), which keeps it to one push in ten minutes.
--                            Goes with the account (foreign key) and when the device signs out or turns it off.
--   families_per_account     an instance setting: how many families one account (not an operator) may make while stewards
--                            make families. A new install starts at 5; an install that already has accounts keeps no limit
--                            until its operator sets one.
-- Plain SQL, so D1 and node:sqlite both run it.
ALTER TABLE family_admin ADD COLUMN closed INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0, 1));
CREATE INDEX family_admin_created_by ON family_admin (created_by);

ALTER TABLE data_request ADD COLUMN forwarded_at INTEGER;
UPDATE data_request SET forwarded_at = COALESCE(updated_at, created) WHERE status = 'forwarded';
CREATE INDEX data_request_status ON data_request (status, created);

CREATE TABLE terms_acceptance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL,
  version TEXT NOT NULL,
  at INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('family.create', 'invite.steward')),
  family TEXT
);
CREATE INDEX terms_acceptance_user ON terms_acceptance (user, at);

CREATE TABLE operator_push (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'de', 'af')),
  created INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX operator_push_user ON operator_push (user);

INSERT INTO instance_setting (key, value, updated_at, updated_by)
  SELECT 'families_per_account', '5', 0, NULL WHERE NOT EXISTS (SELECT 1 FROM user);
