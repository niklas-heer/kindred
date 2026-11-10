// Patching the page's copy of the family after an Edit save, instead of reading the whole family again. The save answers
// with the person as the saver's graph now has them (`GraphPatch`, see savePersonEdit), so only that person changes.
// Anything the answer does not carry is left to a full read: `patchPerson` returns null and the caller refetches.
import { EDITED_KEYS, type GPerson, type Graph, type GraphPatch } from './types.ts';

/** The family with one person patched, or null when the patch cannot be applied safely and the family must be read again. */
export function patchPerson(g: Graph | undefined, id: string, patch: GraphPatch | undefined): Graph | null {
  if (!g || !patch) return null;
  const old = g.people.find((p) => p.id === id);
  if (!old) return null;
  // A painted portrait's drawn age follows the birth date and the photo's year, which only the full read knows.
  if (old.portrait && (patch.born ?? undefined) !== old.born) return null;
  const next = { ...old } as Record<string, unknown>;
  for (const k of [...EDITED_KEYS, 'contacts'] as const) {
    const v = patch[k];
    // The graph leaves an absent value out (db.server.ts, `defined`), so "none" is a missing key here too.
    if (v === null || v === undefined) delete next[k];
    else next[k] = v;
  }
  return { ...g, people: g.people.map((p) => (p.id === id ? (next as unknown as GPerson) : p)) };
}
