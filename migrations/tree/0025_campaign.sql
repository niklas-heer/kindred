-- The Campaign (docs/campaign.md): a slow game between the family's houses, on a map made from the family's places. It is
-- off until a steward turns it on, and nothing here is part of the family's records: no table refers to a person, a
-- house or a place by a foreign key, the game never writes outside these tables, and they are left out of GEDCOM, the
-- Markdown archive and the D1 transfer (scripts/lib/d1-transfer.ts). Members are named by their account id.
-- Plain SQL, as every migration here: D1 and node:sqlite run it.

-- One row: the steward's switch and the number of the season being played (0 before the first).
CREATE TABLE campaign (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  season INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  updated_by TEXT
);

-- A season: its seed, the UTC day it started (days since 1970), its map and sides as they were drawn that day, and the
-- position. `rev` goes up with every change to `state`, and every order guards on it, so two orders never write over
-- each other. A finished season keeps its winner and standings: the hall of fame.
CREATE TABLE campaign_season (
  season INTEGER PRIMARY KEY,
  seed TEXT NOT NULL,
  started INTEGER NOT NULL,
  map TEXT NOT NULL,
  sides TEXT NOT NULL,
  state TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  ended TEXT,
  winner TEXT,
  result TEXT
);

-- A member in a season: the orders they have left and the day that count is from, the house they chose to serve when
-- they stand for nobody in a house, the day of their last bonus order, and the last chronicle entry they have seen.
CREATE TABLE campaign_member (
  season INTEGER NOT NULL REFERENCES campaign_season (season) ON DELETE CASCADE,
  account TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  side TEXT,
  pledged INTEGER NOT NULL DEFAULT 0 CHECK (pledged IN (0, 1)),
  orders INTEGER NOT NULL DEFAULT 3,
  orders_day INTEGER NOT NULL DEFAULT 0,
  bonus_day TEXT,
  seen INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (season, account)
);

-- The campaign's chronicle: every order a member gave, every attack a regent made, and the season's start and end.
-- `data` is JSON (the dice of a battle, with their seed); `cry` is the member's battle cry, at most 80 characters.
CREATE TABLE campaign_log (
  id INTEGER PRIMARY KEY,
  season INTEGER NOT NULL REFERENCES campaign_season (season) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  side TEXT,
  account TEXT,
  name TEXT,
  province INTEGER,
  took INTEGER NOT NULL DEFAULT 0 CHECK (took IN (0, 1)),
  data TEXT,
  cry TEXT
);
CREATE INDEX campaign_log_season ON campaign_log (season, id);

-- At most one campaign push a day for each member: the row is the claim.
CREATE TABLE campaign_push (
  account TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (account, day)
);
