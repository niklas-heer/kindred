-- The Campaign as a game one plays alone (docs/campaign.md): each reign a member plays, for the family's weekly table.
-- The tables of migration 0025 stay as they are: the shared seasons are closed and kept as "Seasons of old".
-- Nothing here is part of the family's records: no foreign key to a person, a house or a place, and left out of GEDCOM,
-- the Markdown archive and the D1 transfer (scripts/lib/d1-transfer.ts). Members are named by their account id.
-- Plain SQL, as every migration here: D1 and node:sqlite run it.

-- A reign: who played it (the account, and the name they had then), the side they played, the ISO week ("2026-W46"),
-- the dice's seed, and the field it was played on (JSON: the map, the sides, the opening, and what the player's renown
-- and the daily quiz added to the levy, as they were when it began). A finished reign has the moves the browser sent
-- (JSON), the score the server worked out by playing them again, the score's parts (JSON) and when it was finished.
CREATE TABLE campaign_run (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  name_then TEXT NOT NULL DEFAULT '',
  side TEXT NOT NULL,
  week TEXT NOT NULL,
  seed TEXT NOT NULL,
  field TEXT NOT NULL,
  orders TEXT,
  score INTEGER,
  result TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX campaign_run_week ON campaign_run (week, score);
CREATE INDEX campaign_run_account ON campaign_run (account, created_at);
