// Server functions (run on the server, called like local functions) and the queries built on them.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

const tree = z.string().regex(/^[a-z0-9-]+$/);
const date = z.string().regex(/^~?\d{3,4}(-\d\d(-\d\d)?)?$/).optional();
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
    }),
  )
  .handler(async ({ data }) => {
    const { db, newId } = await server();
    const d = db(data.tree);
    const p = data.person;
    const id = newId(p.given);
    const anchor = d.prepare('SELECT house, surname FROM person WHERE id = ?').get(data.anchor) as { house: string | null; surname: string | null } | undefined;
    if (!anchor) throw new Error('unknown anchor');
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
        // Two parents of the same child are usually a couple; record it so the tree can draw them together.
        const other = d.prepare('SELECT parent FROM parent WHERE child = ? AND parent != ?').get(data.anchor, id) as { parent: string } | undefined;
        if (other) d.prepare('INSERT INTO partnership (id, a, b, kind) VALUES (?, ?, ?, ?)').run(`${other.parent}__${id}`, other.parent, id, 'marriage');
      } else if (data.relation === 'sibling') {
        for (const r of d.prepare('SELECT parent FROM parent WHERE child = ?').all(data.anchor) as { parent: string }[]) link.run(id, r.parent);
      } else {
        d.prepare('INSERT INTO partnership (id, a, b, kind) VALUES (?, ?, ?, ?)').run(`${data.anchor}__${id}`, data.anchor, id, 'marriage');
      }
      d.exec('COMMIT');
    } catch (e) {
      d.exec('ROLLBACK');
      throw e;
    }
    return id;
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
        born: z.string().nullable(),
        bornPlace: z.string().trim().max(200).nullable(),
        died: z.string().nullable(),
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
