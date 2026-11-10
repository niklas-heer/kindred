// The Research page's data and changes, for the server functions in research.functions.ts. Every change is a `once` plan
// whose guards hold what it read (db.server.ts), and a document's file is written before the row that points at it.
//
// Who may do what is decided here as well as in the server function: viewers read what they may see, contributors add and
// change their own work, editors change anyone's. Private projects, documents, notes and person links are the rule of a
// private field: only editors and stewards ever receive them, and to everyone else they do not exist (not found, not refused).
import { fail } from './auth/guard.server';
import { forbidden } from './auth/errors';
import { added, change, db, guard, media, once, personExists, q, removed, type Db, type OpKey } from './db.server';
import { DOCUMENT_EXT, mayChangeResearch, seesPrivateResearch, type DocumentMime, type PersonResearchLink, type ProjectSummary, type ProjectView, type ResearchDocument, type ResearchNote } from './research.ts';
import { can, type Role } from './roles.ts';
import { LIVING_IDS, pictureColumn } from './protect-living.ts';

/**
 * Who is asking, as the guard established. `protectLiving` is set for a guest whose link protects living people: a project
 * that names a living person is then not there for them at all, documents, notes and files included (src/lib/protect-living.ts).
 */
export interface Who { id: string; name: string; role: Role; protectLiving?: boolean }

interface ProjectRow {
  id: string; title: string; summary: string; private: number; created_by: string; created_by_name: string; updated_at: string;
}

const now = () => new Date().toISOString();
const privateFilter = (see: boolean, alias = '') => (see ? '' : `AND ${alias}private = 0`);
/** Leaves out every project that names a living person, privately or not, when the reader's link protects the living. */
const livingFilter = (protect: boolean | undefined, project: string) =>
  (protect ? `AND NOT EXISTS (SELECT 1 FROM research_person lp WHERE lp.project = ${project} AND lp.person IN (${LIVING_IDS}))` : '');

const needs = (who: Who, action: 'add-research' | 'edit-research') => {
  if (!can(who.role, action)) throw fail(forbidden(action, action === 'add-research' ? 'contributor' : 'editor'));
};
/** Refuses a change to someone else's work unless the reader is an editor. */
const needsChange = (who: Who, owner: string) => {
  if (!mayChangeResearch(who.role, owner === who.id)) throw fail(forbidden('edit-research', 'editor'));
};
/** Marking something private is an editor's: a contributor could never read it again. */
const needsPrivateRight = (who: Who, makesPrivate: boolean) => {
  if (makesPrivate && !seesPrivateResearch(who.role)) throw fail(forbidden('edit-research', 'editor'));
};

async function projectFor(d: Db, id: string, who: Who): Promise<ProjectRow> {
  const row = await d.get<ProjectRow>(`SELECT * FROM research_project WHERE id = ? ${privateFilter(seesPrivateResearch(who.role))}`, id);
  if (!row) throw new Error('research.err.project_gone');
  return row;
}

/** The history's level for research: private research is for editors and stewards only, as everywhere else. */
const levelOf = (...privates: (number | boolean | undefined)[]) => (privates.some((x) => x === 1 || x === true) ? 'editors' as const : 'family' as const);

const projectStillThere = (id: string) => guard('EXISTS (SELECT 1 FROM research_project WHERE id = ?)', id);
const touch = (id: string) => q('UPDATE research_project SET updated_at = ? WHERE id = ?', now(), id);

// ---------- reads ----------

const authored = (r: { created_by: string; created_by_name: string }, who: { id: string }) => ({ by: r.created_by_name, mine: r.created_by === who.id });

