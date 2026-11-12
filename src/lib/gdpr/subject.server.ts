// Answering a request about someone in a family's records who is not a member: a living relative asking what the family keeps
// about them (GDPR Art. 15), to have it erased (Art. 17) or its use restricted (Art. 18). docs/gdpr.md, "A person in the tree".
//
// The family's stewards answer it, as the family keeps the records. They search for the person (`findPeople`), see where they
// appear (`subjectReport`: counts and the records that name them, never anything about the relatives around them), give them a
// copy of what is kept about them (`subjectCopy`), and then erase or restrict them.
//
// Erasure goes further than removing a person (relations.server.ts removePlan, which it builds on):
//   - the person, and with them (foreign keys) their links, fields, events, stories, contacts, photo, portraits, tags,
//     citations, research links and their tags on posts;
//   - every gallery picture in which they are the only person tagged (a picture with others keeps its other tags), with its
//     reactions and comments, and the files of all of these;
//   - every history row about them, and their name and id wherever text still holds them: other people's fields, stories,
//     posts, comments, research notes, captions, the quiz, the Campaign's log, the history's remaining rows, retry keys. Full
//     names (given and surname, as born and as now) are replaced by "[—]"; a first name alone is left, as it cannot be told
//     apart from anyone else's, and the report shows where it still appears;
//   - in the accounts database: every conversation with the assistant in this family that names them (the whole conversation:
//     an answer can describe someone without their name), the guest statistics that counted visits to their page, a join
//     request that claimed to be them, the background tasks' give-up list, live presence, and the same text replacement in
//     the family's other rows (feedback, join messages);
//   - nothing is kept that names them: the erasure is not written to the family's history, and the steward's record of it
//     (`subject_action`) holds only counts.
// Pushes already delivered sit on the members' devices; Kindred keeps no copy of a push's text (the service worker caches
// nothing, and every push is written when it is sent). Backups and the nightly archive keep them until they roll over (docs/gdpr.md).
//
// A member's own person is not erased here: the member deletes their account (account.server.ts) or is removed first.
import { AuthError } from '../auth/errors.ts';
import { db, media, once, type Db } from '../db.server.ts';
import { translate } from '../i18n/dictionary.ts';
import { removePlan } from '../relations.server.ts';
import { guard, q, store, type Query } from '../store/index.ts';
import { ident, isText, tablesOf, type Table } from './schema.ts';

const accounts = () => store.accounts();
const invalid = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => new AuthError('invalid', translate('en', key, vars));

/** What replaces an erased person's full name in text that stays. */
export const REDACTED = '[—]';

/** The characters an id is made of: a match of a person's id must not run on into one of these (`i1` is not in `i10`). */
const ID_CHAR = 'A-Za-z0-9_-';
/**
 * SQL that holds when `col` contains the id `id` as a whole token (alone, or between characters an id cannot have: `/`, `>`,
 * `"`, a space), and its parameters. GLOB, as SQLite and D1 both have it; the id's own GLOB characters are escaped.
 */
