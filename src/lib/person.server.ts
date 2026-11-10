// Changes to a person's details and fields. Reads are in db.server.ts (`person`), and the Edit tab's read is
// `editSnapshot` below. Every change is a plan run through `once`: it reads what it decides on, guards those facts in
// the batch, and writes in one transaction, so a retried or racing request never writes twice or half-way (see
// db.server.ts).
import { added, change, db, editedPart, fieldOf, guard, newId, once, personExists, q, removed, type HistoryEntry, type OpKey, type Query } from './db.server.ts';
import { CHANGED_SINCE_OPENED, fieldText, isContactType, MAX_FIELDS, storedValue, type FieldInput, type FieldType, type FieldValue, type PersonField } from '../components/fields/model.ts';
import { EDITED_KEYS, type GraphPatch, type Look } from './types.ts';
import { parseFurther, storeFurther } from './further-given.ts';
import { validDate } from './dates.ts';
import type { HistoryValue, RestorableField } from './history.ts';
import { occupationCodeFor } from './occupations.ts';
import { translate } from './i18n/dictionary.ts';
import { fieldsVisibleTo, mayBePersonal, maySee, type Audience, type Visibility } from './visibility.ts';

/** The message a save gets when the person changed after the draft was opened (the reader sees it in their language). */
export { CHANGED_SINCE_OPENED };

/** The scalar details of a person, as the Edit tab saves them. Names: a null current name means "same as birth". */
export interface PersonDetails {
  given: string;
  /** Further given names in order (second name, third name, ...). Left out, the stored ones stay as they are. */
  furtherGiven?: string[];
  surname: string | null;
  currentGiven: string | null;
  currentSurname: string | null;
  nickname: string | null;
  sex: 'm' | 'f' | 'x' | null;
  born: string | null;
  bornPlace: string | null;
  died: string | null;
  diedPlace: string | null;
  living: boolean;
  title: string | null;
  epithet: string | null;
  occupation: string | null;
  /** The vocabulary entry chosen in the editor, if any. The text is what decides when it is not. */
  occupationCode?: string | null;
  bio: string | null;
}

/**
 * Everything the Edit tab writes, read as one consistent view: the person's scalars, places and biography, the list
 * of fields, and the revision they are at. The draft and "Load the latest" both start from this, so they never mix
 * a value from one moment with a revision from another.
 */
export interface EditSnapshot {
  id: string;
  /** The version of what this reader can see of the person (see `viewRevision`), never the stored counter. */
  revision: number;
  given: string;
  furtherGiven: string[];
  surname: string | null;
  currentGiven: string | null;
  currentSurname: string | null;
  nickname: string | null;
  sex: 'm' | 'f' | 'x' | null;
  born: string | null;
  bornPlace: string | null;
  died: string | null;
  diedPlace: string | null;
  living: boolean;
  title: string | null;
  epithet: string | null;
  occupation: string | null;
  occupationCode: string | null;
  bio: string | null;
  fields: PersonField[];
}

/** The person's columns the Edit tab writes. Each one moves the revision (migration 0010). */
const EDIT_COLUMNS = [
  'given', 'further_given', 'surname', 'current_given', 'current_surname', 'nickname', 'sex', 'born', 'born_place', 'died', 'died_place',
  'living', 'title', 'epithet', 'occupation', 'occupation_code', 'bio',
] as const;
type EditColumn = (typeof EDIT_COLUMNS)[number];
type Cell = string | number | null;
/** The row as the database gives it (see `EDIT_COLUMNS`). */
interface EditRow {
  given: string; further_given: string | null; surname: string | null; current_given: string | null; current_surname: string | null; nickname: string | null;
  sex: 'm' | 'f' | 'x' | null; born: string | null; born_place: string | null; died: string | null; died_place: string | null;
  living: number; title: string | null; epithet: string | null; occupation: string | null; occupation_code: string | null; bio: string | null;
}

/** A field as the reader's version counts it: what the Edit tab shows and writes, with the value as stored. */
interface Seen { id: string; type: string; label: string; value: string; visibility: string }

/**
 * The revision a reader is given: a 48-bit digest of exactly what their Edit draft holds, the person's Edit columns and
 * the fields they may see, in order. The stored `person.revision` moves with every field at every level, so handing it
 * out would let a reader watch someone's Personal or Editors fields change; this number moves only with what this
 * reader sees. The stale-save check compares it; the batch still guards the stored counter, so any change in between
 * makes the plan read and decide again.
 */
