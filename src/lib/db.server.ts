// A family's data: reads for the pages, and the transaction pattern every change uses. Storage is the
// async `Db` interface (./store): node:sqlite files on Node, D1 on Cloudflare Workers.
import { guard, isGuardError, q, store, type Db, type Query, type Result } from './store/index.ts';
import type { GParent, GPerson, GUnion, Graph, House, PersonDetail, TreeMeta } from './types';
import { fieldText, type FieldType, type FieldValue, type PersonField } from '../components/fields/model.ts';

export { guard, q, store, type Db, type Query } from './store/index.ts';

/** A family's database. Throws for an unknown tree. */
export function db(tree: string): Db {
  return store.tree(tree);
}

// ---------- changes: decide on reads, write in one guarded batch ----------
//
// D1 has no interactive transactions, so no change may read, decide and write while holding a lock.
// Every change is a *plan* instead: read what it needs, run its checks (throwing the reader's error
// message), and return the writes. `commit` sends them as one atomic batch that starts with guards
// restating what the plan relied on ("the child still has one parent", "the anchor's birth year is
// unchanged"). If another request changed any of it in between, the batch writes nothing, and the plan
// runs again on fresh reads: its checks now refuse with the right message, or it writes the new plan.
// Constraints (primary keys, foreign keys, UNIQUE) back the same rules inside the database.

const OP_KEEP_DAYS = 30;
const ATTEMPTS = 4;
let lastPrune = 0;

/** A retry key, scoped to the person sending it and to exactly what they sent. */
export interface OpKey { key: string; user: string; payload: unknown }

/** What a change writes, decided on reads. */
export interface Plan<T> {
  /** Guards first, then the writes; run as one batch with the retry key's row. */
  writes: Query[];
  /** What the caller gets back, and what a retry with the same key replays. */
  result: T | ((results: Result[]) => T);
  /** An SQL expression for a result only the batch knows (`last_insert_rowid()`), stored for replays. */
  resultSql?: string;
  /** Work after the batch committed, e.g. deleting a replaced picture. Not run for a replay. */
  after?: (results: Result[]) => Promise<unknown> | unknown;
  /** Undoes work the plan did outside the database (a stored upload) when its batch did not commit. */
  abandon?: () => Promise<unknown> | unknown;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const fingerprintOf = async (fn: string, payload: unknown) =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fn + JSON.stringify(payload ?? null, (_k, v) => (typeof File !== 'undefined' && v instanceof File ? { name: v.name, size: v.size, type: v.type } : v)))));

type OpRow = { fn: string; result: string; user: string | null; fingerprint: string | null };

/**
 * Runs a change. With an `opKey`, its result is stored in the `op` table in the same batch as the
 * writes, and the same key arriving again (a retry after a lost response) gets the stored result back
 * instead of a second write. Two copies racing: the key is the op table's primary key, so only one
 * batch commits; the other fails as a whole and replays the winner's result. Only the same person
 * resending the same change gets a replay; a key used for anything else is refused.
 */
export async function once<T>(tree: string, op: OpKey | undefined, fn: string, work: (d: Db) => Promise<Plan<T>> | Plan<T>): Promise<T> {
  const d = db(tree);
  const fingerprint = op ? await fingerprintOf(fn, op.payload) : null;
  const replay = (r: OpRow): T => {
    if (r.fn !== fn || r.user !== op!.user || r.fingerprint !== fingerprint) throw new Error('That change was already sent as something else. Reload and try again.');
    return JSON.parse(r.result) as T;
  };
  const stored = () => (op ? d.get<OpRow>('SELECT fn, result, user, fingerprint FROM op WHERE key = ?', op.key) : Promise.resolve(undefined));

  for (let attempt = 1; ; attempt++) {
    const had = await stored();
    if (had) return replay(had);
    const plan = await work(d);
    const value = (results: Result[]) => (typeof plan.result === 'function' ? (plan.result as (r: Result[]) => T)(results) : plan.result);
    const batch = [...plan.writes];
    if (op) {
      const at = new Date().toISOString();
      batch.push(
        plan.resultSql
          ? q(`INSERT INTO op (key, fn, result, at, user, fingerprint) VALUES (?, ?, json_quote(${plan.resultSql}), ?, ?, ?)`, op.key, fn, at, op.user, fingerprint)
          : q('INSERT INTO op (key, fn, result, at, user, fingerprint) VALUES (?, ?, ?, ?, ?, ?)', op.key, fn, JSON.stringify(value([]) ?? null), at, op.user, fingerprint),
      );
    }
    let results: Result[];
    try {
      results = batch.length ? await d.batch(batch) : [];
    } catch (e) {
      await plan.abandon?.();
      // A copy of this request committed first: replay its result.
      const won = await stored();
      if (won) return replay(won);
      // Something the plan relied on changed: decide again on fresh reads.
      if (isGuardError(e)) {
        if (attempt < ATTEMPTS) continue;
        throw new Error('The family changed while this was being saved. Please try again.');
      }
      throw e;
    }
    const writes = results.slice(0, plan.writes.length);
    // Old keys are only kept long enough to cover a retry.
    const now = Date.now();
    if (op && now - lastPrune > 3_600_000) {
      lastPrune = now;
      await d.run('DELETE FROM op WHERE at < ?', new Date(now - OP_KEEP_DAYS * 86_400_000).toISOString()).catch(() => {});
    }
    await plan.after?.(writes);
    return value(writes);
  }
}

