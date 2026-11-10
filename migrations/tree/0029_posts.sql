-- Posts: a member's short message to the family, shown on the Today page's feed (docs/feed.md). Members only. A post is
-- the family talking, not a record about an ancestor: it is not in the change history. Members are named by their account
-- id; a post keeps the name it was written under, and the person its writer stood for then, so it outlives the account.
-- Plain SQL, as every migration here: D1 and node:sqlite both run it.

-- `body` is plain text with its line breaks (at most 4,000 characters; empty when the post is only pictures).
-- `author_person` is who the writer was in the tree when they wrote it: the face beside the post once they have left.
CREATE TABLE post (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  author_person TEXT REFERENCES person (id) ON DELETE SET NULL,
  body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
  created_at TEXT NOT NULL,
  edited_at TEXT
);
CREATE INDEX post_created ON post (created_at, id);
CREATE INDEX post_account ON post (account);

-- A post's pictures, in their order. Each is an ordinary gallery picture (a `media` row, uploaded through the gallery's
-- own code), so it has a thumbnail, can be tagged, and is in the Gallery under "From the feed". A picture belongs to at
-- most one post.
CREATE TABLE post_media (
  post TEXT NOT NULL REFERENCES post (id) ON DELETE CASCADE,
  media TEXT NOT NULL UNIQUE REFERENCES media (key) ON DELETE CASCADE,
  ord INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post, media)
);

-- The people from the tree a post is about: it also shows on their page.
CREATE TABLE post_person (
  post TEXT NOT NULL REFERENCES post (id) ON DELETE CASCADE,
  person TEXT NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  PRIMARY KEY (post, person)
);
CREATE INDEX post_person_person ON post_person (person);

-- The feed reads the newest uploads first.
CREATE INDEX media_uploaded ON media (uploaded_at);

-- Reactions and comments (migration 0027) take a third kind of target: 'post' (post.id). SQLite cannot change a CHECK, so
-- both tables are made again with their rows. The triggers that name them go first and come back after, with one for posts.
DROP TRIGGER story_responses_go;
DROP TRIGGER media_responses_go;

CREATE TABLE reaction_next (
  target_kind TEXT NOT NULL CHECK (target_kind IN ('story', 'media', 'post')),
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

CREATE TABLE comment_next (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('story', 'media', 'post')),
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
