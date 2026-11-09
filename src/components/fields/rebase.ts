// Rebasing an Edit draft onto the person's latest version, after a save was refused because the person changed, or when a
// draft left on this device is opened again.
// What the reader changed stays changed; what they did not touch takes the latest value, so the rebase never writes
// back an old copy of something someone else has since changed. Where the reader and someone else both changed the
// same thing to different values, the reader's version stays in the draft and the case comes back as a conflict, so
// the Edit tab can show both versions and the reader chooses. Pure: the Edit tab and the tests use the same code.

import type { Visibility } from '../../lib/visibility.ts';

/** A field in the draft (`key` is React's; `id` is set once the family has saved the field). */
export interface RebaseField {
  key: string;
  id?: string;
  type: string;
  label: string;
  value: Record<string, string>;
  visibility: Visibility;
}

/** Scalars saved as one unit: the occupation text and its vocabulary code, so a save never stores one with the other's partner. */
export const UNITS: string[][] = [['occupation', 'occupationCode']];

/**
 * Something the reader and someone else both changed, to different values. A `value` conflict is one scalar, or a unit,
 * named by `keys`; `mine` and `theirs` hold those keys. A `field` conflict is a field by its `id`: `mine` is null when the
 * reader removed it, `theirs` is null when someone else did. `before` lists the ids of the fields that came before it
 * when the reader opened the draft, nearest first: "Use theirs" puts a removed field back after the nearest of them.
 */
export type Conflict<F extends RebaseField = RebaseField> =
  | { kind: 'value'; keys: string[]; mine: Record<string, unknown>; theirs: Record<string, unknown> }
  | { kind: 'field'; id: string; before: string[]; mine: F | null; theirs: F | null };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const at = (o: object, k: string): unknown => (o as Record<string, unknown>)[k];
const sameField = (a: RebaseField, b: RebaseField) =>
  a.type === b.type && a.label === b.label && a.visibility === b.visibility && same(a.value, b.value);
const byId = <F extends RebaseField>(fields: F[]) => new Map(fields.flatMap((f) => (f.id ? [[f.id, f] as const] : [])));

/**
 * The fields of the draft, rebased. In the draft's order: a field the reader changed keeps their version (if the
 * field was removed meanwhile, as a new field without an id, so their words are not lost); an unchanged field
 * takes the latest version; a field the reader removed stays removed. Fields that others added since the draft
 * was opened are kept, after the draft's own, so the save does not delete them.
 */
export function rebaseFields<F extends RebaseField>(base: F[], draft: F[], latest: F[]): F[] {
  const baseById = byId(base);
  const latestById = byId(latest);
  const draftIds = new Set(draft.flatMap((f) => (f.id ? [f.id] : [])));
  const claimed = new Set<string>();
  const out: F[] = [];
  for (const d of draft) {
    if (!d.id) {
      // Its save got through but the answer was lost: the field is already there, so it takes that id and is not added twice.
      const twin = latest.find((l) => l.id && !baseById.has(l.id) && !draftIds.has(l.id) && !claimed.has(l.id) && sameField(l, d));
      if (twin) claimed.add(twin.id!);
      out.push(twin ? { ...d, id: twin.id } : d);
      continue;
    }
    const was = baseById.get(d.id);
    const changed = !was || !sameField(d, was);
    const now = latestById.get(d.id);
    if (now) out.push(changed ? d : now);
    else if (changed) out.push({ ...d, id: undefined });
  }
  for (const l of latest) if (l.id && !baseById.has(l.id) && !draftIds.has(l.id) && !claimed.has(l.id)) out.push(l);
  return out;
}

/** The fields the reader and someone else both changed (or one removed and the other changed): see `Conflict`. */
export function fieldConflicts<F extends RebaseField>(base: F[], draft: F[], latest: F[]): Conflict<F>[] {
  const baseById = byId(base);
  const draftById = byId(draft);
  const latestById = byId(latest);
  const ids = base.flatMap((f) => (f.id ? [f.id] : []));
  const out: Conflict<F>[] = [];
  ids.forEach((id, i) => {
    const was = baseById.get(id)!;
    const mine = draftById.get(id) ?? null;
    const theirs = latestById.get(id) ?? null;
    const reader = !mine || !sameField(mine, was);
    const other = !theirs || !sameField(theirs, was);
    if (!reader || !other) return;
    if (!mine && !theirs) return; // both removed it
    if (mine && theirs && sameField(mine, theirs)) return; // both made the same change
    out.push({ kind: 'field', id, before: ids.slice(0, i).reverse(), mine, theirs });
  });
  return out;
}

/**
 * The whole draft, rebased. Each scalar (and each unit) the reader changed, compared with the version they opened, keeps
 * their value; every other one takes the latest value. Where someone else changed it too, to a different value, the
 * reader's value is kept and the case is returned in `conflicts`, so nothing is overwritten without the reader seeing it.
 * The fields are rebased as above; `fields` is the list key.
 */
export function rebaseDraft<V extends { fields: F[] }, F extends RebaseField>(base: V, draft: V, latest: V): { values: V; conflicts: Conflict<F>[] } {
  const out: Record<string, unknown> = { ...latest };
  const conflicts: Conflict<F>[] = [];
  const unitKeys = new Set(UNITS.flat());
  const groups: string[][] = [
    ...UNITS,
    ...Object.keys(latest).filter((k) => k !== 'fields' && !unitKeys.has(k)).map((k) => [k]),
  ];
  for (const keys of groups) {
    if (!keys.some((k) => !same(at(draft, k), at(base, k)))) continue; // the reader did not touch it: latest stays
    for (const k of keys) out[k] = at(draft, k);
    const other = keys.some((k) => !same(at(latest, k), at(base, k)));
    if (other && keys.some((k) => !same(at(draft, k), at(latest, k)))) {
      const pick = (v: object) => Object.fromEntries(keys.map((k) => [k, at(v, k)]));
      conflicts.push({ kind: 'value', keys, mine: pick(draft), theirs: pick(latest) });
    }
  }
  out.fields = rebaseFields(base.fields, draft.fields, latest.fields);
  return { values: out as V, conflicts: [...conflicts, ...fieldConflicts(base.fields, draft.fields, latest.fields)] };
}

/**
 * The draft with one conflict settled on the other person's version. Keeping the reader's version needs no change:
 * the rebased draft already holds it.
 */
export function takeTheirs<V extends { fields: F[] }, F extends RebaseField>(draft: V, c: Conflict<F>): V {
  if (c.kind === 'value') return { ...draft, ...c.theirs } as V;
  const matches = (f: F) => f.id === c.id || f.key === c.id;
  if (!c.theirs) return { ...draft, fields: draft.fields.filter((f) => !matches(f)) };
  const theirs = c.theirs;
  const first = draft.fields.findIndex(matches);
  if (first < 0) {
    // Put back where it was: after the nearest field that came before it and is still in the draft, else first.
    const index = restoreIndex(draft.fields, c.before);
    return { ...draft, fields: [...draft.fields.slice(0, index), theirs, ...draft.fields.slice(index)] };
  }
  return { ...draft, fields: draft.fields.flatMap((f, i) => (i === first ? [theirs] : matches(f) ? [] : [f])) };
}

/** The index a removed field goes back to: just after the nearest id in `before` that the list still has, else 0. */
function restoreIndex<F extends RebaseField>(fields: F[], before: string[]): number {
  for (const id of before) {
    const i = fields.findIndex((f) => f.id === id || f.key === id);
    if (i >= 0) return i + 1;
  }
  return 0;
}
