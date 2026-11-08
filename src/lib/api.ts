// Server functions (run on the server, called like local functions) and the queries built on them.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { validDate } from './dates';
import type { Action } from './roles';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const date = z.string().refine(validDate, 'Not a real date').optional();
const server = () => import('./db.server');

// The server's permission checks (src/lib/auth/guard.server.ts), imported inside each handler so they
// stay server-only. Every handler below starts with one: reads need membership of the tree, changes
// need the same `Action` the browser asks `useCan()` about, so hiding a button is never the only
// protection. They answer 401 when signed out and 403 for a non-member or a role that is too low.
const guard = () => import('./auth/guard.server');
const requireMember = async (t: string) => (await guard()).requireMember(t);
const requireCan = async (t: string, action: Action) => (await guard()).requireCan(t, action);
// The families list lives in src/lib/auth/functions.ts (`fetchMyFamilies`): only the reader's own.

export const getGraph = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    await requireMember(data.tree);
    return (await server()).graph(data.tree);
  });
export const graphQuery = (t: string) => queryOptions({ queryKey: ['graph', t], queryFn: () => getGraph({ data: { tree: t } }), staleTime: Infinity });

export const getPerson = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, id: z.string() }))
  .handler(async ({ data }) => {
    await requireMember(data.tree);
    return (await server()).person(data.tree, data.id);
  });
export const personQuery = (t: string, id: string) => queryOptions({ queryKey: ['person', t, id], queryFn: () => getPerson({ data: { tree: t, id } }) });

export const getChronicle = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    await requireMember(data.tree);
    return (await server()).chronicle(data.tree, 300);
  });
export const chronicleQuery = (t: string) => queryOptions({ queryKey: ['chronicle', t], queryFn: () => getChronicle({ data: { tree: t } }) });

export const getContacts = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    await requireMember(data.tree);
    return (await server()).allContacts(data.tree);
  });
export const contactsQuery = (t: string) => queryOptions({ queryKey: ['contacts', t], queryFn: () => getContacts({ data: { tree: t } }) });

/**
 * An idempotency key: one per logical attempt at a change, reused when that attempt is retried. The server
 * stores the result under it in the same transaction as the change and replays it for a repeat.
 */
const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional();

