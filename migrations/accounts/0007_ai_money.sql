-- The AI budget is money, not tokens: cost depends on the model, so a token count says little.
--
-- ai_settings gains the monthly budget in micro-dollars (1 USD = 1,000,000), the web-search switch, and the family's
-- own prices for models Kindred has no price for (JSON: { "<model id>": { "inPerM": USD, "outPerM": USD } }, USD per
-- 1M tokens). `daily_tokens` is no longer read; it stays so the table keeps its shape. Existing rows keep working:
-- the default budget is $5 a month, and a family whose token budget was 0 (AI off) stays off.
--
-- Spend is booked per family per UTC month in ai_spend, the same way ai_usage booked tokens per day (see
-- src/lib/ai/settings.server.ts). Written to run on SQLite and on D1: no PRAGMA, no BEGIN, defaults on new NOT NULL columns.
ALTER TABLE ai_settings ADD COLUMN monthly_micros INTEGER NOT NULL DEFAULT 5000000 CHECK (monthly_micros >= 0);
ALTER TABLE ai_settings ADD COLUMN web_search INTEGER NOT NULL DEFAULT 0 CHECK (web_search IN (0, 1));
ALTER TABLE ai_settings ADD COLUMN custom_prices TEXT NOT NULL DEFAULT '{}';

UPDATE ai_settings SET monthly_micros = 0 WHERE daily_tokens = 0;

-- Micro-dollars spent per family per UTC month, for the monthly budget.
CREATE TABLE IF NOT EXISTS ai_spend (
  tree TEXT NOT NULL,
  month TEXT NOT NULL,               -- YYYY-MM (UTC)
  micros INTEGER NOT NULL DEFAULT 0 CHECK (micros >= 0),
  PRIMARY KEY (tree, month)
);
