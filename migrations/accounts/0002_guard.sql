-- A guard aborts the batch it is in unless its condition holds (src/lib/store/db.ts):
--   INSERT INTO guard (ok) SELECT <condition>
-- It keeps the account rules that used to rely on a write lock: one first steward however many setups
-- race, at least one steward per family, never removing someone's last passkey.
CREATE VIEW IF NOT EXISTS guard AS SELECT 1 AS ok;
CREATE TRIGGER IF NOT EXISTS guard_check INSTEAD OF INSERT ON guard
WHEN NEW.ok IS NOT 1
BEGIN
  SELECT RAISE(ABORT, 'kindred:guard');
END;
