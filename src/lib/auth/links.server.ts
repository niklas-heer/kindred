// Who is waiting for a steward to confirm who they say they are. The Access page answers these, and they count among what
// waits for a steward on the AI activity page and its badge.
import type { WaitingLink } from '../ai/background.ts';
import { db } from '../db.server.ts';
import { accounts } from './store.server.ts';

/** Members who say they are someone still in the tree and have no confirmation. Editors and stewards never wait: they can paint anyway. */
export async function linksWaiting(tree: string): Promise<WaitingLink[]> {
  const rows = await accounts().all<WaitingLink>(
    `SELECT u.id AS user, u.name, m.person FROM membership m JOIN user u ON u.id = m.user
      WHERE m.tree = ? AND m.person IS NOT NULL AND m.person <> '-' AND m.person_confirmed = 0 AND m.role NOT IN ('editor', 'steward')
      ORDER BY m.created`,
    tree,
  );
  if (!rows.length) return [];
  const inTree = new Set((await db(tree).all<{ id: string }>('SELECT id FROM person')).map((p) => p.id));
  return rows.filter((r) => inTree.has(r.person)).map(({ user, name, person }) => ({ user, name, person }));
}
