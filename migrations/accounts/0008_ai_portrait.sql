-- Painted portraits have their own switch and provider, apart from the assistant's features and budget: off until a
-- steward turns it on. The key is OpenRouter's (image models are listed there), sealed like the family key. A family
-- whose own provider is already OpenRouter may reuse that saved key instead (reuse_family_key = 1), so it is kept once.
-- Portrait spend is booked against the family's monthly budget (ai_spend), like every other AI call.
-- Written to run on SQLite and on D1: no PRAGMA, no BEGIN, defaults on new NOT NULL columns.

CREATE TABLE IF NOT EXISTS ai_portrait (
  tree TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  model TEXT NOT NULL DEFAULT '',
  reuse_family_key INTEGER NOT NULL DEFAULT 0 CHECK (reuse_family_key IN (0, 1)),
  key_sealed TEXT,
  key_tail TEXT,
  updated INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT
);
