-- Imports into a family's Durable Object, who made an invitation, and uploads on their way (docs/data-model.md).
--
--   family_import        one row per import into a family's Durable Object (POST /api/move/<tree>,
--                        src/lib/store/move.server.ts): `id`, the import's own random id every later step must name;
--                        `user`, the account that began it (only they may continue it); `mode`, 'new' for a family this
--                        server does not have yet (its importer becomes its steward when it is published) or 'copy' for a
--                        family a D1 binding serves, copied by one of its stewards; `schema`, the last tree migration the
--                        rows were read under; `expected`, the number of rows of each table the import announced (JSON);
--                        `started_at` and `finished_at` (ms). The import is written into a staged object that serves
--                        nothing; only a finish whose counts match publishes it. Deleted with the family (its `tree`
--                        column), and replaced by the next import of the same family.
--   invite.by_operator   1 for an invitation an operator made as a family's first steward (the operator console's "Make a
--                        family for someone"). Only such an invitation may be renewed by an operator, and only while the
--                        family has no members. Invitations made before this migration: those an operator made for a
--                        family the operator made for someone (family_admin.invited_name).
--   media_usage.pending_at  when an upload reserved its bytes and has not been stored yet (ms), NULL once it is. A recount
--                        keeps a pending row younger than an hour, so an upload on its way is not forgotten.
-- Plain SQL, so D1, node:sqlite and a Durable Object all run it.
CREATE TABLE family_import (
  tree TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  user TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('new', 'copy')),
  schema TEXT NOT NULL,
  expected TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);

ALTER TABLE invite ADD COLUMN by_operator INTEGER NOT NULL DEFAULT 0 CHECK (by_operator IN (0, 1));
UPDATE invite SET by_operator = 1
WHERE role = 'steward'
  AND created_by IN (SELECT id FROM user WHERE operator = 1)
  AND tree IN (SELECT tree FROM family_admin WHERE invited_name IS NOT NULL);

ALTER TABLE media_usage ADD COLUMN pending_at INTEGER;
