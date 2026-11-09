// Taking a story away, and putting it back. A removed story is kept in the retry key's row (the `op` table, see
// db.server.ts `once`), so Undo restores exactly what was there, with its writer and its date, from the server's own
// copy. The browser never sends a story's author: it only names the removal it wants undone.
import { db, guard, once, personExists, q, type OpKey } from './db.server.ts';

interface StoryRow { id: string; person: string; kind: string; title: string | null; body: string; author: string; at: string; context: string | null }

/** Removes a story. The answer says whether there was one to remove. */
export function removeStory(tree: string, id: string, op: OpKey | undefined): Promise<{ removed: boolean }> {
  return once<StoryRow | null>(tree, op, 'deleteStory', async (d) => {
    const row = await d.get<StoryRow>('SELECT id, person, kind, title, body, author, at, context FROM story WHERE id = ?', id);
    if (!row) return { writes: [], result: null };
    return { writes: [guard('EXISTS (SELECT 1 FROM story WHERE id = ?)', id), q('DELETE FROM story WHERE id = ?', id)], result: row };
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
    return {
      writes: [
        personExists(row.person),
        q('INSERT OR IGNORE INTO story (id, person, kind, title, body, author, at, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          row.id, row.person, row.kind, row.title, row.body, row.author, row.at, row.context),
      ],
      result: { restored: true },
    };
  });
}
