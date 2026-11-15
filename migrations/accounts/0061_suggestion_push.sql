-- A device's choice to hear that suggestions are waiting for review (docs/suggestions.md), beside its other reminder choices:
-- off until its owner turns it on, and only offered to members whose role may review suggestions. `suggestions_sent_at` is
-- when this device was last told (milliseconds), which is the claim that keeps it to one such push in a few hours however
-- many suggestions arrive. Plain SQL: D1 and node:sqlite both run it.
ALTER TABLE push_subscription ADD COLUMN suggestions INTEGER NOT NULL DEFAULT 0 CHECK (suggestions IN (0, 1));
ALTER TABLE push_subscription ADD COLUMN suggestions_sent_at INTEGER;
