// A reader's own account: "Download my data" (GDPR Art. 15 and 20) and "Delete my account" (Art. 17). docs/gdpr.md says what
// each covers; this is how.
//
// Both work from the databases' own schemas (./schema.ts), so a table a later migration adds is covered without a list here:
//
// - In the accounts database, a column named `user` or `account` names the account that row belongs to: the export copies
//   those rows (without secrets: hashes, sealed keys, tokens, push keys), and deletion deletes them. A column ending in `_by`
//   only says who did something to a row about someone else (who made an invitation, who decided a request): deletion empties
//   it and the row stays. Two tables are kept as they are, as the operator's own records: the audit log of what operators did,
//   and the record of who accepted the server's terms and processing agreement (proof the operator may need for three years;
//   the retention job removes it after that once the account is gone, retention.server.ts).
// - In each family the account belongs to (or left traces in), rows only that account could read, or that are only its own
//   state (its reactions, its quiz answers, its personal notes and their history, its retry keys), are deleted. What it wrote
//   for the family stays with the family, under a pseudonym: stories, posts, comments, pictures, changes in the history keep
//   their content, and the name shown becomes "A former member". The family is the controller of its records (or within the
//   household exemption), and a story about a grandmother does not vanish because its writer left. Names an older feature
//   copied as plain text (who uploaded a picture, who last changed a field) are replaced where the family has no other member
//   of that name; otherwise they cannot be told apart and stay. The account id becomes `former-<random>`, one per deletion, so
//   rows stay distinct and nothing links them to the account again.
//
// Refused while the account is a family's last steward (a family must keep one: hand it on, or delete the family) or the
// server's last operator. Under Kindred's own sign-in it needs a fresh proof, as deleting a family does.
import { AuthError } from '../auth/errors.ts';
import { families } from '../auth/trees.server.ts';
import { db, once } from '../db.server.ts';
import { translate } from '../i18n/dictionary.ts';
import { guard, isGuardError, q, store, type Db, type Query } from '../store/index.ts';
import { ident, isText, tablesOf, type Table } from './schema.ts';

const accounts = () => store.accounts();
const invalid = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => new AuthError('invalid', translate('en', key, vars));

/** Columns that name the account a row belongs to. */
const OWNER = new Set(['user', 'account', 'author_account', 'owner']);
/** Columns that only record who did something (`created_by`, `decided_by` …). */
const isBy = (c: string) => /_by$/.test(c);
/** Accounts tables kept as they are when an account goes: the operator's records (docs/gdpr.md). */
export const KEPT_ON_DELETION = new Set(['operator_audit', 'terms_acceptance']);
/** Columns never exported: secrets and what only the server needs. */
const SECRET = /(^|_)(hash|sealed|secret|token|handle|p256dh|auth|public_key|key_tail|fingerprint|challenge|data)$|^network$/;
/** Name columns that go with an id column in the same table (the name shown then). */
const NAME_OF: Record<string, string[]> = {
  account: ['name', 'author_name', 'user_name'],
  user: ['name', 'user_name'],
  author_account: ['author'],
  created_by: ['created_by_name'],
  updated_by: ['updated_by_name'],
};
/** Columns older features fill with a display name instead of an account id. */
const NAME_ONLY = new Set(['uploaded_by', 'tagged_by', 'named_by', 'updated_by', 'saved_by', 'checked_by', 'decided_by', 'author', 'created_by_name', 'updated_by_name', 'author_name', 'name']);

export const formerName = () => translate('en', 'gdpr.former_member');

// ---------- what refuses ----------

