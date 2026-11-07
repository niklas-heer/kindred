import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from './schema';
import type { GParent, GPerson, GUnion, Graph, House, PersonDetail, TreeMeta } from './types';

const DATA = resolve(process.cwd(), 'data');
const open = new Map<string, DatabaseSync>();

export function db(tree: string): DatabaseSync {
  if (!/^[a-z0-9-]+$/.test(tree)) throw new Error(`bad tree id ${tree}`);
  let d = open.get(tree);
  if (!d) {
    const path = join(DATA, `${tree}.db`);
    if (!existsSync(path)) throw new Error(`no tree ${tree}; run mise run seed`);
    d = new DatabaseSync(path);
    d.exec(SCHEMA);
    open.set(tree, d);
  }
  return d;
}

const meta = (d: DatabaseSync) =>
  Object.fromEntries((d.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));

export function listTrees(): TreeMeta[] {
  return readdirSync(DATA)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const d = db(f.slice(0, -3));
      const m = meta(d);
      const { n } = d.prepare('SELECT count(*) AS n FROM person').get() as { n: number };
      return { id: m.id, name: m.name, tagline: m.tagline, theme: m.theme as TreeMeta['theme'], focus: m.focus, people: n };
    })
    .sort((a, b) => b.people - a.people);
}

const json = <T>(s: unknown): T | undefined => (typeof s === 'string' ? JSON.parse(s) : undefined);
const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

export function graph(tree: string): Graph {
  const d = db(tree);
  const m = meta(d);
  const people = (d.prepare(`SELECT p.*, ph.at AS photo, (SELECT count(*) FROM story s WHERE s.person = p.id) AS stories, (SELECT count(*) FROM contact c WHERE c.person = p.id) AS contacts
    FROM person p LEFT JOIN photo ph ON ph.person = p.id`).all() as any[]).map(
    (r): GPerson => ({
      id: r.id,
      given: r.given,
      surname: opt(r.surname),
      house: opt(r.house),
      sex: opt(r.sex),
      born: opt(r.born),
      died: opt(r.died),
      living: r.living === 1,
      epithet: opt(r.epithet),
      title: opt(r.title),
      occupation: opt(r.occupation),
      nickname: opt(r.nickname),
      traits: json(r.traits),
      look: json(r.look),
      photo: opt(r.photo),
      stories: r.stories,
      contacts: r.contacts,
      bornPlace: opt(r.born_place),
      diedPlace: opt(r.died_place),
    }),
  );
  const houses = (d.prepare('SELECT * FROM house').all() as any[]).map(
    (r): House => ({ id: r.id, name: r.name, motto: opt(r.motto), arms: JSON.parse(r.arms), founder: opt(r.founder) }),
  );
  const parents = d.prepare('SELECT child, parent, kind, confidence FROM parent').all() as unknown as GParent[];
  const unions = (d.prepare('SELECT * FROM partnership ORDER BY start').all() as any[]).map(
    (r): GUnion => ({ id: r.id, a: r.a, b: r.b, kind: r.kind, start: opt(r.start), end: opt(r.end), endReason: opt(r.end_reason), place: opt(r.place) }),
  );
  const places = (d.prepare('SELECT * FROM place').all() as any[]).map((r) => ({ name: r.name, lat: r.lat, lng: r.lng, country: opt(r.country) }));
  return {
    places,
    tree: { id: m.id, name: m.name, tagline: m.tagline, theme: m.theme as TreeMeta['theme'], focus: m.focus, people: people.length },
    houses,
    people,
    parents,
    unions,
  };
}

export function person(tree: string, id: string): PersonDetail {
  const d = db(tree);
  const r = d.prepare('SELECT bio, born_place, died_place, favourite, updated_at FROM person WHERE id = ?').get(id) as any;
  if (!r) throw new Error(`no person ${id}`);
  return {
    id,
    bio: opt(r.bio),
    bornPlace: opt(r.born_place),
    diedPlace: opt(r.died_place),
    favourite: opt(r.favourite),
    updatedAt: r.updated_at,
    stories: (d.prepare('SELECT * FROM story WHERE person = ? ORDER BY at DESC').all(id) as any[]).map((s) => ({
      id: s.id, person: s.person, kind: s.kind, title: opt(s.title), body: s.body, author: s.author, at: s.at, context: opt(s.context),
    })),
    contacts: (d.prepare('SELECT * FROM contact WHERE person = ? ORDER BY kind, id').all(id) as any[]).map((c) => ({
      id: c.id, person: c.person, kind: c.kind, label: opt(c.label), value: c.value,
    })),
  };
}

/** Every story in the tree, newest first: the family's "recent changes". */
export function chronicle(tree: string, limit: number) {
  return db(tree).prepare('SELECT * FROM story ORDER BY at DESC LIMIT ?').all(limit) as any[];
}

export function allContacts(tree: string) {
  return db(tree).prepare('SELECT * FROM contact ORDER BY person, kind').all() as any[];
}

export function photo(tree: string, id: string) {
  return db(tree).prepare('SELECT mime, data FROM photo WHERE person = ?').get(id) as { mime: string; data: Uint8Array } | undefined;
}

export const newId = (given: string) =>
  `${given.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'person'}_${crypto.randomUUID().slice(0, 6)}`;
