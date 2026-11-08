-- A person's further given names (second name, third name, and so on), in order, after `given`.
--
-- Stored as a JSON array of strings in one nullable column: NULL means none. Existing people keep exactly what they
-- have: a given name that already holds several names stays in `given` and is never split. The Edit tab saves the
-- column, so the person row's revision counts it (the trigger from 0010, recreated with the new column). Plain SQL,
-- as every migration here: D1 and node:sqlite run it.

ALTER TABLE person ADD COLUMN further_given TEXT;

DROP TRIGGER IF EXISTS person_revision_on_row_update;

CREATE TRIGGER person_revision_on_row_update AFTER UPDATE OF
  given, further_given, surname, current_given, current_surname, nickname, sex, born, born_place, died, died_place, living,
  title, epithet, occupation, occupation_code, bio
ON person WHEN NEW.revision = OLD.revision
BEGIN
  UPDATE person SET revision = OLD.revision + 1 WHERE id = NEW.id;
END;