export function hasId(col: string, id: string): { sql: string; params: string[] } {
  const g = id.replace(/[*?[]/g, (c) => `[${c}]`);
  const edge = `[^${ID_CHAR}]`;
  return { sql: `(${col} = ? OR ${col} GLOB ? OR ${col} GLOB ? OR ${col} GLOB ?)`, params: [id, `${g}${edge}*`, `*${edge}${g}`, `*${edge}${g}${edge}*`] };
}
/** Columns that point at a person by id. */
const PERSON_REF = new Set(['person', 'child', 'parent', 'a', 'b', 'head', 'heir', 'author_person', 'about']);
/** Never searched or rewritten: secrets, files' bytes, and hashes. */
const SKIP_COLUMN = /(^|_)(hash|sealed|secret|token|p256dh|auth|public_key|key_tail|fingerprint)$/;
/** Accounts tables never searched as text: a chat's pictures (their bytes as text); their conversation is what counts. */
const SKIP_TABLE = new Set(['ai_chat_image', 'subject_action']);

interface PersonRow { id: string; given: string; surname: string | null; current_given: string | null; current_surname: string | null; further_given: string | null; born: string | null; living: number }

/** The person's name as the family shows it. */
const shown = (p: PersonRow) => [p.current_given ?? p.given, p.current_surname ?? p.surname].filter(Boolean).join(' ');

/**
 * The full names text may hold for a person: given and surname as born and as now, with further given names. Only names of
 * two words or more, so a first name shared with half the family is never touched.
 */
export function namesOf(p: Pick<PersonRow, 'given' | 'surname' | 'current_given' | 'current_surname' | 'further_given'>): string[] {
  const givens = [p.given, p.current_given].filter((x): x is string => !!x?.trim());
  const surnames = [p.surname, p.current_surname].filter((x): x is string => !!x?.trim());
  const out = new Set<string>();
  for (const g of givens) for (const s of surnames) {
    out.add(`${g} ${s}`);
    if (p.further_given?.trim()) out.add(`${g} ${p.further_given.trim()} ${s}`);
  }
  // Longest first, so "Ada Maria Rm" is replaced before "Ada Rm" could split it.
  return [...out].map((n) => n.replace(/\s+/g, ' ').trim()).filter((n) => n.includes(' ') && n.length >= 5).sort((x, y) => y.length - x.length);
}

async function personRow(d: Db, id: string): Promise<PersonRow | undefined> {
  return d.get<PersonRow>('SELECT id, given, surname, current_given, current_surname, further_given, born, living FROM person WHERE id = ?', id);
}

// ---------- finding the person ----------

export interface PersonHit { id: string; name: string; born: string | null; living: boolean; member: boolean; restricted: boolean }

/** People whose name contains what the steward typed (at most 20), living first. */
export async function findPeople(tree: string, text: string): Promise<PersonHit[]> {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
  if (!words.length) return [];
  const full = "lower(coalesce(given,'') || ' ' || coalesce(further_given,'') || ' ' || coalesce(current_given,'') || ' ' || coalesce(surname,'') || ' ' || coalesce(current_surname,'') || ' ' || coalesce(nickname,''))";
  const rows = await db(tree).all<PersonRow>(
    `SELECT id, given, surname, current_given, current_surname, further_given, born, living FROM person WHERE ${words.map(() => `instr(${full}, ?) > 0`).join(' AND ')} ORDER BY living DESC, given LIMIT 20`, ...words);
  const [members, restricted] = await Promise.all([
    accounts().all<{ person: string }>('SELECT person FROM membership WHERE tree = ? AND person IS NOT NULL', tree),
    accounts().all<{ person: string }>('SELECT person FROM subject_restriction WHERE tree = ?', tree),
  ]);
  const m = new Set(members.map((r) => r.person)), r = new Set(restricted.map((x) => x.person));
  return rows.map((p) => ({ id: p.id, name: shown(p), born: p.born?.slice(0, 4) ?? null, living: !!p.living, member: m.has(p.id), restricted: r.has(p.id) }));
}

// ---------- where they appear ----------

/** One place a person appears: a table, how many rows, and how (linked by id, or named in text). */
export interface Trace { db: 'family' | 'accounts'; table: string; how: 'link' | 'text' | 'history' | 'conversation'; rows: number }

/** Every place the person still appears, by id or by full name, in the family's database and in the accounts database. */
export async function traces(tree: string, who: { id: string; names: string[] }): Promise<Trace[]> {
  const d = db(tree);
  const out: Trace[] = [];
  // A column mentions them when it holds their id as a whole token, or one of their full names. The terms are bound once, in a
  // one-row table `kx` joined to the table counted, so a table with many text columns stays under D1's 100 parameters.
  const id = hasId('c', who.id).params;
  const kx = `WITH kx AS (SELECT ? AS kx_id, ? AS kx_a, ? AS kx_b, ? AS kx_c${who.names.map((_, i) => `, ? AS kx_n${i}`).join('')})`;
  const kxParams = [...id, ...who.names];
  const mention = (c: string) => `(${[`${ident(c)} = kx.kx_id`, ...['a', 'b', 'c'].map((x) => `${ident(c)} GLOB kx.kx_${x}`), ...who.names.map((_, i) => `instr(${ident(c)}, kx.kx_n${i}) > 0`)].join(' OR ')})`;
  const any = (cols: string[]) => ({ sql: cols.map(mention).join(' OR '), params: kxParams });
  for (const t of await tablesOf(d)) {
    if (t.name === 'history') {
      const h = await d.get<{ n: number }>(`${kx} SELECT count(*) AS n FROM history, kx WHERE person = kx.kx_id OR ${any(['record', 'person_name', 'label', 'fields']).sql}`, ...kxParams);
      if (h?.n) out.push({ db: 'family', table: 'history', how: 'history', rows: h.n });
      continue;
    }
    const links = t.columns.filter((c) => PERSON_REF.has(c.name));
    if (links.length) {
      const n = await d.get<{ n: number }>(`SELECT count(*) AS n FROM ${ident(t.name)} WHERE ${links.map((c) => `${ident(c.name)} = ?`).join(' OR ')}`, ...links.map(() => who.id));
      if (n?.n) out.push({ db: 'family', table: t.name, how: 'link', rows: n.n });
    }
    const texts = t.columns.filter((c) => isText(c) && !PERSON_REF.has(c.name) && !SKIP_COLUMN.test(c.name));
    if (texts.length) {
      const m = any(texts.map((c) => c.name));
      const n = await d.get<{ n: number }>(`${kx} SELECT count(*) AS n FROM ${ident(t.name)}, kx WHERE ${m.sql}`, ...m.params);
      if (n?.n) out.push({ db: 'family', table: t.name, how: 'text', rows: n.n });
    }
  }
  for (const t of await familyTables()) {
    const texts = t.columns.filter((c) => isText(c) && c.name !== 'tree' && !SKIP_COLUMN.test(c.name));
    if (!texts.length) continue;
    const m = any(texts.map((c) => c.name));
    const n = await accounts().get<{ n: number }>(`${kx} SELECT count(*) AS n FROM ${ident(t.name)}, kx WHERE tree = ? AND (${m.sql})`, ...m.params, tree);
    if (n?.n) out.push({ db: 'accounts', table: t.name, how: t.name.startsWith('ai_') ? 'conversation' : 'text', rows: n.n });
  }
  return out;
}

/** The accounts database's tables that belong to a family (a `tree` column), which may hold a person's name or id. */
async function familyTables(): Promise<Table[]> {
  return (await tablesOf(accounts())).filter((t) => !SKIP_TABLE.has(t.name) && t.columns.some((c) => c.name === 'tree'));
}

export interface SubjectReport {
  person: PersonHit;
  /** The full names searched for (and replaced on erasure). */
  names: string[];
  traces: Trace[];
  /** Gallery pictures they are tagged in, and whether erasure deletes each (nobody else is tagged in it). */
  pictures: { key: string; caption: string | null; others: number; deleted: boolean }[];
  /** When it is restricted, since when. */
  restrictedSince: number | null;
}

async function hitFor(tree: string, p: PersonRow): Promise<PersonHit & { since: number | null }> {
  const [member, restriction] = await Promise.all([
    accounts().get('SELECT 1 FROM membership WHERE tree = ? AND person = ?', tree, p.id),
    accounts().get<{ since: number }>('SELECT since FROM subject_restriction WHERE tree = ? AND person = ?', tree, p.id),
  ]);
  return { id: p.id, name: shown(p), born: p.born?.slice(0, 4) ?? null, living: !!p.living, member: !!member, restricted: !!restriction, since: restriction?.since ?? null };
}

const gone = () => invalid('gdpr.err.no_person');

/** What a steward sees to answer a request about one person: where they appear, and what erasure would delete. */
export async function subjectReport(tree: string, person: string): Promise<SubjectReport> {
  const d = db(tree);
  const p = await personRow(d, person);
  if (!p) throw gone();
  const names = namesOf(p);
  const [hit, found, pictures] = await Promise.all([
    hitFor(tree, p),
    traces(tree, { id: p.id, names }),
    d.all<{ key: string; caption: string | null; others: number }>(
      `SELECT m.key, m.caption, (SELECT count(*) FROM media_person o WHERE o.media = m.key AND o.person <> ?) AS others
       FROM media_person mp JOIN media m ON m.key = mp.media WHERE mp.person = ? ORDER BY m.uploaded_at`, p.id, p.id),
  ]);
  const { since, ...rest } = hit;
  return { person: rest, names, traces: found, pictures: pictures.map((x) => ({ ...x, deleted: x.others === 0 })), restrictedSince: since };
}

// ---------- a copy for them ----------

export interface SubjectCopy {
  format: 'kindred-subject-copy';
  version: 1;
  family: string;
  exported: string;
  person: Record<string, unknown>;
  /** Rows that point at them, by table: their fields, events, stories, links, tags … (no member's personal notes). */
  records: Record<string, Record<string, unknown>[]>;
  /** The names of the people their links point to, so a link reads as "parent: Ben Rm". Nothing else of those people. */
  related: Record<string, string>;
}

/** What the family keeps about one person, as JSON for the steward to send them (Art. 15). */
export async function subjectCopy(tree: string, person: string, now = new Date()): Promise<SubjectCopy> {
  const d = db(tree);
  const row = await d.get<Record<string, unknown>>('SELECT * FROM person WHERE id = ?', person);
  if (!row) throw gone();
  const records: SubjectCopy['records'] = {};
  const ids = new Set<string>();
  for (const t of await tablesOf(d)) {
    if (t.name === 'person' || t.name === 'history' || t.name === 'op') continue;
    const links = t.columns.filter((c) => PERSON_REF.has(c.name));
    if (!links.length) continue;
    // A member's personal note about them is that member's alone (src/lib/visibility.ts): not part of the family's records.
    const personal = t.columns.some((c) => c.name === 'visibility') ? " AND visibility <> 'personal'" : '';
    const rows = await d.all<Record<string, unknown>>(`SELECT * FROM ${ident(t.name)} WHERE (${links.map((c) => `${ident(c.name)} = ?`).join(' OR ')})${personal}`, ...links.map(() => person));
    if (!rows.length) continue;
    records[t.name] = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => !SKIP_COLUMN.test(k) && !(v instanceof Uint8Array) && k !== 'owner')));
    for (const r of rows) for (const c of links) if (typeof r[c.name] === 'string' && r[c.name] !== person) ids.add(r[c.name] as string);
  }
  const related: Record<string, string> = {};
  if (ids.size) {
    const people = await d.all<PersonRow>('SELECT id, given, surname, current_given, current_surname, further_given, born, living FROM person WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify([...ids]));
    for (const p of people) related[p.id] = shown(p);
  }
  const clean = Object.fromEntries(Object.entries(row).filter(([k, v]) => !(v instanceof Uint8Array) && k !== 'revision'));
  return { format: 'kindred-subject-copy', version: 1, family: tree, exported: now.toISOString(), person: clean, records, related };
}

