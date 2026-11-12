// Managing the families of an install (the Families page, src/routes/families.tsx): making another one, changing its own
// details, and deleting one with everything that belongs to it. The rules, as docs/self-host.md ("More than one family") gives them:
//
// - Who may make a family: an operator of this server always; a steward of any family on it while the instance's
//   `family_creation` is `stewards` (the default; docs/hosting-many-families.md). Who may change or delete one: a steward of
//   that family (and an operator, from the operator console). While stewards make families, an account that is not an
//   operator may have made at most `families_per_account` of those still here (an instance setting; none set, no limit). While
//   the operator has written terms, the maker accepts them (src/lib/operator/terms.server.ts). Deleting also needs the family's id typed, a fresh passkey proof (Kindred's own sign-in), and
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
import { guard, isGuardError, NOT_TREES, onWorkers, q, store, type Query } from './store/index.ts';
import { change, once, type OpKey } from './db.server.ts';
import { translate } from './i18n/dictionary.ts';
import { familyCreation, instanceSettings } from './operator/settings.server.ts';
import { storageOf } from './operator/storage.server.ts';
import { acceptance, termsNeeded } from './operator/terms.server.ts';
import type { FamilyCreation } from './operator/shared.ts';

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
  'cdn-cgi', 'favicon', 'manifest', 'robots', 'sw', 'health', 'operator', 'request', 'signup', 'privacy-request', 'legal', 'processing-agreement', 'privacy', 'impressum', 'terms', 'whats-new', 'reset', 'unsubscribe', 'verify-email',
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

/**
 * Whether `user` may make a family on this server, by the instance's `family_creation` (src/lib/operator/shared.ts): an
 * operator always may; a steward of any family here may while it is `stewards` (the default); nobody else.
 */
export async function mayCreate(user: UserRow, memberships: MembershipRow[], mode?: FamilyCreation): Promise<boolean> {
  if (user.operator === 1) return true;
  if ((mode ?? (await familyCreation())) !== 'stewards') return false;
  const here = new Set((await families()).map((f) => f.id));
  return memberships.some((m) => m.role === 'steward' && here.has(m.tree));
}

export interface FamilyAdminRow {
  id: string; name: string; tagline: string; theme: FamilyTheme; people: number; steward: boolean;
  /** For its stewards: the media storage it uses, and its cap when the operator set one. */
  storage?: { usedBytes: number; capBytes: number | null };
  suspended?: boolean;
  /** Read-only because nobody visited (the lifecycle), not by the operator's decision. */
  inactive?: boolean;
  /** The operator closed it: its members see a page that says so instead. */
  closed?: boolean;
}
export interface FamiliesOverview {
  /** The families the reader is a member of, with whether they steward each (they may change and delete those). */
  families: FamilyAdminRow[];
  /** Family databases on this server that hold no family yet: on Workers, the bound TREE_<ID> databases a family can be made in, or a Durable Object a failed attempt left. */
  empty: { id: string; binding: string }[];
  /** A new family needs a D1 database bound and a deploy first: Workers without the FAMILIES Durable Objects. */
  workers: boolean;
  mayCreate: boolean;
  /** Who may make a family here (the instance's setting): with `requests`, the page points at the request form instead. */
  familyCreation: FamilyCreation;
  /** How many families the server holds, for "the last family cannot be deleted". */
  total: number;
  /** KINDRED_DEFAULT_TREE, when set: that family cannot be deleted while the setting names it. */
  defaultTree?: string;
  /** The server has terms the reader must accept to make a family (they are not an operator). */
  terms?: boolean;
  /** The reader's limit of families (not an operator, and the instance sets one): how many they may make, and have made. */
  limit?: { max: number; made: number };
}

