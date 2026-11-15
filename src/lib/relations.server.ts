// The rules for connecting people: the plan behind `linkRelative` (api.ts) and behind each link of an assistant's family
// draft (ai/family.server.ts), the plan behind `addRelative` (a new person and their link), and a couple's details
// (partnership.functions.ts). The forms and an approved suggestion (suggestions/review.server.ts) run the same checks, so
// neither can link what the form would refuse. A plan reads what it needs and guards every fact it read (db.server.ts `once`).
import { added, change, guard, media, newId, q, removed, sameBorn, sameParents, type Db, type HistoryEntry, type Plan } from './db.server';
import type { LinkResult } from './api';
import { storeFurther } from './further-given';
import { bornBeforeParent, MAX_PARENTS } from './parent-rules';
import type { GParent, GUnion } from './types';

export interface LinkInput {
  anchor: string;
  person: string;
  relation: 'parent' | 'child' | 'sibling' | 'partner';
  /** For a child: the anchor's partner who is the other parent. */
  coParent?: string;
  partnership?: { kind: GUnion['kind']; start?: string; place?: string };
  /** For a parent or a child: what kind of parent the link is (left out, or for a sibling or partner: biological, the table's default). */
  parentKind?: GParent['kind'];
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
  // On the anchor's history: the link or the partnership, naming the other person.
  const other = people.get(data.person)!.given;
  const history: HistoryEntry[] = created.partnership ? [added('partnership', created.partnership, { person: data.anchor, label: other })] : [];
  // The guards hold every parent set as read, so exactly the edges not already there are new.
  for (const [child, parent] of edges) {
    writes.push(data.parentKind && (data.relation === 'child' || data.relation === 'parent')
      ? q('INSERT OR IGNORE INTO parent (child, parent, kind) VALUES (?, ?, ?)', child, parent, data.parentKind)
      : q('INSERT OR IGNORE INTO parent (child, parent) VALUES (?, ?)', child, parent));
    if (!(await parentsOf(child)).includes(parent) && !created.parents.some((e) => e.child === child && e.parent === parent)) {
      created.parents.push({ child, parent });
      history.push(added('link', `${child}>${parent}`, { person: data.anchor, label: other }));
    }
  }
  return { writes, history, result: created };
}

/** A new person and how they join the anchor: the add-relative form's input (api.ts `addRelative`). */
export interface AddRelativeInput {
  anchor: string;
  relation: 'child' | 'parent' | 'partner' | 'sibling';
  /** For a child: the anchor's partner who is the other parent. */
  coParent?: string;
  person: { given: string; furtherGiven?: string[]; surname?: string; sex?: 'm' | 'f' | 'x'; born?: string; died?: string; living: boolean };
  partnership?: { kind: GUnion['kind']; start?: string; place?: string };
  /** For a parent or a child: what kind of parent the link is (left out: biological, as the table's default). */
  parentKind?: GParent['kind'];
}

/** The first year of a stored date ("~1890-05" → 1890), or NaN. */
const yearIn = (d: string | null | undefined) => (d ? parseInt(d.replace(/^~/, ''), 10) : NaN);

/**
 * Adds a person already connected to someone: the "+" slots on the tree. Refuses a sibling of someone with no parent, a third
 * parent, a parent born after the child and a child born before the parent. Children and siblings join the anchor's house;
 * parents and partners only if they share its surname. Returns the new id.
 */
