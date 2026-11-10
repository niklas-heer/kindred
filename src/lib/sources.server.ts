// The family's sources and the citations that tie them to facts: the reads for the Sources page, a person's page and the
// Needed page, and the editor's changes. Every change is a `once` plan whose guards restate what it read (db.server.ts).
//
// Sources and citations are for members: a share-link guest gets none of them (the server functions use `requireMember`,
// and every read here refuses a guest as well). Changing them is an editor's (`edit-person`), as changing the facts is.
// A source linked to a private research document shows that link only to those who may see private research.
//
// Deleting a source: the database refuses to drop a source that a citation uses (migration 0024). `removeSource` takes the
// number of citations the editor was shown and confirmed; it deletes those citations and the source in one batch, guarded on
// that number, so a citation added meanwhile makes the editor confirm again rather than vanish unseen.
import { fail } from './auth/guard.server';
import { notMember } from './auth/errors';
import { added, change, db, guard, once, q, removed, type Db, type OpKey, type Query } from './db.server';
import { needsEditor, type LifeReader } from './events.server';
import type { Citation, CitationInput, EventType, Fact, Quality, Source, SourceInput } from './events.ts';
import { seesPrivateResearch } from './research.ts';

const now = () => new Date().toISOString();
const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/** Sources are for members only. */
function needsMember(who: LifeReader) {
  if (who.guest || !who.id) throw fail(notMember());
}

interface SourceRow {
  id: string; title: string; author: string | null; publication: string | null; reference: string | null; date: string | null; note: string;
  document: string | null; media: string | null; citations: number; doc_title: string | null; doc_project: string | null; doc_private: number | null;
}

interface CitationRow {
  id: string; source: string; source_title: string; fact: Fact['fact']; person: string | null; parent: string | null; event: string | null; partnership: string | null;
  page: string | null; quality: Quality | null; transcription: string;
  event_person: string | null; event_type: EventType | null; event_label: string | null; pa: string | null; pb: string | null;
}

const targetOf = (r: Pick<CitationRow, 'fact' | 'person' | 'parent' | 'event' | 'partnership'>): Fact => {
  switch (r.fact) {
    case 'event': return { fact: 'event', event: r.event! };
    case 'partnership': return { fact: 'partnership', partnership: r.partnership! };
    case 'parent': return { fact: 'parent', child: r.person!, parent: r.parent! };
    default: return { fact: r.fact, person: r.person! };
  }
};

const citationOf = (r: CitationRow): Citation => ({
  id: r.id, source: r.source, sourceTitle: r.source_title, target: targetOf(r), page: r.page, quality: r.quality, transcription: r.transcription,
  about: [r.person, r.parent, r.event_person, r.pa, r.pb].filter((x): x is string => !!x),
  ...(r.event_type ? { event: { type: r.event_type, label: r.event_label } } : {}),
});

const CITATION_SELECT = `SELECT c.*, s.title AS source_title, e.person AS event_person, e.type AS event_type, e.label AS event_label, u.a AS pa, u.b AS pb
  FROM citation c JOIN source s ON s.id = c.source LEFT JOIN life_event e ON e.id = c.event LEFT JOIN partnership u ON u.id = c.partnership`;

// ---------- reads ----------

/** The family's sources, by title, each with how many facts cite it. */
export async function listSources(tree: string, who: LifeReader): Promise<Source[]> {
  needsMember(who);
  const see = seesPrivateResearch(who.role);
  const rows = await db(tree).all<SourceRow>(
    `SELECT s.*, (SELECT count(*) FROM citation c WHERE c.source = s.id) AS citations,
       d.title AS doc_title, d.project AS doc_project, (CASE WHEN d.id IS NULL THEN NULL WHEN d.private = 1 OR p.private = 1 THEN 1 ELSE 0 END) AS doc_private
     FROM source s LEFT JOIN research_document d ON d.id = s.document LEFT JOIN research_project p ON p.id = d.project
     ORDER BY s.title COLLATE NOCASE, s.id`,
  );
  return rows.map((r) => ({
    id: r.id, title: r.title, author: r.author, publication: r.publication, reference: r.reference, date: r.date, note: r.note,
    document: r.document && r.doc_title && r.doc_project && (see || r.doc_private === 0) ? { id: r.document, title: r.doc_title, project: r.doc_project } : null,
    media: r.media,
    citations: r.citations,
  }));
}

/** What cites one source. */
export async function sourceCitations(tree: string, source: string, who: LifeReader): Promise<Citation[]> {
  needsMember(who);
  return (await db(tree).all<CitationRow>(`${CITATION_SELECT} WHERE c.source = ? ORDER BY c.created_at, c.id`, source)).map(citationOf);
}

/**
 * The citations of every fact on one person's page: their birth, death and name, their events, their partnerships, and their
 * links to their parents.
 */
