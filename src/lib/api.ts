// Server functions (run on the server, called like local functions) and the queries built on them.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { armsSchema } from '~/components/heraldry/schema';
import { validDate } from './dates';
import { MAX_FURTHER, MAX_FURTHER_LENGTH, storeFurther } from './further-given';
import type { Action } from './roles';
import { audienceOf, PLAIN_MEMBER } from './visibility';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const date = z.string().refine(validDate, 'Not a real date').optional();
const server = () => import('./db.server');

// The server's permission checks (src/lib/auth/guard.server.ts), imported inside each handler so they
// stay server-only. Every handler below starts with one: reads need membership of the tree, changes
// need the same `Action` the browser asks `useCan()` about, so hiding a button is never the only
// protection. They answer 401 when signed out and 403 for a non-member or a role that is too low.
const guard = () => import('./auth/guard.server');
const requireMember = async (t: string) => (await guard()).requireMember(t);
const requireReader = async (t: string) => (await guard()).requireReader(t);
const requireCan = async (t: string, action: Action) => (await guard()).requireCan(t, action);
// The families list lives in src/lib/auth/functions.ts (`fetchMyFamilies`): only the reader's own.

export const getGraph = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const r = await requireReader(data.tree);
    // Opening the family is a visit, for "What's new" (history.server.ts noteVisit). A guest is not remembered.
    if (r.user && !r.guest) await (await import('./history.server')).noteVisit(r.user.id, data.tree).catch(() => {});
    // A guest gets the plain count, so the Needed page does not say that everyone lacks a contact. Never a value. A guest whose
    // link protects living people gets them without dates, places or details (src/lib/protect-living.ts).
    return (await server()).graph(data.tree, r.guest ? { ...PLAIN_MEMBER, protectLiving: r.protectLiving } : audienceOf(r));
  });
export const graphQuery = (t: string) => queryOptions({ queryKey: ['graph', t], queryFn: () => getGraph({ data: { tree: t } }), staleTime: Infinity });

export const getChronicle = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const r = await requireReader(data.tree);
    return (await server()).chronicle(data.tree, 300, r.protectLiving);
  });
export const chronicleQuery = (t: string) => queryOptions({ queryKey: ['chronicle', t], queryFn: () => getChronicle({ data: { tree: t } }) });

export const getContacts = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    return (await server()).allContacts(data.tree, audienceOf(await requireReader(data.tree)));
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
  furtherGiven: z.array(z.string().trim().min(1).max(MAX_FURTHER_LENGTH)).max(MAX_FURTHER).optional(),
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
    const { once, newId, q, guard, sameParents, added } = await server();
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
        q('INSERT INTO person (id, given, further_given, surname, house, sex, born, died, living) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          id, p.given, storeFurther(p.furtherGiven), p.surname ?? null, sameHouse ? anchor.house : null, p.sex ?? null, p.born ?? null, p.died ?? null, p.living ? 1 : 0),
      ];
      const name = [p.given, p.surname].filter(Boolean).join(' ');
      // The new person, and on the anchor's history the link that ties them in.
      const history = [added('person', id, { person: id, personName: name, label: name })];
      const link = (child: string, parent: string) => {
        history.push(added('link', `${child}>${parent}`, { person: data.anchor, label: name }));
        return q('INSERT OR IGNORE INTO parent (child, parent) VALUES (?, ?)', child, parent);
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
    const { once } = await server();
    // The rules live in relations.server.ts, shared with the assistant's family drafts.
    const { linkPlan } = await import('./relations.server');
    return once(data.tree, opOf(_m, data), 'linkRelative', (d) => linkPlan(d, data));
  });

/** Undo for a link: removes exactly the edges and the partnership that link created. */
export const unlinkRelative = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, parents: z.array(z.object({ child: z.string(), parent: z.string() })).max(4), partnership: z.string().optional() }))
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'edit-person');
    const { once, q, removed } = await server();
    await once(data.tree, undefined, 'unlinkRelative', async (d) => {
      // What is there to take away, for the history: the links that exist, and the partnership's couple.
      const links = (await Promise.all(data.parents.map((e) => d.get<{ child: string; parent: string; given: string }>(
        'SELECT l.child, l.parent, p.given FROM parent l JOIN person p ON p.id = l.parent WHERE l.child = ? AND l.parent = ?', e.child, e.parent)))).filter((x) => !!x);
      const couple = data.partnership ? await d.get<{ a: string; b: string }>('SELECT a, b FROM partnership WHERE id = ?', data.partnership) : undefined;
      return {
        writes: [
          ...data.parents.map((e) => q('DELETE FROM parent WHERE child = ? AND parent = ?', e.child, e.parent)),
          ...(data.partnership ? [q('DELETE FROM partnership WHERE id = ?', data.partnership)] : []),
        ],
        history: [
          ...links.map((l) => removed('link', `${l.child}>${l.parent}`, { person: l.child, label: l.given })),
          ...(couple && data.partnership ? [removed('partnership', data.partnership, { person: couple.a })] : []),
        ],
        result: undefined,
      };
    });
  });

