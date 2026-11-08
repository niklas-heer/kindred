-- The person row's revision counts only the columns the Edit tab saves (src/lib/person.server.ts, savePersonEdit).
--
-- Migration 0009 bumped the revision on every change to the row, so a reader's own portrait (`look`), their
-- preferred picture (`prefer_avatar`) or a house move made the Edit tab's save refuse itself: the draft was
-- opened at a revision that the reader's own look had since moved on. A stale draft can only overwrite the
-- columns it writes, so only those columns need the check. `updated_at` is left out on purpose: every writer
-- sets it, so counting it would count every writer again.
--
-- The field triggers from 0009 stay as they are. Plain SQL, no PRAGMA: D1 and node:sqlite run it. Shipped
-- migrations are never edited, so this replaces the row trigger by dropping and creating it again.

DROP TRIGGER IF EXISTS person_revision_on_row_update;

CREATE TRIGGER person_revision_on_row_update AFTER UPDATE OF
  given, surname, current_given, current_surname, nickname, sex, born, born_place, died, died_place, living,
  title, epithet, occupation, occupation_code, bio
ON person WHEN NEW.revision = OLD.revision
BEGIN
  UPDATE person SET revision = OLD.revision + 1 WHERE id = NEW.id;
END;
