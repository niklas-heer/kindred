// The families on this server, for setup (the first steward joins all of them) and invitations, and the family
// a brand-new server makes for itself when setup creates its first account (docs/deploy-cloudflare.md, step 2).
import { listTrees, provisionFamily } from '../db.server.ts';
import { translate } from '../i18n/dictionary.ts';
import { NOT_TREES, onWorkers, store, TREE_ID } from '../store/index.ts';
import { AuthError } from './errors.ts';

/**
 * Every family on this server, or with `only`, just those of them (a reader's own: nobody else's database is opened).
 * `protectLiving` names the families read by a guest whose link protects living people (listTrees).
 */
export async function families(only?: Iterable<string>, protectLiving?: ReadonlySet<string>) {
  return (await listTrees(only, protectLiving)).filter((t) => !NOT_TREES.has(t.id));
}

export async function family(tree: string) {
  return (await families([tree])).find((t) => t.id === tree);
}

export const DEFAULT_FAMILY_NAME = 'Our family';
export const FAMILY_NAME_MAX = 80;

/** The family a new server makes for itself: KINDRED_DEFAULT_TREE, or `family`. Lower-case letters, digits and dashes. */
export function defaultTreeId(env: string | undefined = process.env.KINDRED_DEFAULT_TREE): string {
  const id = env?.trim() || 'family';
  if (!TREE_ID.test(id) || NOT_TREES.has(id)) throw new Error(`KINDRED_DEFAULT_TREE must be lower-case letters, digits and dashes, not "${id}".`);
  return id;
}

/** The D1 binding that holds a family on Workers: `my-family` → TREE_MY_FAMILY. */
export const bindingOf = (id: string) => `TREE_${id.toUpperCase().replace(/-/g, '_')}`;

/**
 * On Workers a family's database must be bound before it can be made: a missing binding is the operator's to add,
 * so the reader gets the steps rather than a crash. Null when the family can be made here.
 */
export function missingBinding(id: string, bound: string[], workers: boolean): AuthError | null {
  if (!workers || bound.includes(id)) return null;
  return new AuthError('invalid', translate('en', 'setup.err_no_binding', { id, binding: bindingOf(id) }));
}

/** The bound database has no tables yet: the schema has not been applied (`mise run cf:migrate:remote`). */
export const notMigrated = (id: string) =>
  new AuthError('invalid', translate('en', 'setup.err_not_migrated', { id, binding: bindingOf(id) }));

/** A family name as typed: one line, at most FAMILY_NAME_MAX characters. Blank means the default name. */
export function cleanFamilyName(raw: unknown): string {
  const n = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim() : '';
  if (!n) return DEFAULT_FAMILY_NAME;
  if (n.length > FAMILY_NAME_MAX) throw new AuthError('invalid', translate('en', 'setup.err_family_name_long', { max: FAMILY_NAME_MAX }));
  return n;
}

/** Before setup asks for a passkey: a server with no family yet must be able to make its first one. */
export async function checkCanMakeFamily(): Promise<void> {
  if ((await families()).length) return;
  const problem = missingBinding(defaultTreeId(), store.treeIds(), onWorkers);
  if (problem) throw problem;
}

/** Makes the server's first family, named `name` (see provisionFamily), and returns its id. */
export async function makeFirstFamily(name: string): Promise<string> {
  const id = defaultTreeId();
  const problem = missingBinding(id, store.treeIds(), onWorkers);
  if (problem) throw problem;
  try {
    await provisionFamily(id, name);
  } catch (e) {
    if (/no such table/i.test(e instanceof Error ? e.message : String(e))) throw notMigrated(id);
    throw e;
  }
  return id;
}
