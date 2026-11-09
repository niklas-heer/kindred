// The rules for connecting two people who are already in the tree: the plan behind `linkRelative` (api.ts) and
// behind each link of an assistant's family draft (ai/family.server.ts). Both run the same checks, so a draft can
// never link what the form would refuse. A plan reads what it needs and guards every fact it read (db.server.ts `once`).
import { guard, media, q, sameBorn, sameParents, type Db, type Plan } from './db.server';
import type { LinkResult } from './api';
import { bornBeforeParent, MAX_PARENTS } from './parent-rules';

export interface LinkInput {
  anchor: string;
  person: string;
  relation: 'parent' | 'child' | 'sibling' | 'partner';
  /** For a child: the anchor's partner who is the other parent. */
  coParent?: string;
  partnership?: { kind: 'marriage' | 'partnership' | 'other'; start?: string; place?: string };
}

/** A random id for a partnership row, as the form makes it. */
function partnershipId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Connects an existing person without inventing couples or duplicating edges. Refuses a third parent, a child born
 * before (or with) their parent, a loop in the ancestry, and a link that already exists.
 */
export async function linkPlan(d: Db, data: LinkInput): Promise<Plan<LinkResult>> {
  if (data.anchor === data.person) throw new Error('A person cannot be their own relative.');
  // Everything a check reads is guarded in the batch: birth dates, parent sets, the ancestry, partners.
  const guards: ReturnType<typeof q>[] = [];
  const born = new Map<string, string | null>();
  const people = new Map<string, { given: string; born: string | null }>();
  for (const id of [data.anchor, data.person, data.coParent].filter((x): x is string => !!x)) {
    const r = await d.get<{ given: string; born: string | null }>('SELECT given, born FROM person WHERE id = ?', id);
    if (!r) throw new Error('Person not found.');
    people.set(id, r);
    born.set(id, r.born);
  }
  const parentSets = new Map<string, string[]>();
  const parentsOf = async (id: string) => {
    let ps = parentSets.get(id);
    if (!ps) parentSets.set(id, (ps = (await d.all<{ parent: string }>('SELECT parent FROM parent WHERE child = ?', id)).map((r) => r.parent)));
    return ps;
  };
  const created: LinkResult = { person: data.person, parents: [] };
  // All checks for every edge first, then the writes, so a refusal never leaves half a link.
  const edges: [child: string, parent: string][] = [];
  if (data.relation === 'parent') edges.push([data.anchor, data.person]);
  if (data.relation === 'child') {
    edges.push([data.person, data.anchor]);
    if (data.coParent && data.coParent !== data.anchor) edges.push([data.person, data.coParent]);
  }
  if (data.relation === 'sibling') {
    const ps = await parentsOf(data.anchor);
    if (!ps.length) throw new Error('Record a shared parent first to link siblings.');
    const theirs = await parentsOf(data.person);
    if (ps.every((p) => theirs.includes(p))) throw new Error(`${people.get(data.person)!.given} is already their sibling.`);
    for (const p of ps) edges.push([data.person, p]);
  }
  const name = (id: string) => d.get<{ given: string }>('SELECT given FROM person WHERE id = ?', id);
  const bornOf = async (id: string) => {
    if (!born.has(id)) born.set(id, (await d.get<{ born: string | null }>('SELECT born FROM person WHERE id = ?', id))?.born ?? null);
    return born.get(id)!;
  };
  const newParents = new Map<string, Set<string>>();
  for (const [child, parent] of edges) {
    if (child === parent) throw new Error('A person cannot be their own parent.');
    const had = await parentsOf(child);
    if (had.includes(parent)) {
      if (data.relation === 'sibling') continue; // a shared parent they already have
      throw new Error(`${(await name(parent))?.given ?? 'They'} is already ${(await name(child))?.given ?? 'their'}’s parent.`);
    }
    const all = newParents.get(child) ?? new Set(had);
    all.add(parent);
    newParents.set(child, all);
    if (all.size > MAX_PARENTS) throw new Error(`${(await name(child))?.given ?? 'They'} already has two parents.`);
    if (bornBeforeParent(await bornOf(child), await bornOf(parent))) throw new Error(`${(await name(child))?.given ?? 'The child'} was born before ${(await name(parent))?.given ?? 'the parent'}, so cannot be their child.`);
    const ancestry = 'WITH RECURSIVE ancestors(id) AS (SELECT parent FROM parent WHERE child = ? UNION SELECT p.parent FROM parent p JOIN ancestors a ON p.child = a.id) SELECT id FROM ancestors WHERE id = ?';
    if (await d.get(ancestry, parent, child)) throw new Error('This would create a loop in the ancestry.');
    guards.push(guard(`NOT EXISTS (${ancestry})`, parent, child));
  }
  for (const [id, b] of born) guards.push(sameBorn(id, b));
  for (const [id, ps] of parentSets) guards.push(sameParents(id, ps));
  const writes = [...guards];
  if (data.relation === 'partner') {
    const pair = '(a = ? AND b = ?) OR (a = ? AND b = ?)';
    if (await d.get(`SELECT id FROM partnership WHERE ${pair}`, data.anchor, data.person, data.person, data.anchor)) {
      throw new Error(`${people.get(data.person)!.given} is already their partner.`);
    }
    const id = partnershipId();
    writes.push(
      guard(`NOT EXISTS (SELECT 1 FROM partnership WHERE ${pair})`, data.anchor, data.person, data.person, data.anchor),
      q('INSERT INTO partnership (id, a, b, kind, start, place) VALUES (?, ?, ?, ?, ?, ?)', id, data.anchor, data.person, data.partnership?.kind ?? 'partnership', data.partnership?.start ?? null, data.partnership?.place ?? null),
    );
    created.partnership = id;
  }
  // The guards hold every parent set as read, so exactly the edges not already there are new.
  for (const [child, parent] of edges) {
    writes.push(q('INSERT OR IGNORE INTO parent (child, parent) VALUES (?, ?)', child, parent));
    if (!(await parentsOf(child)).includes(parent) && !created.parents.some((e) => e.child === child && e.parent === parent)) created.parents.push({ child, parent });
  }
  return { writes, result: created };
}

