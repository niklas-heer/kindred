-- What stewards report about Kindred itself: a text, its type and status, what was attached automatically (`context`, JSON),
-- and the key of the screen's picture in the family's media storage (`picture`, feedback/<uuid>.jpg, null when left out).
-- Kept in this installation only; nothing is sent anywhere else. `user` is a plain id and `user_name` the name at the time,
-- so a report outlives the account. Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  tree TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bug', 'idea', 'confusing')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in-progress', 'resolved')),
  body TEXT NOT NULL,
  context TEXT NOT NULL,
  picture TEXT,
  user TEXT NOT NULL,
  user_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX feedback_by_tree ON feedback(tree, created_at DESC);