// ---------- erasure ----------

export interface ErasureResult { counts: Record<string, number>; files: number }

/** The statements that replace a person's names (and drop their id) in every text column of `tables`, but key columns. */
function scrubText(tables: Table[], who: { id: string; names: string[] }, where = '', whereParams: (string | number)[] = []): Query[] {
  const out: Query[] = [];
  for (const t of tables) {
    for (const c of t.columns) {
      if (!isText(c) || c.name === 'tree' || SKIP_COLUMN.test(c.name)) continue;
      const col = ident(c.name);
      // The id only as a whole token: an imported `i1` does not match `i10`.
      const id = hasId(col, who.id);
      // A key column cannot be rewritten without colliding: a row keyed by the id goes instead.
      if (c.key) {
        out.push(q(`DELETE FROM ${ident(t.name)} WHERE ${id.sql}${where}`, ...id.params, ...whereParams));
        continue;
      }
      // Only rows that name them are rewritten. Within such a row the id is replaced wherever it occurs, so a row that names
      // both `i1` and `i10` loses the start of `i10` too; that is the one case left, and it is rare (docs/gdpr.md).
      let expr = `replace(${col}, ?, ?)`;
      const params: string[] = [who.id, REDACTED];
      for (const n of who.names) { expr = `replace(${expr}, ?, ?)`; params.push(n, REDACTED); }
      const names = who.names.map(() => `instr(${col}, ?) > 0`);
      out.push(q(`UPDATE ${ident(t.name)} SET ${col} = ${expr} WHERE (${[id.sql, ...names].join(' OR ')})${where}`, ...params, ...id.params, ...who.names, ...whereParams));
    }
  }
  return out;
}