/** What the Families page shows a signed-in reader. Nothing of a family they are not a member of, beyond the empty databases. */
export async function overview(user: UserRow, memberships: MembershipRow[]): Promise<FamiliesOverview> {
  const all = await families();
  const mine = new Map(memberships.map((m) => [m.tree, m.role]));
  const mode = await familyCreation();
  const may = await mayCreate(user, memberships, mode);
  const made = new Set(all.map((f) => f.id));
  const suspended = new Set(memberships.filter((m) => m.suspended).map((m) => m.tree));
  const closed = new Set(memberships.filter((m) => m.closed).map((m) => m.tree));
  // Made read-only by the lifecycle (src/lib/lifecycle/): said so, rather than "suspended by the operator".
  const inactive = new Set(suspended.size ? (await accounts().all<{ tree: string }>("SELECT tree FROM family_admin WHERE status_by = 'lifecycle'")).map((r) => r.tree) : []);
  const rows = all.filter((f) => mine.has(f.id)).map((f) => ({
    id: f.id, name: f.name, tagline: f.tagline ?? '', theme: (f.theme === 'modern' ? 'modern' : 'codex') as FamilyTheme, people: f.people, steward: mine.get(f.id) === 'steward',
    ...(suspended.has(f.id) ? { suspended: true, ...(inactive.has(f.id) ? { inactive: true } : {}) } : {}),
    ...(closed.has(f.id) ? { closed: true } : {}),
  })).sort((a, b) => a.name.localeCompare(b.name));
  const limit = may ? await familyLimit(user) : null;
  // What each family stores is for its stewards: they are the ones who make room when it is full.
  const stored = await Promise.all(rows.map((f) => (f.steward ? storageOf(f.id) : undefined)));
  return {
    families: rows.map((f, i) => (stored[i] ? { ...f, storage: stored[i] } : f)),
    // Only someone who may make a family needs to know which databases wait for one.
    empty: may ? (await store.treeIds()).filter((id) => !made.has(id) && !NOT_TREES.has(id)).sort().map((id) => ({ id, binding: bindingOf(id) })) : [],
    workers: onWorkers && !store.canMakeTree(),
    mayCreate: may,
    familyCreation: mode,
    total: all.length,
    defaultTree: process.env.KINDRED_DEFAULT_TREE?.trim() || undefined,
    ...(may && (await termsNeeded(user.operator === 1)) ? { terms: true } : {}),
    ...(limit ? { limit } : {}),
  };
}

/**
 * An account's limit of families (`families_per_account`), and how many of the families still on the server it made. Null
 * for an operator, and when the instance sets no limit.
 */
export async function familyLimit(user: Pick<UserRow, 'id' | 'operator'>, override?: number): Promise<{ max: number; made: number } | null> {
  if (user.operator === 1) return null;
  const max = override ?? (await instanceSettings()).familiesPerAccount;
  if (max === null) return null;
  const made = await accounts().get<{ n: number }>('SELECT count(*) AS n FROM family_admin WHERE created_by = ?', user.id);
  return { max, made: made?.n ?? 0 };
}

/**
 * The guard that keeps `familyLimit` inside the batch that records a new family as made by `user`, so parallel requests
 * (or several staged imports finishing) cannot each pass the check made before it. `tree` itself is not counted: making
 * a half-made family again records it a second time. Empty for an operator and when the instance sets no limit.
 */
export async function familyLimitGuard(user: Pick<UserRow, 'id' | 'operator'>, tree: string, override?: number): Promise<Query[]> {
  if (user.operator === 1) return [];
  const max = override ?? (await instanceSettings()).familiesPerAccount;
  if (max === null) return [];
  return [guard('(SELECT count(*) FROM family_admin WHERE created_by = ? AND tree <> ?) < ?', user.id, tree, max)];
}

export interface NewFamily { id: string; name: string; tagline: string; theme: FamilyTheme }

