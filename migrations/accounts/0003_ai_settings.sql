-- AI settings and the assistant's conversations, in the accounts database (not in a family's tree, so a
-- family's key and a person's chats never travel with the family's data).
--
-- One settings row per family. The API key is stored sealed (AES-GCM with KINDRED_SECRET, src/lib/ai/secret.server.ts),
-- never in clear; `key_tail` keeps only its last four characters, for "…abcd". `features` is JSON:
-- {"assistant","faces","avatar","arms"}. `daily_tokens` is the family's budget per UTC day (0 turns AI off).
CREATE TABLE IF NOT EXISTS ai_settings (
  tree TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'anthropic' CHECK (provider IN ('anthropic', 'openai', 'openrouter')),
  model TEXT NOT NULL DEFAULT '',
  key_sealed TEXT,
  key_tail TEXT,
  features TEXT NOT NULL DEFAULT '{"assistant":false,"faces":false,"avatar":false,"arms":false}',
  daily_tokens INTEGER NOT NULL DEFAULT 300000 CHECK (daily_tokens >= 0),
  updated INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT REFERENCES user(id) ON DELETE SET NULL
);

-- Tokens spent per family per UTC day, for the budget.
CREATE TABLE IF NOT EXISTS ai_usage (
  tree TEXT NOT NULL,
  day TEXT NOT NULL,                 -- YYYY-MM-DD (UTC)
  tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tree, day)
);

-- Which conversation a reader is in, per family. "New conversation" moves it.
CREATE TABLE IF NOT EXISTS ai_conversation (
  tree TEXT NOT NULL,
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  conv TEXT NOT NULL,
  started INTEGER NOT NULL,
  PRIMARY KEY (tree, user)
);

-- One row per message. `body` is JSON: the text, and for an assistant reply its proposals (with their status).
CREATE TABLE IF NOT EXISTS ai_chat (
  id TEXT PRIMARY KEY,
  tree TEXT NOT NULL,
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  conv TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  body TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_chat_by_conv ON ai_chat (tree, user, conv, at);
