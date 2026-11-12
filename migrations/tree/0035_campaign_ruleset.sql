-- The Campaign's rules have a version (docs/campaign.md, "Rulesets"): the map made from the family's places was 1, the
-- invented continent with its rivers, ridges and sea lanes is 2. A reign and a week's field say which rules they were
-- laid out for, so the tables compare a score only with scores under the same rules, and the reigns of earlier rules
-- stay to be shown apart. Everything stored before this migration was played under the first rules.
-- Plain SQL, as every migration here: D1 and node:sqlite run it.

ALTER TABLE campaign_run ADD COLUMN ruleset INTEGER NOT NULL DEFAULT 1;
ALTER TABLE campaign_week ADD COLUMN ruleset INTEGER NOT NULL DEFAULT 1;
CREATE INDEX campaign_run_ruleset ON campaign_run (ruleset, week, score);
