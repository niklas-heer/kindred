// The family's name and tagline, changed by a steward after setup. They are the tree's `meta` rows, which the graph
// (and so every page that shows the name) reads. The change goes through `once`, so a retry writes nothing twice.
import { change, guard, once, q, type OpKey } from './db.server.ts';
import { FAMILY_NAME_MAX } from './auth/trees.server.ts';

export const TAGLINE_MAX = 140;

/** A name and tagline as typed: one line each, the name required. Throws the translation key of the first problem. */
export function cleanFamilyDetails(raw: { name: string; tagline: string }): { name: string; tagline: string } {
  const line = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  const name = line(raw.name);
  const tagline = line(raw.tagline);
  if (!name) throw new Error('acc.family_name_required');
  if (name.length > FAMILY_NAME_MAX) throw new Error('acc.family_name_long');
  if (tagline.length > TAGLINE_MAX) throw new Error('acc.family_tagline_long');
  return { name, tagline };
}

/** Renames the family and sets its tagline. Returns what was saved. */
export function renameFamily(tree: string, raw: { name: string; tagline: string }, op: OpKey | undefined) {
  const details = cleanFamilyDetails(raw);
  return once(tree, op, 'renameFamily', async (d) => ({
    history: change('family', 'details', Object.fromEntries((await d.all<{ key: string; value: string }>("SELECT key, value FROM meta WHERE key IN ('name', 'tagline')")).map((r) => [r.key, r.value])), details, { label: details.name }),
    writes: [
      guard("EXISTS (SELECT 1 FROM meta WHERE key = 'id')"),
      q("INSERT INTO meta (key, value) VALUES ('name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", details.name),
      q("INSERT INTO meta (key, value) VALUES ('tagline', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", details.tagline),
    ],
    result: details,
  }));
}
