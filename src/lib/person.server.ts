// Changes to a person's details and fields. Reads are in db.server.ts (`person`), and the Edit tab's read is
// `editSnapshot` below. Every change is a plan run through `once`: it reads what it decides on, guards those facts in
// the batch, and writes in one transaction, so a retried or racing request never writes twice or half-way (see
// db.server.ts).
import { db, fieldOf, guard, newId, once, personExists, q, type OpKey, type Query } from './db.server.ts';
import { CHANGED_SINCE_OPENED, MAX_FIELDS, storedValue, type FieldInput, type FieldType, type FieldValue, type PersonField } from '../components/fields/model.ts';
import type { Look } from './types.ts';
import { occupationCodeFor } from './occupations.ts';
import { translate } from './i18n/dictionary.ts';
import { fieldsVisibleTo, maySee, type Audience, type Visibility } from './visibility.ts';

/** The message a save gets when the person changed after the draft was opened (the reader sees it in their language). */
export { CHANGED_SINCE_OPENED };

/** The scalar details of a person, as the Edit tab saves them. Names: a null current name means "same as birth". */
export interface PersonDetails {
  given: string;
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
  revision: number;
  given: string;
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
  'given', 'surname', 'current_given', 'current_surname', 'nickname', 'sex', 'born', 'born_place', 'died', 'died_place',
  'living', 'title', 'epithet', 'occupation', 'occupation_code', 'bio',
] as const;
type EditColumn = (typeof EDIT_COLUMNS)[number];
type Cell = string | number | null;
/** The row as the database gives it (see `EDIT_COLUMNS`). */
interface EditRow {
  given: string; surname: string | null; current_given: string | null; current_surname: string | null; nickname: string | null;
  sex: 'm' | 'f' | 'x' | null; born: string | null; born_place: string | null; died: string | null; died_place: string | null;
  living: number; title: string | null; epithet: string | null; occupation: string | null; occupation_code: string | null; bio: string | null;
}

/** How often `editSnapshot` reads again when the person changes in the middle of the read. */
const SNAPSHOT_ATTEMPTS = 3;

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const empty = (s: string | null) => (s === null || s.trim() === '' ? null : s.trim());

interface Existing { id: string; type: string; label: string; value: string; visibility: Visibility; owner: string | null; ord: number }

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
        revision: r.revision,
        given: r.given,
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
        fields: fields.map(fieldOf),
      };
    }
    if (attempt >= SNAPSHOT_ATTEMPTS) throw new Error('The family changed while this was loaded. Please try again.');
  }
}

/**
 * Saves the details and the whole list of fields in one batch. `fields` is the list in its new order: a field with an
 * `id` is updated, one without is added, and any field of this person not in the list is removed. `revision` is the
 * person's revision when the draft was opened: if anything about the person has changed since (a field added elsewhere,
 * a name changed), the save is refused and the draft stays with the reader. The batch restates the revision it read, so a
 * change that lands between this check and the write makes the batch write nothing, and the plan runs again on fresh
 * reads (and then refuses).
 *
 * Only what changed is written: a field whose content, label, privacy and position are as stored is left alone (so its
 * last editor and time stand), and the person's row is written only if one of its columns differs. Each write moves the
 * revision once per row, so a save of one nickname makes one step, not several.
 *
 * `who` is the person saving. The list only ever covers what they may see: someone else's personal field is not in their
 * draft, so it is neither removed nor changed, and an id naming one is refused as any unknown field is.
 */
