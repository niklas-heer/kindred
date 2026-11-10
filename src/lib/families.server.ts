// Managing the families of an install (the Families page, src/routes/families.tsx): making another one, changing its own
// details, and deleting one with everything that belongs to it. The rules, as docs/self-host.md ("More than one family") gives them:
//
// - Who may make a family: a steward of any family on this server, or the server's first account. Who may change or delete one:
//   a steward of that family. Deleting also needs the family's id typed, a fresh passkey proof (Kindred's own sign-in), and
//   another family left on the server.
// - An id is a URL segment and a database name: lower-case letters, digits and single dashes, starting with a letter, never one
//   of the app's own first path segments (RESERVED_IDS).
// - Node makes data/<id>.db. Workers can only use a D1 database bound as TREE_<ID> when the Worker was deployed, so there a family
//   is made in a bound database that holds no family yet.
// - Making a family is three steps that cannot share one transaction (they touch two databases): forget whatever the accounts
//   database and the media store still hold under that id (left by a deletion that stopped part-way), write the family's
//   details, make the maker its steward. A family that has details but no people and no members was left half-made by a step
//   that failed: making it again finishes it. A family with people or members is never taken over.
// - Deleting goes the other way: the family's database (and so the family) first, then its files, then every accounts row that
//   names it. A deletion that stops part-way leaves rows that name a family that no longer exists, which nobody can reach, and
//   the next family made under that id forgets them first.
import { AuthError } from './auth/errors.ts';
import { cleanFamilyDetails } from './family-details.server.ts';
import { bindingOf, families } from './auth/trees.server.ts';
import { accounts, upsertMembership, type MembershipRow, type UserRow } from './auth/store.server.ts';
import { guard, NOT_TREES, onWorkers, q, store, type Query } from './store/index.ts';
import { once, type OpKey } from './db.server.ts';
import { translate } from './i18n/dictionary.ts';

/** A new family's id: 2 to 40 characters, a letter first, single dashes between letters and digits. */
export const NEW_FAMILY_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const FAMILY_ID_MIN = 2;
export const FAMILY_ID_MAX = 40;

/**
 * First path segments the app (or the platform in front of it) answers itself, so a family there could never be opened, and
 * names the data folder keeps for itself. Kept a little wider than today's routes, so a page added later has room.
 */
export const RESERVED_IDS: ReadonlySet<string> = new Set([
  'api', 'setup', 'signin', 'signout', 'share', 'invite', 'join', 'ui', 'families', 'family-new', 'new', 'settings', 'admin',
  'assets', 'static', 'media', 'backups', 'seed', 'demo', 'help', 'about', 'login', 'logout', 'account', 'accounts', 'gazetteer',
  'cdn-cgi', 'favicon', 'manifest', 'robots', 'sw', 'health',
  ...NOT_TREES,
]);

/** The family themes a family can open in (a reader may still pick another for themselves). */
export const FAMILY_THEMES = ['codex', 'modern'] as const;
export type FamilyTheme = (typeof FAMILY_THEMES)[number];

const invalid = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => new AuthError('invalid', translate('en', key, vars));
/** The refusal for someone who may not make a family (mayCreate). */
export const notAllowed = () => new AuthError('forbidden', translate('en', 'families.err_not_steward'));

/** The problem with an id for a new family, as an error, or null when it may be used. */
export function idProblem(id: string): AuthError | null {
  if (id.length < FAMILY_ID_MIN || id.length > FAMILY_ID_MAX) return invalid('families.err_id_length', { min: FAMILY_ID_MIN, max: FAMILY_ID_MAX });
  if (!NEW_FAMILY_ID.test(id)) return invalid('families.err_id_chars');
  if (RESERVED_IDS.has(id)) return invalid('families.err_id_reserved', { id });
  return null;
}

/** The id the page suggests for a name: "The Lindqvist Family" → `the-lindqvist-family`. Empty when nothing usable is left. */
export function suggestId(name: string): string {
  const s = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[0-9-]+/, '');
  return s.slice(0, FAMILY_ID_MAX).replace(/-+$/, '');
}

/** The server's first account: the one made at setup. */
async function firstAccount(): Promise<string | undefined> {
  return (await accounts().get<{ id: string }>('SELECT id FROM user ORDER BY created, rowid LIMIT 1'))?.id;
}

/** Whether `user` may make a family on this server: a steward of any family here, or the first account. */
export async function mayCreate(user: UserRow, memberships: MembershipRow[]): Promise<boolean> {
  const here = new Set((await families()).map((f) => f.id));
  if (memberships.some((m) => m.role === 'steward' && here.has(m.tree))) return true;
  return (await firstAccount()) === user.id;
}

