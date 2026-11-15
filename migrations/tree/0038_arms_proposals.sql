-- Arms proposals: a member proposes new arms for a house, and the family settles it (a steward decides, or a vote does).
--
-- `arms_proposal` is one proposal: who wrote it (`account`, with the `author_name` and `author_person` shown then, so it
-- outlives the membership), its `name` and `note`, the `arms` as JSON (the house's stored shape, normalised) and its
-- `status`. `reason` is a decline text, `not_chosen`, or `vote_removed`; `decided_by` and `decided_by_name` are the
-- steward who decided (NULL for a vote) and `decided_at` is when. A proposal goes with its house.
--
-- An arms vote is an ordinary `vote` whose options may point at a proposal: `vote_option.proposal` names it, and `arms`
-- is the snapshot of the current arms on the one "keep" option (the option with no proposal). `vote.settled_at` stays NULL
-- until the settlement ran, so the vote can be closed and settled as two guarded steps.
CREATE TABLE arms_proposal (
  id TEXT PRIMARY KEY,
  house TEXT NOT NULL REFERENCES house (id) ON DELETE CASCADE,
  account TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_person TEXT,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  arms TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'voting', 'accepted', 'declined', 'withdrawn')),
  reason TEXT,
  decided_by TEXT,
  decided_by_name TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX arms_proposal_house ON arms_proposal (house, status);

ALTER TABLE vote_option ADD COLUMN proposal TEXT;
ALTER TABLE vote_option ADD COLUMN arms TEXT;
ALTER TABLE vote ADD COLUMN settled_at TEXT;
