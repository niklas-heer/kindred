-- The Campaign's counted reign is fixed when it begins (docs/campaign.md, "One reign a day counts"): the first reign a
-- member begins on a day (UTC) is that day's counted one, whatever is begun or finished afterwards. Until now that was
-- worked out from the reigns ("the first finished of the day"), so a member could begin several and finish the luckiest.
-- Plain SQL, as every migration here: D1 and node:sqlite run it.

-- `counts_for` is the day ("2026-11-12") a reign is the counted one of, or NULL for an extra reign. `progress` (JSON) is
-- the moves the browser has reported while the reign is played, so the reign can be continued in another tab or on
-- another device, and a finish has to go on from them.
ALTER TABLE campaign_run ADD COLUMN counts_for TEXT;
ALTER TABLE campaign_run ADD COLUMN progress TEXT;

-- The reigns already finished keep what they were: of the reigns a member began on a day, the first finished counted.
-- A day with only unfinished reigns has no counted reign yet, so the next one begun that day is.
UPDATE campaign_run SET counts_for = substr(created_at, 1, 10)
WHERE finished_at IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM campaign_run o WHERE o.account = campaign_run.account AND o.ruleset = campaign_run.ruleset
    AND o.finished_at IS NOT NULL AND substr(o.created_at, 1, 10) = substr(campaign_run.created_at, 1, 10)
    AND (o.finished_at < campaign_run.finished_at OR (o.finished_at = campaign_run.finished_at AND o.id < campaign_run.id))
);

-- One counted reign a day for each member under one ruleset, whatever begins at the same moment.
CREATE UNIQUE INDEX campaign_run_counted ON campaign_run (account, ruleset, counts_for) WHERE counts_for IS NOT NULL;
