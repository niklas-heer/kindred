// Changes to a person's details and fields. Reads are in db.server.ts (`person`). Every change is a plan
// run through `once`: it reads what it decides on, guards those facts in the batch, and writes in one
// transaction, so a retried or racing request never writes twice or half-way (see db.server.ts).
import { guard, newId, once, personExists, q, type OpKey, type Query } from './db.server.ts';
import { CHANGED_SINCE_OPENED, MAX_FIELDS, storedValue, type FieldInput, type FieldType } from '../components/fields/model.ts';
import type { Look } from './types.ts';
import { occupationCodeFor } from './occupations.ts';

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

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const empty = (s: string | null) => (s === null || s.trim() === '' ? null : s.trim());

interface Existing { id: string; type: string; label: string; value: string; private: number; ord: number }

/**
 * Saves the details and the whole list of fields in one batch. `fields` is the list in its new order:
 * a field with an `id` is updated, one without is added, and any field of this person not in the list is
 * removed. `revision` is the person's revision when the draft was opened: if anything about the person has
 * changed since (a field added elsewhere, a name changed), the save is refused and the draft stays with the
 * reader. The batch restates the revision it read, so a change that lands between this check and the write
 * makes the batch write nothing, and the plan runs again on fresh reads (and then refuses).
 */
export function savePersonEdit(tree: string, id: string, details: PersonDetails, fields: FieldInput[], revision: number, op: OpKey | undefined, by: string) {
  return once(tree, op, 'savePersonEdit', async (d) => {
    const now = await d.get<{ revision: number }>('SELECT revision FROM person WHERE id = ?', id);
    if (!now) throw new Error('Person not found.');
    if (now.revision !== revision) throw new Error(CHANGED_SINCE_OPENED);
    const had = await d.all<Existing>('SELECT id, type, label, value, private, ord FROM person_field WHERE person = ?', id);
    const hadById = new Map(had.map((r) => [r.id, r]));
    const kept = new Set<string>();
    // What the plan read: the person at this revision (every change bumps it, see migration 0009), and the fields.
    const writes: Query[] = [
      guard('EXISTS (SELECT 1 FROM person WHERE id = ? AND revision = ?)', id, revision),
      guard('(SELECT count(*) FROM person_field WHERE person = ?) = ?', id, had.length),
    ];

    for (const [ord, f] of fields.entries()) {
      const value = storedValue(f.type as FieldType, f.value);
      const json = JSON.stringify(value);
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
        const same = before.label === f.label && before.value === json && before.private === (f.private ? 1 : 0) && before.ord === ord;
        if (!same) {
          writes.push(q(
            'UPDATE person_field SET label = ?, value = ?, private = ?, ord = ?, updated_by = ?, updated_at = ? WHERE id = ? AND person = ?',
            f.label, json, f.private ? 1 : 0, ord, by, nowIso(), f.id, id,
          ));
        }
      } else {
        writes.push(q(
          'INSERT INTO person_field (id, person, type, label, value, ord, private, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          crypto.randomUUID(), id, f.type, f.label, json, ord, f.private ? 1 : 0, by, nowIso(), by, nowIso(),
        ));
      }
    }
    for (const r of had) if (!kept.has(r.id)) writes.push(q('DELETE FROM person_field WHERE id = ? AND person = ?', r.id, id));

    const s = details;
    writes.push(q(
      `UPDATE person SET given = ?, surname = ?, current_given = ?, current_surname = ?, nickname = ?, sex = ?, born = ?, born_place = ?,
        died = ?, died_place = ?, living = ?, title = ?, epithet = ?, occupation = ?, occupation_code = ?, bio = ?, updated_at = ? WHERE id = ?`,
      s.given.trim(), empty(s.surname), empty(s.currentGiven), empty(s.currentSurname), empty(s.nickname), s.sex, empty(s.born),
      empty(s.bornPlace), empty(s.died), empty(s.diedPlace), s.living ? 1 : 0, empty(s.title), empty(s.epithet), empty(s.occupation),
      empty(s.occupation) ? occupationCodeFor(empty(s.occupation), s.occupationCode) : null,
      empty(s.bio), nowIso(), id,
    ));
    return { writes, result: undefined };
  });
}

/** Adds one field to the end of a person's list (the Everyday tab's quick add for a contact). Returns its id. */
export function addPersonField(tree: string, person: string, f: FieldInput, op: OpKey | undefined, by: string) {
  return once(tree, op, 'addPersonField', async (d) => {
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
        q('INSERT INTO person_field (id, person, type, label, value, ord, private, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          fid, person, f.type, f.label, JSON.stringify(storedValue(f.type, f.value)), (at?.last ?? -1) + 1, f.private ? 1 : 0, by, now, by, now),
      ],
      result: fid,
    };
  });
}

/** Removes one field. Refuses a field that is not of the type the caller checked the role for. */
export function deletePersonField(tree: string, id: string, op: OpKey | undefined) {
  return once(tree, op, 'deletePersonField', async (d) => {
    const row = await d.get<{ person: string; type: string }>('SELECT person, type FROM person_field WHERE id = ?', id);
    if (!row) return { writes: [], result: undefined };
    return {
      writes: [
        guard('EXISTS (SELECT 1 FROM person_field WHERE id = ? AND person = ? AND type = ?)', id, row.person, row.type),
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