/**
 * Erases a living person who is not a member from a family, everywhere Kindred keeps them (see the top of this file). The caller
 * checked that `by` is a steward (and a fresh proof). `request` is the data request it answers, if any: it is marked done.
 * Returns how many rows went from each place, which is all the record of it keeps.
 *
 * Two databases cannot change in one batch, so it goes in three steps, each safe to repeat: (1) the accounts database is
 * cleaned and the erasure recorded as pending (`subject_action.pending` holds the person's id, never a name); (2) the family's
 * records go, in one batch; (3) the record is finished and the request marked done. A failure in (1) or (2) leaves the person
 * in the family, and trying again does it all again. A failure in (3) leaves the person gone from the family: trying again finds
 * the pending record and finishes it.
 */
export async function erasePerson(tree: string, person: string, by: string, request: string | null = null, now = Date.now()): Promise<ErasureResult> {
  const d = db(tree);
  const p = await personRow(d, person);
  if (!p) {
    // Gone from the family: an erasure that stopped after its family step is finished; anyone else was never here.
    const pending = await accounts().get<{ counts: string; request: string | null }>(
      "SELECT counts, request FROM subject_action WHERE tree = ? AND kind = 'erase' AND pending = ?", tree, person);
    if (!pending) throw gone();
    await finishErasure(tree, person, by, pending.request ?? request, now);
    return { counts: JSON.parse(pending.counts) as Record<string, number>, files: 0 };
  }
  if (await accounts().get('SELECT 1 FROM membership WHERE tree = ? AND person = ?', tree, person)) throw invalid('gdpr.err.is_member');
  const who = { id: p.id, names: namesOf(p) };
  const before = await traces(tree, who);
  const counts: Record<string, number> = {};
  for (const t of before) counts[`${t.db}.${t.table}`] = (counts[`${t.db}.${t.table}`] ?? 0) + t.rows;

  // Only the tables the report found them in are rewritten, which keeps the batch small (a D1 database counts every statement).
  const found = (where: Trace['db']) => new Set(before.filter((t) => t.db === where).map((t) => t.table));
  const familyFound = found('family'), accountsFound = found('accounts');

  // (1) The accounts database: whole conversations that named them (by any message or by their title), then the rest of the
  // family's rows; and the record, pending, once however often this step runs.
  const named = (c: string) => {
    const id = hasId(c, who.id);
    return { sql: `(${[id.sql, ...who.names.map(() => `instr(${c}, ?) > 0`)].join(' OR ')})`, params: [...id.params, ...who.names] };
  };
  const body = named('body'), title = named('title');
  const convRows = await accounts().all<{ conv: string }>(
    `SELECT conv FROM ai_chat WHERE tree = ? AND ${body.sql} UNION SELECT conv FROM ai_thread WHERE tree = ? AND ${title.sql}`, tree, ...body.params, tree, ...title.params);
  const convs = JSON.stringify(convRows.map((r) => r.conv));
  const inConvs = 'conv IN (SELECT value FROM json_each(?))';
  const famTables = (await familyTables()).filter((t) => accountsFound.has(t.name) && !['ai_chat', 'ai_thread', 'ai_conversation'].includes(t.name));
  await accounts().batch([
    q(`DELETE FROM ai_turn WHERE ${inConvs}`, convs),
    q(`DELETE FROM ai_chat_image WHERE tree = ? AND item IN (SELECT id FROM ai_chat WHERE tree = ? AND ${inConvs})`, tree, tree, convs),
    q(`DELETE FROM ai_chat WHERE tree = ? AND ${inConvs}`, tree, convs),
    q(`DELETE FROM ai_thread WHERE tree = ? AND ${inConvs}`, tree, convs),
    q(`DELETE FROM ai_conversation WHERE tree = ? AND ${inConvs}`, tree, convs),
    q('UPDATE guest_visitor SET people = json_remove(people, ?) WHERE tree = ? AND json_valid(people) AND json_type(people, ?) IS NOT NULL', `$."${person}"`, tree, `$."${person}"`),
    q('UPDATE join_request SET person = NULL WHERE tree = ? AND person = ?', tree, person),
    q(`DELETE FROM presence WHERE tree = ? AND (focus = ? OR ${hasId('route', person).sql})`, tree, person, ...hasId('route', person).params),
    q('DELETE FROM subject_restriction WHERE tree = ? AND person = ?', tree, person),
    ...scrubText(famTables, who, ' AND tree = ?', [tree]),
    q(`INSERT INTO subject_action (tree, kind, at, done_by, request, counts, pending) SELECT ?, 'erase', ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM subject_action WHERE tree = ? AND kind = 'erase' AND pending = ?)`, tree, now, by, request, JSON.stringify(counts), person, tree, person),
  ]);

  // (2) The family's records.
  const tables = (await tablesOf(d)).filter((t) => familyFound.has(t.name));
  let files = 0;
  await once(tree, undefined, 'erasePerson', async (dd) => {
    // The person, as a removal does: their photo's and portraits' files, the tree's focus, links on others' fields.
    const base = await removePlan(dd, tree, person);
    const only = await dd.all<{ key: string }>(
      'SELECT mp.media AS key FROM media_person mp WHERE mp.person = ? AND NOT EXISTS (SELECT 1 FROM media_person o WHERE o.media = mp.media AND o.person <> ?)', person, person);
    const pictures = JSON.stringify(only.map((r) => r.key));
    const nPlan = base.writes.length;
    const writes: Query[] = [
      // Guarded on the tags read, so a picture tagged with someone else meanwhile is not deleted.
      guard('(SELECT count(*) FROM media_person WHERE media IN (SELECT value FROM json_each(?)) AND person <> ?) = 0', pictures, person),
      ...base.writes,
      q('SELECT key, thumb FROM media WHERE key IN (SELECT value FROM json_each(?))', pictures),
      q('DELETE FROM media WHERE key IN (SELECT value FROM json_each(?))', pictures),
      q(`DELETE FROM history WHERE person = ? OR ${hasId('record', person).sql}`, person, ...hasId('record', person).params),
      ...scrubText(tables, who),
    ];
    return {
      writes,
      // Not written down: a history row about the erasure would name them again. subject_action records it, with counts only.
      history: [],
      result: null,
      after: async (r) => {
        await base.after?.(r.slice(1, 1 + nPlan));
        const rows = r[1 + nPlan]!.rows as { key: string; thumb: string | null }[];
        for (const x of rows) for (const k of [x.key, x.thumb]) if (k) { await media.delete(tree, k).catch((e) => console.error('[media] could not delete', k, e)); files++; }
        files += (r[2]?.rows.length ?? 0) + (r[3]?.rows.length ?? 0);
      },
    };
  });

  // (3) Done: the record no longer holds their id, and the request is answered.
  await finishErasure(tree, person, by, request, now);
  return { counts, files };
}

