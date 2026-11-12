-- Data protection, first part (docs/gdpr.md, src/lib/gdpr/):
--   terms_acceptance.kind          what was accepted: 'terms' (the server's terms, as before) or 'dpa' (the processing agreement a
--                                  family's steward accepts with the operator, src/lib/gdpr/dpa.server.ts). Every older row is
--                                  'terms'.
--   data_request.extended_at       when the operator told the requester the answer takes up to two more months (GDPR Art. 12(3));
--                                  the deadline is then three calendar months after the request instead of one (ms).
--   data_request.extension_reason  the reason given in that notice (the requester must be told why).
--   data_request.person            the person in the family the request is about, once a steward has found them (an id; no
--                                  foreign key: the family's people live in its own database).
--   data_request.outcome           how it was answered: 'answered' (a copy given or a correction made), 'erased', 'restricted' or
--                                  'refused' (with the reason written to the requester). NULL while open.
--   family_admin.status_reason     the statement of reasons an operator writes when suspending or closing a family (EU DSA
--                                  Art. 17): the facts, and what the family may do about it. Its stewards read it.
--   family_admin.status_ground     what it rests on: 'terms' (the server's terms), 'law' (illegal content or a legal duty) or
--                                  'other' (unpaid, abandoned, asked for).
--   family_admin.status_at         when the status was last set (ms).
--   subject_restriction            one row per person in a family whose processing is restricted (GDPR Art. 18) on a request:
--                                  the family (`tree`), the `person` id, `since` (ms), who restricted it (`restricted_by`, an
--                                  account id) and the data request it answers (`request`, an id or NULL). While a row exists the
--                                  person cannot be changed. Deleted with the family (its `tree` column).
--   subject_action                 one row per erasure or restriction a steward carried out: the family, `kind` ('erase',
--                                  'restrict', 'lift'), when (`at`, ms), by whom (`done_by`, an account id), the request it
--                                  answers, and `counts` (JSON: how many rows went from each place). Never a name: an erased
--                                  person is not written down again. Deleted with the family.
-- Plain SQL, so D1 and node:sqlite both run it.
ALTER TABLE terms_acceptance ADD COLUMN kind TEXT NOT NULL DEFAULT 'terms' CHECK (kind IN ('terms', 'dpa'));

ALTER TABLE data_request ADD COLUMN extended_at INTEGER;
ALTER TABLE data_request ADD COLUMN extension_reason TEXT;
ALTER TABLE data_request ADD COLUMN person TEXT;
ALTER TABLE data_request ADD COLUMN outcome TEXT CHECK (outcome IS NULL OR outcome IN ('answered', 'erased', 'restricted', 'refused'));

ALTER TABLE family_admin ADD COLUMN status_reason TEXT;
ALTER TABLE family_admin ADD COLUMN status_ground TEXT CHECK (status_ground IS NULL OR status_ground IN ('terms', 'law', 'other'));
ALTER TABLE family_admin ADD COLUMN status_at INTEGER;

CREATE TABLE subject_restriction (
  tree TEXT NOT NULL,
  person TEXT NOT NULL,
  since INTEGER NOT NULL,
  restricted_by TEXT,
  request TEXT,
  PRIMARY KEY (tree, person)
);

CREATE TABLE subject_action (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tree TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('erase', 'restrict', 'lift')),
  at INTEGER NOT NULL,
  done_by TEXT,
  request TEXT,
  counts TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX subject_action_tree ON subject_action (tree, at);
