// Laying a card's change over the person as they are now, for the same save the Edit tab makes. Pure, so a test can hold it
// to its rule: what the card showed must still be what the record says, or the reader is told it changed and nothing is written.
// A change that is already on the record counts as done, so a retry after a lost reply is not refused.
import { CHANGED_SINCE_OPENED, type FieldInput } from '~/lib/fields/model';
import type { EditSnapshot, PersonDetails } from '~/lib/person.server';

type Args = Record<string, unknown> & { clear?: string[]; before?: Record<string, unknown> };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const SETTABLE = ['given', 'furtherGiven', 'surname', 'currentGiven', 'currentSurname', 'nickname', 'title', 'epithet', 'sex', 'living', 'bio'] as const;

/** The Edit tab's details as they are in this snapshot. */
export const detailsOf = (s: EditSnapshot): PersonDetails => ({
  given: s.given, furtherGiven: s.furtherGiven, surname: s.surname, currentGiven: s.currentGiven, currentSurname: s.currentSurname,
  nickname: s.nickname, sex: s.sex, born: s.born, bornPlace: s.bornPlace, died: s.died, diedPlace: s.diedPlace, living: s.living,
  title: s.title, epithet: s.epithet, occupation: s.occupation, occupationCode: s.occupationCode, bio: s.bio,
});

/** The list the Edit tab sends back: every field this reader may see, as it is. */
export const fieldsOf = (s: EditSnapshot): FieldInput[] => s.fields.map((f) => ({ id: f.id, type: f.type, label: f.label, value: f.value, visibility: f.visibility }));

/** The details with this card's change laid over them, or `null` when they already say so. Throws when the record has moved on. */
export function mergeEdit(s: EditSnapshot, a: Args): PersonDetails | null {
  const current = detailsOf(s) as unknown as Record<string, unknown>;
  const sets = SETTABLE.filter((k) => a[k] !== undefined);
  const cleared = a.clear ?? [];
  const blank = (k: string) => (k === 'furtherGiven' ? [] : null);
  const already = sets.every((k) => same(current[k], a[k])) && cleared.every((k) => same(current[k], blank(k)));
  if (already) return null;
  for (const k of [...sets, ...cleared]) if (!same(current[k], a.before?.[k] ?? blank(k))) throw new Error(CHANGED_SINCE_OPENED);
  const next = { ...current };
  for (const k of sets) next[k] = a[k];
  for (const k of cleared) next[k] = blank(k);
  return next as unknown as PersonDetails;
}

/** The field list with one field changed, or `null` when it already says so. Throws when the field is gone or has moved on. */
export function mergeField(s: EditSnapshot, a: { field: string; label: string; value: Record<string, string>; visibility: FieldInput['visibility']; before: { label: string; value: Record<string, string>; visibility: string } }): FieldInput[] | null {
  const cur = s.fields.find((f) => f.id === a.field);
  if (!cur) throw new Error(CHANGED_SINCE_OPENED);
  if (cur.label === a.label && same(cur.value, a.value) && cur.visibility === a.visibility) return null;
  if (cur.label !== a.before.label || !same(cur.value, a.before.value) || cur.visibility !== a.before.visibility) throw new Error(CHANGED_SINCE_OPENED);
  return fieldsOf(s).map((f) => (f.id === a.field ? { ...f, label: a.label, value: a.value, visibility: a.visibility } : f));
}
