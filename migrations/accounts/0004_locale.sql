-- The language a reader chose while signed in. NULL means "not chosen yet": the server then uses the
-- guest cookie or Accept-Language, as before. Only the three locales the app ships are allowed.
ALTER TABLE user ADD COLUMN locale TEXT CHECK (locale IS NULL OR locale IN ('en', 'de', 'af'));
