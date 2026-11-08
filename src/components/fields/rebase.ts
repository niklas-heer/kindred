// Rebasing an Edit draft onto the person's latest version, after a save was refused because the person changed.
// What the reader changed wins; what they did not touch takes the latest value, so the rebase never writes back
// an old copy of something someone else has since changed. Pure: the Edit tab and the tests use the same code.

/** A field in the draft (`key` is React's and is not compared; `id` is set once the family has saved the field). */
export interface RebaseField {
  key: string;
  id?: string;
  type: string;
  label: string;
  value: Record<string, string>;
  private: boolean;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameField = (a: RebaseField, b: RebaseField) =>
  a.type === b.type && a.label === b.label && a.private === b.private && same(a.value, b.value);

/**
 * The fields of the draft, rebased. In the draft's order: a field the reader changed keeps their version (if the
 * field was removed meanwhile, as a new field without an id, so their words are not lost); an unchanged field
 * takes the latest version; a field the reader removed stays removed. Fields that others added since the draft
 * was opened are kept, after the draft's own, so the save does not delete them.
 */
export function rebaseFields<F extends RebaseField>(base: F[], draft: F[], latest: F[]): F[] {
  const baseById = new Map(base.flatMap((f) => (f.id ? [[f.id, f] as const] : [])));
  const latestById = new Map(latest.flatMap((f) => (f.id ? [[f.id, f] as const] : [])));
  const draftIds = new Set(draft.flatMap((f) => (f.id ? [f.id] : [])));
  const out: F[] = [];
  for (const d of draft) {
    if (!d.id) {
      out.push(d);
      continue;
    }
    const was = baseById.get(d.id);
    const changed = !was || !sameField(d, was);
    const now = latestById.get(d.id);
    if (now) out.push(changed ? d : now);
    else if (changed) out.push({ ...d, id: undefined });
  }
  for (const l of latest) if (l.id && !baseById.has(l.id) && !draftIds.has(l.id)) out.push(l);
  return out;
}

/**
 * The whole draft, rebased: each scalar the reader changed (compared with the version they opened) keeps their
 * value, every other one takes the latest value, and the fields are rebased as above. `fields` is the list key.
 */
export function rebaseDraft<V extends { fields: F[] }, F extends RebaseField>(base: V, draft: V, latest: V): V {
  const out: Record<string, unknown> = { ...latest };
  for (const k of Object.keys(latest) as (keyof V & string)[]) {
    if (k === 'fields') continue;
    if (!same(draft[k], base[k])) out[k] = draft[k];
  }
  out.fields = rebaseFields(base.fields, draft.fields, latest.fields);
  return out as V;
}