/** A fresh key. Works outside secure contexts too, where crypto.randomUUID is missing. */
export function newOpKey(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Keys for one form: the same step with the same payload keeps its key, so a retry after a lost response
 * is recognised; a changed payload is a new attempt and gets a new key. `clear()` after a success.
 */
export function opKeys() {
  const keys = new Map<string, { sig: string; key: string }>();
  return {
    for(step: string, payload: unknown): string {
      const sig = JSON.stringify(payload ?? null);
      const had = keys.get(step);
      if (had && had.sig === sig) return had.key;
      const key = newOpKey();
      keys.set(step, { sig, key });
      return key;
    },
    clear(step?: string) { if (step) keys.delete(step); else keys.clear(); },
  };
}

const newPerson = z.object({
  given: z.string().trim().min(1).max(120),
  surname: z.string().trim().max(120).optional(),
  sex: z.enum(['m', 'f', 'x']).optional(),
  born: date,
  died: date,
  living: z.boolean(),
});

const partnershipInput = z.object({ kind: z.enum(['marriage', 'partnership', 'other']), start: date, place: z.string().trim().max(200).optional() });

/** The first year of a stored date ("~1890-05" → 1890), or NaN. */
const yearIn = (d: string | null | undefined) => (d ? parseInt(d.replace(/^~/, ''), 10) : NaN);

/** Adds a person already connected to someone: the "+" slots on the tree. Returns the new id. */
export const addRelative = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      tree,
      anchor: z.string(),
      relation: z.enum(['child', 'parent', 'partner', 'sibling']),
      /** For a child: the anchor's partner who is the other parent. */
      coParent: z.string().optional(),
      person: newPerson,
      partnership: partnershipInput.optional(),
      opKey,
    }),
  )
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'add-person');
    const { once, newId } = await server();
    return once(data.tree, data.opKey, 'addRelative', (d) => {
      const p = data.person;
      const id = newId(p.given);
      const anchor = d.prepare('SELECT house, surname, born FROM person WHERE id = ?').get(data.anchor) as { house: string | null; surname: string | null; born: string | null } | undefined;
      if (!anchor) throw new Error('unknown anchor');
      const anchorParents = (d.prepare('SELECT parent FROM parent WHERE child = ?').all(data.anchor) as { parent: string }[]).map((r) => r.parent);
      if (data.relation === 'sibling' && !anchorParents.length) throw new Error('Record a shared parent first to add a sibling.');
      if (data.relation === 'parent' && anchorParents.length >= 2) throw new Error('They already have two parents.');
      if (data.relation === 'parent' && yearIn(p.born) >= yearIn(anchor.born)) throw new Error('A parent must be born before their child.');
      if (data.relation === 'child' && yearIn(p.born) <= yearIn(anchor.born)) throw new Error('A child must be born after their parent.');
      // Children and siblings join the anchor's house; parents and partners only if they share its surname.
      const sameHouse = data.relation === 'child' || data.relation === 'sibling' || (p.surname && p.surname === anchor.surname);
      d.prepare('INSERT INTO person (id, given, surname, house, sex, born, died, living) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, p.given, p.surname ?? null, sameHouse ? anchor.house : null, p.sex ?? null, p.born ?? null, p.died ?? null, p.living ? 1 : 0,
      );
      const link = d.prepare('INSERT OR IGNORE INTO parent (child, parent) VALUES (?, ?)');
      if (data.relation === 'child') {
        link.run(id, data.anchor);
        if (data.coParent && data.coParent !== data.anchor) link.run(id, data.coParent);
      } else if (data.relation === 'parent') {
        link.run(data.anchor, id);
      } else if (data.relation === 'sibling') {
        for (const parent of anchorParents) link.run(id, parent);
      } else {
        d.prepare('INSERT INTO partnership (id, a, b, kind, start, place) VALUES (?, ?, ?, ?, ?, ?)').run(
          `${data.anchor}__${id}`, data.anchor, id, data.partnership?.kind ?? 'partnership', data.partnership?.start ?? null, data.partnership?.place ?? null,
        );
      }
      return id;
    });
  });

/** What a link created, so Undo removes exactly that and nothing that was there before. */
export interface LinkResult { person: string; parents: { child: string; parent: string }[]; partnership?: string }

/**
 * Connects an existing person without inventing couples or duplicating edges. Refuses a third parent, a
 * child born before (or with) their parent, a loop in the ancestry, and a link that already exists.
 */