export interface FamilyAdminRow { id: string; name: string; tagline: string; theme: FamilyTheme; people: number; steward: boolean }
export interface FamiliesOverview {
  /** The families the reader is a member of, with whether they steward each (they may change and delete those). */
  families: FamilyAdminRow[];
  /** Family databases on this server that hold no family yet: on Workers, the bound TREE_<ID> databases a family can be made in. */
  empty: { id: string; binding: string }[];
  workers: boolean;
  mayCreate: boolean;
  /** How many families the server holds, for "the last family cannot be deleted". */
  total: number;
  /** KINDRED_DEFAULT_TREE, when set: that family cannot be deleted while the setting names it. */
  defaultTree?: string;
}

/** What the Families page shows a signed-in reader. Nothing of a family they are not a member of, beyond the empty databases. */
export async function overview(user: UserRow, memberships: MembershipRow[]): Promise<FamiliesOverview> {
  const all = await families();
  const mine = new Map(memberships.map((m) => [m.tree, m.role]));
  const may = await mayCreate(user, memberships);
  const made = new Set(all.map((f) => f.id));
  return {
    families: all.filter((f) => mine.has(f.id)).map((f) => ({
      id: f.id, name: f.name, tagline: f.tagline ?? '', theme: (f.theme === 'modern' ? 'modern' : 'codex') as FamilyTheme, people: f.people, steward: mine.get(f.id) === 'steward',
    })).sort((a, b) => a.name.localeCompare(b.name)),
    // Only someone who may make a family needs to know which databases wait for one.
    empty: may ? store.treeIds().filter((id) => !made.has(id) && !NOT_TREES.has(id)).sort().map((id) => ({ id, binding: bindingOf(id) })) : [],
    workers: onWorkers,
    mayCreate: may,
    total: all.length,
    defaultTree: process.env.KINDRED_DEFAULT_TREE?.trim() || undefined,
  };
}

export interface NewFamily { id: string; name: string; tagline: string; theme: FamilyTheme }

/** The statements that forget every accounts row naming `tree` (see deleteFamily). Built from the schema, so a table added later is included. */
async function forgetInAccounts(tree: string): Promise<Query[]> {
  const tables = await accounts().all<{ name: string; sql: string | null }>("SELECT name, sql FROM sqlite_master WHERE type = 'table'");
  const has = (name: string) => tables.some((t) => t.name === name);
  // Every table with a `tree` column: memberships, invitations, the share link, AI settings, chats and spending, statistics,
  // push subscriptions, join requests, feedback, and whatever a later migration adds with one.
  const byTree = tables.filter((t) => /^[a-z_][a-z0-9_]*$/.test(t.name) && /[(,]\s*"?tree"?\s+[A-Za-z]/i.test(t.sql ?? '')).map((t) => t.name);
  const writes: Query[] = [];
  // Rows that name the family only through another row go first, while that row is still there to find them by.
  if (has('share_session') && has('share_link')) writes.push(q('DELETE FROM share_session WHERE link IN (SELECT id FROM share_link WHERE tree = ?)', tree));
  if (has('ai_turn')) {
    const convs = ['ai_thread', 'ai_conversation'].filter(has).map((t) => `SELECT conv FROM ${t} WHERE tree = ?`);
    if (convs.length) writes.push(q(`DELETE FROM ai_turn WHERE conv IN (${convs.join(' UNION ')})`, ...convs.map(() => tree)));
  }
  // A pending account (someone who asked to join, not yet approved) exists only for its request: it goes with it, unless it
  // is a member somewhere or waits on another family too. Its passkeys and sessions go with it (foreign keys).
  if (has('join_request')) {
    writes.push(q(`DELETE FROM user WHERE id IN (SELECT user FROM join_request WHERE tree = ? AND status = 'open')
      AND NOT EXISTS (SELECT 1 FROM membership m WHERE m.user = user.id)
      AND NOT EXISTS (SELECT 1 FROM join_request j WHERE j.user = user.id AND j.tree <> ?)`, tree, tree));
  }
  for (const t of byTree) writes.push(q(`DELETE FROM "${t}" WHERE tree = ?`, tree));
  return writes;
}

/**
 * Makes a family, or finishes one a failed attempt left half-made, and makes `user` its steward. Returns its id.
 * `user` must be allowed (mayCreate): the server function checks that first.
 */
export async function createFamily(user: UserRow, input: NewFamily): Promise<string> {
  const id = input.id.trim();
  const problem = idProblem(id);
  if (problem) throw problem;
  const details = cleanFamily(input);

  const bound = store.treeIds().includes(id);
  // Workers: the database must have been bound when the Worker was deployed (docs/deploy-cloudflare.md, "Another family").
  if (onWorkers && !bound) throw invalid('families.err_no_binding', { id, binding: bindingOf(id) });

  let resume = false;
  if (bound) {
    const d = store.tree(id);
    let held: [{ value: string }[], { n: number }[]];
    try {
      held = (await d.readBatch([q("SELECT value FROM meta WHERE key = 'id'"), q('SELECT count(*) AS n FROM person')])) as unknown as typeof held;
    } catch (e) {
      // A bound D1 database without the schema: `mise run cf:migrate:remote` has not run for it yet.
      if (/no such table/i.test(e instanceof Error ? e.message : String(e))) throw invalid('setup.err_not_migrated', { id, binding: bindingOf(id) });
      throw e;
    }
    const [[meta], [people]] = held;
    if (meta && meta.value !== id) throw invalid('families.err_other_family', { id });
    if (meta) {
      const members = await accounts().get<{ n: number }>('SELECT count(*) AS n FROM membership WHERE tree = ?', id);
      if ((people?.n ?? 0) > 0 || (members?.n ?? 0) > 0) throw invalid('families.err_exists', { id });
      resume = true;
    } else if ((people?.n ?? 0) > 0) {
      // People without a family's details: not something Kindred made. It is never written over.
      throw invalid('families.err_not_empty', { id });
    }
  }

  // 1. Forget what a deletion that stopped part-way left under this id, so nobody inherits a membership or a file.
  if (!resume) {
    await accounts().batch(await forgetInAccounts(id));
    await store.media.deleteTree(id);
  }
  // 2. The family's details. On Node this makes data/<id>.db; on Workers the bound database must already exist.
  const d = store.ensureTree(id);
  await d.batch([
    guard("NOT EXISTS (SELECT 1 FROM meta WHERE key = 'id' AND value <> ?)", id),
    q("INSERT INTO meta (key, value) VALUES ('id', ?) ON CONFLICT(key) DO NOTHING", id),
    ...(['name', 'tagline', 'theme'] as const).map((k) => q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, details[k])),
    q("INSERT INTO meta (key, value) VALUES ('focus', '') ON CONFLICT(key) DO NOTHING"),
  ]);
  // 3. Its first steward. Without this step the family is half-made, and making it again finishes it.
  await accounts().batch([upsertMembership(user.id, id, 'steward')]);
  return id;
}

