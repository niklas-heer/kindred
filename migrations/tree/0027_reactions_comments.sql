-- Reactions and comments on a memory (a `story`) or a gallery photo (a `media` row), for members only (docs/responses.md).
-- `target_kind` says which table `target` names: 'story' (story.id) or 'media' (media.key). A target is one of two
-- tables, so there is no foreign key; triggers take a story's or a picture's reactions and comments away with it,
-- whichever way it goes (removed on its own, or with its person). Members are named by their account id; a comment
-- keeps the name shown when it was written, so it outlives the account. Plain SQL: D1 and node:sqlite both run it.

-- One row per account, target and kind of reaction: giving the same reaction twice is the same row.
CREATE TABLE reaction (
  target_kind TEXT NOT NULL CHECK (target_kind IN ('story', 'media')),
  target TEXT NOT NULL,
  account TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (target_kind, target, account, kind)
);
CREATE INDEX reaction_created ON reaction (created_at);

-- A comment: plain text with its line breaks, at most 1,000 characters. `edited_at` is set when its author changes it.
CREATE TABLE comment (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('story', 'media')),
  target TEXT NOT NULL,
  account TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL,
  edited_at TEXT
);
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

-- The opt-in push to an author: one row per account that chose it, and the UTC day (YYYY-MM-DD) of its last push, which
-- is the claim that keeps it to one a day.
CREATE TABLE response_push (
  account TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  last_day TEXT
);

-- Who wrote a story, as an account: the author of a memory is told about its reactions and comments. `author` stays the
-- name shown. NULL for stories written before this migration, by the assistant, or brought in by an import.
ALTER TABLE story ADD COLUMN author_account TEXT;