export const linkRelative = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, anchor: z.string(), person: z.string(), relation: z.enum(['parent', 'child', 'sibling', 'partner']), coParent: z.string().optional(), partnership: partnershipInput.optional(), opKey }))
  .handler(async ({ data }): Promise<LinkResult> => {
    await requireCan(data.tree, 'edit-person');
    const { once } = await server();
    return once(data.tree, data.opKey, 'linkRelative', (d) => {
      if (data.anchor === data.person) throw new Error('A person cannot be their own relative.');
      const people = new Map<string, { given: string; born: string | null }>();
      for (const id of [data.anchor, data.person, data.coParent].filter((x): x is string => !!x)) {
        const r = d.prepare('SELECT given, born FROM person WHERE id = ?').get(id) as { given: string; born: string | null } | undefined;
        if (!r) throw new Error('Person not found.');
        people.set(id, r);
      }
      const parentsOf = (id: string) => (d.prepare('SELECT parent FROM parent WHERE child = ?').all(id) as { parent: string }[]).map((r) => r.parent);
      const created: LinkResult = { person: data.person, parents: [] };
      // All checks for every edge first, then the writes, so a refusal never leaves half a link.
      const edges: [child: string, parent: string][] = [];
      if (data.relation === 'parent') edges.push([data.anchor, data.person]);
      if (data.relation === 'child') {
        edges.push([data.person, data.anchor]);
        if (data.coParent && data.coParent !== data.anchor) edges.push([data.person, data.coParent]);
      }
      if (data.relation === 'sibling') {
        const ps = parentsOf(data.anchor);
        if (!ps.length) throw new Error('Record a shared parent first to link siblings.');
        if (ps.every((p) => parentsOf(data.person).includes(p))) throw new Error(`${people.get(data.person)!.given} is already their sibling.`);
        for (const p of ps) edges.push([data.person, p]);
      }
      const name = (id: string) => d.prepare('SELECT given FROM person WHERE id = ?').get(id) as { given: string } | undefined;
      const newParents = new Map<string, Set<string>>();
      for (const [child, parent] of edges) {
        if (child === parent) throw new Error('A person cannot be their own parent.');
        const had = parentsOf(child);
        if (had.includes(parent)) {
          if (data.relation === 'sibling') continue; // a shared parent they already have
          throw new Error(`${name(parent)?.given ?? 'They'} is already ${name(child)?.given ?? 'their'}’s parent.`);
        }
        const all = newParents.get(child) ?? new Set(had);
        all.add(parent);
        newParents.set(child, all);
        if (all.size > 2) throw new Error(`${name(child)?.given ?? 'They'} already has two parents.`);
        const cy = yearIn((d.prepare('SELECT born FROM person WHERE id = ?').get(child) as { born: string | null }).born);
        const py = yearIn((d.prepare('SELECT born FROM person WHERE id = ?').get(parent) as { born: string | null }).born);
        if (cy <= py) throw new Error(`${name(child)?.given ?? 'The child'} was born before ${name(parent)?.given ?? 'the parent'}, so cannot be their child.`);
        const cycle = d.prepare('WITH RECURSIVE ancestors(id) AS (SELECT parent FROM parent WHERE child = ? UNION SELECT p.parent FROM parent p JOIN ancestors a ON p.child = a.id) SELECT id FROM ancestors WHERE id = ?').get(parent, child);
        if (cycle) throw new Error('This would create a loop in the ancestry.');
      }
      if (data.relation === 'partner') {
        if (d.prepare('SELECT id FROM partnership WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)').get(data.anchor, data.person, data.person, data.anchor)) {
          throw new Error(`${people.get(data.person)!.given} is already their partner.`);
        }
        const id = newOpKey();
        d.prepare('INSERT INTO partnership (id, a, b, kind, start, place) VALUES (?, ?, ?, ?, ?, ?)').run(id, data.anchor, data.person, data.partnership?.kind ?? 'partnership', data.partnership?.start ?? null, data.partnership?.place ?? null);
        created.partnership = id;
      }
      for (const [child, parent] of edges) {
        if (d.prepare('INSERT OR IGNORE INTO parent (child, parent) VALUES (?, ?)').run(child, parent).changes) created.parents.push({ child, parent });
      }
      return created;
    });
  });

/** Undo for a link: removes exactly the edges and the partnership that link created. */
export const unlinkRelative = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, parents: z.array(z.object({ child: z.string(), parent: z.string() })).max(4), partnership: z.string().optional() }))
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'edit-person');
    const { once } = await server();
    once(data.tree, undefined, 'unlinkRelative', (d) => {
      for (const e of data.parents) d.prepare('DELETE FROM parent WHERE child = ? AND parent = ?').run(e.child, e.parent);
      if (data.partnership) d.prepare('DELETE FROM partnership WHERE id = ?').run(data.partnership);
    });
  });

export const updatePerson = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      tree,
      id: z.string(),
      patch: z.object({
        given: z.string().trim().min(1).max(120),
        surname: z.string().trim().max(120).nullable(),
        nickname: z.string().trim().max(120).nullable(),
        sex: z.enum(['m', 'f', 'x']).nullable(),
        born: z.string().refine((d) => d.trim() === '' || validDate(d.trim()), 'Not a real date').nullable(),
        bornPlace: z.string().trim().max(200).nullable(),
        died: z.string().refine((d) => d.trim() === '' || validDate(d.trim()), 'Not a real date').nullable(),
        diedPlace: z.string().trim().max(200).nullable(),
        living: z.boolean(),
        title: z.string().trim().max(200).nullable(),
        epithet: z.string().trim().max(120).nullable(),
        occupation: z.string().trim().max(200).nullable(),
        favourite: z.string().trim().max(500).nullable(),
        bio: z.string().max(20_000).nullable(),
      }),
    }),
  )
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'edit-person');
    const { db } = await server();
    const p = data.patch;
    const empty = (s: string | null) => (s === null || s.trim() === '' ? null : s.trim());
    db(data.tree)
      .prepare(`UPDATE person SET given = ?, surname = ?, nickname = ?, sex = ?, born = ?, born_place = ?, died = ?, died_place = ?,
        living = ?, title = ?, epithet = ?, occupation = ?, favourite = ?, bio = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`)
      .run(p.given, empty(p.surname), empty(p.nickname), p.sex, empty(p.born), empty(p.bornPlace), empty(p.died), empty(p.diedPlace),
        p.living ? 1 : 0, empty(p.title), empty(p.epithet), empty(p.occupation), empty(p.favourite), empty(p.bio), data.id);
  });