/**
 * Whether an erasure of this person stopped after the family's step (erasePerson then finishes it): its record waits and the
 * person is really gone from the family. One that stopped before (the person still there) is not: a retry is a new erasure,
 * and the steward confirms it with the name again.
 */
export async function pendingErasure(tree: string, person: string): Promise<boolean> {
  if (!(await accounts().get("SELECT 1 FROM subject_action WHERE tree = ? AND kind = 'erase' AND pending = ?", tree, person))) return false;
  return !(await personRow(db(tree), person));
}

/** The erasure's last step: its record stops naming the person, and the request it answers is done. Safe to repeat. */
async function finishErasure(tree: string, person: string, by: string, request: string | null, now: number): Promise<void> {
  await accounts().batch([
    q("UPDATE subject_action SET pending = NULL WHERE tree = ? AND kind = 'erase' AND pending = ?", tree, person),
    ...(request ? [q("UPDATE data_request SET status = 'done', outcome = 'erased', person = NULL, updated_at = ?, updated_by = ? WHERE id = ? AND family = ?", now, by, request, tree)] : []),
  ]);
}

// ---------- restriction ----------

/**
 * Restricts the use of a person's data (Art. 18): while restricted they are kept but cannot be changed, and the stewards see
 * why. Used while a correction is checked, or when the person wants the data kept but not used. Recorded with the request.
 */