/** Every project the reader may see, most recently changed first, with what each holds that the reader may see. */
export async function listProjects(tree: string, who: Who): Promise<ProjectSummary[]> {
  const see = seesPrivateResearch(who.role);
  const rows = await db(tree).all<ProjectRow & { documents: number; pictures: number; notes: number; people: number; places: number }>(
    `SELECT p.*,
       (SELECT count(*) FROM research_document x WHERE x.project = p.id ${privateFilter(see, 'x.')}) AS documents,
       (SELECT count(*) FROM research_picture x JOIN media m ON m.key = x.media WHERE x.project = p.id AND m.for_post = 0) AS pictures,
       (SELECT count(*) FROM research_note x WHERE x.project = p.id ${privateFilter(see, 'x.')}) AS notes,
       (SELECT count(*) FROM research_person x WHERE x.project = p.id ${privateFilter(see, 'x.')}) AS people,
       (SELECT count(*) FROM research_place x WHERE x.project = p.id) AS places
     FROM research_project p
     WHERE 1 = 1 ${privateFilter(see, 'p.')} ${livingFilter(who.protectLiving, 'p.id')}
     ORDER BY p.updated_at DESC, p.id`,
  );
  return rows.map((r) => ({
    id: r.id, title: r.title, summary: r.summary, private: r.private === 1, updatedAt: r.updated_at, ...authored(r, who),
    counts: { documents: r.documents, pictures: r.pictures, notes: r.notes, people: r.people, places: r.places },
  }));
}

/** One project as the reader may see it, or undefined when it is gone or hidden from them. */
export async function projectView(tree: string, id: string, who: Who): Promise<ProjectView | undefined> {
  const d = db(tree);
  const see = seesPrivateResearch(who.role);
  const p = await d.get<ProjectRow>(`SELECT * FROM research_project WHERE id = ? ${privateFilter(see)} ${livingFilter(who.protectLiving, 'research_project.id')}`, id);
  if (!p) return undefined;
  const [documents, notes, pictures, people, places] = await Promise.all([
    d.all<Record<string, never> & DocumentRow>(`SELECT * FROM research_document WHERE project = ? ${privateFilter(see)} ORDER BY coalesce(date, '9999'), created_at, id`, id),
    d.all<Record<string, never> & NoteRow>(`SELECT * FROM research_note WHERE project = ? ${privateFilter(see)} ORDER BY coalesce(date, '9999'), created_at, id`, id),
    d.all<{ media: string; taken: string | null; caption: string | null; created_by: string; created_by_name: string }>(
      // A picture with a living person in it comes to a protected guest without its caption or date (protect-living.ts). A
      // picture uploaded for a post is the members' alone, and research, which a guest reads, never shows one.
      `SELECT r.media, ${pictureColumn('m.taken', who.protectLiving)} AS taken, ${pictureColumn('m.caption', who.protectLiving)} AS caption, r.created_by, r.created_by_name
         FROM research_picture r JOIN media m ON m.key = r.media WHERE r.project = ? AND m.for_post = 0 ORDER BY r.created_at, r.media`, id),
    d.all<{ person: string; private: number; created_by: string; created_by_name: string }>(
      `SELECT person, private, created_by, created_by_name FROM research_person WHERE project = ? ${privateFilter(see)} ORDER BY created_at, person`, id),
    d.all<{ place: string; created_by: string; created_by_name: string }>(
      'SELECT place, created_by, created_by_name FROM research_place WHERE project = ? ORDER BY created_at, place', id),
  ]);
  return {
    id: p.id, title: p.title, summary: p.summary, private: p.private === 1, updatedAt: p.updated_at, ...authored(p, who),
    documents: documents.map((r) => documentOf(r, who)),
    notes: notes.map((r) => noteOf(r, who)),
    pictures: pictures.map((r) => ({ key: r.media, taken: r.taken, caption: r.caption, ...authored(r, who) })),
    people: people.map((r) => ({ person: r.person, private: r.private === 1, ...authored(r, who) })),
    places: places.map((r) => ({ place: r.place, ...authored(r, who) })),
  };
}

