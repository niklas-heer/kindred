// Taking a story away, and putting it back. A removed story is kept in the retry key's row (the `op` table, see
// db.server.ts `once`), so Undo restores exactly what was there, with its writer and its date, from the server's own
// copy. The browser never sends a story's author: it only names the removal it wants undone. The story's reactions and
// comments (migration 0027) go with it and do not come back. Its tag as an answer to the question of the week
// (`today_answer`, migration 0028) is kept with the story and comes back with it. So is what makes it a recipe (`recipe`,
// migration 0031): its row is kept here, and its pictures are only marked when the story goes, so both come back.
import { added, db, guard, once, personExists, q, removed, type OpKey } from './db.server.ts';
import { keptRecipe, restoreRecipeWrites, type KeptRecipe } from './recipes/kept.server.ts';

interface StoryRow {
  id: string; person: string; kind: string; title: string | null; body: string; author: string; at: string; context: string | null; author_account?: string | null;
  /** The week and question it answers, when it is an answer to the question of the week (absent in removals kept before this). */
  today?: { week: string; question: string } | null;
  /** Its row as a structured recipe, when it is one (absent in removals kept before recipes had one). */
  recipe?: KeptRecipe | null;
}

/** Removes a story. The answer says whether there was one to remove. */
export function removeStory(tree: string, id: string, op: OpKey | undefined): Promise<{ removed: boolean }> {
  return once<StoryRow | null>(tree, op, 'deleteStory', async (d) => {
    const row = await d.get<StoryRow>('SELECT id, person, kind, title, body, author, at, context, author_account FROM story WHERE id = ?', id);
    if (!row) return { writes: [], history: [], result: null };
    row.today = (await d.get<{ week: string; question: string }>('SELECT week, question FROM today_answer WHERE story = ?', id)) ?? null;
    row.recipe = row.kind === 'recipe' ? await keptRecipe(d, id) : null;
    return {
      writes: [guard('EXISTS (SELECT 1 FROM story WHERE id = ?)', id), q('DELETE FROM story WHERE id = ?', id)],
      history: [removed('story', id, { person: row.person, label: row.title })],
      result: row,
    };
  }).then((row) => ({ removed: !!row }));
}

/**
 * Puts back the story that the removal with this key took away. Only the person who removed it can, and only while
 * the key is kept (30 days). Restoring twice changes nothing.
 */
export async function restoreStory(tree: string, key: string, user: string): Promise<{ restored: boolean }> {
  const kept = await db(tree).get<{ fn: string; result: string; user: string | null }>('SELECT fn, result, user FROM op WHERE key = ?', key);
  if (!kept || kept.fn !== 'deleteStory' || kept.user !== user) throw new Error('This can no longer be undone.');
  const row = JSON.parse(kept.result) as StoryRow | null;
  if (!row) return { restored: false };
  return once(tree, undefined, 'restoreStory', async (d) => {
    if (!(await d.get('SELECT id FROM person WHERE id = ?', row.person))) throw new Error('Person not found.');
    // Already back: nothing to write, and nothing new for the history.
    if (await d.get('SELECT id FROM story WHERE id = ?', row.id)) return { writes: [], history: [], result: { restored: true } };
    return {
      writes: [
        personExists(row.person),
        q('INSERT OR IGNORE INTO story (id, person, kind, title, body, author, at, context, author_account) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          row.id, row.person, row.kind, row.title, row.body, row.author, row.at, row.context, row.author_account ?? null),
        ...(row.today ? [q('INSERT OR IGNORE INTO today_answer (story, week, question) VALUES (?, ?, ?)', row.id, row.today.week, row.today.question)] : []),
        ...(row.recipe ? restoreRecipeWrites(row.id, row.recipe) : []),
      ],
      history: [added('story', row.id, { person: row.person, label: row.title })],
      result: { restored: true },
    };
  });
}
