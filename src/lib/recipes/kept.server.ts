// What a removed recipe leaves behind for Undo (story.server.ts): its row in `recipe` (tree migration 0031), kept with the
// removal, and the writes that put it back. Its pictures are not kept here: the trigger of migration 0031 only marks them
// when the story goes, and the restore unmarks them. Storage only, so story.server.ts stays light.
import { q, type Db, type Query } from '../db.server.ts';

/** A recipe's row as a removal keeps it, so Undo puts back exactly what was there. */
export interface KeptRecipe {
  source: string; servings: number | null; prep_minutes: number | null; cook_minutes: number | null; ingredients: string; steps: string; notes: string; tags: string;
  cover: string | null; updated_at: string | null;
}

/** The row to keep with a story's removal, or null for a story that has none. */
export const keptRecipe = (d: Db, story: string) =>
  d.get<KeptRecipe>('SELECT source, servings, prep_minutes, cook_minutes, ingredients, steps, notes, tags, cover, updated_at FROM recipe WHERE story = ?', story).then((r) => r ?? null);

/** The writes that put a removed recipe's row back, and unmark its pictures that are still kept. */
export const restoreRecipeWrites = (story: string, r: KeptRecipe): Query[] => [
  q('INSERT OR IGNORE INTO recipe (story, source, servings, prep_minutes, cook_minutes, ingredients, steps, notes, tags, cover, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    story, r.source, r.servings, r.prep_minutes, r.cook_minutes, r.ingredients, r.steps, r.notes, r.tags, r.cover, r.updated_at),
  q('UPDATE recipe_image SET gone_at = NULL WHERE story = ?', story),
];
