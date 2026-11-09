-- The assistant's chats as a reader sees them: one row per chat, per reader, per family. Messages stay in ai_chat under
-- their `conv`; this row holds what belongs to the chat as a whole. `title` is only a name the reader chose (a chat is
-- otherwise named from its first readable message when listed, so a title never outlives the reader's right to read it),
-- and `title_tier` is the tier that name needs. `provider` and `model` are a steward's choice for this chat; both NULL
-- means the family's own assistant route. Every chat that already has messages gets a row, dated from those messages.
CREATE TABLE IF NOT EXISTS ai_thread (
  tree TEXT NOT NULL,
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  conv TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  title_tier TEXT NOT NULL DEFAULT 'member' CHECK (title_tier IN ('member', 'editor')),
  provider TEXT,
  model TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (tree, user, conv)
);
CREATE INDEX IF NOT EXISTS ai_thread_by_reader ON ai_thread (tree, user, updated);

INSERT OR IGNORE INTO ai_thread (tree, user, conv, created, updated)
  SELECT tree, user, conv, MIN(at), MAX(at) FROM ai_chat GROUP BY tree, user, conv;
