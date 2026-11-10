// Taking a story away, and putting it back. A removed story is kept in the retry key's row (the `op` table, see
// db.server.ts `once`), so Undo restores exactly what was there, with its writer and its date, from the server's own
// copy. The browser never sends a story's author: it only names the removal it wants undone. The story's reactions and
// comments (migration 0027) go with it and do not come back.
import { added, db, guard, once, personExists, q, removed, type OpKey } from './db.server.ts';

interface StoryRow { id: string; person: string; kind: string; title: string | null; body: string; author: string; at: string; context: string | null; author_account?: string | null }

/** Removes a story. The answer says whether there was one to remove. */
export function removeStory(tree: string, id: string, op: OpKey | undefined): Promise<{ removed: boolean }> {
  return once<StoryRow | null>(tree, op, 'deleteStory', async (d) => {
    const row = await d.get<StoryRow>('SELECT id, person, kind, title, body, author, at, context, author_account FROM story WHERE id = ?', id);
    if (!row) return { writes: [], history: [], result: null };
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
      ],
      history: [added('story', row.id, { person: row.person, label: row.title })],
      result: { restored: true },
    };
  });
}
