-- A device's choice to hear about family votes (docs/votes.md, docs/feed.md), beside its other reminder choices: off until
-- its owner turns it on. With it on, the device is told when a vote starts and, about a day before a vote closes, reminded
-- when its owner has not voted. `votes_sent_at` is when this device was last told of a new vote (milliseconds), which is the
-- claim that keeps it to one such push in a few hours however many votes start; a reminder's claim is the family's
-- `vote_reminded` row. Plain SQL: D1 and node:sqlite both run it.
ALTER TABLE push_subscription ADD COLUMN votes INTEGER NOT NULL DEFAULT 0 CHECK (votes IN (0, 1));
ALTER TABLE push_subscription ADD COLUMN votes_sent_at INTEGER;