/** Fills in only the fields given: the Needed page saves exactly what was missing. */
export const patchPerson = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      tree,
      id: z.string(),
      patch: z
        .object({
          born: date,
          bornPlace: z.string().trim().min(1).max(200),
          died: date,
          sex: z.enum(['m', 'f', 'x']),
          occupation: z.string().trim().min(1).max(200),
        })
        .partial(),
      opKey,
    }),
  )
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'edit-person');
    const cols: Record<string, string> = { born: 'born', bornPlace: 'born_place', died: 'died', sex: 'sex', occupation: 'occupation' };
    const set = Object.entries(data.patch).filter(([, v]) => v !== undefined && v !== '');
    if (!set.length) return;
    const sql = `UPDATE person SET ${set.map(([k]) => `${cols[k]} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`;
    (await server()).once(data.tree, data.opKey, 'patchPerson', (d) => { d.prepare(sql).run(...set.map(([, v]) => v as string), data.id); });
  });

/** Takes someone out of the tree, with their links, stories, contacts and photo. */
export const removePerson = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string() }))
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'remove-person');
    const d = (await server()).db(data.tree);
    d.exec('PRAGMA foreign_keys = ON; BEGIN');
    try {
      // The tree must keep a person to open on.
      const focus = d.prepare("SELECT value FROM meta WHERE key = 'focus'").get() as { value: string } | undefined;
      if (focus?.value === data.id) {
        const other = d.prepare('SELECT id FROM person WHERE id != ? LIMIT 1').get(data.id) as { id: string } | undefined;
        if (!other) throw new Error('The last person cannot be removed');
        d.prepare("UPDATE meta SET value = ? WHERE key = 'focus'").run(other.id);
      }
      const r = d.prepare('DELETE FROM person WHERE id = ?').run(data.id);
      d.exec('COMMIT');
      return r.changes;
    } catch (e) {
      d.exec('ROLLBACK');
      throw e;
    }
  });

export const addStory = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      tree,
      person: z.string(),
      kind: z.enum(['note', 'quote', 'anecdote', 'recipe', 'memory']),
      title: z.string().trim().max(200).optional(),
      body: z.string().trim().min(1).max(20_000),
      context: z.string().trim().max(300).optional(),
      opKey,
    }),
  )
  .handler(async ({ data }) => {
    // Signed with the writer's own name from their account, never a name the browser sends.
    const { user } = await requireCan(data.tree, 'add-story');
    return (await server()).once(data.tree, data.opKey, 'addStory', (d) => {
      if (!d.prepare('SELECT id FROM person WHERE id = ?').get(data.person)) throw new Error('Person not found.');
      const id = crypto.randomUUID();
      d.prepare('INSERT INTO story (id, person, kind, title, body, author, at, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, data.person, data.kind, data.title || null, data.body, user.name, new Date().toISOString(), data.context || null);
      return id;
    });
  });

export const deleteStory = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string() }))
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'edit-person');
    (await server()).db(data.tree).prepare('DELETE FROM story WHERE id = ?').run(data.id);
  });

export const addContact = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      tree,
      person: z.string(),
      kind: z.enum(['phone', 'email', 'address', 'web', 'messenger']),
      label: z.string().trim().max(60).optional(),
      value: z.string().trim().min(1).max(500),
      opKey,
    }),
  )
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'edit-contact');
    return (await server()).once(data.tree, data.opKey, 'addContact', (d) => {
      if (!d.prepare('SELECT id FROM person WHERE id = ?').get(data.person)) throw new Error('Person not found.');
      return Number(d.prepare('INSERT INTO contact (person, kind, label, value) VALUES (?, ?, ?, ?)').run(data.person, data.kind, data.label || null, data.value).lastInsertRowid);
    });
  });

export const deleteContact = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.number().int() }))
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'edit-contact');
    (await server()).db(data.tree).prepare('DELETE FROM contact WHERE id = ?').run(data.id);
  });

export const uploadPhoto = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error('expected form data');
    const file = d.get('file');
    // Photos only (no SVG: it can carry script). The Portrait shows them with <img>.
    if (!(file instanceof File) || !/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type) || file.size > 5_000_000) throw new Error('A photo (JPEG, PNG, WebP, GIF or AVIF) under 5 MB');
    return { tree: tree.parse(d.get('tree')), id: z.string().parse(d.get('id')), file, opKey: opKey.parse(d.get('opKey') ?? undefined) };
  })
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'upload-photo');
    const bytes = new Uint8Array(await data.file.arrayBuffer());
    (await server()).once(data.tree, data.opKey, 'uploadPhoto', (d) => {
      if (!d.prepare('SELECT id FROM person WHERE id = ?').get(data.id)) throw new Error('Person not found.');
      d.prepare('INSERT INTO photo (person, mime, data, at) VALUES (?, ?, ?, ?) ON CONFLICT(person) DO UPDATE SET mime = excluded.mime, data = excluded.data, at = excluded.at')
        .run(data.id, data.file.type, bytes, new Date().toISOString());
    });
  });

// ---------- places ----------

/** Place suggestions for a place field: the tree's own places, then the offline gazetteer. Cheap enough for every keystroke. */
export const searchPlaces = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, q: z.string().max(120) }))
  .handler(async ({ data }) => {
    await requireMember(data.tree);
    return (await server()).searchPlaces(data.tree, data.q);
  });
export const placeSearchQuery = (t: string, q: string) =>
  queryOptions({ queryKey: ['places', t, q.trim().toLowerCase()], queryFn: () => searchPlaces({ data: { tree: t, q: q.trim() } }), staleTime: 60_000, placeholderData: (prev) => prev });

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

/** Gazetteer towns in a map box, for orientation when dropping a pin. */
export const getPlacesIn = createServerFn({ method: 'GET' })
  .validator(z.object({ west: lng, south: lat, east: lng, north: lat, limit: z.number().int().min(1).max(200) }))
  .handler(async ({ data }) => {
    // The gazetteer belongs to no family: any signed-in reader may look at it.
    await (await guard()).requireUser();
    return (await server()).placesIn(data, data.limit);
  });

/** Puts places on the tree's map. Existing pins stay where they are unless `move` is set. Safe to repeat. */
export const upsertPlaces = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, places: z.array(z.object({ name: z.string().trim().min(1).max(200), lat, lng, country: z.string().regex(/^[a-z]{2}$/).optional(), move: z.boolean().optional() })).max(10), opKey }))
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'edit-place');
    return (await server()).upsertPlaces(data.tree, data.places, data.opKey);
  });

// ---------- houses ----------

const tincture = z.enum(['or', 'argent', 'gules', 'azure', 'vert', 'sable', 'purpure']);
const arms = z.object({
  field: tincture,
  field2: tincture.optional(),
  division: z.enum(['plain', 'per-pale', 'per-fess', 'per-bend', 'quarterly', 'chevron', 'paly', 'bendy', 'saltire', 'cross']),
  charge: z.enum(['none', 'lion', 'eagle', 'tower', 'star', 'crescent', 'fleur', 'key', 'rose', 'boar', 'stag', 'sword']),
  chargeTincture: tincture,
});

/** A steward renames a house or changes its motto and arms. */
export const updateHouse = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      tree,
      id: z.string().min(1).max(120),
      name: z.string().trim().min(1, 'A house needs a name').max(80),
      motto: z.string().trim().max(160).nullable(),
      arms,
    }),
  )
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'edit-house');
    return (await server()).updateHouse(data.tree, data.id, { name: data.name, motto: data.motto || null, arms: data.arms });
  });
