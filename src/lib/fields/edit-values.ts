// What the Edit tab's draft is, and which part of it can be written now. Autosave runs while the reader is half way through
// typing, so a part that is not valid yet (an email without its domain, a date that is not real) stays in the form with its
// red mark, and the server keeps the last good version of that part while the rest is saved. No React here, so the test
// runner loads it.
import { periodOf, storedIssue } from '../partial-date.ts';
import type { PlaceValue } from '../../components/PlaceInput';
import type { Journal } from './autosave.ts';
import type { DraftField } from '../../components/fields/FieldEditor';
import { blankValue, fieldIssue, storedValue } from './model.ts';
import { rebaseDraft, type Conflict } from './rebase.ts';

export interface EditValues {
  given: string; furtherGiven: string[]; surname: string; sameName: boolean; currentGiven: string; currentSurname: string;
  nickname: string; sex: '' | 'm' | 'f' | 'x';
  born: string; bornPlace: PlaceValue; died: string; diedPlace: PlaceValue; living: boolean;
  title: string; epithet: string; occupation: string; occupationCode: string; bio: string;
  fields: DraftField[];
}

/** A new card nobody has written in yet: it is not a problem, it just has nothing to save. */
export const isBlankNew = (f: Pick<DraftField, 'id' | 'value'>) => !f.id && Object.values(f.value).every((x) => !x.trim());

/**
 * The draft as it can be written now, against the version the server has (`saved`): each part that is not valid yet is
 * replaced by its saved version, and a new field that is not valid yet is left out. `held` says that something the reader
 * wrote is being kept back.
 */
export function sendable(v: EditValues, saved: EditValues, today: string): { values: EditValues; held: boolean } {
  let held = false;
  const out: EditValues = { ...v };
  if (!v.given.trim()) { out.given = saved.given; held = true; }
  if (!v.sameName && !v.currentGiven.trim()) { out.currentGiven = saved.currentGiven; held = true; }
  if (storedIssue(v.born, { notAfter: today })) { out.born = saved.born; held = true; }
  if (storedIssue(v.died, { notBefore: v.living ? undefined : periodOf(out.born)?.from })) {
    out.died = saved.died;
    if (!v.living) held = true;
  }
  const had = new Map(saved.fields.flatMap((f) => (f.id ? [[f.id, f] as const] : [])));
  out.fields = v.fields.flatMap((f) => {
    if (!fieldIssue(f.type, f.value)) return [f];
    if (!isBlankNew(f)) held = true;
    const last = f.id ? had.get(f.id) : undefined;
    return last ? [last] : [];
  });
  return { values: out, held };
}

/** Whether Personal can be chosen for a field: the browser's side of `mayBePersonal` (visibility.ts). A field not saved yet will be the reader's own. */
export const offersPersonal = (f: Pick<DraftField, 'id' | 'authored' | 'visibility'>) => !f.id || !!f.authored || f.visibility === 'personal';

/**
 * The draft with no saved field asking to be personal when the server would refuse it. Undo can ask for it by taking back the
 * sharing of a field with no recorded author. Such a field keeps the level it has now. Returns `v` itself if nothing changes.
 */
export function keepShared(v: EditValues, saved: EditValues): EditValues {
  const held = new Map(saved.fields.flatMap((f) => (f.id ? [[f.id, f] as const] : [])));
  const heldBy = (f: DraftField) => (f.id ? held.get(f.id) : undefined);
  const refused = (f: DraftField) => { const was = heldBy(f); return f.visibility === 'personal' && !!was && !offersPersonal(was); };
  if (!v.fields.some(refused)) return v;
  return { ...v, fields: v.fields.map((f) => (refused(f) ? { ...f, visibility: heldBy(f)!.visibility } : f)) };
}

/** The scalars and the fields as the server's save takes them. */
export function wireOf(v: EditValues) {
  return {
    details: {
      given: v.given, furtherGiven: v.furtherGiven.map((x) => x.trim()).filter(Boolean), surname: v.surname, nickname: v.nickname, sex: v.sex || null,
      currentGiven: v.sameName ? null : v.currentGiven, currentSurname: v.sameName ? null : v.currentSurname,
      born: v.born, bornPlace: v.bornPlace.name, died: v.died, diedPlace: v.diedPlace.name, living: v.living,
      title: v.title, epithet: v.epithet, occupation: v.occupation, occupationCode: v.occupationCode || null, bio: v.bio,
    },
    fields: v.fields.map((f) => ({ id: f.id, type: f.type, label: f.label, value: f.value, visibility: f.visibility })),
  };
}

/**
 * What a write of this draft would say, as text. A field's id is left out: learning the id of a field just added is not a
 * change. A place's coordinates are kept in: pinning a place on the map under the same name is.
 */
export function signatureOf(v: EditValues): string {
  const { details, fields } = wireOf(v);
  return JSON.stringify({ details, bornPlace: v.bornPlace, diedPlace: v.diedPlace, fields: fields.map(({ id: _id, ...rest }) => rest) });
}

/** A written draft as the server holds it: trimmed, and with only the keys each field's type has. */
export function storedForm(v: EditValues): EditValues {
  const trimmedPlace = (p: PlaceValue): PlaceValue => ({ ...p, name: p.name.trim() });
  return {
    ...v,
    given: v.given.trim(), furtherGiven: v.furtherGiven.map((x) => x.trim()).filter(Boolean), surname: v.surname.trim(),
    currentGiven: v.currentGiven.trim(), currentSurname: v.currentSurname.trim(), nickname: v.nickname.trim(),
    born: v.born.trim(), bornPlace: trimmedPlace(v.bornPlace), died: v.died.trim(), diedPlace: trimmedPlace(v.diedPlace),
    title: v.title.trim(), epithet: v.epithet.trim(), occupation: v.occupation.trim(),
    occupationCode: v.occupation.trim() ? v.occupationCode : '', bio: v.bio.trim(),
    fields: v.fields.map((f) => ({ ...f, label: f.label.trim(), value: { ...blankValue(f.type), ...storedValue(f.type, f.value) } })),
  };
}

/**
 * The form's first values: the server's (`latest`), with any draft left on this device rebased onto them. `restored` says
 * the draft brought something back that the server does not have; `leftOver` says a draft was there at all, which also
 * covers the write that reached the server as the page went away, its answer lost with the page: the server has the
 * reader's words, and the status line says so instead of starting again as if nothing had been typed.
 */
export function openDraft(latest: EditValues, left: Journal<EditValues> | null) {
  if (!left) return { start: latest, base: latest, conflicts: [] as Conflict<DraftField>[], restored: false, leftOver: false, unchosen: null };
  const { values, conflicts } = rebaseDraft<EditValues, DraftField>(left.base, left.draft, latest);
  return { start: values, base: latest, conflicts, restored: signatureOf(values) !== signatureOf(latest), leftOver: true, unchosen: conflicts.length ? left.base : null };
}
