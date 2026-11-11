-- The Campaign's week (docs/campaign.md): the field every reign of a week is played on, kept on its own, so that removing a
-- member (whose reigns go) or two first reigns begun at once can never change it mid-week. Not part of the family's
-- records: left out of GEDCOM, the Markdown archive and the D1 transfer (scripts/lib/d1-transfer.ts).
-- Plain SQL, as every migration here: D1 and node:sqlite run it.

-- `week` is the ISO week ("2026-W46"); `field` (JSON) is the map with its terrain, the four sides and the opening, as the
-- week's first reign found them; `created_at` is when that was.
CREATE TABLE campaign_week (
  week TEXT PRIMARY KEY,
  field TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- The weeks already played keep the field of their first reign, without that player's own renown and quiz reward.
INSERT INTO campaign_week (week, field, created_at)
SELECT r.week, json_remove(r.field, '$.renown', '$.grant'), r.created_at FROM campaign_run r
WHERE NOT EXISTS (
  SELECT 1 FROM campaign_run o WHERE o.week = r.week AND (o.created_at < r.created_at OR (o.created_at = r.created_at AND o.id < r.id))
);
