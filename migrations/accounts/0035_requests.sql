-- What people who are not members ask the operator (docs/hosting-many-families.md, src/lib/operator/requests.server.ts).
--   family_request  someone asking for a family on this server, while `family_creation` is 'requests': their `name`,
--                   `email`, the `family_name` they want and a `message`, the `locale` they wrote in, when (`created`, ms).
--                   `status` is 'open', 'approved' or 'declined', with when and by whom (`decided_at`, `decided_by`); an
--                   approved one names the family made for it (`family`, an id, not a `tree` column: the request is the
--                   operator's record and outlives the family). `network` is a short hash of the network it came from, to
--                   count requests from one place; it narrows nothing down to an address.
--   data_request    someone (often a relative who never signed up) asking for access to, correction or deletion of data
--                   about them: `name`, `email`, the family as they wrote it (`family_text`) and, when it names a family on
--                   this server, its id (`family`, not a `tree` column, for the same reason), `kind` ('access',
--                   'correction', 'deletion' or 'other'), a `message`, `created` (ms). `status` is 'open', 'forwarded' (to
--                   the family's stewards) or 'done', with when and by whom it last changed. `network` as above.
-- Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE family_request (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  family_name TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  locale TEXT,
  created INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'declined')),
  decided_at INTEGER,
  decided_by TEXT,
  family TEXT,
  network TEXT
);
CREATE INDEX family_request_status ON family_request (status, created);
CREATE INDEX family_request_network ON family_request (network, created);

CREATE TABLE data_request (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  family_text TEXT NOT NULL DEFAULT '',
  family TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('access', 'correction', 'deletion', 'other')),
  message TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'forwarded', 'done')),
  updated_at INTEGER,
  updated_by TEXT,
  network TEXT
);
CREATE INDEX data_request_family ON data_request (family, status);
CREATE INDEX data_request_network ON data_request (network, created);
