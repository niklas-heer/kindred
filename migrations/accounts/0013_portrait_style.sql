-- A family's own portrait style: the look every painted portrait shares. Empty means Kindred's default.
-- Plain SQL, so D1 and node:sqlite both run it.
ALTER TABLE ai_portrait ADD COLUMN style TEXT NOT NULL DEFAULT '';
