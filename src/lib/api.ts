// Server functions (run on the server, called like local functions) and the queries built on them.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { armsSchema } from '~/components/heraldry/schema';
import { validDate } from './dates';
import type { Action } from './roles';
import { occupationCodeFor } from './occupations.ts';

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

/** The retry key for a change, bound to who sends it and to everything else they sent (see `once`). */
function opOf<D extends { opKey?: string }>(m: { user: { id: string } }, data: D) {
  if (!data.opKey) return undefined;
  const { opKey: key, ...payload } = data;
  return { key, user: m.user.id, payload };
}

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
    const _m = await requireCan(data.tree, 'add-person');
    const { once, newId, q, guard, sameParents } = await server();
    return once(data.tree, opOf(_m, data), 'addRelative', async (d) => {
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
        q('INSERT INTO person (id, given, surname, house, sex, born, died, living) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          id, p.given, p.surname ?? null, sameHouse ? anchor.house : null, p.sex ?? null, p.born ?? null, p.died ?? null, p.living ? 1 : 0),
      ];
      const link = (child: string, parent: string) => q('INSERT OR IGNORE INTO parent (child, parent) VALUES (?, ?)', child, parent);
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
      }
      return { writes, result: id };
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
    const _m = await requireCan(data.tree, 'edit-person');
    const { once, q, guard, sameParents, sameBorn } = await server();
    return once(data.tree, opOf(_m, data), 'linkRelative', async (d) => {
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
        if (all.size > 2) throw new Error(`${(await name(child))?.given ?? 'They'} already has two parents.`);
        const cy = yearIn(await bornOf(child));
        const py = yearIn(await bornOf(parent));
        if (cy <= py) throw new Error(`${(await name(child))?.given ?? 'The child'} was born before ${(await name(parent))?.given ?? 'the parent'}, so cannot be their child.`);
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
        const id = newOpKey();
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
    });
  });

