-- "Who is this?" (docs/who-is-this.md): members name the people in untagged gallery pictures, as a small game. A name a member
-- gives is a proposal, not a tag: it becomes one (a confirmed row of `media_person`) only when someone who may tag pictures
-- agrees. Plain SQL, as every migration here: D1 and node:sqlite run it.

-- The name of the member whose proposal a tag came from, as it was shown then ("Named by Ada"). NULL for a tag made in the gallery.
ALTER TABLE media_person ADD COLUMN named_by TEXT;

-- A member's proposal: `person` is in picture `media`, at the box they tapped (all four NULL when they tapped no face).
-- `account` and `name` are the member and their name then. `status` is `open` until someone who may tag pictures confirms
-- it (`confirmed`) or says it is not right (`declined`); `decided_by` is that account. One proposal per member, picture and person.
CREATE TABLE tag_proposal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media TEXT NOT NULL REFERENCES media (key) ON DELETE CASCADE,
  person TEXT NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  account TEXT NOT NULL,
  name TEXT NOT NULL,
  x REAL CHECK (x IS NULL OR (x >= 0 AND x <= 1)),
  y REAL CHECK (y IS NULL OR (y >= 0 AND y <= 1)),
  w REAL CHECK (w IS NULL OR (w > 0 AND w <= 1)),
  h REAL CHECK (h IS NULL OR (h > 0 AND h <= 1)),
  at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'declined')),
  decided_by TEXT,
  decided_at TEXT,
  UNIQUE (media, person, account)
);
CREATE INDEX tag_proposal_open ON tag_proposal (status, media);
CREATE INDEX tag_proposal_account ON tag_proposal (account, at);

-- A picture a member passed on: `unknown` ("I don't know", not asked again) or `skip` (asked again after the others).
CREATE TABLE tag_pass (
  media TEXT NOT NULL REFERENCES media (key) ON DELETE CASCADE,
  account TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('unknown', 'skip')),
  at TEXT NOT NULL,
  PRIMARY KEY (media, account)
);
