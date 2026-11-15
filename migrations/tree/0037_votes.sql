-- Family votes: a question the family decides together.
--
-- `vote` is the question and its rules: `single` (one choice) or `ranked` (an order of the options), `secret` (nobody reads
-- who chose what, and a ballot keeps no time), `add_options` (members may propose more options) and `guests` (a share-link
-- guest may take part). It closes at `closes_at`, or earlier by hand (`closed_at`). `subject_kind` and `subject` may tie it
-- to a thing in the tree. `vote_option` lists the options in order; `vote_voter` is whoever takes part, a member by `account`
-- or a guest by `guest_key`, with the name shown then; `struck` takes a voter's ballot out of the count.
--
-- `ballot` is one row per voter and vote, a JSON list of option ids in the voter's order. It has no rowid and, for a secret
-- vote, no time (`changed_at` stays NULL), so the table's own order and storage carry nothing about who voted when.
-- `vote_reminded` is the claim that keeps the reminder push to one for each member and vote.
CREATE TABLE vote (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_person TEXT,
  question TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('single', 'ranked')),
  secret INTEGER NOT NULL DEFAULT 0,
  add_options INTEGER NOT NULL DEFAULT 0,
  guests INTEGER NOT NULL DEFAULT 0,
  closes_at TEXT NOT NULL,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  edited_at TEXT,
  subject_kind TEXT,
  subject TEXT
);
CREATE INDEX vote_closes ON vote (closes_at);

CREATE TABLE vote_option (
  id TEXT PRIMARY KEY,
  vote TEXT NOT NULL REFERENCES vote (id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  label TEXT NOT NULL,
  added_by_account TEXT NOT NULL,
  added_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX vote_option_vote ON vote_option (vote, ord);

CREATE TABLE vote_voter (
  id TEXT PRIMARY KEY,
  vote TEXT NOT NULL REFERENCES vote (id) ON DELETE CASCADE,
  account TEXT,
  guest_key TEXT,
  name TEXT NOT NULL,
  person TEXT,
  link TEXT,
  net INTEGER,
  struck INTEGER NOT NULL DEFAULT 0,
  UNIQUE (vote, account),
  UNIQUE (vote, guest_key)
);

CREATE TABLE ballot (
  vote TEXT NOT NULL REFERENCES vote (id) ON DELETE CASCADE,
  voter TEXT NOT NULL,
  choices TEXT NOT NULL,
  changed_at TEXT,
  PRIMARY KEY (vote, voter)
) WITHOUT ROWID;

CREATE TABLE vote_reminded (
  vote TEXT NOT NULL,
  account TEXT NOT NULL,
  PRIMARY KEY (vote, account)
);

-- Reactions and comments take a fifth kind of target, as in 0030: both tables are made again with their rows, and the
-- triggers that name them go first and come back after.
DROP TRIGGER story_responses_go;
DROP TRIGGER media_responses_go;
DROP TRIGGER post_responses_go;

CREATE TABLE reaction_next (
  target_kind TEXT NOT NULL CHECK (target_kind IN ('story', 'media', 'post', 'event', 'vote')),
  target TEXT NOT NULL,
  account TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (target_kind, target, account, kind)
);
INSERT INTO reaction_next (target_kind, target, account, kind, created_at) SELECT target_kind, target, account, kind, created_at FROM reaction;
DROP TABLE reaction;
ALTER TABLE reaction_next RENAME TO reaction;
CREATE INDEX reaction_created ON reaction (created_at);
CREATE INDEX reaction_account ON reaction (account, created_at);

CREATE TABLE comment_next (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('story', 'media', 'post', 'event', 'vote')),
  target TEXT NOT NULL,
  account TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL,
  edited_at TEXT
);
INSERT INTO comment_next (id, target_kind, target, account, author_name, body, created_at, edited_at) SELECT id, target_kind, target, account, author_name, body, created_at, edited_at FROM comment;
DROP TABLE comment;
ALTER TABLE comment_next RENAME TO comment;
CREATE INDEX comment_target ON comment (target_kind, target, created_at);
CREATE INDEX comment_created ON comment (created_at);

CREATE TRIGGER story_responses_go AFTER DELETE ON story
BEGIN
  DELETE FROM reaction WHERE target_kind = 'story' AND target = OLD.id;
  DELETE FROM comment WHERE target_kind = 'story' AND target = OLD.id;
END;

CREATE TRIGGER media_responses_go AFTER DELETE ON media
BEGIN
  DELETE FROM reaction WHERE target_kind = 'media' AND target = OLD.key;
  DELETE FROM comment WHERE target_kind = 'media' AND target = OLD.key;
END;

CREATE TRIGGER post_responses_go AFTER DELETE ON post
BEGIN
  DELETE FROM reaction WHERE target_kind = 'post' AND target = OLD.id;
  DELETE FROM comment WHERE target_kind = 'post' AND target = OLD.id;
END;

CREATE TRIGGER vote_responses_go AFTER DELETE ON vote
BEGIN
  DELETE FROM reaction WHERE target_kind = 'vote' AND target = OLD.id;
  DELETE FROM comment WHERE target_kind = 'vote' AND target = OLD.id;
END;