async function viewRevision(row: Record<EditColumn, Cell>, fields: Seen[]): Promise<number> {
  const text = JSON.stringify([EDIT_COLUMNS.map((c) => row[c]), fields.map((f) => [f.id, f.type, f.label, f.value, f.visibility])]);
  const h = new DataView(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return h.getUint32(0) * 0x10000 + h.getUint16(4);
}

/** How often `editSnapshot` reads again when the person changes in the middle of the read. */
const SNAPSHOT_ATTEMPTS = 3;

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const empty = (s: string | null) => (s === null || s.trim() === '' ? null : s.trim());

interface Existing { id: string; type: string; label: string; value: string; visibility: Visibility; owner: string | null; ord: number; created_by: string | null; updated_by: string | null; updated_at: string | null }

/**
 * Saves this close together are one change for the statistics: an autosave writes at every pause in typing. Decided from when
 * and by whom each row says it was last written, so counting this keeps nothing new about anyone.
 */
const ONE_CHANGE_MS = 10 * 60_000;
const justWritten = (at: string | null) => at !== null && Date.now() - Date.parse(at) < ONE_CHANGE_MS;

/** The owner a field at this level has: the person saving it when it is personal, nobody otherwise. */
function ownerFor(visibility: Visibility, who: Audience): string | null {
  if (visibility !== 'personal') return null;
  if (!who.account) throw new Error(translate('en', 'field.vis.needsAccount'));
  return who.account;
}

/** A field's parts for comparing: a blank part and a missing one are the same, and the order of keys does not matter. */
const parts = (v: Record<string, string>) =>
  JSON.stringify(Object.keys(v).sort().filter((k) => v[k] !== '' && v[k] != null).map((k) => [k, v[k]]));
/** Whether a stored value already says what the draft says, so an untouched field is not rewritten. */
const sameContent = (stored: string, value: FieldValue) => parts(JSON.parse(stored)) === parts(value);

/** A person's name as the history keeps it. */
const nameOf = (r: { given: string | null; surname: string | null; current_given?: string | null; current_surname?: string | null }) =>
  [r.current_given ?? r.given, r.current_surname ?? r.surname].filter(Boolean).join(' ');

/** A field as the history compares it. */
interface FieldState { id: string; type: string; label: string; value: string; visibility: Visibility; owner: string | null }

/** The stricter of two levels that are not personal. */
const stricter = (a: Visibility, b: Visibility): Visibility => (a === 'editors' || b === 'editors' ? 'editors' : 'family');

/**
 * What a change to one of a person's fields writes to the history. A personal field's row is personal, for its owner alone,
 * and keeps no content. A field made personal is, for everyone else, removed (without its content, as its author withdrew
 * it); a personal field shared is, for them, added. Between the other two levels, the row is at the stricter one.
 */
export function fieldHistory(person: string, before: FieldState | null, after: FieldState | null): HistoryEntry[] {
  const f = (after ?? before)!;
  const label = f.label || f.type;
  const base = { person, label };
  const text = (x: FieldState) => { try { return fieldText(x.type as FieldType, JSON.parse(x.value) as FieldValue); } catch { return ''; } };
  if (!before && after) return [added('field', after.id, { ...base, level: after.visibility, owner: after.owner })];
  if (before && !after) return [removed('field', before.id, { ...base, level: before.visibility, owner: before.owner })];
  const b = before!, a = after!;
  if (b.visibility === 'personal' && a.visibility === 'personal') {
    return b.label === a.label && b.value === a.value ? [] : [{ kind: 'field', record: a.id, action: 'changed', ...base, level: 'personal', owner: a.owner }];
  }
  if (a.visibility === 'personal') return [removed('field', b.id, { ...base, level: b.visibility })];
  if (b.visibility === 'personal') return [added('field', a.id, { ...base, level: a.visibility })];
  return change('field', a.id, { label: b.label, value: text(b), visibility: b.visibility }, { label: a.label, value: text(a), visibility: a.visibility }, { ...base, level: stricter(b.visibility, a.visibility) });
}

/** The person's columns the history compares on a save: the Edit tab's, without the derived occupation code. */
const LOGGED_COLUMNS = EDIT_COLUMNS.filter((c) => c !== 'occupation_code');
const pick = (row: object, cols: readonly string[]) => Object.fromEntries(cols.map((c) => [c, (row as Record<string, unknown>)[c]]));

/**
 * The Edit tab's read. Reads the person's row (scalars and revision) in one statement, then the fields, then the
 * revision again: if the person changed in between, the read starts again, so the snapshot is one moment, never a
 * mix. Only the fields this reader may see are listed, by the same rule as the person read (visibility.ts).
 */
export async function editSnapshot(tree: string, id: string, reader: Audience): Promise<EditSnapshot> {
  const d = db(tree);
  const seen = fieldsVisibleTo(reader);
  for (let attempt = 1; ; attempt++) {
    const r = await d.get<EditRow & { revision: number }>(`SELECT revision, ${EDIT_COLUMNS.join(', ')} FROM person WHERE id = ?`, id);
    if (!r) throw new Error('Person not found.');
    const fields = await d.all<any>(`SELECT * FROM person_field WHERE person = ? AND ${seen.sql} ORDER BY ord, id`, id, ...seen.params);
    const again = await d.get<{ revision: number }>('SELECT revision FROM person WHERE id = ?', id);
    if (again?.revision === r.revision) {
      return {
        id,
        revision: await viewRevision(r as unknown as Record<EditColumn, Cell>, fields),
        given: r.given,
        furtherGiven: parseFurther(r.further_given),
        surname: r.surname,
        currentGiven: r.current_given,
        currentSurname: r.current_surname,
        nickname: r.nickname,
        sex: r.sex,
        born: r.born,
        bornPlace: r.born_place,
        died: r.died,
        diedPlace: r.died_place,
        living: r.living === 1,
        title: r.title,
        epithet: r.epithet,
        occupation: r.occupation,
        occupationCode: r.occupation_code,
        bio: r.bio,
        // Whether this reader created each field, so the picker offers Personal when the save would take it. Never the account itself.
        fields: fields.map((row, i) => ({ ...fieldOf(row, i), authored: !!reader.account && row.created_by === reader.account })),
      };
    }
    if (attempt >= SNAPSHOT_ATTEMPTS) throw new Error('The family changed while this was loaded. Please try again.');
  }
}

/**
 * What a save leaves the draft with: the reader's revision after it (see `viewRevision`), known exactly because the batch
 * is guarded on what the plan read, and the id of each field in the list, in the list's order. An autosaving draft goes on from
 * these, so its next save neither looks stale to itself nor adds a new field a second time. `person` is the person as the
 * saving reader's graph now has them, so the page patches its copy of the family instead of reading all of it again.
 */
export interface SavedEdit { revision: number; fieldIds: string[]; person: GraphPatch }

/** The person as the saving reader's graph shows them after the save: the row as written, and the contacts they can see. */
function graphPatchOf(row: Record<EditColumn, Cell>, fields: Seen[]): GraphPatch {
  const part = editedPart(row) as Record<string, unknown>;
  const patch = Object.fromEntries(EDITED_KEYS.map((k) => [k, part[k] ?? null])) as Omit<GraphPatch, 'contacts'>;
  return { ...patch, contacts: fields.filter((f) => isContactType(f.type)).length };
}

/**
 * Saves the details and the whole list of fields in one batch. `fields` is the list in its new order: a field with an
 * `id` is updated, one without is added, and any field of this person not in the list is removed. `revision` is the
 * reader's revision when the draft was opened (`viewRevision`): if anything they can see has changed since (a field added
 * elsewhere, a name changed), the save is refused and the draft stays with the reader. A change to a field they cannot see
 * does not refuse it, so a refusal never tells them one happened. The batch restates the stored revision it read, so any
 * change that lands between this check and the write makes the batch write nothing, and the plan runs again on fresh
 * reads (and then refuses if the reader's view moved).
 *
 * Only what changed is written: a field whose content, label, privacy and position are as stored is left alone (so its
 * last editor and time stand), and the person's row is written only if one of its columns differs. A field that only moved
 * in the list gets its new place and keeps its last editor and time: someone else's hidden field moving it says nothing.
 *
 * `who` is the person saving. The list only ever covers what they may see: someone else's personal field is not in their
 * draft, so it is neither removed nor changed, and an id naming one is refused as any unknown field is. Only the
 * account that created a field may make it personal (visibility.ts); `created_by` is written when a field is added and never again.
 */
export function savePersonEdit(tree: string, id: string, details: PersonDetails, fields: FieldInput[], revision: number, op: OpKey | undefined, by: string, who: Audience) {
  return once(tree, op, 'savePersonEdit', async (d) => {
    const now = await d.get<EditRow & { revision: number; updated_at: string | null }>(`SELECT revision, updated_at, ${EDIT_COLUMNS.join(', ')} FROM person WHERE id = ?`, id);
    if (!now) throw new Error('Person not found.');
    const seen = fieldsVisibleTo(who);
    const had = await d.all<Existing>(`SELECT id, type, label, value, visibility, owner, ord, created_by, updated_by, updated_at FROM person_field WHERE person = ? AND ${seen.sql} ORDER BY ord, id`, id, ...seen.params);
    if ((await viewRevision(now as unknown as Record<EditColumn, Cell>, had)) !== revision) throw new Error(CHANGED_SINCE_OPENED);
    const hadById = new Map(had.map((r) => [r.id, r]));
    const kept = new Set<string>();
    const fieldIds: string[] = [];
    // The reader's fields as they will be stored after this batch, for the revision the save answers with.
    const after: Seen[] = [];
    const history: HistoryEntry[] = [];
    // Whether every row written here was just written by this editor: then this is the same change going on (see `ONE_CHANGE_MS`).
    let continues = true;
    // What the plan read: the person at the stored revision (every change bumps it, see migration 0009), and the fields.
    // Every decision below rests on that revision, so the guard covers the person's columns as well.
    const writes: Query[] = [
      guard('EXISTS (SELECT 1 FROM person WHERE id = ? AND revision = ?)', id, now.revision),
      guard(`(SELECT count(*) FROM person_field WHERE person = ? AND ${seen.sql}) = ?`, id, ...seen.params, had.length),
    ];

    for (const [ord, f] of fields.entries()) {
      const owner = ownerFor(f.visibility, who);
      const value = storedValue(f.type as FieldType, f.value);
      const stored = f.id ? hadById.get(f.id) : undefined;
      // Only a link this save makes is checked: a field left as it was may name someone removed meanwhile, and refusing it
      // would stop every other change to this person.
      if (f.type === 'related' && value.person && !(stored && sameContent(stored.value, value))) {
        if (!(await d.get('SELECT id FROM person WHERE id = ?', value.person))) throw new Error('That person is not in this family.');
        if (value.person === id) throw new Error('A person cannot be their own relative.');
        writes.push(guard('EXISTS (SELECT 1 FROM person WHERE id = ?)', value.person));
      }
      if (f.id) {
        const before = hadById.get(f.id);
        if (!before || before.type !== f.type) throw new Error('That field is not on this person.');
        if (f.visibility === 'personal' && !mayBePersonal(who, before)) throw new Error(translate('en', 'field.vis.onlyAuthor'));
        kept.add(f.id);
        writes.push(guard('EXISTS (SELECT 1 FROM person_field WHERE id = ? AND person = ?)', f.id, id));
        const sameText = sameContent(before.value, value);
        const same = before.label === f.label && before.visibility === f.visibility && before.owner === owner && sameText;
        const stored = sameText ? before.value : JSON.stringify(value);
        fieldIds.push(f.id);
        after.push({ id: f.id, type: f.type, label: f.label, value: stored, visibility: f.visibility });
        if (!same) {
          history.push(...fieldHistory(id, before, { id: f.id, type: f.type, label: f.label, value: stored, visibility: f.visibility, owner }));
          continues &&= before.updated_by === by && justWritten(before.updated_at);
          writes.push(q(
            'UPDATE person_field SET label = ?, value = ?, visibility = ?, owner = ?, ord = ?, updated_by = ?, updated_at = ? WHERE id = ? AND person = ?',
            f.label, stored, f.visibility, owner, ord, by, nowIso(), f.id, id,
          ));
        } else if (before.ord !== ord) {
          writes.push(q('UPDATE person_field SET ord = ? WHERE id = ? AND person = ?', ord, f.id, id));
        }
      } else {
        const fresh = crypto.randomUUID();
        fieldIds.push(fresh);
        after.push({ id: fresh, type: f.type, label: f.label, value: JSON.stringify(value), visibility: f.visibility });
        history.push(...fieldHistory(id, null, { id: fresh, type: f.type, label: f.label, value: JSON.stringify(value), visibility: f.visibility, owner }));
        continues = false;
        writes.push(q(
          'INSERT INTO person_field (id, person, type, label, value, ord, visibility, owner, created_by, created_by_name, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          fresh, id, f.type, f.label, JSON.stringify(value), ord, f.visibility, owner, who.account, by, nowIso(), by, nowIso(),
        ));
      }
    }
    for (const r of had) {
      if (kept.has(r.id)) continue;
      history.push(...fieldHistory(id, r, null));
      continues = false;
      writes.push(q('DELETE FROM person_field WHERE id = ? AND person = ?', r.id, id));
    }

    const s = details;
    const occupation = empty(s.occupation);
    const next: Record<EditColumn, Cell> = {
      given: s.given.trim(), further_given: s.furtherGiven === undefined ? now.further_given : storeFurther(s.furtherGiven), surname: empty(s.surname), current_given: empty(s.currentGiven), current_surname: empty(s.currentSurname),
      nickname: empty(s.nickname), sex: s.sex, born: empty(s.born), born_place: empty(s.bornPlace), died: empty(s.died),
      died_place: empty(s.diedPlace), living: s.living ? 1 : 0, title: empty(s.title), epithet: empty(s.epithet),
      occupation, occupation_code: occupation ? occupationCodeFor(occupation, s.occupationCode) : null, bio: empty(s.bio),
    };
    const changed = EDIT_COLUMNS.filter((c) => next[c] !== now[c]);
    history.unshift(...change('person', id, pick(now, LOGGED_COLUMNS), pick(next, LOGGED_COLUMNS), { person: id, personName: nameOf(next as never), label: nameOf(next as never) }));
    if (changed.length) {
      // The person's row names no editor, so its time alone says whether this is the same bout of editing.
      continues &&= justWritten(now.updated_at);
      writes.push(q(
        `UPDATE person SET ${changed.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        ...changed.map((c) => next[c]), nowIso(), id,
      ));
    }
    return { writes, continues, history, result: { revision: await viewRevision(next, after), fieldIds, person: graphPatchOf(next, after) } satisfies SavedEdit };
  });
}

/** Adds one field to the end of a person's list (the Everyday tab's quick add for a contact). Returns its id. */
export function addPersonField(tree: string, person: string, f: FieldInput, op: OpKey | undefined, by: string, who: Audience) {
  return once(tree, op, 'addPersonField', async (d) => {
    const owner = ownerFor(f.visibility, who);
    if (!(await d.get('SELECT id FROM person WHERE id = ?', person))) throw new Error('Person not found.');
    // The cap counts the fields this reader sees, as the Edit tab's list does, so it never tells them how many they don't.
    const seen = fieldsVisibleTo(who);
    const at = await d.get<{ n: number; last: number }>(
      `SELECT (SELECT count(*) FROM person_field WHERE person = ? AND ${seen.sql}) AS n, (SELECT coalesce(max(ord), -1) FROM person_field WHERE person = ?) AS last`,
      person, ...seen.params, person,
    );
    if ((at?.n ?? 0) >= MAX_FIELDS) throw new Error(`A person can have up to ${MAX_FIELDS} fields.`);
    if (f.type === 'related' && storedValue('related', f.value).person) {
      const other = storedValue('related', f.value).person!;
      if (!(await d.get('SELECT id FROM person WHERE id = ?', other))) throw new Error('That person is not in this family.');
    }
    const fid = crypto.randomUUID();
    const now = nowIso();
    return {
      writes: [
        personExists(person),
        guard(`(SELECT count(*) FROM person_field WHERE person = ? AND ${seen.sql}) = ?`, person, ...seen.params, at?.n ?? 0),
        q('INSERT INTO person_field (id, person, type, label, value, ord, visibility, owner, created_by, created_by_name, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          fid, person, f.type, f.label, JSON.stringify(storedValue(f.type, f.value)), (at?.last ?? -1) + 1, f.visibility, owner, who.account, by, now, by, now),
      ],
      history: fieldHistory(person, null, { id: fid, type: f.type, label: f.label, value: '{}', visibility: f.visibility, owner }),
      result: fid,
    };
  });
}

/**
 * Removes one field. Refuses a field that is not of the type the caller checked the role for. Someone else's personal
 * field is left alone, and it answers exactly as a field that does not exist does.
 */
export function deletePersonField(tree: string, id: string, op: OpKey | undefined, who: Audience, types?: readonly string[]) {
  return once(tree, op, 'deletePersonField', async (d) => {
    const row = await d.get<{ person: string; type: string; label: string; value: string; visibility: Visibility; owner: string | null }>('SELECT person, type, label, value, visibility, owner FROM person_field WHERE id = ?', id);
    if (!row || !maySee(who, row) || (types && !types.includes(row.type))) return { writes: [], history: [], result: undefined };
    return {
      writes: [
        guard('EXISTS (SELECT 1 FROM person_field WHERE id = ? AND person = ? AND type = ? AND visibility = ? AND owner IS ?)', id, row.person, row.type, row.visibility, row.owner),
        q('DELETE FROM person_field WHERE id = ?', id),
      ],
      history: fieldHistory(row.person, { id, ...row }, null),
      result: undefined,
    };
  });
}

/** Saves the portrait's look (the Appearance dialog). The caller has cleaned it with `sanitizeLook`. */
export function setPersonLook(tree: string, id: string, look: Look, op: OpKey | undefined) {
  return once(tree, op, 'setPersonLook', async (d) => {
    const row = await d.get<{ look: string | null }>('SELECT look FROM person WHERE id = ?', id);
    if (!row) throw new Error('Person not found.');
    return {
      writes: [personExists(id), q('UPDATE person SET look = ?, updated_at = ? WHERE id = ?', JSON.stringify(look), nowIso(), id)],
      history: change('portrait', id, { look: row.look }, { look: JSON.stringify(look) }, { person: id, opaque: ['look'] }),
      result: undefined,
    };
  });
}

/** The details the Needed page fills in, and the column each one is. */
const GAP_COLUMNS = { born: 'born', bornPlace: 'born_place', died: 'died', sex: 'sex', occupation: 'occupation' } as const;
export type GapField = keyof typeof GAP_COLUMNS;
/** What a fill left alone: values someone else entered after the page was loaded, which stay as they are. */
export interface FilledGaps { kept: GapField[] }

/**
 * Fills in the details the Needed page asked for. `seen` is each value as the page showed it (left out: empty), so a
 * value is written only while the person still has exactly that: a gap someone else filled in meanwhile is not
 * overwritten, and the answer names it so the page can say so. A value already there as typed counts as written.
 * With no `seen` at all the caller is replacing values it was shown itself, as an approved change from the assistant
 * does (and as a page loaded before this check existed does): then every value given is written.
 * Typing an occupation here also sets its vocabulary code, so the Needed page and the editor agree.
 */
export function fillGaps(tree: string, id: string, patch: Partial<Record<GapField, string>>, seen: Partial<Record<GapField, string | null>> | undefined, op: OpKey | undefined) {
  return once(tree, op, 'patchPerson', async (d) => {
    const now = await d.get<Record<string, string | null>>(`SELECT ${Object.values(GAP_COLUMNS).join(', ')} FROM person WHERE id = ?`, id);
    if (!now) throw new Error('Person not found.');
    const kept: GapField[] = [];
    const writes: Query[] = [];
    const assigns: string[] = [];
    const values: (string | null)[] = [];
    const was: Record<string, unknown> = {};
    const becomes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch) as [GapField, string | undefined][]) {
      if (v === undefined || v === '') continue;
      const col = GAP_COLUMNS[k];
      const stored = now[col] || null;
      if (stored === v) continue;
      if (seen && stored !== (seen[k] || null)) { kept.push(k); continue; }
      // The value as read, restated in the batch: a change that lands in between makes the plan decide again.
      writes.push(guard(`EXISTS (SELECT 1 FROM person WHERE id = ? AND coalesce(${col}, '') = ?)`, id, stored ?? ''));
      assigns.push(`${col} = ?`);
      values.push(v);
      was[col] = stored;
      becomes[col] = v;
      if (k === 'occupation') { assigns.push('occupation_code = ?'); values.push(occupationCodeFor(v)); }
    }
    if (assigns.length) writes.push(q(`UPDATE person SET ${assigns.join(', ')}, updated_at = ? WHERE id = ?`, ...values, nowIso(), id));
    return { writes, history: change('person', id, was, becomes, { person: id }), result: { kept } satisfies FilledGaps };
  });
}

/** Sets only the death place, for the assistant and the quick fixes. Blank clears it. */
export function setPersonDiedPlace(tree: string, id: string, place: string | null, op: OpKey | undefined) {
  return once(tree, op, 'setPersonDiedPlace', async (d) => {
    const row = await d.get<{ died_place: string | null }>('SELECT died_place FROM person WHERE id = ?', id);
    if (!row) throw new Error('Person not found.');
    return {
      writes: [
        guard('EXISTS (SELECT 1 FROM person WHERE id = ? AND died_place IS ?)', id, row.died_place),
        q('UPDATE person SET died_place = ?, updated_at = ? WHERE id = ?', empty(place), nowIso(), id),
      ],
      history: change('person', id, { died_place: row.died_place }, { died_place: empty(place) }, { person: id }),
      result: undefined,
    };
  });
}

/**
 * The first person of a family: the steward adds themselves from the first-run step. Stored with the given name and
 * surname apart (the setup splits the name it was given). Sets the family's starting point (meta `focus`) to them when
 * it has none yet. Returns the new person's id.
 */
export function addFirstPerson(tree: string, name: { given: string; surname: string }, op: OpKey | undefined) {
  return once(tree, op, 'addFirstPerson', async (d) => {
    const given = name.given.trim();
    if (!given) throw new Error('A given name is needed.');
    const focus = await d.get<{ value: string }>("SELECT value FROM meta WHERE key = 'focus'");
    const id = newId(given);
    const writes: Query[] = [
      guard("(SELECT value FROM meta WHERE key = 'focus') IS ?", focus?.value ?? null),
      q('INSERT INTO person (id, given, surname, living, updated_at) VALUES (?, ?, ?, 1, ?)', id, given, empty(name.surname), nowIso()),
    ];
    if (focus && focus.value === '') writes.push(q("UPDATE meta SET value = ? WHERE key = 'focus'", id));
    const full = [given, empty(name.surname)].filter(Boolean).join(' ');
    return { writes, history: [added('person', id, { person: id, personName: full, label: full })], result: id };
  });
}

/**
 * Puts one of a person's own facts back to a value from the history (an editor's "Restore this value"). It is a save like
 * any other: guarded on the person as read, and itself written to the history. The value is checked as the Edit tab checks
 * it; one that no longer fits (an unreadable date) is refused.
 */
export function restorePersonValue(tree: string, id: string, column: RestorableField, value: HistoryValue, op: OpKey | undefined) {
  return once(tree, op, 'restorePersonValue', async (d) => {
    const now = await d.get<EditRow & { revision: number }>(`SELECT revision, ${EDIT_COLUMNS.join(', ')} FROM person WHERE id = ?`, id);
    if (!now) throw new Error('Person not found.');
    const text = value === null ? null : empty(String(value));
    let cell: Cell = text;
    if (column === 'given' && !text) throw new Error('A given name is needed.');
    if (column === 'living') cell = value === 1 || value === '1' ? 1 : 0;
    if (column === 'sex' && text !== null && !['m', 'f', 'x'].includes(text)) throw new Error('history.err.cannot_restore');
    if ((column === 'born' || column === 'died') && text !== null && !validDate(text)) throw new Error('history.err.cannot_restore');
    if (column === 'further_given') cell = storeFurther(parseFurther(text));
    if (typeof cell === 'string' && cell.length > (column === 'bio' ? 20_000 : 200)) throw new Error('history.err.cannot_restore');
    const next: Record<EditColumn, Cell> = { ...(now as unknown as Record<EditColumn, Cell>), [column]: cell };
    if (column === 'occupation') next.occupation_code = text ? occupationCodeFor(text) : null;
    const cols = column === 'occupation' ? (['occupation', 'occupation_code'] as const) : ([column] as const);
    return {
      writes: [
        guard('EXISTS (SELECT 1 FROM person WHERE id = ? AND revision = ?)', id, now.revision),
        q(`UPDATE person SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...cols.map((c) => next[c]), nowIso(), id),
      ],
      history: change('person', id, { [column]: now[column] }, { [column]: next[column] }, { person: id, personName: nameOf(next as never), label: nameOf(next as never), fold: false }),
      result: undefined,
    };
  });
}