/** The research that names a person, for their panel: only projects and links the reader may see. */
export async function personResearch(tree: string, person: string, who: Who): Promise<PersonResearchLink[]> {
  const see = seesPrivateResearch(who.role);
  const rows = await db(tree).all<{ id: string; title: string; private: number }>(
    `SELECT p.id, p.title, p.private FROM research_person l JOIN research_project p ON p.id = l.project
     WHERE l.person = ? ${privateFilter(see, 'l.')} ${privateFilter(see, 'p.')} ${livingFilter(who.protectLiving, 'p.id')} ORDER BY p.updated_at DESC, p.id`,
    person,
  );
  return rows.map((r) => ({ id: r.id, title: r.title, private: r.private === 1 }));
}

/** What the file route may serve: the document, if the reader may see it and its project (`protectLiving` as in `Who`). */
export async function documentFile(tree: string, key: string, role: Role | null | undefined, protectLiving = false): Promise<{ mime: DocumentMime; title: string; private: boolean } | undefined> {
  const see = seesPrivateResearch(role);
  const r = await db(tree).get<{ mime: DocumentMime; title: string; doc_private: number; project_private: number }>(
    `SELECT d.mime, d.title, d.private AS doc_private, p.private AS project_private
     FROM research_document d JOIN research_project p ON p.id = d.project
     WHERE d.key = ? ${privateFilter(see, 'd.')} ${privateFilter(see, 'p.')} ${livingFilter(protectLiving, 'p.id')}`,
    key,
  );
  return r ? { mime: r.mime, title: r.title, private: r.doc_private === 1 || r.project_private === 1 } : undefined;
}

// ---------- projects ----------

export interface ProjectInput { id?: string; title: string; summary: string; private: boolean }

