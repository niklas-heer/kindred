-- The ancestry revision: one number that goes up on every change to a parent link, by whatever route.
--
-- The GEDCOM import (src/lib/exchange/import.server.ts) plans against the family's parent links, and must write only if
-- they are the same when the batch runs. Guarding the set of links as one JSON parameter grows with the family, and D1
-- refuses a string over 2 MB, so a large family could no longer import anything. This number is the same size whatever
-- the family holds: the import reads it while planning and guards `rev = ?` inside its batch. Every change to `parent`
-- bumps it, so a link another editor replaced (even one for one, which leaves the count the same) moves the number.
--
-- Plain SQL, no PRAGMA: D1 and node:sqlite run it. The row is seeded once, so running this again changes nothing.
-- It is not copied by the D1 transfer (scripts/lib/d1-transfer.ts): the target's own parent changes bump it from its seed.

CREATE TABLE IF NOT EXISTS ancestry_rev (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rev INTEGER NOT NULL
);

INSERT OR IGNORE INTO ancestry_rev (id, rev) VALUES (1, 0);

CREATE TRIGGER IF NOT EXISTS ancestry_rev_on_parent_insert AFTER INSERT ON parent
BEGIN
  UPDATE ancestry_rev SET rev = rev + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS ancestry_rev_on_parent_update AFTER UPDATE ON parent
BEGIN
  UPDATE ancestry_rev SET rev = rev + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS ancestry_rev_on_parent_delete AFTER DELETE ON parent
BEGIN
  UPDATE ancestry_rev SET rev = rev + 1 WHERE id = 1;
END;
