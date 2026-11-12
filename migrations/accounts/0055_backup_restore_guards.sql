-- What a restore may hand to whom (docs/hosting-many-families.md, "Backups"; src/lib/backup/backup.server.ts).
--
--   family_backup.stewards        the family's stewards (a JSON list of account ids) when the backup was made. A restore into a
--                                 new family makes those of them that still have an account its stewards, and nobody else;
--                                 NULL (a backup from before this migration) records none, so such a backup is not restored
--                                 into a new family.
--   family_backup.family_created  `family_admin.created_at` of the family when it was backed up: which family held the id then.
--                                 A deleted family's id can be used again; a restore copies pictures only from the same family.
--   family_backup.pinned_until    the backup made just before a restore over the family or a rollback is kept until then
--                                 (7 days), whatever the retention says.
--   family_claim                  one row per family id being made (`what` `create`, while createFamily runs) or restored into
--                                 (`restore`): the claim both respect, so a family cannot be made at an address a restore is
--                                 writing to, nor two restores write to the same one. A restore's row stays: its source, its
--                                 backup and the source family's `family_created`, so *Copy more pictures* copies only from
--                                 that family into this one, and `media` 0 once nothing is left to copy. It has a `tree` column,
--                                 so it goes with the family.
-- Additive only. Plain SQL, so D1 and node:sqlite both run it.
ALTER TABLE family_backup ADD COLUMN stewards TEXT;
ALTER TABLE family_backup ADD COLUMN family_created INTEGER;
ALTER TABLE family_backup ADD COLUMN pinned_until INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS family_claim (
  tree TEXT PRIMARY KEY,
  what TEXT NOT NULL DEFAULT 'create',
  at INTEGER NOT NULL DEFAULT 0,
  by TEXT,
  source TEXT,
  backup TEXT,
  source_created INTEGER,
  state TEXT NOT NULL DEFAULT 'restoring',
  media INTEGER NOT NULL DEFAULT 0
);
