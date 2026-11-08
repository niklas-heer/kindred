-- What stewards decided after the arms check (src/lib/house-meaning.server.ts): a JSON list, oldest first, of what the check
-- advised and whether the steward chose a suggestion or kept the arms. A later check reads it so it cannot repeat itself, and
-- the card reads the last entry to say the arms were the steward's choice. Plain SQL, so D1 and node:sqlite both run it.

ALTER TABLE house_arms_review ADD COLUMN history TEXT NOT NULL DEFAULT '[]';
