// Importing a GEDCOM file into a family: the preview (what would happen, nothing written) and the apply (the
// same plan, written as one guarded batch through `once`, so a retry or a second copy cannot write twice).
// Server-only: it uses the family's database. The steward's permission is checked by the server function that
// calls this (exchange.functions.ts), before anything here runs.
import { storeFurther } from '../further-given.ts';
import { db, newId, once, sameBorn, type Db, type HistoryEntry, type OpKey } from '../db.server.ts';
import { gazetteer, locatePlaces, type Located } from '../gazetteer.server.ts';
import { guard, q, type Query } from '../store/index.ts';
import { readGedcom } from './gedcom.ts';
import { planImport, type Conflict, type ConflictCode, type ImportPlan } from './plan.ts';
import type { Vars } from '../i18n/types.ts';
import { readTree, type ExTree, type IssueCode } from './model.ts';

/** Lists are cut at this many rows; the counts are always complete. */
const LIST = 300;

/**
 * The places the import brings that the family has no pin for yet. A place the gazetteer places with certainty gets its
 * pin on the Atlas; the rest are listed, and keep only their text. Pins already on the map are never moved.
 */
interface PlacePlan {
  located: Map<string, Located>;
  unplaced: string[];
  /** Places the family already has a pin for. */
  alreadyPinned: number;
  /** The pins the family has now: a write that is guarded on this number. */
  pins: number;
  gazetteer: boolean;
}

export interface PlacePreview {
  located: number;
  unplaced: number;
  alreadyPinned: number;
  /** Whether this deployment has a gazetteer at all; without one nothing can be placed. */
  gazetteer: boolean;
  unplacedNames: string[];
}

async function placePlan(d: Db, plan: ImportPlan): Promise<PlacePlan> {
  const names = [...new Set([...plan.add.flatMap((p) => [p.bornPlace, p.diedPlace]), ...plan.unions.map((u) => u.place), ...plan.events.map((e) => e.place)])].filter(
    (n): n is string => !!n,
  );
  const pinned = await d.all<{ name: string }>('SELECT name FROM place');
  const have = new Set(pinned.map((r) => r.name));
  const wanted = names.filter((n) => !have.has(n));
  const g = gazetteer();
  const located = g && wanted.length ? await locatePlaces(g, wanted) : new Map<string, Located>();
  return {
    located,
    unplaced: wanted.filter((n) => !located.has(n)),
    alreadyPinned: names.length - wanted.length,
    pins: pinned.length,
    gazetteer: !!g,
  };
}

function placePreview(p: PlacePlan): PlacePreview {
  return { located: p.located.size, unplaced: p.unplaced.length, alreadyPinned: p.alreadyPinned, gazetteer: p.gazetteer, unplacedNames: p.unplaced.slice(0, LIST) };
}

export interface ImportPreview {
  /** The family's own name, and the name the file gives itself. */
  family: { name: string };
  fileName: string | null;
  existing: number;
  incoming: number;
  add: { name: string }[];
  addCount: number;
  matched: { name: string; by: 'id' | 'name' }[];
  matchCount: number;
  ambiguous: string[];
  conflicts: { name: string; field: string; code: ConflictCode; kind: Conflict['kind']; existing: string; incoming: string; vars: Vars }[];
  conflictCount: number;
  parents: number;
  duplicateParents: number;
  unions: number;
  duplicateUnions: number;
  unlinked: number;
  pictures: number;
  /** New life events, sources and citations, and how many of each the family already had. */
  events: number;
  duplicateEvents: number;
  sources: number;
  duplicateSources: number;
  citations: number;
  duplicateCitations: number;
  issues: { level: string; message: string; code: IssueCode; vars: Vars }[];
  issueCount: number;
  places: PlacePreview;
}