/** The statements that forget every accounts row naming `tree` (see deleteFamily). Built from the schema, so a table added later is included. */
export async function forgetInAccounts(tree: string): Promise<Query[]> {
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
 *
 * With `member: false` (the operator console, src/lib/operator/operator.server.ts) nobody becomes a member: the family waits,
 * with no members, for the person its steward invitation is for. While that invitation is open nobody can "finish" the
 * family as their own.
 *
 * Sign-up (src/lib/signup/signup.server.ts) brings the rest of its step to the last batch: `before` (the new account, its
 * passkey, and the guards of the sign-up limits), `after` (the sign-up's own rows), `limit` (its families per account, instead
 * of the instance's) and `refused` (the reader's sentence when a guard of that batch stops it).
 */
export interface CreateOptions {
  member?: boolean;
  invitedName?: string | null;
  acceptedTerms?: boolean;
  before?: Query[];
  after?: Query[];
  limit?: number;
  refused?: () => Promise<Error>;
}

export async function createFamily(
  user: UserRow, input: NewFamily,
  { member = true, invitedName = null, acceptedTerms, before = [], after = [], limit: limitOverride, refused }: CreateOptions = {},
): Promise<string> {
  const id = input.id.trim();
  const problem = idProblem(id);
  if (problem) throw problem;
  const details = cleanFamily(input);
  // Someone making a family of their own: within their limit, and with the terms accepted (both before anything is written).
  let accepted: Query[] = [];
  let limited: Query[] = [];
  const overLimit = (max: number) => new AuthError('forbidden', translate('en', 'families.err_limit', { max }));
  if (member) {
    const limit = await familyLimit(user, limitOverride);
    if (limit && limit.made >= limit.max) throw overLimit(limit.max);
    limited = await familyLimitGuard(user, id, limitOverride);
    accepted = await acceptance(user, acceptedTerms, 'family.create', id);
  }

  const bound = (await store.treeIds()).includes(id);
  // Workers without Durable Objects: the database must have been bound when the Worker was deployed (docs/deploy-cloudflare.md, "Another family").
  if (!bound && !store.canMakeTree(id)) throw invalid('families.err_no_binding', { id, binding: bindingOf(id) });

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
      const members = await accounts().get<{ n: number; invited: number }>(
        'SELECT count(*) AS n, (SELECT count(*) FROM invite WHERE tree = ? AND used_at IS NULL AND revoked_at IS NULL AND expires > ?) AS invited FROM membership WHERE tree = ?', id, Date.now(), id);
      // An open invitation is the family's first steward on the way: the family is not half-made, it is waiting.
      if ((people?.n ?? 0) > 0 || (members?.n ?? 0) > 0 || (members?.invited ?? 0) > 0) throw invalid('families.err_exists', { id });
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
  const d = await store.ensureTree(id);
  await d.batch([
    guard("NOT EXISTS (SELECT 1 FROM meta WHERE key = 'id' AND value <> ?)", id),
    q("INSERT INTO meta (key, value) VALUES ('id', ?) ON CONFLICT(key) DO NOTHING", id),
    ...(['name', 'tagline', 'theme'] as const).map((k) => q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, details[k])),
    q("INSERT INTO meta (key, value) VALUES ('focus', '') ON CONFLICT(key) DO NOTHING"),
  ]);
  // 3. Its first steward, and its administration: when and by whom it was made, and the instance's default storage cap.
  // Without this step the family is half-made, and making it again finishes it.
  // The limit is checked again inside this batch: a parallel request may have made the account's last family meanwhile.
  const { defaultCapBytes: cap, familiesPerAccount } = await instanceSettings();
  try {
    await accounts().batch([
      ...before,
      ...limited,
      ...(member ? [upsertMembership(user.id, id, 'steward')] : []),
      q(`INSERT INTO family_admin (tree, cap_bytes, created_at, created_by, invited_name) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(tree) DO UPDATE SET created_by = excluded.created_by, invited_name = excluded.invited_name`, id, cap, Date.now(), user.id, invitedName),
      ...accepted,
      ...after,
    ]);
  } catch (e) {
    if (!(limited.length || before.length || after.length) || !isGuardError(e)) throw e;
    // Refused over the limit: a database this request made is not left behind as a family waiting to be finished.
    // Only while nobody else has made it theirs meanwhile (a parallel request for the same id): no member, no administration
    // row, no open invitation. Otherwise it is theirs and stays.
    if (!bound) {
      const taken = await accounts().get(
        'SELECT 1 FROM membership WHERE tree = ? UNION ALL SELECT 1 FROM family_admin WHERE tree = ? UNION ALL SELECT 1 FROM invite WHERE tree = ? AND used_at IS NULL AND revoked_at IS NULL',
        id, id, id);
      if (!taken) await store.dropTree(id).catch(() => {});
    }
    if (refused) throw await refused();
    throw overLimit(limitOverride ?? familiesPerAccount ?? 0);
  }
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
  return once(tree, op, 'editFamily', async (d) => ({
    history: change('family', 'details', Object.fromEntries((await d.all<{ key: string; value: string }>("SELECT key, value FROM meta WHERE key IN ('name', 'tagline', 'theme')")).map((r) => [r.key, r.value])), details, { label: details.name }),
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
  // Its automatic backups stay for the operator's grace period, then the daily backup job deletes them (src/lib/backup/).
  const { markGone } = await import('./backup/backup.server.ts');
  await accounts().batch([...(await forgetInAccounts(tree)), markGone(tree)]);
}