export async function restrictPerson(tree: string, person: string, by: string, request: string | null = null, now = Date.now()): Promise<void> {
  if (!(await personRow(db(tree), person))) throw gone();
  await accounts().batch([
    q('INSERT INTO subject_restriction (tree, person, since, restricted_by, request) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tree, person) DO NOTHING', tree, person, now, by, request),
    q("INSERT INTO subject_action (tree, kind, at, done_by, request) VALUES (?, 'restrict', ?, ?, ?)", tree, now, by, request),
    ...(request ? [q("UPDATE data_request SET person = ?, outcome = 'restricted', updated_at = ?, updated_by = ? WHERE id = ? AND family = ?", person, now, by, request, tree)] : []),
  ]);
}

export async function liftRestriction(tree: string, person: string, by: string, now = Date.now()): Promise<void> {
  await accounts().batch([
    q('DELETE FROM subject_restriction WHERE tree = ? AND person = ?', tree, person),
    q("INSERT INTO subject_action (tree, kind, at, done_by) VALUES (?, 'lift', ?, ?)", tree, now, by),
  ]);
}

/** Refuses a change to a person whose processing is restricted (Art. 18). Called by the person's server functions. */
export async function refuseRestricted(tree: string, person: string): Promise<void> {
  if (await accounts().get('SELECT 1 FROM subject_restriction WHERE tree = ? AND person = ?', tree, person)) throw invalid('gdpr.err.restricted');
}
