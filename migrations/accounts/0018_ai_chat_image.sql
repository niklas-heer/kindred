-- A picture a reader chose to keep with a message in their assistant chat. Pictures are not stored unless the reader asks.
-- One row per picture, so a conversation's text loads without them. A row goes with its chat message and its user, and
-- it is read only through the same check as the message it belongs to (src/lib/ai/chat.server.ts). `data` is base64.
CREATE TABLE IF NOT EXISTS ai_chat_image (
  id TEXT PRIMARY KEY,
  item TEXT NOT NULL REFERENCES ai_chat(id) ON DELETE CASCADE,
  tree TEXT NOT NULL,
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_chat_image_by_item ON ai_chat_image (item);
