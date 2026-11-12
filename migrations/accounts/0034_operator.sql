-- The operator: whoever runs this server for families that are not theirs (docs/hosting-many-families.md,
-- src/lib/operator/). An instance role, kept apart from every family's roles: it grants no access to any family's records.
--   user.operator     1 for an operator. The server's first account is one: this migration makes the earliest account
--                     the operator of an install that already has accounts, and a new install's first account becomes one
--                     when it is made (newUser in src/lib/auth/store.server.ts). An operator can make other accounts
--                     operators and step down, never leaving the server without one.
--   instance_setting  one row per setting of the server (family_creation, the instance's name, the legal texts, the default
--                     storage cap): `key`, `value` (text), when and by whom it was last changed. A missing row is the default.
--   operator_audit    one row per thing an operator did: when, who (`account`, no foreign key, and `name` as it was then),
--                     `action`, the family it concerned (`family`, an id, deliberately not a `tree` column so the row outlives
--                     the family's deletion) and `detail` (JSON, never record content).
--   family_admin      one row per family the operator has managed: `status` ('active' or 'suspended': a suspended family
--                     is read-only for its members), `cap_bytes` (its storage cap; NULL for none), when and by whom it was
--                     made (`created_at`, `created_by`), the name of the person an operator invited as its first steward
--                     (`invited_name`), and `counted_at`, when its storage was last recounted. Deleted with the family (its
--                     `tree` column).
--   media_usage       one row per file in a family's media storage: its `key` and size in `bytes`, written when the file
--                     is stored and deleted with it (src/lib/operator/storage.server.ts). Their sum is what the family
--                     uses against its cap. A recount rebuilds a family's rows from its storage. Deleted with the family.
-- Plain SQL, so D1 and node:sqlite both run it.
ALTER TABLE user ADD COLUMN operator INTEGER NOT NULL DEFAULT 0 CHECK (operator IN (0, 1));
UPDATE user SET operator = 1 WHERE id = (SELECT id FROM user ORDER BY created, rowid LIMIT 1);

CREATE TABLE instance_setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

CREATE TABLE operator_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  account TEXT,
  name TEXT NOT NULL,
  action TEXT NOT NULL,
  family TEXT,
  detail TEXT
);
CREATE INDEX operator_audit_at ON operator_audit (at);

CREATE TABLE family_admin (
  tree TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  cap_bytes INTEGER CHECK (cap_bytes IS NULL OR cap_bytes >= 0),
  created_at INTEGER,
  created_by TEXT,
  invited_name TEXT,
  counted_at INTEGER
);

CREATE TABLE media_usage (
  tree TEXT NOT NULL,
  key TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  at INTEGER NOT NULL,
  PRIMARY KEY (tree, key)
);