/** Undo for a link: removes exactly the edges and the partnership that link created. */
export const unlinkRelative = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, parents: z.array(z.object({ child: z.string(), parent: z.string() })).max(4), partnership: z.string().optional() }))
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'edit-person');
    const { once, q } = await server();
    await once(data.tree, undefined, 'unlinkRelative', () => ({
      writes: [
        ...data.parents.map((e) => q('DELETE FROM parent WHERE child = ? AND parent = ?', e.child, e.parent)),
        ...(data.partnership ? [q('DELETE FROM partnership WHERE id = ?', data.partnership)] : []),
      ],
      result: undefined,
    }));
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
        bio: z.string().max(20_000).nullable(),
      }),
    }),
  )
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'edit-person');
    const { db } = await server();
    const p = data.patch;
    const empty = (s: string | null) => (s === null || s.trim() === '' ? null : s.trim());
    await db(data.tree)
      .run(`UPDATE person SET given = ?, surname = ?, nickname = ?, sex = ?, born = ?, born_place = ?, died = ?, died_place = ?,
        living = ?, title = ?, epithet = ?, occupation = ?, occupation_code = ?, bio = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
        p.given, empty(p.surname), empty(p.nickname), p.sex, empty(p.born), empty(p.bornPlace), empty(p.died), empty(p.diedPlace),
        p.living ? 1 : 0, empty(p.title), empty(p.epithet), empty(p.occupation), occupationCodeFor(empty(p.occupation)), empty(p.bio), data.id);
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
    const _m = await requireCan(data.tree, 'edit-person');
    const cols: Record<string, string> = { born: 'born', bornPlace: 'born_place', died: 'died', sex: 'sex', occupation: 'occupation' };
    const set = Object.entries(data.patch).filter(([, v]) => v !== undefined && v !== '');
    if (!set.length) return;
    // Typing an occupation here also sets its vocabulary code, so the Needed page and the editor agree.
    const assigns = set.map(([k]) => `${cols[k]} = ?`);
    const values: (string | null)[] = set.map(([, v]) => v as string);
    if (data.patch.occupation) { assigns.push('occupation_code = ?'); values.push(occupationCodeFor(data.patch.occupation)); }
    const sql = `UPDATE person SET ${assigns.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`;
    const { once, q } = await server();
    await once(data.tree, opOf(_m, data), 'patchPerson', () => ({ writes: [q(sql, ...values, data.id)], result: undefined }));
  });

/** Takes someone out of the tree, with their links, stories, contacts and photo. */
export const removePerson = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string() }))
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'remove-person');
    const { once, q, guard, media } = await server();
    return once(data.tree, undefined, 'removePerson', async (d) => {
      // The tree must keep a person to open on.
      const focus = await d.get<{ value: string }>("SELECT value FROM meta WHERE key = 'focus'");
      const writes = [
        guard("(SELECT value FROM meta WHERE key = 'focus') IS ?", focus?.value ?? null),
        // Their portrait, read in the batch, so the file deleted afterwards is the one the row pointed at.
        q('SELECT key FROM photo WHERE person = ?', data.id),
      ];
      if (focus?.value === data.id) {
        const other = await d.get<{ id: string }>('SELECT id FROM person WHERE id != ? LIMIT 1', data.id);
        if (!other) throw new Error('The last person cannot be removed');
        writes.push(guard('EXISTS (SELECT 1 FROM person WHERE id = ?)', other.id), q("UPDATE meta SET value = ? WHERE key = 'focus'", other.id));
      }
      // Their links, stories, contacts and photo row go with them (ON DELETE CASCADE).
      // RETURNING counts the person alone (D1's `changes` would include the cascade).
      writes.push(q('DELETE FROM person WHERE id = ? RETURNING id', data.id));
      return {
        writes,
        result: (r) => r[r.length - 1].rows.length,
        after: async (r) => {
          const key = (r[1].rows[0] as { key: string | null } | undefined)?.key;
          if (key) await media.delete(data.tree, key).catch((e) => console.error('[media] could not delete', key, e));
        },
      };
    });
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
    const _m = await requireCan(data.tree, 'add-story');
    const { user } = _m;
    const { once, q, personExists } = await server();
    return once(data.tree, opOf(_m, data), 'addStory', async (d) => {
      if (!(await d.get('SELECT id FROM person WHERE id = ?', data.person))) throw new Error('Person not found.');
      const id = crypto.randomUUID();
      return {
        writes: [
          personExists(data.person),
          q('INSERT INTO story (id, person, kind, title, body, author, at, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            id, data.person, data.kind, data.title || null, data.body, user.name, new Date().toISOString(), data.context || null),
        ],
        result: id,
      };
    });
  });

export const deleteStory = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string() }))
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'edit-person');
    await (await server()).db(data.tree).run('DELETE FROM story WHERE id = ?', data.id);
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
    const _m = await requireCan(data.tree, 'edit-contact');
    // Contacts are person fields now (src/lib/person.server.ts): the old kinds map onto their field types.
    const [type, key] = LEGACY_CONTACT[data.kind];
    return (await import('./person.server')).addPersonField(data.tree, data.person, { type, label: data.label ?? '', value: { [key]: data.value }, private: false }, opOf(_m, data), _m.user.name);
  });

const LEGACY_CONTACT = { phone: ['phone', 'number'], email: ['email', 'address'], address: ['address', 'street'], web: ['website', 'url'], messenger: ['social', 'handle'] } as const;

export const deleteContact = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/) }))
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'edit-contact');
    await (await server()).db(data.tree).run("DELETE FROM person_field WHERE id = ? AND type IN ('phone', 'email', 'address', 'website', 'social')", data.id);
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
    const _m = await requireCan(data.tree, 'upload-photo');
    const bytes = new Uint8Array(await data.file.arrayBuffer());
    const { once, q, personExists, media, newMediaKey } = await server();
    await once(data.tree, opOf(_m, data), 'uploadPhoto', async (d) => {
      if (!(await d.get('SELECT id FROM person WHERE id = ?', data.id))) throw new Error('Person not found.');
      // The picture goes to media storage first; the row points at it once the batch commits.
      const key = newMediaKey('photo', data.file.type);
      await media.put(data.tree, key, bytes, data.file.type);
      return {
        writes: [
          personExists(data.id),
          q('SELECT key FROM photo WHERE person = ?', data.id), // the picture this one replaces
          q('INSERT INTO photo (person, mime, key, data, at) VALUES (?, ?, ?, NULL, ?) ON CONFLICT(person) DO UPDATE SET mime = excluded.mime, key = excluded.key, data = NULL, at = excluded.at',
            data.id, data.file.type, key, new Date().toISOString()),
        ],
        result: undefined,
        abandon: () => media.delete(data.tree, key).catch(() => {}),
        after: async (r) => {
          const old = (r[1].rows[0] as { key: string | null } | undefined)?.key;
          if (old && old !== key) await media.delete(data.tree, old).catch((e) => console.error('[media] could not delete', old, e));
        },
      };
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
    const _m = await requireCan(data.tree, 'edit-place');
    return (await server()).upsertPlaces(data.tree, data.places, opOf(_m, data));
  });

// ---------- houses ----------

// v1 arms plus the optional heraldry v2 design (src/components/heraldry/schema.ts).
const arms = armsSchema;

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