export async function personCitations(tree: string, person: string, who: LifeReader): Promise<Citation[]> {
  needsMember(who);
  const rows = await db(tree).all<CitationRow>(
    `${CITATION_SELECT} WHERE c.person = ?1
       OR c.event IN (SELECT id FROM life_event WHERE person = ?1)
       OR c.partnership IN (SELECT id FROM partnership WHERE a = ?1 OR b = ?1)
     ORDER BY c.created_at, c.id`,
    person,
  );
  return rows.map(citationOf);
}

/** The people whose birth has a date or a place but no source: what the Needed page lists for editors. */
export async function unsourcedBirths(tree: string, who: LifeReader): Promise<string[]> {
  needsEditor(who);
  const rows = await db(tree).all<{ id: string }>(
    `SELECT p.id FROM person p WHERE (coalesce(p.born, '') <> '' OR coalesce(p.born_place, '') <> '')
       AND NOT EXISTS (SELECT 1 FROM citation c WHERE c.fact = 'birth' AND c.person = p.id) ORDER BY p.rowid`,
  );
  return rows.map((r) => r.id);
}

// ---------- sources ----------

/** Checks the research document and the gallery picture a source links to, and returns the guards that hold them. */
async function linkGuards(d: Db, who: LifeReader, input: SourceInput): Promise<Query[]> {
  const out: Query[] = [];
  if (input.document) {
    const see = seesPrivateResearch(who.role);
    const doc = await d.get<{ id: string }>(
      `SELECT d.id FROM research_document d JOIN research_project p ON p.id = d.project WHERE d.id = ? ${see ? '' : 'AND d.private = 0 AND p.private = 0'}`, input.document);
    if (!doc) throw new Error('sources.err.document_gone');
    out.push(guard('EXISTS (SELECT 1 FROM research_document WHERE id = ?)', input.document));
  }
  if (input.media) {
    if (!(await d.get('SELECT key FROM media WHERE key = ?', input.media))) throw new Error('sources.err.picture_gone');
    out.push(guard('EXISTS (SELECT 1 FROM media WHERE key = ?)', input.media));
  }
  return out;
}

/** Adds a source (no id) or changes one. Returns its id. */
export function saveSource(tree: string, who: LifeReader, input: SourceInput, op: OpKey | undefined): Promise<{ id: string }> {
  return once(tree, op, 'saveSource', async (d) => {
    needsEditor(who);
    const title = clean(input.title);
    if (!title) throw new Error('sources.err.title_required');
    const at = now();
    const values = [title, clean(input.author), clean(input.publication), clean(input.reference), clean(input.date), input.note.trim(), input.document, input.media];
    const writes = await linkGuards(d, who, input);
    const [, author, publication, reference, date, note, document, media] = values;
    const next = { title, author, publication, reference, date, note, document, media };
    if (input.id) {
      const had = await d.get<typeof next>('SELECT title, author, publication, reference, date, note, document, media FROM source WHERE id = ?', input.id);
      if (!had) throw new Error('sources.err.gone');
      writes.push(
        guard('EXISTS (SELECT 1 FROM source WHERE id = ?)', input.id),
        q('UPDATE source SET title = ?, author = ?, publication = ?, reference = ?, date = ?, note = ?, document = ?, media = ?, updated_at = ? WHERE id = ?', ...values, at, input.id),
      );
      // The link to a research document may name a private one: only editors read it in the history.
      return { writes, history: change('source', input.id, had, next, { label: title, editors: ['document'] }), result: { id: input.id } };
    }
    const id = crypto.randomUUID();
    writes.push(q(
      'INSERT INTO source (id, title, author, publication, reference, date, note, document, media, created_by, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, ...values, who.id, who.name, at, at,
    ));
    return { writes, history: [added('source', id, { label: title })], result: { id } };
  });
}

/**
 * Deletes a source and the citations that use it. `citations` is how many the editor was shown and confirmed: when the count
 * is different now, nothing is deleted and the editor is asked again (`sources.err.cited_changed`).
 */
export function removeSource(tree: string, who: LifeReader, id: string, citations: number, op: OpKey | undefined) {
  return once(tree, op, 'removeSource', async (d) => {
    needsEditor(who);
    const had = await d.get<{ n: number; title: string }>('SELECT (SELECT count(*) FROM citation WHERE source = s.id) AS n, s.title FROM source s WHERE s.id = ?', id);
    if (!had) return { writes: [], history: [], result: undefined };
    if (had.n !== citations) throw new Error('sources.err.cited_changed');
    return {
      writes: [
        guard('(SELECT count(*) FROM citation WHERE source = ?) = ?', id, citations),
        q('DELETE FROM citation WHERE source = ?', id),
        q('DELETE FROM source WHERE id = ?', id),
      ],
      // One row for the source; its citations go with it, as the editor confirmed.
      history: [removed('source', id, { label: had.title })],
      result: undefined,
    };
  });
}

// ---------- citations ----------

