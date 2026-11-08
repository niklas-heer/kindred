-- A revision for each person: it goes up whenever the person or any of their fields changes, by whatever route
-- (the Edit tab, the Everyday tab, the assistant, the API), so it is a true version of what the person is.
-- The Edit tab sends the revision it opened, and the save is refused when the person has changed since
-- (src/lib/person.server.ts, savePersonEdit): a stale draft never overwrites fields it has not seen.
--
-- Triggers keep it honest, so no writer has to remember to bump it. Plain SQL: D1 and node:sqlite run it.

ALTER TABLE person ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER IF NOT EXISTS person_revision_on_field_insert AFTER INSERT ON person_field
BEGIN
  UPDATE person SET revision = revision + 1 WHERE id = NEW.person;
END;

CREATE TRIGGER IF NOT EXISTS person_revision_on_field_update AFTER UPDATE ON person_field
BEGIN
  UPDATE person SET revision = revision + 1 WHERE id = NEW.person;
END;

CREATE TRIGGER IF NOT EXISTS person_revision_on_field_delete AFTER DELETE ON person_field
BEGIN
  UPDATE person SET revision = revision + 1 WHERE id = OLD.person;
END;

-- A change to the person's own row counts too, unless the statement already moved the revision itself.
CREATE TRIGGER IF NOT EXISTS person_revision_on_row_update AFTER UPDATE ON person WHEN NEW.revision = OLD.revision
BEGIN
  UPDATE person SET revision = OLD.revision + 1 WHERE id = NEW.id;
END;