function summarize(plan: ImportPlan, incoming: ReturnType<typeof readGedcom>, existing: ExTree, places: PlacePlan): ImportPreview {
  return {
    places: placePreview(places),
    family: { name: existing.name },
    fileName: incoming.tree.name,
    existing: existing.people.length,
    incoming: incoming.people.length,
    add: plan.add.slice(0, LIST).map((p) => ({ name: [p.given, p.surname].filter(Boolean).join(' ') })),
    addCount: plan.add.length,
    matched: plan.matched.slice(0, LIST).map((m) => ({ name: m.name, by: m.by })),
    matchCount: plan.matched.length,
    ambiguous: plan.ambiguous.slice(0, LIST),
    conflicts: plan.conflicts
      .slice(0, LIST)
      .map((c) => ({ name: c.name, field: c.field, code: c.code, kind: c.kind, existing: c.existing, incoming: c.incoming, vars: c.vars })),
    conflictCount: plan.conflicts.length,
    parents: plan.parents.length,
    duplicateParents: plan.duplicateParents,
    unions: plan.unions.length,
    duplicateUnions: plan.duplicateUnions,
    unlinked: plan.unlinked,
    pictures: incoming.pictures,
    events: plan.events.length,
    duplicateEvents: plan.duplicateEvents,
    sources: plan.sources.length,
    duplicateSources: plan.duplicateSources,
    citations: plan.citations.length,
    duplicateCitations: plan.duplicateCitations,
    issues: plan.issues.slice(0, LIST).map((i) => ({ level: i.level, message: i.message, code: i.code, vars: i.vars })),
    issueCount: plan.issues.length,
  };
}

/** What importing `text` into `tree` would do. Reads only. */
export async function previewImport(tree: string, text: string): Promise<ImportPreview> {
  const d = db(tree);
  const existing = await readTree(d);
  const incoming = readGedcom(text);
  const plan = planImport(incoming, existing, newId);
  return summarize(plan, incoming, existing, await placePlan(d, plan));
}

export interface ApplyResult {
  people: number;
  parents: number;
  unions: number;
  matched: number;
  events: number;
  sources: number;
  citations: number;
  /** Places given a pin on the Atlas from the gazetteer, and places that could not be placed with certainty. */
  places: { located: number; unplaced: number };
}

/**
 * Writes the import. A family that already has people needs `allowExisting`: adding a file to a family is
 * never the default. The batch restates what the plan read, so if anyone else changed the family in between,
 * nothing is written and the import is planned again on fresh reads (see `once`). The parent links are guarded by
 * the ancestry revision (migration 0011), which every change to a link bumps: one number, the same size for a
 * family of any size, and it moves even when another editor replaces one link with a different one and leaves the
 * count the same. The loop check above only holds for the links it read.
 */