/** Why this account may not be deleted now, as an error; null when it may. */
export async function deletionBlocked(user: { id: string; operator?: number }): Promise<AuthError | null> {
  const lone = await accounts().all<{ tree: string }>(
    `SELECT m.tree FROM membership m WHERE m.user = ? AND m.role = 'steward'
       AND NOT EXISTS (SELECT 1 FROM membership o WHERE o.tree = m.tree AND o.role = 'steward' AND o.user <> m.user)`, user.id);
  const here = new Set((await families()).map((f) => f.id));
  const blocking = lone.filter((r) => here.has(r.tree));
  if (blocking.length) {
    const names = new Map((await families()).map((f) => [f.id, f.name]));
    return invalid('gdpr.err.last_steward', { families: blocking.map((r) => names.get(r.tree) ?? r.tree).join(', ') });
  }
  if (user.operator === 1) {
    const others = await accounts().get<{ n: number }>('SELECT count(*) AS n FROM user WHERE operator = 1 AND id <> ?', user.id);
    if (!others?.n) return invalid('gdpr.err.last_operator');
  }
  return null;
}

/** The guards that hold the same rules inside the deletion's batch, so a steward made meanwhile cannot slip through. */
async function deletionGuards(user: { id: string; operator?: number }): Promise<Query[]> {
  const stewarded = await accounts().all<{ tree: string }>("SELECT tree FROM membership WHERE user = ? AND role = 'steward'", user.id);
  const here = new Set((await families()).map((f) => f.id));
  return [
    ...stewarded.filter((r) => here.has(r.tree)).map((r) => guard("EXISTS (SELECT 1 FROM membership WHERE tree = ? AND role = 'steward' AND user <> ?)", r.tree, user.id)),
    ...(user.operator === 1 ? [guard('EXISTS (SELECT 1 FROM user WHERE operator = 1 AND id <> ?)', user.id)] : []),
  ];
}

// ---------- which families ----------

/** The families whose records may name this account: any accounts row with a `tree` column that is the account's. */
export async function familiesOf(userId: string, tables?: Table[]): Promise<string[]> {
  const all = tables ?? (await tablesOf(accounts()));
  const reads = all
    .filter((t) => t.columns.some((c) => c.name === 'tree'))
    .flatMap((t) => t.columns.filter((c) => c.name === 'user' || c.name === 'account').map((c) => `SELECT tree FROM ${ident(t.name)} WHERE ${ident(c.name)} = ?`));
  if (!reads.length) return [];
  const rows = await accounts().all<{ tree: string }>(reads.join(' UNION '), ...reads.map(() => userId));
  const here = new Set((await families()).map((f) => f.id));
  return [...new Set(rows.map((r) => r.tree))].filter((t) => here.has(t)).sort();
}

// ---------- deleting ----------

/** The accounts database's statements for deleting `userId`, built from its schema. The `user` row goes last. */
export function accountDeletion(tables: Table[], userId: string): Query[] {
  const has = (n: string) => tables.some((t) => t.name === n);
  const out: Query[] = [];
  // Rows that name the account only through another of its rows go first, while that row is still there to find them by.
  if (has('ai_turn')) {
    const convs = ['ai_thread', 'ai_conversation', 'ai_chat'].filter(has).map((t) => `SELECT conv FROM ${t} WHERE user = ?`);
    if (convs.length) out.push(q(`DELETE FROM ai_turn WHERE conv IN (${convs.join(' UNION ')})`, ...convs.map(() => userId)));
  }
  if (has('challenge')) out.push(q("DELETE FROM challenge WHERE subject = ? OR subject LIKE ? || ':%' OR subject LIKE '%:' || ?", userId, userId, userId));
  for (const t of tables) {
    if (t.name === 'user' || KEPT_ON_DELETION.has(t.name)) continue;
    const owner = t.columns.filter((c) => c.name === 'user' || c.name === 'account');
    for (const c of owner) out.push(q(`DELETE FROM ${ident(t.name)} WHERE ${ident(c.name)} = ?`, userId));
    for (const c of t.columns.filter((x) => isBy(x.name))) {
      out.push(q(`UPDATE ${ident(t.name)} SET ${ident(c.name)} = ${c.notNull ? "''" : 'NULL'} WHERE ${ident(c.name)} = ?`, userId));
    }
  }
  out.push(q('DELETE FROM user WHERE id = ?', userId));
  return out;
}