/**
 * Takes a person out of the tree. Their links, stories and contacts go by cascade; their photo file and every painted
 * portrait file (accepted, kept or draft, whatever its state) are deleted once the batch committed.
 */
export async function removePlan(d: Db, tree: string, id: string): Promise<Plan<number>> {
  // The tree must keep a person to open on.
  const focus = await d.get<{ value: string }>("SELECT value FROM meta WHERE key = 'focus'");
  const writes = [
    guard("(SELECT value FROM meta WHERE key = 'focus') IS ?", focus?.value ?? null),
    // Their files, read in the batch, so the ones deleted afterwards are the ones the rows pointed at.
    q('SELECT key FROM photo WHERE person = ?', id),
    q('SELECT key FROM portrait WHERE person = ?', id),
  ];
  if (focus?.value === id) {
    const other = await d.get<{ id: string }>('SELECT id FROM person WHERE id != ? LIMIT 1', id);
    if (!other) throw new Error('The last person cannot be removed');
    writes.push(guard('EXISTS (SELECT 1 FROM person WHERE id = ?)', other.id), q("UPDATE meta SET value = ? WHERE key = 'focus'", other.id));
  }
  // A field on someone else that named this person keeps the name they had, as plain text, so it still reads and the
  // person it is on can be saved again (a link to someone not in the family is refused). A name typed there is kept.
  const gone = await d.get<{ given: string; surname: string | null; current_given: string | null; current_surname: string | null }>(
    'SELECT given, surname, current_given, current_surname FROM person WHERE id = ?', id);
  if (gone) {
    const name = [gone.current_given ?? gone.given, gone.current_surname ?? gone.surname].filter(Boolean).join(' ');
    writes.push(q(
      `UPDATE person_field SET value = json_set(value, '$.person', '', '$.name', CASE WHEN coalesce(json_extract(value, '$.name'), '') = '' THEN ? ELSE json_extract(value, '$.name') END)
       WHERE type = 'related' AND json_extract(value, '$.person') = ?`,
      name, id,
    ));
  }
  // RETURNING counts the person alone (D1's `changes` would include the cascade).
  writes.push(q('DELETE FROM person WHERE id = ? RETURNING id', id));
  return {
    writes,
    result: (r) => r[r.length - 1].rows.length,
    after: async (r) => {
      const keys = [...r[1].rows, ...r[2].rows].map((x) => (x as { key: string | null }).key).filter((k): k is string => !!k);
      for (const key of keys) await media.delete(tree, key).catch((e) => console.error('[media] could not delete', key, e));
    },
  };
}