/** Creates a project (no id) or changes one. Returns its id. */
export function saveProject(tree: string, who: Who, p: ProjectInput, op: OpKey | undefined): Promise<{ id: string }> {
  return once(tree, op, 'researchSaveProject', async (d) => {
    needs(who, 'add-research');
    needsPrivateRight(who, p.private);
    if (p.id) {
      const had = await projectFor(d, p.id, who);
      needsChange(who, had.created_by);
      return {
        writes: [projectStillThere(p.id), q('UPDATE research_project SET title = ?, summary = ?, private = ?, updated_at = ? WHERE id = ?', p.title, p.summary, p.private ? 1 : 0, now(), p.id)],
        history: change('research', p.id, { title: had.title, summary: had.summary, private: had.private }, { title: p.title, summary: p.summary, private: p.private ? 1 : 0 },
          { label: p.title, level: levelOf(had.private, p.private) }),
        result: { id: p.id },
      };
    }
    const id = crypto.randomUUID();
    const at = now();
    return {
      writes: [q('INSERT INTO research_project (id, title, summary, private, created_by, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, p.title, p.summary, p.private ? 1 : 0, who.id, who.name, at, at)],
      history: [added('research', id, { label: p.title, level: levelOf(p.private) })],
      result: { id },
    };
  });
}

/**
 * Deletes a project with everything in it, and its documents' files once the delete has committed. An editor may delete any
 * project; a contributor only one they started and that holds nobody else's work.
 */
export function removeProject(tree: string, who: Who, id: string, op: OpKey | undefined) {
  return once(tree, op, 'researchRemoveProject', async (d) => {
    const had = await projectFor(d, id, who);
    needsChange(who, had.created_by);
    const othersWork = `EXISTS (SELECT 1 FROM research_document WHERE project = ?1 AND created_by <> ?2)
      OR EXISTS (SELECT 1 FROM research_note WHERE project = ?1 AND created_by <> ?2)
      OR EXISTS (SELECT 1 FROM research_picture WHERE project = ?1 AND created_by <> ?2)
      OR EXISTS (SELECT 1 FROM research_person WHERE project = ?1 AND created_by <> ?2)
      OR EXISTS (SELECT 1 FROM research_place WHERE project = ?1 AND created_by <> ?2)`;
    const isEditor = can(who.role, 'edit-research');
    if (!isEditor) {
      const blocked = await d.get<{ yes: number }>(`SELECT (${othersWork}) AS yes`, id, who.id);
      if (blocked?.yes) throw new Error('research.err.others_work');
    }
    return {
      writes: [
        ...(isEditor ? [] : [guard(`NOT (${othersWork})`, id, who.id)]),
        q('SELECT key FROM research_document WHERE project = ?', id), // the files to delete, read inside the batch
        q('DELETE FROM research_project WHERE id = ?', id),
      ],
      history: [removed('research', id, { label: had.title, level: levelOf(had.private) })],
      result: undefined,
      after: async (r) => {
        const rows = r[isEditor ? 0 : 1].rows as { key: string }[];
        await Promise.all(rows.map((x) => media.delete(tree, x.key).catch((e) => console.error('research.err.delete_failed', x.key, e))));
      },
    };
  });
}

// ---------- documents ----------

interface DocumentRow {
  id: string; key: string; mime: DocumentMime; size: number; width: number; height: number; title: string; date: string | null; source: string | null; notes: string;
  private: number; created_by: string; created_by_name: string;
}

const documentOf = (r: DocumentRow, who: { id: string }): ResearchDocument => ({
  id: r.id, key: r.key, mime: r.mime, size: r.size, width: r.width, height: r.height, title: r.title, date: r.date, source: r.source, notes: r.notes,
  private: r.private === 1, ...authored(r, who),
});

export interface DocumentDetails { title: string; date: string | null; source: string | null; notes: string; private: boolean }

/** Stores a document and its details: the file first, the row kept only if the batch commits. */
export function addDocument(
  tree: string, who: Who, project: string, bytes: Uint8Array, mime: DocumentMime, size: { width: number; height: number }, details: DocumentDetails, op: OpKey | undefined,
): Promise<ResearchDocument> {
  return once(tree, op, 'researchAddDocument', async (d) => {
    needs(who, 'add-research');
    needsPrivateRight(who, details.private);
    const proj = await projectFor(d, project, who);
    const id = crypto.randomUUID();
    const key = `research/${crypto.randomUUID()}.${DOCUMENT_EXT[mime]}`;
    await media.put(tree, key, bytes, mime);
    const at = now();
    const row: DocumentRow = { id, key, mime, size: bytes.length, width: size.width, height: size.height, title: details.title, date: details.date, source: details.source, notes: details.notes, private: details.private ? 1 : 0, created_by: who.id, created_by_name: who.name };
    return {
      writes: [
        projectStillThere(project),
        q('INSERT INTO research_document (id, project, key, mime, size, width, height, title, date, source, notes, private, created_by, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          id, project, key, mime, row.size, size.width, size.height, details.title, details.date, details.source, details.notes, row.private, who.id, who.name, at, at),
        touch(project),
      ],
      // The file itself never goes into the history.
      history: [added('research', id, { label: details.title, level: levelOf(proj.private, details.private) })],
      result: documentOf(row, who),
      abandon: () => media.delete(tree, key).catch(() => {}),
    };
  });
}

/** The document, if the reader may see it. */
async function documentFor(d: Db, id: string, who: Who): Promise<DocumentRow & { project: string; project_private: number }> {
  const see = seesPrivateResearch(who.role);
  const r = await d.get<DocumentRow & { project: string; project_private: number }>(
    `SELECT d.*, p.private AS project_private FROM research_document d JOIN research_project p ON p.id = d.project WHERE d.id = ? ${privateFilter(see, 'd.')} ${privateFilter(see, 'p.')}`, id);
  if (!r) throw new Error('research.err.document_gone');
  return r;
}

export function editDocument(tree: string, who: Who, id: string, details: DocumentDetails, op: OpKey | undefined) {
  return once(tree, op, 'researchEditDocument', async (d) => {
    const had = await documentFor(d, id, who);
    needsChange(who, had.created_by);
    needsPrivateRight(who, details.private);
    return {
      writes: [
        guard('EXISTS (SELECT 1 FROM research_document WHERE id = ?)', id),
        q('UPDATE research_document SET title = ?, date = ?, source = ?, notes = ?, private = ?, updated_at = ? WHERE id = ?', details.title, details.date, details.source, details.notes, details.private ? 1 : 0, now(), id),
        touch(had.project),
      ],
      history: change('research', id, { title: had.title, date: had.date, source: had.source, notes: had.notes, private: had.private },
        { title: details.title, date: details.date, source: details.source, notes: details.notes, private: details.private ? 1 : 0 },
        { label: details.title, level: levelOf(had.project_private, had.private, details.private) }),
      result: undefined,
    };
  });
}

export function removeDocument(tree: string, who: Who, id: string, op: OpKey | undefined) {
  return once(tree, op, 'researchRemoveDocument', async (d) => {
    const had = await documentFor(d, id, who);
    needsChange(who, had.created_by);
    return {
      writes: [guard('EXISTS (SELECT 1 FROM research_document WHERE id = ?)', id), q('DELETE FROM research_document WHERE id = ?', id), touch(had.project)],
      history: [removed('research', id, { label: had.title, level: levelOf(had.project_private, had.private) })],
      result: undefined,
      after: () => media.delete(tree, had.key).catch((e) => console.error('research.err.delete_failed', had.key, e)),
    };
  });
}

// ---------- notes ----------

interface NoteRow { id: string; title: string; body: string; date: string | null; private: number; created_by: string; created_by_name: string }

const noteOf = (r: NoteRow, who: { id: string }): ResearchNote => ({ id: r.id, title: r.title, body: r.body, date: r.date, private: r.private === 1, ...authored(r, who) });

export interface NoteInput { id?: string; project: string; title: string; body: string; date: string | null; private: boolean }

/** Adds a note (no id) or changes one. */
export function saveNote(tree: string, who: Who, n: NoteInput, op: OpKey | undefined): Promise<{ id: string }> {
  return once(tree, op, 'researchSaveNote', async (d) => {
    needs(who, 'add-research');
    needsPrivateRight(who, n.private);
    const proj = await projectFor(d, n.project, who);
    const at = now();
    if (n.id) {
      const see = seesPrivateResearch(who.role);
      const had = await d.get<{ created_by: string; title: string; body: string; date: string | null; private: number }>(
        `SELECT created_by, title, body, date, private FROM research_note WHERE id = ? AND project = ? ${privateFilter(see)}`, n.id, n.project);
      if (!had) throw new Error('research.err.note_gone');
      needsChange(who, had.created_by);
      return {
        writes: [guard('EXISTS (SELECT 1 FROM research_note WHERE id = ?)', n.id), q('UPDATE research_note SET title = ?, body = ?, date = ?, private = ?, updated_at = ? WHERE id = ?', n.title, n.body, n.date, n.private ? 1 : 0, at, n.id), touch(n.project)],
        history: change('research', n.id, { title: had.title, body: had.body, date: had.date, private: had.private }, { title: n.title, body: n.body, date: n.date, private: n.private ? 1 : 0 },
          { label: n.title, level: levelOf(proj.private, had.private, n.private) }),
        result: { id: n.id },
      };
    }
    const id = crypto.randomUUID();
    return {
      writes: [projectStillThere(n.project), q('INSERT INTO research_note (id, project, title, body, date, private, created_by, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, n.project, n.title, n.body, n.date, n.private ? 1 : 0, who.id, who.name, at, at), touch(n.project)],
      history: [added('research', id, { label: n.title, level: levelOf(proj.private, n.private) })],
      result: { id },
    };
  });
}

export function removeNote(tree: string, who: Who, project: string, id: string, op: OpKey | undefined) {
  return once(tree, op, 'researchRemoveNote', async (d) => {
    const proj = await projectFor(d, project, who);
    const had = await d.get<{ created_by: string; title: string; private: number }>(`SELECT created_by, title, private FROM research_note WHERE id = ? AND project = ? ${privateFilter(seesPrivateResearch(who.role))}`, id, project);
    if (!had) throw new Error('research.err.note_gone');
    needsChange(who, had.created_by);
    return {
      writes: [guard('EXISTS (SELECT 1 FROM research_note WHERE id = ?)', id), q('DELETE FROM research_note WHERE id = ?', id), touch(project)],
      history: [removed('research', id, { label: had.title, level: levelOf(proj.private, had.private) })],
      result: undefined,
    };
  });
}

// ---------- links ----------

export type LinkKind = 'picture' | 'person' | 'place';

const LINK: Record<LinkKind, { table: string; column: string; parent: string; parentKey: string; gone: string }> = {
  picture: { table: 'research_picture', column: 'media', parent: 'media', parentKey: 'key', gone: 'research.err.picture_gone' },
  person: { table: 'research_person', column: 'person', parent: 'person', parentKey: 'id', gone: 'research.err.person_gone' },
  place: { table: 'research_place', column: 'place', parent: 'place', parentKey: 'name', gone: 'research.err.place_gone' },
};

/**
 * Links a gallery picture, a person or a place to a project. A link that already exists is left as it is. A picture uploaded
 * for a post (`media.for_post`) is refused: a share-link guest reads research, and that picture is the members' alone.
 */
export function addLink(tree: string, who: Who, project: string, kind: LinkKind, target: string, makePrivate: boolean, op: OpKey | undefined) {
  return once(tree, op, 'researchAddLink', async (d) => {
    needs(who, 'add-research');
    needsPrivateRight(who, makePrivate);
    const proj = await projectFor(d, project, who);
    const l = LINK[kind];
    const linked = await d.get(`SELECT 1 AS x FROM ${l.table} WHERE project = ? AND ${l.column} = ?`, project, target);
    if (!(await d.get(`SELECT 1 AS x FROM ${l.parent} WHERE ${l.parentKey} = ?`, target))) throw new Error(l.gone);
    if (kind === 'picture' && (await d.get('SELECT 1 AS x FROM media WHERE key = ? AND for_post = 1', target))) throw new Error('research.err.picture_of_a_post');
    const flag = kind === 'person' ? ', private' : '';
    const flagValue = kind === 'person' ? `, ${makePrivate ? 1 : 0}` : '';
    return {
      writes: [
        projectStillThere(project),
        kind === 'person' ? personExists(target)
          : kind === 'picture' ? guard('EXISTS (SELECT 1 FROM media WHERE key = ? AND for_post = 0)', target)
            : guard(`EXISTS (SELECT 1 FROM ${l.parent} WHERE ${l.parentKey} = ?)`, target),
        q(`INSERT INTO ${l.table} (project, ${l.column}${flag}, created_by, created_by_name, created_at) VALUES (?, ?${flagValue}, ?, ?, ?) ON CONFLICT (project, ${l.column}) DO NOTHING`,
          project, target, who.id, who.name, now()),
        touch(project),
      ],
      // A link that is already there is left as it is, and is no news. A person link is on that person's history too.
      history: linked ? [] : [added('research', `${project}>${target}`, { label: proj.title, person: kind === 'person' ? target : null, level: levelOf(proj.private, kind === 'person' && makePrivate) })],
      result: undefined,
    };
  });
}

/** Removes a link; the picture, the person or the place itself stays. */
export function removeLink(tree: string, who: Who, project: string, kind: LinkKind, target: string, op: OpKey | undefined) {
  return once(tree, op, 'researchRemoveLink', async (d) => {
    const proj = await projectFor(d, project, who);
    const l = LINK[kind];
    const hidden = kind === 'person' && !seesPrivateResearch(who.role) ? 'AND private = 0' : '';
    const had = await d.get<{ created_by: string; private?: number }>(`SELECT * FROM ${l.table} WHERE project = ? AND ${l.column} = ? ${hidden}`, project, target);
    if (!had) throw new Error('research.err.link_gone');
    needsChange(who, had.created_by);
    return {
      writes: [guard(`EXISTS (SELECT 1 FROM ${l.table} WHERE project = ? AND ${l.column} = ?)`, project, target), q(`DELETE FROM ${l.table} WHERE project = ? AND ${l.column} = ?`, project, target), touch(project)],
      history: [removed('research', `${project}>${target}`, { label: proj.title, person: kind === 'person' ? target : null, level: levelOf(proj.private, had.private) })],
      result: undefined,
    };
  });
}