/**
 * One family's statements: delete what was only the account's, give the rest a pseudonym. `sameName` is whether another member of
 * the family has the account's name, in which case plain-text names are left alone.
 */
export function familyDeletion(tables: Table[], user: { id: string; name: string }, pseudonym: string, sameName: boolean): Query[] {
  const out: Query[] = [];
  const former = formerName();
  for (const t of tables) {
    // Retry keys can hold a change's result: they go.
    if (t.name === 'op') { out.push(q('DELETE FROM op WHERE user = ?', user.id)); continue; }
    const cols = new Set(t.columns.map((c) => c.name));
    // A row only its owner could read (a personal note, its history) goes with the account.
    if (cols.has('owner')) out.push(q(`DELETE FROM ${ident(t.name)} WHERE owner = ?`, user.id));
    for (const c of t.columns) {
      if (!OWNER.has(c.name) && !isBy(c.name)) continue;
      if (c.name === 'owner') continue;
      // The account's own state (a reaction, a quiz answer, a push setting): the row is keyed by the account, so it goes.
      if (c.key) { out.push(q(`DELETE FROM ${ident(t.name)} WHERE ${ident(c.name)} = ?`, user.id)); continue; }
      const names = (NAME_OF[c.name] ?? []).filter((n) => cols.has(n));
      const sets = [`${ident(c.name)} = ?`, ...names.map((n) => `${ident(n)} = ?`)];
      out.push(q(`UPDATE ${ident(t.name)} SET ${sets.join(', ')} WHERE ${ident(c.name)} = ?`, pseudonym, ...names.map(() => former), user.id));
    }
    // Only in tables that record who wrote or did something: an album or a house that happens to share the name is left alone.
    const authored = t.columns.some((c) => OWNER.has(c.name) || isBy(c.name));
    if (!sameName && authored && user.name.trim()) {
      for (const c of t.columns.filter((x) => NAME_ONLY.has(x.name) && isText(x) && !x.key)) {
        out.push(q(`UPDATE ${ident(t.name)} SET ${ident(c.name)} = ? WHERE ${ident(c.name)} = ?`, former, user.name));
      }
    }
  }
  return out;
}

export interface DeletionReport { families: number }

/**
 * Deletes an account. The caller checked who it is (and a fresh proof); `confirm` is what they typed, which must be their
 * name or email. The families first (each in its own batch, as each is its own database), then the account in one batch whose
 * guards restate the refusals. A deletion that stops part-way leaves the account in place to try again; the families already
 * done keep the pseudonym, and trying again finds nothing more there.
 */
export async function deleteAccount(user: { id: string; name: string; email: string | null; operator?: number }, confirm: string): Promise<DeletionReport> {
  const typed = confirm.trim().toLowerCase();
  if (!typed || (typed !== user.name.trim().toLowerCase() && typed !== (user.email ?? '').trim().toLowerCase())) throw invalid('gdpr.err.confirm_account');
  const blocked = await deletionBlocked(user);
  if (blocked) throw blocked;
  return removeAccount(user);
}

/**
 * The deletion itself, without the typed confirmation: the families first, then the accounts database. The retention job
 * (retention.server.ts) uses it for accounts nobody has used for two years.
 */
export async function removeAccount(user: { id: string; name: string; operator?: number }): Promise<DeletionReport> {
  const accountTables = await tablesOf(accounts());
  const trees = await familiesOf(user.id, accountTables);
  const pseudonym = `former-${crypto.randomUUID()}`;
  for (const tree of trees) {
    const others = await accounts().get<{ n: number }>(
      'SELECT count(*) AS n FROM membership m JOIN user u ON u.id = m.user WHERE m.tree = ? AND m.user <> ? AND lower(trim(u.name)) = lower(trim(?))', tree, user.id, user.name);
    const d = db(tree);
    const statements = familyDeletion(await tablesOf(d), user, pseudonym, (others?.n ?? 0) > 0);
    // Through `once`, as every change of a family is; it writes no history row (nothing a reader would call a change of the records).
    await once(tree, undefined, 'deleteAccount', () => ({ writes: statements, history: [], result: null }));
  }
  try {
    await accounts().batch([...(await deletionGuards(user)), ...accountDeletion(accountTables, user.id)]);
  } catch (e) {
    if (isGuardError(e)) throw (await deletionBlocked(user)) ?? e;
    throw e;
  }
  return { families: trees.length };
}

