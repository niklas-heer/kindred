-- Occupations from the fixed vocabulary (src/lib/occupations.ts). `person.occupation` keeps the text the family
-- typed, unchanged. `occupation_code` is the vocabulary id that text names, or the entry the editor chose; NULL
-- when the text names none. Old rows stay NULL until scripts/map-occupations.ts runs.
ALTER TABLE person ADD COLUMN occupation_code TEXT;

-- AI translations of a free-text occupation, cached per text and locale so each is asked for once. The label is
-- what the reader sees; the text itself is never changed by a translation.
CREATE TABLE IF NOT EXISTS occupation_translation (
  text TEXT NOT NULL,
  locale TEXT NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (text, locale)
);