export function applyImport(tree: string, text: string, op: OpKey | undefined, allowExisting: boolean): Promise<ApplyResult> {
  return once<ApplyResult>(tree, op, 'importExchange', async (d) => {
    // The revision is read before the links: a change between the two reads makes the guard fail, never pass.
    const rev = await d.get<{ rev: number }>('SELECT rev FROM ancestry_rev WHERE id = 1');
    if (!rev) throw new Error('The family database is missing its ancestry revision: run its migrations.');
    const existing = await readTree(d);
    if (existing.people.length && !allowExisting) {
      throw new Error('exchange.import.needAllow');
    }
    const incoming = readGedcom(text);
    const plan = planImport(incoming, existing, newId);
    // A file that would make someone their own ancestor is not written at all: the steward corrects it first.
    if (plan.cycles.length) throw new Error('exchange.cycle_refused');
    const writes: Query[] = [
      guard('(SELECT count(*) FROM person) = ?', existing.people.length),
      guard('(SELECT count(*) FROM parent) = ?', existing.parents.length),
      guard('(SELECT rev FROM ancestry_rev WHERE id = 1) = ?', rev.rev),
      guard('(SELECT count(*) FROM partnership) = ?', existing.unions.length),
      // What the plan read of events, sources and citations, so one added meanwhile makes the import plan again.
      guard('(SELECT count(*) FROM life_event) = ?', existing.events?.length ?? 0),
      guard('(SELECT count(*) FROM source) = ?', existing.sources?.length ?? 0),
      guard('(SELECT count(*) FROM citation) = ?', existing.citations?.length ?? 0),
    ];
    const at = new Date().toISOString();
    // A source's link to research or the gallery is kept only when this family has that document or picture.
    const docs = new Set((await d.all<{ id: string }>('SELECT id FROM research_document')).map((r) => r.id));
    const pictures = new Set((await d.all<{ key: string }>('SELECT key FROM media')).map((r) => r.key));
    for (const x of plan.sources) {
      const document = x.document && docs.has(x.document) ? x.document : null;
      const media = x.media && pictures.has(x.media) ? x.media : null;
      if (document) writes.push(guard('EXISTS (SELECT 1 FROM research_document WHERE id = ?)', document));
      if (media) writes.push(guard('EXISTS (SELECT 1 FROM media WHERE key = ?)', media));
      writes.push(q('INSERT INTO source (id, title, author, publication, reference, date, note, document, media, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        x.id, x.title, x.author, x.publication, x.reference, x.date, x.note, document, media, 'GEDCOM', at, at));
    }
    // The parent rules read these birth dates: a date changed in between makes the import plan again.
    for (const [id, born] of plan.bornRead) writes.push(sameBorn(id, born));
    for (const p of plan.add) {
      writes.push(
        q(
          `INSERT INTO person (id, given, surname, sex, born, born_place, died, died_place, living, title, epithet, occupation, nickname, bio, current_given, current_surname, further_given)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          p.id,
          p.given,
          p.surname,
          p.sex,
          p.born,
          p.bornPlace,
          p.died,
          p.diedPlace,
          p.living ? 1 : 0,
          p.title,
          p.epithet,
          p.occupation,
          p.nickname,
          p.bio,
          p.currentGiven,
          p.currentSurname,
          storeFurther(p.furtherGiven),
        ),
      );
    }
    for (const l of plan.parents) writes.push(q('INSERT INTO parent (child, parent, kind, confidence) VALUES (?, ?, ?, ?)', l.child, l.parent, l.kind, l.confidence));
    for (const u of plan.unions) {
      writes.push(
        q('INSERT INTO partnership (id, a, b, kind, start, end, end_reason, place) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', u.id, u.a, u.b, u.kind, u.start, u.end, u.endReason, u.place),
      );
    }
    for (const e of plan.events) {
      writes.push(q('INSERT INTO life_event (id, person, type, label, date, end_date, place, note, ord, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        e.id, e.person, e.type, e.label, e.date, e.endDate, e.place, e.note, e.ord, 'GEDCOM', at, at));
    }
    for (const c of plan.citations) {
      const t = c.target;
      const cols = t.fact === 'event' ? [null, null, t.event, null] : t.fact === 'partnership' ? [null, null, null, t.partnership] : t.fact === 'parent' ? [t.child, t.parent, null, null] : [t.person, null, null, null];
      writes.push(q('INSERT INTO citation (id, source, fact, person, parent, event, partnership, page, quality, transcription, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        c.id, c.source, t.fact, ...cols, c.page, c.quality, c.transcription, 'GEDCOM', at, at));
    }
    // The pins: only for places the gazetteer places with certainty, and only where the family has no pin yet.
    const places = await placePlan(d, plan);
    writes.push(guard('(SELECT count(*) FROM place) = ?', places.pins));
    for (const [name, at] of places.located) {
      writes.push(q('INSERT INTO place (name, lat, lng, country) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO NOTHING', name, at.lat, at.lng, at.country));
    }
    // One row for the whole import, however many people it brings: what it added, counted. Never a row per person.
    const counts = { people: plan.add.length, parents: plan.parents.length, unions: plan.unions.length, events: plan.events.length, sources: plan.sources.length, citations: plan.citations.length };
    const history: HistoryEntry[] = Object.values(counts).some((n) => n > 0)
      ? [{ kind: 'import', record: at, action: 'added', label: 'GEDCOM', count: plan.add.length || 1,
        diff: { f: Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => [k, [null, n]])) } }]
      : [];
    return {
      writes,
      history,
      result: {
        people: plan.add.length,
        parents: plan.parents.length,
        unions: plan.unions.length,
        matched: plan.matched.length,
        events: plan.events.length,
        sources: plan.sources.length,
        citations: plan.citations.length,
        places: { located: places.located.size, unplaced: places.unplaced.length },
      },
    };
  });
}