export async function addRelativePlan(d: Db, data: AddRelativeInput): Promise<Plan<string>> {
  const p = data.person;
  const id = newId(p.given);
  const anchor = await d.get<{ house: string | null; surname: string | null; born: string | null }>('SELECT house, surname, born FROM person WHERE id = ?', data.anchor);
  if (!anchor) throw new Error('unknown anchor');
  const anchorParents = (await d.all<{ parent: string }>('SELECT parent FROM parent WHERE child = ?', data.anchor)).map((r) => r.parent);
  if (data.relation === 'sibling' && !anchorParents.length) throw new Error('Record a shared parent first to add a sibling.');
  if (data.relation === 'parent' && anchorParents.length >= 2) throw new Error('They already have two parents.');
  if (data.relation === 'parent' && yearIn(p.born) >= yearIn(anchor.born)) throw new Error('A parent must be born before their child.');
  if (data.relation === 'child' && yearIn(p.born) <= yearIn(anchor.born)) throw new Error('A child must be born after their parent.');
  // Children and siblings join the anchor's house; parents and partners only if they share its surname.
  const sameHouse = data.relation === 'child' || data.relation === 'sibling' || (p.surname && p.surname === anchor.surname);
  const writes = [
    // What the checks above read: the anchor as it was, and their parents.
    guard('EXISTS (SELECT 1 FROM person WHERE id = ? AND house IS ? AND surname IS ? AND born IS ?)', data.anchor, anchor.house, anchor.surname, anchor.born),
    sameParents(data.anchor, anchorParents),
    q('INSERT INTO person (id, given, further_given, surname, house, sex, born, died, living) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, p.given, storeFurther(p.furtherGiven), p.surname ?? null, sameHouse ? anchor.house : null, p.sex ?? null, p.born ?? null, p.died ?? null, p.living ? 1 : 0),
  ];
  const name = [p.given, p.surname].filter(Boolean).join(' ');
  // The new person, and on the anchor's history the link that ties them in.
  const history = [added('person', id, { person: id, personName: name, label: name })];
  const kind = data.relation === 'child' || data.relation === 'parent' ? data.parentKind : undefined;
  const link = (child: string, parent: string) => {
    history.push(added('link', `${child}>${parent}`, { person: data.anchor, label: name }));
    return kind
      ? q('INSERT OR IGNORE INTO parent (child, parent, kind) VALUES (?, ?, ?)', child, parent, kind)
      : q('INSERT OR IGNORE INTO parent (child, parent) VALUES (?, ?)', child, parent);
  };
  if (data.relation === 'child') {
    writes.push(link(id, data.anchor));
    if (data.coParent && data.coParent !== data.anchor) writes.push(link(id, data.coParent));
  } else if (data.relation === 'parent') {
    writes.push(link(data.anchor, id));
  } else if (data.relation === 'sibling') {
    for (const parent of anchorParents) writes.push(link(id, parent));
  } else {
    writes.push(q('INSERT INTO partnership (id, a, b, kind, start, place) VALUES (?, ?, ?, ?, ?, ?)',
      `${data.anchor}__${id}`, data.anchor, id, data.partnership?.kind ?? 'partnership', data.partnership?.start ?? null, data.partnership?.place ?? null));
    history.push(added('partnership', `${data.anchor}__${id}`, { person: data.anchor, label: name }));
  }
  return { writes, history, result: id };
}

/** A couple's kind, start date and place, after they are linked (partnership.functions.ts `setPartnershipDetails`). */
export async function partnershipDetailsPlan(d: Db, data: { id: string; kind: GUnion['kind']; start: string | null; place: string | null }): Promise<Plan<undefined>> {
  const had = await d.get<{ a: string; kind: string; start: string | null; place: string | null }>('SELECT a, kind, start, place FROM partnership WHERE id = ?', data.id);
  if (!had) throw new Error('chat.err.partnershipGone');
  return {
    writes: [
      guard('EXISTS (SELECT 1 FROM partnership WHERE id = ? AND kind = ? AND start IS ? AND place IS ?)', data.id, had.kind, had.start, had.place),
      q('UPDATE partnership SET kind = ?, start = ?, place = ? WHERE id = ?', data.kind, data.start, data.place || null, data.id),
    ],
    history: change('partnership', data.id, had, { kind: data.kind, start: data.start, place: data.place || null }, { person: had.a }),
    result: undefined,
  };
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
  // The person's history stays, and this row keeps their name: nothing else will say who they were.
  const name = gone ? [gone.current_given ?? gone.given, gone.current_surname ?? gone.surname].filter(Boolean).join(' ') : null;
  return {
    writes,
    history: gone ? [removed('person', id, { person: id, personName: name, label: name })] : [],
    result: (r) => r[r.length - 1].rows.length,
    after: async (r) => {
      const keys = [...r[1].rows, ...r[2].rows].map((x) => (x as { key: string | null }).key).filter((k): k is string => !!k);
      for (const key of keys) await media.delete(tree, key).catch((e) => console.error('[media] could not delete', key, e));
    },
  };
}
