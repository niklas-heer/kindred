-- Who created each field, by account. Only that account may make a field personal (src/lib/visibility.ts), and it never
-- changes: later saves write updated_by. The column that was called created_by held a display name, so it is renamed to
-- created_by_name, the same pair research uses (0017). Older fields have no recorded author and stay NULL: nobody can make
-- those personal. Plain SQL, as every migration here: D1 and node:sqlite run it.

ALTER TABLE person_field RENAME COLUMN created_by TO created_by_name;
ALTER TABLE person_field ADD COLUMN created_by TEXT;
