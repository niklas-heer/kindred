// The families on this server, for setup (the first steward joins all of them) and invitations.
import { NOT_TREES } from './store.server.ts';

export async function families() {
  const { listTrees } = await import('../db.server');
  return listTrees().filter((t) => !NOT_TREES.has(t.id));
}

export async function family(tree: string) {
  return (await families()).find((t) => t.id === tree);
}
