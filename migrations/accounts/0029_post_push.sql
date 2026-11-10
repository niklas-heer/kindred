-- A device's choice to be told about a new post in the family's feed (docs/feed.md), beside its other reminder choices:
-- off until its owner turns it on. `posts_sent_at` is when this device was last told (milliseconds), which is the claim
-- that keeps it to one push in a few hours however many posts arrive. Plain SQL: D1 and node:sqlite both run it.
ALTER TABLE push_subscription ADD COLUMN posts INTEGER NOT NULL DEFAULT 0 CHECK (posts IN (0, 1));
ALTER TABLE push_subscription ADD COLUMN posts_sent_at INTEGER;