function cleanFamily(input: { name: string; tagline: string; theme: string }): { name: string; tagline: string; theme: FamilyTheme } {
  let clean: { name: string; tagline: string };
  try {
    clean = cleanFamilyDetails(input);
  } catch (e) {
    // cleanFamilyDetails throws a translation key; the reader gets its sentence.
    throw new AuthError('invalid', translate('en', (e as Error).message as Parameters<typeof translate>[1]));
  }
  if (!(FAMILY_THEMES as readonly string[]).includes(input.theme)) throw invalid('families.err_theme');
  return { ...clean, theme: input.theme as FamilyTheme };
}

/** Changes a family's own details: its name, tagline and the theme it opens in. Through `once`, so a retry writes nothing twice. */
export function editFamily(tree: string, input: { name: string; tagline: string; theme: string }, op: OpKey | undefined) {
  const details = cleanFamily(input);
  return once(tree, op, 'editFamily', async () => ({
    writes: [
      guard("EXISTS (SELECT 1 FROM meta WHERE key = 'id')"),
      ...(['name', 'tagline', 'theme'] as const).map((k) => q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, details[k])),
    ],
    result: details,
  }));
}

/**
 * Deletes a family: its database (Node: the file; Workers: emptied, and still bound), every file it stored, and every row of the
 * accounts database that names it. The caller has checked that the reader stewards it and proved it is them; `confirm` is what
 * they typed, which must be the family's id.
 */
export async function deleteFamily(tree: string, confirm: string): Promise<void> {
  if (confirm.trim() !== tree) throw invalid('families.err_confirm', { id: tree });
  const all = await families();
  // Gone already: a deletion stopped after the database, and its steward (still a member) finishes it.
  if (all.some((f) => f.id === tree)) {
    if (all.length < 2) throw invalid('families.err_last');
    if (process.env.KINDRED_DEFAULT_TREE?.trim() === tree) throw invalid('families.err_default', { id: tree });
    await store.dropTree(tree);
  }
  await store.media.deleteTree(tree);
  await accounts().batch(await forgetInAccounts(tree));
}
