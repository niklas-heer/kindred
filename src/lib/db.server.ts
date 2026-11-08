import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from './schema';
import type { GParent, GPerson, GUnion, Graph, House, PersonDetail, TreeMeta } from './types';

const DATA = resolve(process.cwd(), 'data');
const open = new Map<string, DatabaseSync>();
/** data/gazetteer.db is the place search index and data/accounts.db the accounts store: not trees. Keep in step with NOT_TREES in auth/store.server.ts. */
const GAZETTEER = 'gazetteer';
const NOT_TREES = new Set([GAZETTEER, 'accounts']);

export function db(tree: string): DatabaseSync {
  if (!/^[a-z0-9-]+$/.test(tree) || NOT_TREES.has(tree)) throw new Error(`bad tree id ${tree}`);
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

// ---------- idempotent writes ----------

const OP_KEEP_DAYS = 30;
let lastPrune = 0;

/**
 * Runs `work` in one transaction. With an `opKey`, the result is stored in the `op` table in that same
 * transaction, and the same key arriving again (a retry after a lost response) gets the stored result back
 * instead of a second write. A key used for a different kind of change is refused.
 */
export function once<T>(tree: string, opKey: string | undefined, fn: string, work: (d: DatabaseSync) => T): T {
  const d = db(tree);
  d.exec('BEGIN IMMEDIATE');
  let replay: { fn: string; result: string } | undefined;
  try {
    if (opKey) replay = d.prepare('SELECT fn, result FROM op WHERE key = ?').get(opKey) as typeof replay;
    if (replay) {
      d.exec('COMMIT');
    } else {
      const out = work(d);
      if (opKey) {
        const now = Date.now();
        d.prepare('INSERT INTO op (key, fn, result, at) VALUES (?, ?, ?, ?)').run(opKey, fn, JSON.stringify(out ?? null), new Date(now).toISOString());
        // Old keys are only kept long enough to cover a retry.
        if (now - lastPrune > 3_600_000) {
          lastPrune = now;
          d.prepare('DELETE FROM op WHERE at < ?').run(new Date(now - OP_KEEP_DAYS * 86_400_000).toISOString());
        }
      }
      d.exec('COMMIT');
      return out;
    }
  } catch (e) {
    if (d.isTransaction) d.exec('ROLLBACK');
    throw e;
  }
  if (replay.fn !== fn) throw new Error('That change was already sent as something else. Reload and try again.');
  return JSON.parse(replay.result) as T;
}

const meta = (d: DatabaseSync) =>
  Object.fromEntries((d.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));

export function listTrees(): TreeMeta[] {
  return readdirSync(DATA)
    .filter((f) => f.endsWith('.db') && !NOT_TREES.has(f.slice(0, -3)))
    .map((f): TreeMeta | null => {
      const d = db(f.slice(0, -3));
      const m = meta(d);
      if (!m.id) return null; // not a tree (a half-built file): skip it rather than break the home page
      const { n } = d.prepare('SELECT count(*) AS n FROM person').get() as { n: number };
      const crestRow = d.prepare('SELECT h.arms FROM house h LEFT JOIN person p ON p.house = h.id GROUP BY h.id ORDER BY count(p.id) DESC, h.id LIMIT 1').get() as { arms: string } | undefined;
      const monthDay = `${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
      const birthdays = (d.prepare("SELECT id, given, surname FROM person WHERE living = 1 AND substr(born, 6) = ?").all(monthDay) as { id: string; given: string; surname: string | null }[]).map((p) => ({ id: p.id, name: [p.given, p.surname].filter(Boolean).join(' ') }));
      return { id: m.id, name: m.name, tagline: m.tagline, theme: m.theme as TreeMeta['theme'], focus: m.focus, people: n, crest: crestRow ? JSON.parse(crestRow.arms) as House['arms'] : undefined, birthdays };
    })
    .filter((t): t is TreeMeta => t !== null)
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

// ---------- places ----------

/** Lower case, no accents, punctuation as spaces: "Saint-Étienne" → "saint etienne". Keep in step with `fold` in scripts/gazetteer.ts. */
export function foldPlace(s: string) {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss').replace(/[øœ]/g, (c) => (c === 'ø' ? 'o' : 'oe')).replace(/æ/g, 'ae').replace(/ł/g, 'l').replace(/đ/g, 'd').replace(/þ/g, 'th').replace(/ı/g, 'i')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

let gazetteerDb: DatabaseSync | null = null;
/** The offline gazetteer (scripts/gazetteer.ts), or null until it has been built. Checked again on each call until it exists. */
function gazetteer(): DatabaseSync | null {
  if (gazetteerDb) return gazetteerDb;
  const path = join(DATA, `${GAZETTEER}.db`);
  if (!existsSync(path)) return null;
  try {
    gazetteerDb = new DatabaseSync(path, { readOnly: true });
    gazetteerDb.prepare('SELECT 1 FROM name LIMIT 1').get();
  } catch {
    gazetteerDb = null;
  }
  return gazetteerDb;
}

export interface PlaceHit {
  name: string;
  lat?: number;
  lng?: number;
  /** ISO 3166 alpha-2, lower case. */
  country?: string;
  /** State or province, from the gazetteer. */
  region?: string;
  /** The gazetteer's own name when the hit matched another spelling ("Munich" for München). */
  also?: string;
  /** How many records in this tree use the name; set only for the tree's own places. */
  uses?: number;
}

/** The tree's own places first (by use), then gazetteer towns ranked by how well they match and how big they are. */
export function searchPlaces(tree: string, q: string, limit = 8): PlaceHit[] {
  const d = db(tree);
  const fq = foldPlace(q);
  const placed = new Map((d.prepare('SELECT name, lat, lng, country FROM place').all() as { name: string; lat: number; lng: number; country: string | null }[]).map((r) => [r.name, r]));
  const used = new Map((d.prepare(`SELECT name, count(*) AS n FROM (
      SELECT born_place AS name FROM person WHERE born_place IS NOT NULL AND born_place != ''
      UNION ALL SELECT died_place FROM person WHERE died_place IS NOT NULL AND died_place != ''
      UNION ALL SELECT place FROM partnership WHERE place IS NOT NULL AND place != ''
    ) GROUP BY name`).all() as { name: string; n: number }[]).map((r) => [r.name, r.n]));
  for (const name of placed.keys()) if (!used.has(name)) used.set(name, 0);

  // A family place matches when any of its words starts with what was typed; a match at the very start ranks first.
  const g = fq.length >= 2 ? gazetteer() : null;
  const own = [...used]
    .map(([name, uses]) => ({ name, uses, f: foldPlace(name) }))
    .filter((p) => !fq || p.f.startsWith(fq) || p.f.includes(` ${fq}`))
    .sort((a, b) => Number(!a.f.startsWith(fq)) - Number(!b.f.startsWith(fq)) || b.uses - a.uses || a.name.localeCompare(b.name))
    .slice(0, fq && g ? 4 : limit)
    .map((p): PlaceHit => {
      const at = placed.get(p.name);
      return { name: p.name, uses: p.uses, ...(at && { lat: at.lat, lng: at.lng, country: at.country ?? undefined }) };
    });

  if (!g) return own;
  type Row = { id: number; name: string; cc: string | null; admin1: string | null; lat: number; lng: number; pop: number; alt: string | null; key: string };
  const range = 'n.key >= ? AND n.key < ?';
  const sql = (where: string, n: number) =>
    `SELECT p.id, p.name, p.cc, p.admin1, p.lat, p.lng, p.pop, n.alt, n.key FROM name n JOIN place p ON p.id = n.id WHERE ${where} ORDER BY p.pop DESC LIMIT ${n}`;
  const hi = `${fq}\uffff`;
  const rows = [
    ...(g.prepare(sql('n.key = ?', 12)).all(fq) as Row[]),
    ...(g.prepare(sql(`${range} AND n.alt IS NULL`, 40)).all(fq, hi) as Row[]),
    ...(g.prepare(sql(`${range} AND n.alt IS NOT NULL`, 20)).all(fq, hi) as Row[]),
  ];
  // Size counts most; another spelling counts less than the place's own name; an exact match counts more.
  const best = new Map<number, { r: Row; score: number }>();
  for (const r of rows) {
    const score = Math.log10(r.pop + 10) - (r.alt ? 1.5 : 0) + (r.key === fq ? 1 : 0);
    const had = best.get(r.id);
    if (!had || score > had.score) best.set(r.id, { r, score });
  }
  const near = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.abs(a.lat - b.lat) < 0.2 && Math.abs(a.lng - b.lng) < 0.2;
  // A town the family already has a pin for, under any spelling ("munich" finds their München), is offered as theirs.
  const pinned = [...placed.values()];
  const towns = [...best.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ r }): PlaceHit => {
      const theirs = pinned.find((pl) => (foldPlace(pl.name) === foldPlace(r.alt ?? r.name) && near(pl, r)) || (Math.abs(pl.lat - r.lat) < 0.03 && Math.abs(pl.lng - r.lng) < 0.03));
      if (theirs) return { name: theirs.name, lat: theirs.lat, lng: theirs.lng, country: theirs.country ?? r.cc ?? undefined, region: r.admin1 ?? undefined, uses: used.get(theirs.name) ?? 0 };
      return { name: r.alt ?? r.name, also: r.alt ? r.name : undefined, lat: r.lat, lng: r.lng, country: r.cc ?? undefined, region: r.admin1 ?? undefined };
    })
    // Drop only true repeats; a town that shares a name with a family place elsewhere stays, so it can be told apart.
    .filter((t, i, all) => !(t.uses !== undefined && own.some((o) => o.name === t.name)) && all.findIndex((x) => x.name === t.name && x.lat === t.lat) === i)
    .slice(0, Math.max(3, limit - own.length));
  // The family's places stay together at the top.
  const theirs = towns.filter((t) => t.uses !== undefined);
  return [...own, ...theirs, ...towns.filter((t) => t.uses === undefined)].slice(0, limit + 1);
}

/** Towns inside a box, biggest first, so a map with no tiles still shows where you are. */
export function placesIn(box: { west: number; south: number; east: number; north: number }, limit: number) {
  const g = gazetteer();
  if (!g) return [];
  const wrap = box.west > box.east;
  return g
    .prepare(`SELECT name, cc, admin1, lat, lng, pop FROM place WHERE lat BETWEEN ? AND ? AND ${wrap ? '(lng >= ? OR lng <= ?)' : 'lng BETWEEN ? AND ?'} ORDER BY pop DESC LIMIT ?`)
    .all(box.south, box.north, box.west, box.east, limit) as { name: string; cc: string | null; admin1: string | null; lat: number; lng: number; pop: number }[];
}

/**
 * Records where places are, so the Atlas can draw them. An existing place keeps its coordinates unless
 * `move` is set (the user chose to move its pin). Returns the names whose pin was left alone.
 */
export function upsertPlaces(tree: string, places: { name: string; lat: number; lng: number; country?: string; move?: boolean }[], opKey?: string) {
  return once(tree, opKey, 'upsertPlaces', (d) => {
    const kept: string[] = [];
    for (const p of places) {
      const sql = p.move
        ? 'INSERT INTO place (name, lat, lng, country) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, country = coalesce(excluded.country, country)'
        : 'INSERT INTO place (name, lat, lng, country) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO NOTHING';
      const r = d.prepare(sql).run(p.name, p.lat, p.lng, p.country ?? null);
      if (!r.changes) kept.push(p.name);
    }
    return kept;
  });
}

// ---------- houses ----------

/** Renames a house and changes its motto and arms. Returns the house as the graph shows it. */
export function updateHouse(tree: string, id: string, patch: { name: string; motto: string | null; arms: House['arms'] }): House {
  const d = db(tree);
  const r = d.prepare('SELECT founder FROM house WHERE id = ?').get(id) as { founder: string | null } | undefined;
  if (!r) throw new Error('That house is not in this family.');
  // Store only the fields the arms use: a plain field keeps no second tincture.
  const arms: House['arms'] = { field: patch.arms.field, division: patch.arms.division, charge: patch.arms.charge, chargeTincture: patch.arms.chargeTincture };
  if (patch.arms.field2 && patch.arms.division !== 'plain') arms.field2 = patch.arms.field2;
  d.prepare('UPDATE house SET name = ?, motto = ?, arms = ? WHERE id = ?').run(patch.name, patch.motto, JSON.stringify(arms), id);
  return { id, name: patch.name, motto: patch.motto ?? undefined, arms, founder: opt(r.founder) };
}
