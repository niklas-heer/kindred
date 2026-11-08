-- A person keeps several painted portraits. accepted = 1 is still the one they show; kept = 1 is a version they chose to keep.
-- A row with both at 0 is a draft, swept when abandoned. tweak is the person's own small adjustments, as JSON.
ALTER TABLE portrait ADD COLUMN kept INTEGER NOT NULL DEFAULT 0 CHECK (kept IN (0, 1));
ALTER TABLE portrait ADD COLUMN tweak TEXT;
UPDATE portrait SET kept = 1 WHERE accepted = 1;