/** The citation's columns for a fact, after checking the fact is there; and the guard that holds it there. */
async function factColumns(d: Db, f: Fact): Promise<{ cols: { person: string | null; parent: string | null; event: string | null; partnership: string | null }; hold: Query }> {
  const none = { person: null, parent: null, event: null, partnership: null };
  switch (f.fact) {
    case 'birth': case 'death': case 'name':
      if (!(await d.get('SELECT id FROM person WHERE id = ?', f.person))) throw new Error('sources.err.fact_gone');
      return { cols: { ...none, person: f.person }, hold: guard('EXISTS (SELECT 1 FROM person WHERE id = ?)', f.person) };
    case 'event':
      if (!(await d.get('SELECT id FROM life_event WHERE id = ?', f.event))) throw new Error('sources.err.fact_gone');
      return { cols: { ...none, event: f.event }, hold: guard('EXISTS (SELECT 1 FROM life_event WHERE id = ?)', f.event) };
    case 'partnership':
      if (!(await d.get('SELECT id FROM partnership WHERE id = ?', f.partnership))) throw new Error('sources.err.fact_gone');
      return { cols: { ...none, partnership: f.partnership }, hold: guard('EXISTS (SELECT 1 FROM partnership WHERE id = ?)', f.partnership) };
    case 'parent':
      if (!(await d.get('SELECT child FROM parent WHERE child = ? AND parent = ?', f.child, f.parent))) throw new Error('sources.err.fact_gone');
      return { cols: { ...none, person: f.child, parent: f.parent }, hold: guard('EXISTS (SELECT 1 FROM parent WHERE child = ? AND parent = ?)', f.child, f.parent) };
  }
}

/** The person a citation of an event or a partnership is about, for the history. */
async function factPerson(d: Db, event: string | null, partnership: string | null): Promise<string | null> {
  if (event) return (await d.get<{ person: string }>('SELECT person FROM life_event WHERE id = ?', event))?.person ?? null;
  if (partnership) return (await d.get<{ a: string }>('SELECT a FROM partnership WHERE id = ?', partnership))?.a ?? null;
  return null;
}

/** Cites a source for a fact (no id), or changes a citation's source, page, quality and transcription. Returns its id. */
export function saveCitation(tree: string, who: LifeReader, input: CitationInput, op: OpKey | undefined): Promise<{ id: string }> {
  return once(tree, op, 'saveCitation', async (d) => {
    needsEditor(who);
    const source = await d.get<{ title: string }>('SELECT title FROM source WHERE id = ?', input.source);
    if (!source) throw new Error('sources.err.gone');
    const at = now();
    const detail = [clean(input.page), input.quality, input.transcription.trim()] as const;
    const next = { source: input.source, page: detail[0], quality: detail[1], transcription: detail[2] };
    if (input.id) {
      const had = await d.get<typeof next & { person: string | null; event: string | null; partnership: string | null }>(
        'SELECT source, page, quality, transcription, person, event, partnership FROM citation WHERE id = ?', input.id);
      if (!had) throw new Error('sources.err.citation_gone');
      const { person, event, partnership, ...was } = had;
      return {
        history: change('citation', input.id, was, next, { label: source.title, person: person ?? await factPerson(d, event, partnership) }),
        writes: [
          guard('EXISTS (SELECT 1 FROM source WHERE id = ?)', input.source),
          guard('EXISTS (SELECT 1 FROM citation WHERE id = ?)', input.id),
          q('UPDATE citation SET source = ?, page = ?, quality = ?, transcription = ?, updated_at = ? WHERE id = ?', input.source, ...detail, at, input.id),
        ],
        result: { id: input.id },
      };
    }
    const { cols, hold } = await factColumns(d, input.target);
    const id = crypto.randomUUID();
    return {
      writes: [
        guard('EXISTS (SELECT 1 FROM source WHERE id = ?)', input.source),
        hold,
        q(`INSERT INTO citation (id, source, fact, person, parent, event, partnership, page, quality, transcription, created_by, created_by_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id, input.source, input.target.fact, cols.person, cols.parent, cols.event, cols.partnership, ...detail, who.id, who.name, at, at),
      ],
      history: [added('citation', id, { label: source.title, person: cols.person ?? await factPerson(d, cols.event, cols.partnership) })],
      result: { id },
    };
  });
}

/** Removes one citation; the source stays. A citation already gone is not an error. */
export function removeCitation(tree: string, who: LifeReader, id: string, op: OpKey | undefined) {
  return once(tree, op, 'removeCitation', async (d) => {
    needsEditor(who);
    const had = await d.get<{ person: string | null; event: string | null; partnership: string | null; title: string }>(
      'SELECT c.person, c.event, c.partnership, s.title FROM citation c JOIN source s ON s.id = c.source WHERE c.id = ?', id);
    if (!had) return { writes: [], history: [], result: undefined };
    return {
      writes: [guard('EXISTS (SELECT 1 FROM citation WHERE id = ?)', id), q('DELETE FROM citation WHERE id = ?', id)],
      history: [removed('citation', id, { label: had.title, person: had.person ?? await factPerson(d, had.event, had.partnership) })],
      result: undefined,
    };
  });
}
