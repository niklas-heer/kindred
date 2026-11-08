-- Three levels for a person's fields and notes, in place of the single private flag.
--
--   personal   only the account that added it (owner); not even a steward, never the assistant or an export
--   editors    editors and stewards: what `private = 1` meant
--   family     every member of the family: what `private = 0` meant
--
-- `owner` is the account id (accounts database, user.id), set exactly when the field is personal; the CHECK keeps a
-- personal row from ever losing its owner. Dropping `private` means a query still using it fails loudly, rather than
-- quietly showing a personal row. Only the private rows are updated: the others take the default, so a person's revision
-- does not move for them. Plain SQL, as every migration here: D1 and node:sqlite run it.

ALTER TABLE person_field ADD COLUMN visibility TEXT NOT NULL DEFAULT 'family' CHECK (visibility IN ('personal', 'editors', 'family'));
ALTER TABLE person_field ADD COLUMN owner TEXT CHECK ((visibility = 'personal') = (owner IS NOT NULL));

UPDATE person_field SET visibility = 'editors' WHERE private = 1;

ALTER TABLE person_field DROP COLUMN private;
