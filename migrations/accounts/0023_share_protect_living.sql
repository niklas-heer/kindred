-- Whether a family share link protects living people: a guest then gets their name, their place in the tree and their
-- picture, and none of their dates, places, details, stories, research or photo tags (src/lib/protect-living.ts).
-- 0 for links made before this column existed, so nothing changes under a guest who already has one; the application turns
-- it on for every link it makes from now on unless the steward unticks it (src/lib/auth/share.server.ts, makeShareLink).
-- Plain SQL, so D1 and node:sqlite both run it.
ALTER TABLE share_link ADD COLUMN protect_living INTEGER NOT NULL DEFAULT 0 CHECK (protect_living IN (0, 1));