/** When a partnership ended, and why. Clearing the end clears the reason too. Editors only, as the link is. */
export const setPartnershipEnd = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string(), end: z.string().refine(validDate, 'Not a real date').nullable(), endReason: z.enum(['divorce', 'death', 'other']).nullable() }))
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'edit-person');
    const { once, q, guard, change } = await server();
    const reason = data.end ? data.endReason : null;
    await once(data.tree, undefined, 'setPartnershipEnd', async (d) => {
      const had = await d.get<{ a: string; end: string | null; end_reason: string | null }>('SELECT a, end, end_reason FROM partnership WHERE id = ?', data.id);
      if (!had) return { writes: [], history: [], result: undefined };
      return {
        writes: [
          guard('EXISTS (SELECT 1 FROM partnership WHERE id = ? AND end IS ? AND end_reason IS ?)', data.id, had.end, had.end_reason),
          q('UPDATE partnership SET end = ?, end_reason = ? WHERE id = ?', data.end, reason, data.id),
        ],
        history: change('partnership', data.id, { end: had.end, end_reason: had.end_reason }, { end: data.end, end_reason: reason }, { person: had.a }),
        result: undefined,
      };
    });
  });

/**
 * Fills in only the fields given: the Needed page saves exactly what was missing. `seen` is each value as the page
 * showed it; a value someone else entered since is kept, and the answer lists it (person.server.ts `fillGaps`).
 */
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
      seen: z.object({ born: z.string().max(40), bornPlace: z.string().max(200), died: z.string().max(40), sex: z.enum(['m', 'f', 'x']), occupation: z.string().max(200) }).partial().optional(),
      opKey,
    }),
  )
  .handler(async ({ data }) => {
    const _m = await requireCan(data.tree, 'edit-person');
    const { fillGaps } = await import('./person.server');
    return fillGaps(data.tree, data.id, data.patch, data.seen, opOf(_m, data));
  });

/** Takes someone out of the tree, with their links, stories, contacts and photo. */
export const removePerson = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string() }))
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'remove-person');
    const { once } = await server();
    const { removePlan } = await import('./relations.server');
    return once(data.tree, undefined, 'removePerson', (d) => removePlan(d, data.tree, data.id));
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
    const { once, q, personExists, added } = await server();
    return once(data.tree, opOf(_m, data), 'addStory', async (d) => {
      if (!(await d.get('SELECT id FROM person WHERE id = ?', data.person))) throw new Error('Person not found.');
      const id = crypto.randomUUID();
      return {
        writes: [
          personExists(data.person),
          // The account too (migration 0027), so the writer can be told when someone answers it.
          q('INSERT INTO story (id, person, kind, title, body, author, at, context, author_account) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            id, data.person, data.kind, data.title || null, data.body, user.name, new Date().toISOString(), data.context || null, user.id),
        ],
        history: [added('story', id, { person: data.person, label: data.title || null })],
        result: id,
      };
    });
  });

/** Removes a story. Sent with a key, the removal can be undone by the person who made it (`restoreStory`). */
export const deleteStory = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string(), opKey }))
  .handler(async ({ data }) => {
    const _m = await requireCan(data.tree, 'edit-person');
    return (await import('./story.server')).removeStory(data.tree, data.id, opOf(_m, data));
  });

/** Undo for a removed story: puts back the one the removal with this key took away, as the server kept it. */
export const restoreStory = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, removal: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/) }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'edit-person');
    return (await import('./story.server')).restoreStory(data.tree, data.removal, m.user.id);
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
    return (await import('./person.server')).addPersonField(data.tree, data.person, { type, label: data.label ?? '', value: { [key]: data.value }, visibility: 'family' }, opOf(_m, data), _m.user.name, audienceOf(_m));
  });

const LEGACY_CONTACT = { phone: ['phone', 'number'], email: ['email', 'address'], address: ['address', 'street'], web: ['website', 'url'], messenger: ['social', 'handle'] } as const;

export const deleteContact = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/) }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'edit-contact');
    // Someone else's personal field is not theirs to remove, whatever their role (deletePersonField leaves it alone).
    await (await import('./person.server')).deletePersonField(data.tree, data.id, undefined, audienceOf(m), ['phone', 'email', 'address', 'website', 'social']);
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
    // JPEG, PNG and WebP lose their EXIF, GPS and XMP (src/lib/strip-metadata.ts); GIF and AVIF are stored as sent.
    const cleaned = (await import('./strip-metadata')).stripMetadata(new Uint8Array(await data.file.arrayBuffer()), data.file.type);
    if (!cleaned) throw new Error('A photo (JPEG, PNG, WebP, GIF or AVIF) under 5 MB');
    const bytes = cleaned;
    const { once, q, personExists, media, newMediaKey, change } = await server();
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
        // The picture itself never goes into the history: only that it changed.
        history: change('portrait', data.id, { photo: 0 }, { photo: 1 }, { person: data.id, opaque: ['photo'] }),
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

/** A steward renames a house or changes its motto and arms, over the house as they opened it. */
export const updateHouse = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      tree,
      id: z.string().min(1).max(120),
      name: z.string().trim().min(1, 'A house needs a name').max(80),
      motto: z.string().trim().max(160).nullable(),
      arms,
      // The house as it was opened: a save over someone else's newer change is refused (db.server.ts `updateHouse`).
      before: z.object({ name: z.string().max(200), motto: z.string().max(400).nullable(), arms: z.unknown() }),
    }),
  )
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'edit-house');
    return (await server()).updateHouse(data.tree, data.id, { name: data.name, motto: data.motto || null, arms: data.arms }, data.before);
  });
