// A family's research in the Markdown export and the nightly archive: one Markdown file per project under research/, with its
// documents' files under research/files/. Private projects, documents, notes and person links are left out, as private fields
// are; only a project's non-private parts are written, and the export says what it left out. Files are capped: the whole export
// is built in memory, on a Worker too, so past ARCHIVE_DOCUMENT_BUDGET the rest of the documents are named but not copied. The
// database's own backups and the D1 transfer carry everything.
import { db, media } from '../db.server.ts';
import { DOCUMENT_EXT, type DocumentMime } from '../research.ts';
import type { ArchiveFile } from './markdown.ts';

/** How many bytes of documents one export copies. Enough for a family's scans; a run must not outgrow a Worker's memory. */
export const ARCHIVE_DOCUMENT_BUDGET = 40_000_000;

interface Row { id: string; title: string; summary: string; created_by_name: string; created_at: string }
interface Doc { id: string; project: string; key: string; mime: DocumentMime; size: number; title: string; date: string | null; source: string | null; notes: string }
interface Note { id: string; project: string; title: string; body: string; date: string | null }
interface Named { project: string; name: string }

export interface ResearchArchive {
  files: ArchiveFile[];
  /** What is not in this archive, in the words the export report shows. */
  losses: string[];
}

const slug = (s: string) => s.normalize('NFKD').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 60) || 'project';
const fileOf = (d: Doc) => `research/files/${d.id}.${DOCUMENT_EXT[d.mime]}`;

/** The note for one project: pure, so a test can read it. */
export function projectNote(p: Row, parts: { people: string[]; places: string[]; pictures: string[]; docs: Doc[]; notes: Note[]; held: Set<string> }): string {
  const lines = [`# ${p.title}`, '', ...(p.summary ? [p.summary, ''] : []), `Started by ${p.created_by_name || 'someone'} on ${p.created_at.slice(0, 10)}.`, ''];
  if (parts.people.length) lines.push('## People', '', ...parts.people.map((n) => `- ${n}`), '');
  if (parts.places.length) lines.push('## Places', '', ...parts.places.map((n) => `- ${n}`), '');
  if (parts.docs.length) {
    lines.push('## Documents', '');
    for (const d of parts.docs) {
      const what = parts.held.has(d.id) ? `[${d.title}](files/${d.id}.${DOCUMENT_EXT[d.mime]})` : `${d.title} (not copied: over the archive's size limit)`;
      lines.push(`- ${what}${d.date ? `, ${d.date}` : ''}${d.source ? `; source: ${d.source}` : ''}${d.notes ? `. ${d.notes}` : ''}`);
    }
    lines.push('');
  }
  if (parts.pictures.length) lines.push('## Pictures from the gallery', '', ...parts.pictures.map((k) => `- ${k}`), '');
  if (parts.notes.length) {
    lines.push('## Notes', '');
    for (const n of parts.notes) lines.push(`### ${n.title}${n.date ? ` (${n.date})` : ''}`, '', n.body, '');
  }
  return lines.join('\n');
}

/** The family's research as archive files, and what was left out. Read-only. */
export async function researchArchive(tree: string): Promise<ResearchArchive> {
  const d = db(tree);
  const [projects, docs, notes, people, places, pictures, hidden] = await Promise.all([
    d.all<Row>("SELECT id, title, summary, created_by_name, created_at FROM research_project WHERE private = 0 ORDER BY created_at, id"),
    d.all<Doc>('SELECT d.* FROM research_document d JOIN research_project p ON p.id = d.project WHERE d.private = 0 AND p.private = 0 ORDER BY d.created_at, d.id'),
    d.all<Note>('SELECT n.* FROM research_note n JOIN research_project p ON p.id = n.project WHERE n.private = 0 AND p.private = 0 ORDER BY n.created_at, n.id'),
    d.all<Named>("SELECT l.project, trim(coalesce(p.given, '') || ' ' || coalesce(p.surname, '')) AS name FROM research_person l JOIN person p ON p.id = l.person WHERE l.private = 0 ORDER BY l.created_at"),
    d.all<Named>('SELECT project, place AS name FROM research_place ORDER BY created_at'),
    // A picture uploaded for a post is not research's to list (research.server.ts refuses the link).
    d.all<Named>('SELECT r.project, r.media AS name FROM research_picture r JOIN media m ON m.key = r.media WHERE m.for_post = 0 ORDER BY r.created_at'),
    d.get<{ n: number }>(`SELECT
      (SELECT count(*) FROM research_project WHERE private = 1)
      + (SELECT count(*) FROM research_document d JOIN research_project p ON p.id = d.project WHERE d.private = 1 AND p.private = 0)
      + (SELECT count(*) FROM research_note n JOIN research_project p ON p.id = n.project WHERE n.private = 1 AND p.private = 0)
      + (SELECT count(*) FROM research_person l JOIN research_project p ON p.id = l.project WHERE l.private = 1 AND p.private = 0) AS n`),
  ]);
  const held = new Set<string>();
  const files: ArchiveFile[] = [];
  let spent = 0;
  for (const doc of docs) {
    if (spent + doc.size > ARCHIVE_DOCUMENT_BUDGET) continue;
    const got = await media.get(tree, doc.key);
    if (!got) continue;
    const bytes = got.body instanceof Uint8Array ? got.body : new Uint8Array(await new Response(got.body).arrayBuffer());
    spent += doc.size;
    held.add(doc.id);
    files.push({ path: fileOf(doc), data: bytes });
  }
  const of = <T extends { project: string }>(rows: T[], id: string) => rows.filter((r) => r.project === id);
  const named = new Map<string, number>();
  for (const p of projects) {
    const base = slug(p.title);
    const n = (named.get(base) ?? 0) + 1;
    named.set(base, n);
    files.push({
      path: `research/${base}${n > 1 ? `-${n}` : ''}.md`,
      data: projectNote(p, {
        people: of(people, p.id).map((r) => r.name),
        places: of(places, p.id).map((r) => r.name),
        pictures: of(pictures, p.id).map((r) => r.name),
        docs: of(docs, p.id),
        notes: of(notes, p.id),
        held,
      }),
    });
  }
  const losses: string[] = [];
  if (hidden?.n) losses.push(`${hidden.n} private research ${hidden.n === 1 ? 'item is' : 'items are'} not in the archive`);
  const uncopied = docs.length - held.size;
  if (uncopied) losses.push(`${uncopied} research ${uncopied === 1 ? 'document was' : 'documents were'} too large to copy and ${uncopied === 1 ? 'is' : 'are'} only listed by name`);
  return { files, losses };
}

/** What a GEDCOM file cannot carry of a family's research, for the export report. */
export async function researchGedcomLosses(tree: string): Promise<string[]> {
  const n = (await db(tree).get<{ n: number }>('SELECT count(*) AS n FROM research_project'))?.n ?? 0;
  return n ? [`${n} research ${n === 1 ? 'project is' : 'projects are'} not in a GEDCOM file (the Markdown archive has them)`] : [];
}