// ---------- exporting ----------

export interface AccountExport {
  format: 'kindred-account-export';
  version: 1;
  exported: string;
  account: Record<string, unknown>;
  /** Every accounts row that is this account's, by table, without secrets. */
  accounts: Record<string, Record<string, unknown>[]>;
  /** Per family: what this account wrote or did there. Nothing about other people beyond what the account itself wrote. */
  families: Record<string, { name: string; tables: Record<string, Record<string, unknown>[]> }>;
}

const clean = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).filter(([k, v]) => !SECRET.test(k) && !(v instanceof Uint8Array)));

/** Columns a family's table may export for the account's rows: the history keeps only what the account did and when. */
const FAMILY_COLUMNS: Record<string, string[]> = { history: ['at', 'kind', 'action'] };
/** Family tables not exported: retry keys, and the operator's game log. */
const FAMILY_SKIPPED = new Set(['op']);

async function familyRows(d: Db, tables: Table[], userId: string): Promise<Record<string, Record<string, unknown>[]>> {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const t of tables) {
    if (FAMILY_SKIPPED.has(t.name)) continue;
    const owner = t.columns.filter((c) => OWNER.has(c.name));
    if (!owner.length) continue;
    const only = FAMILY_COLUMNS[t.name];
    const cols = only ? only.filter((c) => t.columns.some((x) => x.name === c)).map(ident).join(', ') : '*';
    const where = owner.map((c) => `${ident(c.name)} = ?`).join(' OR ');
    const rows = await d.all<Record<string, unknown>>(`SELECT ${cols} FROM ${ident(t.name)} WHERE ${where}`, ...owner.map(() => userId));
    if (rows.length) out[t.name] = rows.map(clean);
  }
  return out;
}

/** Everything about the account, as JSON: its own rows in the accounts database and what it wrote in each family. */
export async function exportAccount(userId: string, now = new Date()): Promise<AccountExport> {
  const a = accounts();
  const me = await a.get<Record<string, unknown>>('SELECT id, name, email, created, last_seen, locale, operator FROM user WHERE id = ?', userId);
  if (!me) throw new AuthError('signed-out', translate('en', 'gdpr.err.no_account'));
  const tables = await tablesOf(a);
  const own: AccountExport['accounts'] = {};
  for (const t of tables) {
    if (t.name === 'user') continue;
    const owner = t.columns.filter((c) => c.name === 'user' || c.name === 'account');
    if (!owner.length) continue;
    // A chat with the assistant: the account's own messages. The assistant's answers come from the family's records.
    const extra = t.name === 'ai_chat' ? " AND role = 'user'" : '';
    const rows = await a.all<Record<string, unknown>>(`SELECT * FROM ${ident(t.name)} WHERE (${owner.map((c) => `${ident(c.name)} = ?`).join(' OR ')})${extra}`, ...owner.map(() => userId));
    if (rows.length) own[t.name] = rows.map(clean);
  }
  const names = new Map((await families()).map((f) => [f.id, f.name]));
  const fams: AccountExport['families'] = {};
  for (const tree of await familiesOf(userId, tables)) {
    const d = db(tree);
    fams[tree] = { name: names.get(tree) ?? tree, tables: await familyRows(d, await tablesOf(d), userId) };
  }
  return { format: 'kindred-account-export', version: 1, exported: now.toISOString(), account: me, accounts: own, families: fams };
}

/** Text columns, for callers that scan values (erasure): re-exported so they use one parser. */
export { isText };
