-- Several AI providers per family, and a route for each job (src/lib/ai/providers.server.ts).
--
-- ai_provider  one connection per provider: the steward's key for Anthropic, OpenAI or OpenRouter, sealed as before
--              (secret.server.ts) and shown only by its last four characters. A key is used only for its own provider.
-- ai_route     which provider and model a job uses. A NULL provider means "same as the assistant" (the assistant's provider
--              and model, which is the default for every job but painting). The assistant's own row always names a provider.
--
-- This migration moves the old single-key settings into that shape and keeps everything else:
--   * the family's key (ai_settings) becomes the connection of its provider, and its model becomes the assistant's route;
--   * the portrait's own key (ai_portrait, when not reused from the family) becomes the OpenRouter connection, unless the
--     family already has an OpenRouter connection. Then that second OpenRouter key is deleted: one connection holds one
--     key, nothing reads ai_portrait.key_sealed any more, and a sealed key nobody uses must not linger. The portrait then
--     paints with the family's OpenRouter connection;
--   * the portrait's model becomes the portrait's route (OpenRouter, the only provider that paints);
--   * the switches (ai_settings.features, ai_portrait.enabled, ai_background_task.enabled), the monthly budget, the web-search
--     switch, the custom prices and every spend row are untouched.
-- The key columns the new code no longer reads are cleared, so a key sits in one place and only where it is used.
-- Written to run on SQLite and on D1: no PRAGMA, no BEGIN, defaults on new NOT NULL columns.

CREATE TABLE IF NOT EXISTS ai_provider (
  tree TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai', 'openrouter')),
  key_sealed TEXT NOT NULL,
  key_tail TEXT NOT NULL,
  updated INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tree, provider)
);

CREATE TABLE IF NOT EXISTS ai_route (
  tree TEXT NOT NULL,
  route TEXT NOT NULL CHECK (route IN ('assistant', 'arms', 'faces', 'avatar', 'portrait', 'arms-review', 'occupations', 'chronicle')),
  provider TEXT CHECK (provider IS NULL OR provider IN ('anthropic', 'openai', 'openrouter')),
  model TEXT NOT NULL DEFAULT '',
  updated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tree, route),
  CHECK (route <> 'assistant' OR provider IS NOT NULL),
  CHECK (route <> 'portrait' OR provider IS NULL OR provider = 'openrouter')
);

-- 1. The family's key is its provider's connection. The sealed text moves as it is.
INSERT INTO ai_provider (tree, provider, key_sealed, key_tail, updated, updated_by)
SELECT tree, provider, key_sealed, COALESCE(key_tail, ''), updated, COALESCE(updated_by, '')
FROM ai_settings
WHERE key_sealed IS NOT NULL AND key_sealed <> '';

-- 2. The portrait's own key is OpenRouter's connection, when the family has none yet.
INSERT INTO ai_provider (tree, provider, key_sealed, key_tail, updated, updated_by)
SELECT p.tree, 'openrouter', p.key_sealed, COALESCE(p.key_tail, ''), p.updated, COALESCE(p.updated_by, '')
FROM ai_portrait p
WHERE p.reuse_family_key = 0 AND p.key_sealed IS NOT NULL AND p.key_sealed <> ''
  AND NOT EXISTS (SELECT 1 FROM ai_provider a WHERE a.tree = p.tree AND a.provider = 'openrouter');

-- 3. The routes: the assistant's provider and model, and the portrait's model on OpenRouter. Every other job has no row,
--    so it follows the assistant, as it did before this migration.
INSERT INTO ai_route (tree, route, provider, model, updated)
SELECT tree, 'assistant', provider, COALESCE(model, ''), updated FROM ai_settings;

INSERT INTO ai_route (tree, route, provider, model, updated)
SELECT tree, 'portrait', 'openrouter', COALESCE(model, ''), updated FROM ai_portrait;

-- 4. Clear the key columns nothing reads any more. Every portrait key either moved (see 2) or was a second OpenRouter key
--    that no connection can hold, so none is left behind.
UPDATE ai_settings SET key_sealed = NULL, key_tail = NULL WHERE key_sealed IS NOT NULL OR key_tail IS NOT NULL;

UPDATE ai_portrait SET key_sealed = NULL, key_tail = NULL WHERE key_sealed IS NOT NULL OR key_tail IS NOT NULL;
