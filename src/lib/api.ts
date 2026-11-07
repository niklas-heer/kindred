// Server functions (run on the server, called like local functions) and the queries built on them.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { validDate } from './dates';
import { can, needs, type Action, type Role } from './roles';

const tree = z.string().regex(/^[a-z0-9-]+$/);
const date = z.string().refine(validDate, 'Not a real date').optional();
const server = () => import('./db.server');

export const getTrees = createServerFn({ method: 'GET' }).handler(async () => (await server()).listTrees());
export const treesQuery = queryOptions({ queryKey: ['trees'], queryFn: () => getTrees() });

export const getGraph = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => (await server()).graph(data.tree));
export const graphQuery = (t: string) => queryOptions({ queryKey: ['graph', t], queryFn: () => getGraph({ data: { tree: t } }), staleTime: Infinity });

export const getPerson = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, id: z.string() }))
  .handler(async ({ data }) => (await server()).person(data.tree, data.id));
export const personQuery = (t: string, id: string) => queryOptions({ queryKey: ['person', t, id], queryFn: () => getPerson({ data: { tree: t, id } }) });

export const getChronicle = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => (await server()).chronicle(data.tree, 300));
export const chronicleQuery = (t: string) => queryOptions({ queryKey: ['chronicle', t], queryFn: () => getChronicle({ data: { tree: t } }) });

export const getContacts = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => (await server()).allContacts(data.tree));
export const contactsQuery = (t: string) => queryOptions({ queryKey: ['contacts', t], queryFn: () => getContacts({ data: { tree: t } }) });

const newPerson = z.object({
  given: z.string().trim().min(1).max(120),
  surname: z.string().trim().max(120).optional(),
  sex: z.enum(['m', 'f', 'x']).optional(),
  born: date,
  died: date,
  living: z.boolean(),
});

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
      partnership: z.object({ kind: z.enum(['marriage', 'partnership', 'other']), start: date, place: z.string().trim().max(200).optional() }).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { db, newId } = await server();
    const d = db(data.tree);
    const p = data.person;
    const id = newId(p.given);
    const anchor = d.prepare('SELECT house, surname FROM person WHERE id = ?').get(data.anchor) as { house: string | null; surname: string | null } | undefined;
    if (!anchor) throw new Error('unknown anchor');
    if (data.relation === 'sibling' && !d.prepare('SELECT parent FROM parent WHERE child = ?').get(data.anchor)) throw new Error('Record a shared parent first to add a sibling.');
    // Children and siblings join the anchor's house; parents and partners only if they share its surname.
    const sameHouse = data.relation === 'child' || data.relation === 'sibling' || (p.surname && p.surname === anchor.surname);
    d.exec('BEGIN');
    try {
      d.prepare('INSERT INTO person (id, given, surname, house, sex, born, died, living) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, p.given, p.surname ?? null, sameHouse ? anchor.house : null, p.sex ?? null, p.born ?? null, p.died ?? null, p.living ? 1 : 0,
      );
      const link = d.prepare('INSERT OR IGNORE INTO parent (child, parent) VALUES (?, ?)');
      if (data.relation === 'child') {
        link.run(id, data.anchor);
        if (data.coParent) link.run(id, data.coParent);
      } else if (data.relation === 'parent') {
        link.run(data.anchor, id);
      } else if (data.relation === 'sibling') {
        for (const r of d.prepare('SELECT parent FROM parent WHERE child = ?').all(data.anchor) as { parent: string }[]) link.run(id, r.parent);
      } else {
        d.prepare('INSERT INTO partnership (id, a, b, kind) VALUES (?, ?, ?, ?)').run(`${data.anchor}__${id}`, data.anchor, id, data.partnership?.kind ?? 'partnership');
        d.prepare('UPDATE partnership SET start = ?, place = ? WHERE id = ?').run(data.partnership?.start ?? null, data.partnership?.place ?? null, `${data.anchor}__${id}`);
      }
      d.exec('COMMIT');
    } catch (e) {
      d.exec('ROLLBACK');
      throw e;
    }
    return id;
  });