// ---------- reads ----------

const meta = async (d: Db) => Object.fromEntries((await d.all<{ key: string; value: string }>('SELECT key, value FROM meta')).map((r) => [r.key, r.value]));

export async function listTrees(): Promise<TreeMeta[]> {
  const monthDay = `${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
  const trees = await Promise.all(
    store.treeIds().map(async (id): Promise<TreeMeta | null> => {
      const d = db(id);
      // An empty or half-built database is not a tree yet: skip it rather than break the home page.
      const m = await meta(d).catch(() => ({}) as Record<string, string>);
      if (!m.id) return null;
      const [count, crestRow, born] = await Promise.all([
        d.get<{ n: number }>('SELECT count(*) AS n FROM person'),
        d.get<{ arms: string }>('SELECT h.arms FROM house h LEFT JOIN person p ON p.house = h.id GROUP BY h.id ORDER BY count(p.id) DESC, h.id LIMIT 1'),
        d.all<{ id: string; given: string; surname: string | null }>('SELECT id, given, surname FROM person WHERE living = 1 AND substr(born, 6) = ?', monthDay),
      ]);
      const birthdays = born.map((p) => ({ id: p.id, name: [p.given, p.surname].filter(Boolean).join(' ') }));
      return { id: m.id, name: m.name, tagline: m.tagline, theme: m.theme as TreeMeta['theme'], focus: m.focus, people: count?.n ?? 0, crest: crestRow ? (JSON.parse(crestRow.arms) as House['arms']) : undefined, birthdays };
    }),
  );
  return trees.filter((t): t is TreeMeta => t !== null).sort((a, b) => b.people - a.people);
}

const json = <T>(s: unknown): T | undefined => (typeof s === 'string' ? JSON.parse(s) : undefined);
const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

export async function graph(tree: string): Promise<Graph> {
  const d = db(tree);
  const [m, peopleRows, houseRows, parents, unionRows, placeRows] = await Promise.all([
    meta(d),
    d.all<any>(`SELECT p.*, ph.at AS photo, (SELECT count(*) FROM story s WHERE s.person = p.id) AS stories,
      (SELECT count(*) FROM person_field f WHERE f.person = p.id AND f.private = 0 AND f.type IN ('phone', 'email', 'address', 'website', 'social')) AS contacts
      FROM person p LEFT JOIN photo ph ON ph.person = p.id`),
    d.all<any>('SELECT * FROM house'),
    d.all<GParent>('SELECT child, parent, kind, confidence FROM parent'),
    d.all<any>('SELECT * FROM partnership ORDER BY start'),
    d.all<any>('SELECT * FROM place'),
  ]);
  const people = peopleRows.map(
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
      currentGiven: opt(r.current_given),
      currentSurname: opt(r.current_surname),
      preferAvatar: r.prefer_avatar === 1,
    }),
  );
  const houses = houseRows.map((r): House => ({ id: r.id, name: r.name, motto: opt(r.motto), arms: JSON.parse(r.arms), founder: opt(r.founder) }));
  const unions = unionRows.map(
    (r): GUnion => ({ id: r.id, a: r.a, b: r.b, kind: r.kind, start: opt(r.start), end: opt(r.end), endReason: opt(r.end_reason), place: opt(r.place) }),
  );
  const places = placeRows.map((r) => ({ name: r.name, lat: r.lat, lng: r.lng, country: opt(r.country) }));
  return {
    places,
    tree: { id: m.id, name: m.name, tagline: m.tagline, theme: m.theme as TreeMeta['theme'], focus: m.focus, people: people.length },
    houses,
    people,
    parents,
    unions,
  };
}

/** A person_field row as the browser gets it. */
export const fieldOf = (r: any): PersonField => ({
  id: r.id,
  type: r.type as FieldType,
  label: r.label,
  value: JSON.parse(r.value) as FieldValue,
  ord: r.ord,
  private: r.private === 1,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
});

export async function person(tree: string, id: string, canSee = false): Promise<PersonDetail> {
  const d = db(tree);
  const [r, stories, fields] = await Promise.all([
    d.get<any>('SELECT bio, born_place, died_place, updated_at FROM person WHERE id = ?', id),
    d.all<any>('SELECT * FROM story WHERE person = ? ORDER BY at DESC', id),
    d.all<any>(`SELECT * FROM person_field WHERE person = ? ${canSee ? '' : 'AND private = 0'} ORDER BY ord, id`, id),
  ]);
  if (!r) throw new Error(`no person ${id}`);
  return {
    id,
    bio: opt(r.bio),
    bornPlace: opt(r.born_place),
    diedPlace: opt(r.died_place),
    updatedAt: r.updated_at,
    stories: stories.map((s) => ({
      id: s.id, person: s.person, kind: s.kind, title: opt(s.title), body: s.body, author: s.author, at: s.at, context: opt(s.context),
    })),
    fields: fields.map(fieldOf),
  };
}

/** Every story in the tree, newest first: the family's "recent changes". */
export function chronicle(tree: string, limit: number) {
  return db(tree).all<any>('SELECT * FROM story ORDER BY at DESC LIMIT ?', limit);
}

// The contacts page and its vCards speak in the older kinds; these map the fields onto them. Only fields
// everyone may see are listed.
const CONTACT_KIND: Record<string, string> = { phone: 'phone', email: 'email', address: 'address', website: 'web', social: 'messenger' };

export async function allContacts(tree: string) {
  const rows = await db(tree).all<any>(
    "SELECT id, person, type, label, value FROM person_field WHERE private = 0 AND type IN ('phone', 'email', 'address', 'website', 'social') ORDER BY person, ord, id",
  );
  return rows.map((r) => ({
    id: r.id,
    person: r.person,
    kind: CONTACT_KIND[r.type],
    label: r.label || null,
    value: fieldText(r.type as FieldType, JSON.parse(r.value)),
  }));
}

/** A person's portrait: its type, and where it is (a media key) or, for one not yet moved out, its bytes. */
export function photo(tree: string, id: string) {
  return db(tree).get<{ mime: string; key: string | null; data: Uint8Array | number[] | null }>('SELECT mime, key, data FROM photo WHERE person = ?', id);
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

/** The offline gazetteer (scripts/gazetteer.ts): Node only, and null until it has been built. */
const gazetteer = () => store.gazetteer();

export interface PlaceHit {
  name: string;
  lat?: number;
  lng?: number;
  /** ISO 3166 alpha-2, lower case. */
  country?: string;
  /** State or province, from the gazetteer. */
  region?: string;
  /** The spelling that matched, when the hit matched an alternate of the gazetteer's name ("Munich" for München). */
  also?: string;
  /** How many records in this tree use the name; set only for the tree's own places. */
  uses?: number;
}

/** The tree's own places first (by use), then gazetteer towns ranked by how well they match and how big they are. */
export async function searchPlaces(tree: string, q: string, limit = 8): Promise<PlaceHit[]> {
  const d = db(tree);
  const fq = foldPlace(q);
  const placed = new Map((await d.all<{ name: string; lat: number; lng: number; country: string | null }>('SELECT name, lat, lng, country FROM place')).map((r) => [r.name, r]));
  const used = new Map((await d.all<{ name: string; n: number }>(`SELECT name, count(*) AS n FROM (
      SELECT born_place AS name FROM person WHERE born_place IS NOT NULL AND born_place != ''
      UNION ALL SELECT died_place FROM person WHERE died_place IS NOT NULL AND died_place != ''
      UNION ALL SELECT place FROM partnership WHERE place IS NOT NULL AND place != ''
    ) GROUP BY name`)).map((r) => [r.name, r.n]));
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
  const hi = `${fq}￿`;
  const rows = [
    ...(await g.all<Row>(sql('n.key = ?', 12), fq)),
    ...(await g.all<Row>(sql(`${range} AND n.alt IS NULL`, 40), fq, hi)),
    ...(await g.all<Row>(sql(`${range} AND n.alt IS NOT NULL`, 20), fq, hi)),
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
      // The official name first; the spelling that matched (alt is set only for an alternate) is the hint.
      return { name: r.name, also: r.alt ?? undefined, lat: r.lat, lng: r.lng, country: r.cc ?? undefined, region: r.admin1 ?? undefined };
    })
    // Drop only true repeats; a town that shares a name with a family place elsewhere stays, so it can be told apart.
    .filter((t, i, all) => !(t.uses !== undefined && own.some((o) => o.name === t.name)) && all.findIndex((x) => x.name === t.name && x.lat === t.lat) === i)
    .slice(0, Math.max(3, limit - own.length));
  // The family's places stay together at the top.
  const theirs = towns.filter((t) => t.uses !== undefined);
  return [...own, ...theirs, ...towns.filter((t) => t.uses === undefined)].slice(0, limit + 1);
}

/** Towns inside a box, biggest first, so a map with no tiles still shows where you are. Empty without a gazetteer (always on Workers). */
export async function placesIn(box: { west: number; south: number; east: number; north: number }, limit: number) {
  const g = gazetteer();
  if (!g) return [];
  const wrap = box.west > box.east;
  return g.all<{ name: string; cc: string | null; admin1: string | null; lat: number; lng: number; pop: number }>(
    `SELECT name, cc, admin1, lat, lng, pop FROM place WHERE lat BETWEEN ? AND ? AND ${wrap ? '(lng >= ? OR lng <= ?)' : 'lng BETWEEN ? AND ?'} ORDER BY pop DESC LIMIT ?`,
    box.south, box.north, box.west, box.east, limit,
  );
}

/**
 * Records where places are, so the Atlas can draw them. An existing place keeps its coordinates unless
 * `move` is set (the user chose to move its pin). Returns the names whose pin was left alone.
 */
export function upsertPlaces(tree: string, places: { name: string; lat: number; lng: number; country?: string; move?: boolean }[], op?: OpKey) {
  return once(tree, op, 'upsertPlaces', async (d) => {
    // Which pins exist decides what is kept; the guard holds that steady until the batch commits.
    const names = [...new Set(places.map((p) => p.name))];
    const marks = names.map(() => '?').join(', ');
    const existing = new Set(names.length ? (await d.all<{ name: string }>(`SELECT name FROM place WHERE name IN (${marks})`, ...names)).map((r) => r.name) : []);
    // In order, as the writes run: a pin that exists by the time its write runs is left alone.
    const kept: string[] = [];
    const pinned = new Set(existing);
    for (const p of places) {
      if (!p.move && pinned.has(p.name)) kept.push(p.name);
      pinned.add(p.name);
    }
    const writes: Query[] = names.length ? [guard(`(SELECT count(*) FROM place WHERE name IN (${marks})) = ?`, ...names, existing.size)] : [];
    for (const p of places) {
      writes.push(
        p.move
          ? q('INSERT INTO place (name, lat, lng, country) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, country = coalesce(excluded.country, country)', p.name, p.lat, p.lng, p.country ?? null)
          : q('INSERT INTO place (name, lat, lng, country) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO NOTHING', p.name, p.lat, p.lng, p.country ?? null),
      );
    }
    return { writes, result: kept };
  });
}

// ---------- houses ----------

/** Renames a house and changes its motto and arms. Returns the house as the graph shows it. */
export async function updateHouse(tree: string, id: string, patch: { name: string; motto: string | null; arms: House['arms'] }): Promise<House> {
  const d = db(tree);
  const r = await d.get<{ founder: string | null }>('SELECT founder FROM house WHERE id = ?', id);
  if (!r) throw new Error('That house is not in this family.');
  // Store only the fields the arms use: a plain field keeps no second tincture.
  const arms: House['arms'] = { field: patch.arms.field, division: patch.arms.division, charge: patch.arms.charge, chargeTincture: patch.arms.chargeTincture };
  if (patch.arms.field2 && patch.arms.division !== 'plain') arms.field2 = patch.arms.field2;
  // The v2 design, when there is one; the v1 fields above stay as its nearest summary for older readers.
  if (patch.arms.v2) arms.v2 = patch.arms.v2;
  await d.run('UPDATE house SET name = ?, motto = ?, arms = ? WHERE id = ?', patch.name, patch.motto, JSON.stringify(arms), id);
  return { id, name: patch.name, motto: patch.motto ?? undefined, arms, founder: opt(r.founder) };
}

// ---------- media ----------

export const media = store.media;

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
/** A fresh media key for an upload: `photo/<uuid>.jpg`. */
export const newMediaKey = (kind: string, mime: string) => `${kind}/${crypto.randomUUID()}.${EXT[mime] ?? 'bin'}`;

// ---------- guards for the family's shape ----------

/** Guards that `child` still has exactly the parents `had` that a check read. */
export const sameParents = (child: string, had: string[]) =>
  had.length
    ? guard(
        `(SELECT count(*) FROM parent WHERE child = ?) = ? AND (SELECT count(*) FROM parent WHERE child = ? AND parent IN (${had.map(() => '?').join(', ')})) = ?`,
        child, had.length, child, ...had, had.length,
      )
    : guard('NOT EXISTS (SELECT 1 FROM parent WHERE child = ?)', child);

/** Guards that a person is still there, born when a check read it. */
export const sameBorn = (id: string, born: string | null) => guard('EXISTS (SELECT 1 FROM person WHERE id = ? AND born IS ?)', id, born);

/** Guards that a person is still there. */
export const personExists = (id: string) => guard('EXISTS (SELECT 1 FROM person WHERE id = ?)', id);
