-- Recipes as a structured kind (docs/recipes.md). A recipe is still a story of kind 'recipe': it is in the Chronicle and the
-- feed, takes reactions and comments, is in the change history and goes with its person, all as stories do. This table adds
-- what makes it a recipe. A story of kind 'recipe' with no row here is a recipe from before: free text, shown as written.
-- Plain SQL, as every migration here: D1 and node:sqlite both run it. It changes no existing table.

-- `story.title` is the recipe's name, `story.person` whose recipe it is, and `story.body` the whole recipe written out as
-- Markdown (made again on every save), so everything that reads stories reads a recipe too. `source` is the words for where
-- it comes from ("Grandma's"). `ingredients` is JSON: [{ "name": "For the dumplings", "items": [{ "amount": "1 1/2",
-- "unit": "cups", "item": "flour", "note": "sifted" }] }]; a group without a name is the list's plain start. `steps` is
-- JSON: [{ "text": "...", "image": "recipe/<uuid>.jpg" or null }]. `notes` is the tips or the story, in Markdown. `tags`
-- is a JSON list of words. `cover` is the key of its picture in `recipe_image`.
CREATE TABLE recipe (
  story TEXT PRIMARY KEY REFERENCES story (id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT '' CHECK (length(source) <= 80),
  servings INTEGER CHECK (servings IS NULL OR servings BETWEEN 1 AND 999),
  prep_minutes INTEGER CHECK (prep_minutes IS NULL OR prep_minutes BETWEEN 0 AND 10080),
  cook_minutes INTEGER CHECK (cook_minutes IS NULL OR cook_minutes BETWEEN 0 AND 10080),
  ingredients TEXT NOT NULL DEFAULT '[]',
  steps TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 8000),
  tags TEXT NOT NULL DEFAULT '[]',
  cover TEXT,
  updated_at TEXT
);

-- A recipe's pictures: its cover and the pictures of its steps. They are in media storage under recipe/ (the cover's
-- small copy under recipe-thumb/), and never in the gallery: `media` has no row for them. `story` has no foreign key, so
-- a row outlives its story for as long as the removal can be undone: the trigger below marks it `gone_at`, nobody is
-- served it meanwhile, a restored recipe takes its pictures back, and the daily job deletes what stayed gone for 31 days.
CREATE TABLE recipe_image (
  key TEXT PRIMARY KEY,
  story TEXT NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  thumb TEXT,
  created_at TEXT NOT NULL,
  gone_at TEXT
);
CREATE INDEX recipe_image_story ON recipe_image (story);
CREATE INDEX recipe_image_gone ON recipe_image (gone_at);

-- A story that goes (removed, or with its person) leaves its recipe's pictures marked, not deleted.
CREATE TRIGGER recipe_images_go AFTER DELETE ON story
BEGIN
  UPDATE recipe_image SET gone_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE story = OLD.id AND gone_at IS NULL;
END;