/** Connect an existing person without inventing couples or duplicating edges. */
export const linkRelative = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, anchor: z.string(), person: z.string(), relation: z.enum(['parent', 'child', 'sibling', 'partner']), coParent: z.string().optional(), partnership: z.object({ kind: z.enum(['marriage', 'partnership', 'other']), start: date, place: z.string().trim().max(200).optional() }).optional() }))
  .handler(async ({ data }) => {
    const d = (await server()).db(data.tree);
    if (data.anchor === data.person) throw new Error('A person cannot be their own relative.');
    for (const id of [data.anchor, data.person, data.coParent].filter(Boolean)) {
      if (!d.prepare('SELECT id FROM person WHERE id = ?').get(id!)) throw new Error('Person not found.');
    }
    d.exec('BEGIN');
    try {
      const link = (child: string, parent: string) => {
        if (child === parent) throw new Error('A person cannot be their own parent.');
        const cycle = d.prepare('WITH RECURSIVE ancestors(id) AS (SELECT parent FROM parent WHERE child = ? UNION SELECT p.parent FROM parent p JOIN ancestors a ON p.child = a.id) SELECT id FROM ancestors WHERE id = ?').get(parent, child);
        if (cycle) throw new Error('This would create a loop in the ancestry.');
        d.prepare('INSERT OR IGNORE INTO parent (child, parent) VALUES (?, ?)').run(child, parent);
      };
      if (data.relation === 'parent') link(data.anchor, data.person);
      if (data.relation === 'child') { link(data.person, data.anchor); if (data.coParent) link(data.person, data.coParent); }
      if (data.relation === 'sibling') {
        const ps = d.prepare('SELECT parent FROM parent WHERE child = ?').all(data.anchor) as { parent: string }[];
        if (!ps.length) throw new Error('Record a shared parent first to link siblings.');
        for (const p of ps) link(data.person, p.parent);
      }
      if (data.relation === 'partner' && !d.prepare('SELECT id FROM partnership WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)').get(data.anchor, data.person, data.person, data.anchor)) {
        d.prepare('INSERT INTO partnership (id, a, b, kind, start, place) VALUES (?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), data.anchor, data.person, data.partnership?.kind ?? 'partnership', data.partnership?.start ?? null, data.partnership?.place ?? null);
      }
      d.exec('COMMIT');
    } catch (e) { d.exec('ROLLBACK'); throw e; }
    return data.person;
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
    }),
  )
  .handler(async ({ data }) => {
    const cols: Record<string, string> = { born: 'born', bornPlace: 'born_place', died: 'died', sex: 'sex', occupation: 'occupation' };
    const set = Object.entries(data.patch).filter(([, v]) => v !== undefined && v !== '');
    if (!set.length) return;
    const sql = `UPDATE person SET ${set.map(([k]) => `${cols[k]} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`;
    (await server()).db(data.tree).prepare(sql).run(...set.map(([, v]) => v as string), data.id);
  });

/** Takes someone out of the tree, with their links, stories, contacts and photo. */
export const removePerson = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string() }))
  .handler(async ({ data }) => {
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
      author: z.string().trim().min(1).max(120),
      context: z.string().trim().max(300).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { db } = await server();
    const id = crypto.randomUUID();
    db(data.tree)
      .prepare('INSERT INTO story (id, person, kind, title, body, author, at, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, data.person, data.kind, data.title || null, data.body, data.author, new Date().toISOString(), data.context || null);
    return id;
  });

export const deleteStory = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string() }))
  .handler(async ({ data }) => {
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
    }),
  )
  .handler(async ({ data }) => {
    (await server()).db(data.tree).prepare('INSERT INTO contact (person, kind, label, value) VALUES (?, ?, ?, ?)').run(data.person, data.kind, data.label || null, data.value);
  });

export const deleteContact = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.number().int() }))
  .handler(async ({ data }) => {
    (await server()).db(data.tree).prepare('DELETE FROM contact WHERE id = ?').run(data.id);
  });

export const uploadPhoto = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error('expected form data');
    const file = d.get('file');
    if (!(file instanceof File) || !file.type.startsWith('image/') || file.size > 5_000_000) throw new Error('an image under 5 MB');
    return { tree: tree.parse(d.get('tree')), id: z.string().parse(d.get('id')), file };
  })
  .handler(async ({ data }) => {
    const bytes = new Uint8Array(await data.file.arrayBuffer());
    (await server())
      .db(data.tree)
      .prepare('INSERT INTO photo (person, mime, data, at) VALUES (?, ?, ?, ?) ON CONFLICT(person) DO UPDATE SET mime = excluded.mime, data = excluded.data, at = excluded.at')
      .run(data.id, data.file.type, bytes, new Date().toISOString());
  });

// ---------- places ----------

/** Place suggestions for a place field: the tree's own places, then the offline gazetteer. Cheap enough for every keystroke. */
export const searchPlaces = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, q: z.string().max(120) }))
  .handler(async ({ data }) => (await server()).searchPlaces(data.tree, data.q));
export const placeSearchQuery = (t: string, q: string) =>
  queryOptions({ queryKey: ['places', t, q.trim().toLowerCase()], queryFn: () => searchPlaces({ data: { tree: t, q: q.trim() } }), staleTime: 60_000, placeholderData: (prev) => prev });

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

/** Gazetteer towns in a map box, for orientation when dropping a pin. */
export const getPlacesIn = createServerFn({ method: 'GET' })
  .validator(z.object({ west: lng, south: lat, east: lng, north: lat, limit: z.number().int().min(1).max(200) }))
  .handler(async ({ data }) => (await server()).placesIn(data, data.limit));

/** Puts places on the tree's map. Existing pins stay where they are unless `move` is set. Safe to repeat. */
export const upsertPlaces = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, places: z.array(z.object({ name: z.string().trim().min(1).max(200), lat, lng, country: z.string().regex(/^[a-z]{2}$/).optional(), move: z.boolean().optional() })).max(10) }))
  .handler(async ({ data }) => (await server()).upsertPlaces(data.tree, data.places));

// ---------- houses ----------

/**
 * The server's permission check: every server function that changes something goes through here, with
 * the same `Action` the client asks `useCan()` about, so hiding a button is never the only protection.
 */
async function requireCan(t: string, action: Action): Promise<void> {
  // TODO(auth): check the session's role. Replace this body with the guard from src/lib/auth/guard.server.ts
  // (same name and arguments, imported dynamically so it stays server-only):
  //   await (await import('./auth/guard.server')).requireCan(t, action);
  // Until then every caller counts as a steward.
  const role: Role = 'steward';
  if (!can(role, action)) throw new Error(`Only a ${needs(action)} can do that in the ${t} tree.`);
}

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
