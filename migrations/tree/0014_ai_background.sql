-- Chronicle translations (src/lib/ai/background-tasks.server.ts): a background AI translation of a story, kept beside
-- the original. The story row is never changed. A translation is shown only while source_hash still matches the story
-- (a story edited since is shown in its original text until the next run translates it again). Plain SQL, so D1 and
-- node:sqlite both run it.
--
-- `same` is 1 when the story was already written in this language: nothing is shown, and the story is not asked again
-- until it changes. Pruned with the story (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS story_translation (
  story TEXT NOT NULL REFERENCES story(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,                                 -- en, de or af
  source_hash TEXT NOT NULL,                            -- hash of the story's title and body when translated
  title TEXT,                                           -- the translated title; NULL when the story has none
  body TEXT NOT NULL,                                   -- the translated body (Markdown, as the original is)
  same INTEGER NOT NULL DEFAULT 0 CHECK (same IN (0, 1)),
  translated_at TEXT NOT NULL,
  PRIMARY KEY (story, locale)
);