export function savePersonEdit(tree: string, id: string, details: PersonDetails, fields: FieldInput[], revision: number, op: OpKey | undefined, by: string, who: Audience) {
  return once(tree, op, 'savePersonEdit', async (d) => {
    const now = await d.get<EditRow & { revision: number }>(`SELECT revision, ${EDIT_COLUMNS.join(', ')} FROM person WHERE id = ?`, id);
    if (!now) throw new Error('Person not found.');
    if (now.revision !== revision) throw new Error(CHANGED_SINCE_OPENED);
    const seen = fieldsVisibleTo(who);
    const had = await d.all<Existing>(`SELECT id, type, label, value, visibility, owner, ord FROM person_field WHERE person = ? AND ${seen.sql}`, id, ...seen.params);
    const hadById = new Map(had.map((r) => [r.id, r]));
    const kept = new Set<string>();
    // What the plan read: the person at this revision (every change bumps it, see migration 0009), and the fields.
    // Every decision below rests on that revision, so the guard covers the person's columns as well.
    const writes: Query[] = [
      guard('EXISTS (SELECT 1 FROM person WHERE id = ? AND revision = ?)', id, revision),
      guard(`(SELECT count(*) FROM person_field WHERE person = ? AND ${seen.sql}) = ?`, id, ...seen.params, had.length),
    ];

    for (const [ord, f] of fields.entries()) {
      const owner = ownerFor(f.visibility, who);
      const value = storedValue(f.type as FieldType, f.value);
      if (f.type === 'related' && value.person) {
        if (!(await d.get('SELECT id FROM person WHERE id = ?', value.person))) throw new Error('That person is not in this family.');
        if (value.person === id) throw new Error('A person cannot be their own relative.');
        writes.push(guard('EXISTS (SELECT 1 FROM person WHERE id = ?)', value.person));
      }
      if (f.id) {
        const before = hadById.get(f.id);
        if (!before || before.type !== f.type) throw new Error('That field is not on this person.');
        kept.add(f.id);
        writes.push(guard('EXISTS (SELECT 1 FROM person_field WHERE id = ? AND person = ?)', f.id, id));
        const sameText = sameContent(before.value, value);
        const same = before.label === f.label && before.visibility === f.visibility && before.owner === owner && before.ord === ord && sameText;
        if (!same) {
          writes.push(q(
            'UPDATE person_field SET label = ?, value = ?, visibility = ?, owner = ?, ord = ?, updated_by = ?, updated_at = ? WHERE id = ? AND person = ?',
            f.label, sameText ? before.value : JSON.stringify(value), f.visibility, owner, ord, by, nowIso(), f.id, id,
          ));
        }
      } else {
        writes.push(q(
          'INSERT INTO person_field (id, person, type, label, value, ord, visibility, owner, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          crypto.randomUUID(), id, f.type, f.label, JSON.stringify(value), ord, f.visibility, owner, by, nowIso(), by, nowIso(),
        ));
      }
    }
    for (const r of had) if (!kept.has(r.id)) writes.push(q('DELETE FROM person_field WHERE id = ? AND person = ?', r.id, id));

    const s = details;
    const occupation = empty(s.occupation);
    const next: Record<EditColumn, Cell> = {
      given: s.given.trim(), surname: empty(s.surname), current_given: empty(s.currentGiven), current_surname: empty(s.currentSurname),
      nickname: empty(s.nickname), sex: s.sex, born: empty(s.born), born_place: empty(s.bornPlace), died: empty(s.died),
      died_place: empty(s.diedPlace), living: s.living ? 1 : 0, title: empty(s.title), epithet: empty(s.epithet),
      occupation, occupation_code: occupation ? occupationCodeFor(occupation, s.occupationCode) : null, bio: empty(s.bio),
    };
    const changed = EDIT_COLUMNS.filter((c) => next[c] !== now[c]);
    if (changed.length) {
      writes.push(q(
        `UPDATE person SET ${changed.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        ...changed.map((c) => next[c]), nowIso(), id,
      ));
    }
    return { writes, result: undefined };
  });
}

/** Adds one field to the end of a person's list (the Everyday tab's quick add for a contact). Returns its id. */
export function addPersonField(tree: string, person: string, f: FieldInput, op: OpKey | undefined, by: string, who: Audience) {
  return once(tree, op, 'addPersonField', async (d) => {
    const owner = ownerFor(f.visibility, who);
    if (!(await d.get('SELECT id FROM person WHERE id = ?', person))) throw new Error('Person not found.');
    const at = await d.get<{ n: number; last: number }>('SELECT count(*) AS n, coalesce(max(ord), -1) AS last FROM person_field WHERE person = ?', person);
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
        guard('(SELECT count(*) FROM person_field WHERE person = ?) = ?', person, at?.n ?? 0),
        q('INSERT INTO person_field (id, person, type, label, value, ord, visibility, owner, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          fid, person, f.type, f.label, JSON.stringify(storedValue(f.type, f.value)), (at?.last ?? -1) + 1, f.visibility, owner, by, now, by, now),
      ],
      result: fid,
    };
  });
}

/**
 * Removes one field. Refuses a field that is not of the type the caller checked the role for. Someone else's personal
 * field is left alone, and it answers exactly as a field that does not exist does.
 */
export function deletePersonField(tree: string, id: string, op: OpKey | undefined, who: Audience) {
  return once(tree, op, 'deletePersonField', async (d) => {
    const row = await d.get<{ person: string; type: string; visibility: Visibility; owner: string | null }>('SELECT person, type, visibility, owner FROM person_field WHERE id = ?', id);
    if (!row || !maySee(who, row)) return { writes: [], result: undefined };
    return {
      writes: [
        guard('EXISTS (SELECT 1 FROM person_field WHERE id = ? AND person = ? AND type = ? AND visibility = ? AND owner IS ?)', id, row.person, row.type, row.visibility, row.owner),
        q('DELETE FROM person_field WHERE id = ?', id),
      ],
      result: undefined,
    };
  });
}

/** Saves the portrait's look (the Appearance dialog). The caller has cleaned it with `sanitizeLook`. */
export function setPersonLook(tree: string, id: string, look: Look, op: OpKey | undefined) {
  return once(tree, op, 'setPersonLook', async (d) => {
    if (!(await d.get('SELECT id FROM person WHERE id = ?', id))) throw new Error('Person not found.');
    return {
      writes: [personExists(id), q('UPDATE person SET look = ?, updated_at = ? WHERE id = ?', JSON.stringify(look), nowIso(), id)],
      result: undefined,
    };
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
    return { writes, result: id };
  });
}
