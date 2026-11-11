-- Reactions become emoji, and reactions and comments take a fourth kind of target (docs/responses.md, docs/feed.md).
--
-- `reaction.kind` was one of five names; it is now the emoji itself, one RGI emoji grapheme (the server checks it). The
-- five names become the emoji closest to what they meant: heart ❤️, laugh 😂, candle 🕯️, thanks 🙏, and "I remember this"
-- the thought balloon 💭 (a memory coming back, which no face in the quick row says).
--
-- `target_kind` 'event' is an entry of the feed drawn from the change history ("Ada updated Carl's details", people
-- added, a birthday today). It names no row of a table, so no trigger takes its answers away: the feed reads them by key.
--
-- SQLite cannot change a CHECK, so both tables are made again with their rows, as in 0029. The triggers that name them go
-- first and come back after.
DROP TRIGGER story_responses_go;
DROP TRIGGER media_responses_go;
DROP TRIGGER post_responses_go;

CREATE TABLE reaction_next (
  target_kind TEXT NOT NULL CHECK (target_kind IN ('story', 'media', 'post', 'event')),
  target TEXT NOT NULL,
  account TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (target_kind, target, account, kind)
);
INSERT INTO reaction_next (target_kind, target, account, kind, created_at)
  SELECT target_kind, target, account,
    CASE kind
      WHEN 'heart' THEN '❤️'
      WHEN 'laugh' THEN '😂'
      WHEN 'candle' THEN '🕯️'
      WHEN 'thanks' THEN '🙏'
      WHEN 'remember' THEN '💭'
      ELSE kind
    END,
    created_at
  FROM reaction;
DROP TABLE reaction;
ALTER TABLE reaction_next RENAME TO reaction;
CREATE INDEX reaction_created ON reaction (created_at);
-- A member's most recent emoji, for the palette's "Recently used".
CREATE INDEX reaction_account ON reaction (account, created_at);

CREATE TABLE comment_next (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('story', 'media', 'post', 'event')),
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
