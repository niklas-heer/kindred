-- Data protection, second part: the operator's breach register (GDPR Art. 33(5): every personal data breach is documented,
-- notified or not; docs/gdpr.md, src/lib/gdpr/breach.server.ts).
--   breach         one row per breach: a short `title`; `aware_at`, when the operator became aware (the 72-hour clock to tell
--                  the supervisory authority starts here, ms); `occurred_at` when it happened, if known; what happened
--                  (`description`), which data and whose (`data_categories`, `subjects`), the likely consequences and the
--                  measures taken (`consequences`, `measures`); the operator's `risk` assessment ('unknown' until assessed,
--                  'none' when no notification is owed, 'risk' to notify the authority, 'high' to tell the people too);
--                  `authority_at` and `authority_ref` once the authority was told, `late_reason` when that was after 72 hours,
--                  `subjects_at` once the people were told; `notice`, a message the affected families' stewards see as a banner
--                  until `notice_until` (ms) or the breach is closed (`closed_at`). Who made and last changed it, and when.
--   breach_family  the families a breach affects (`family`, an id, not a `tree` column: the register outlives a deleted
--                  family). A breach with no rows here affects every family.
-- Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE breach (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  aware_at INTEGER NOT NULL,
  occurred_at INTEGER,
  description TEXT NOT NULL DEFAULT '',
  data_categories TEXT NOT NULL DEFAULT '',
  subjects TEXT NOT NULL DEFAULT '',
  consequences TEXT NOT NULL DEFAULT '',
  measures TEXT NOT NULL DEFAULT '',
  risk TEXT NOT NULL DEFAULT 'unknown' CHECK (risk IN ('unknown', 'none', 'risk', 'high')),
  authority_at INTEGER,
  authority_ref TEXT,
  late_reason TEXT,
  subjects_at INTEGER,
  notice TEXT NOT NULL DEFAULT '',
  notice_until INTEGER,
  closed_at INTEGER,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
CREATE INDEX breach_aware ON breach (aware_at);

CREATE TABLE breach_family (
  breach TEXT NOT NULL REFERENCES breach(id) ON DELETE CASCADE,
  family TEXT NOT NULL,
  PRIMARY KEY (breach, family)
);
CREATE INDEX breach_family_family ON breach_family (family);
