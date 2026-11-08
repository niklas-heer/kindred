// The Research page's pure rules, shared by the browser and the server: what a role may do with research, what a family
// may upload as a document, and how a project's timeline is derived. No React and no database, so the test runner loads it.
import { formatDate } from './i18n/dictionary.ts';
import { can, type Role } from './roles.ts';

// ---------- what the browser receives ----------

/** Who wrote a thing, as the reader may know it. `mine` decides what a contributor may change. */
export interface Authored { by: string; mine: boolean }

export interface ProjectSummary extends Authored {
  id: string;
  title: string;
  summary: string;
  private: boolean;
  updatedAt: string;
  counts: { documents: number; pictures: number; notes: number; people: number; places: number };
}

export interface ResearchDocument extends Authored {
  id: string;
  key: string;
  mime: DocumentMime;
  size: number;
  width: number;
  height: number;
  title: string;
  date: string | null;
  source: string | null;
  notes: string;
  private: boolean;
}

export interface ResearchNote extends Authored {
  id: string;
  title: string;
  body: string;
  date: string | null;
  private: boolean;
}

export interface ResearchPicture extends Authored { key: string; taken: string | null; caption: string | null }
export interface ResearchPerson extends Authored { person: string; private: boolean }
export interface ResearchPlace extends Authored { place: string }

export interface ProjectView extends Authored {
  id: string;
  title: string;
  summary: string;
  private: boolean;
  updatedAt: string;
  documents: ResearchDocument[];
  notes: ResearchNote[];
  pictures: ResearchPicture[];
  people: ResearchPerson[];
  places: ResearchPlace[];
}

/** A project that mentions someone, for the person's panel. */
export interface PersonResearchLink { id: string; title: string; private: boolean }

// ---------- roles ----------

/** The reader's reach in research: the same rule as a private field, editors and stewards see private things. */
export const seesPrivateResearch = (role: Role | null | undefined) => can(role, 'edit-research');

/** Whether a role may change something: editors change anyone's, contributors only their own. */
export function mayChangeResearch(role: Role | null | undefined, mine: boolean): boolean {
  return can(role, 'edit-research') || (can(role, 'add-research') && mine);
}

// ---------- uploads ----------

export type DocumentMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';

/** The largest document a family can upload: a long scanned PDF fits, a video does not. */
export const MAX_DOCUMENT_BYTES = 25_000_000;
export const DOCUMENT_EXT: Record<DocumentMime, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
/** What the file picker offers. The server still decides by the bytes. */
export const DOCUMENT_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

/** What the first bytes say a document is, or null. A renamed file is what its bytes are, not what its name says. */
export function sniffDocument(bytes: Uint8Array): DocumentMime | null {
  const at = (i: number, ...b: number[]) => b.every((x, j) => bytes[i + j] === x);
  if (at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf'; // %PDF-
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

const ascii = (bytes: Uint8Array, from: number, to: number) => {
  let s = '';
  for (let i = from; i < to; i++) s += String.fromCharCode(bytes[i]);
  return s;
};

/** Where `word` next starts in `bytes` at or after `from`, or -1. */
function indexOfWord(bytes: Uint8Array, word: string, from: number): number {
  const first = word.charCodeAt(0);
  for (let i = bytes.indexOf(first, from); i !== -1 && i + word.length <= bytes.length; i = bytes.indexOf(first, i + 1)) {
    let j = 1;
    while (j < word.length && bytes[i + j] === word.charCodeAt(j)) j++;
    if (j === word.length) return i;
  }
  return -1;
}

const isDelimiter = (b: number | undefined) => b === undefined || b <= 0x20 || '()<>[]{}/%'.includes(String.fromCharCode(b));
/** PDF names that run code or carry files inside a document. Written as hex escapes (/J#61vaScript) they are the same name. */
const ACTIVE_NAMES = new Set(['JavaScript', 'JS', 'Launch', 'EmbeddedFile', 'EmbeddedFiles', 'RichMedia']);

/**
 * Whether a PDF's objects name active content. Stream bodies are skipped (they are compressed bytes, and a chance /JS in
 * them would refuse a good scan), so this is a first filter, not a proof: what really keeps a file harmless is how the
 * route serves it (src/routes/api/research.$tree.$key.ts).
 */
export function pdfHasActiveContent(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x73 /* s */ && ascii(bytes, i, i + 6) === 'stream' && isDelimiter(bytes[i + 6]) && (bytes[i - 1] !== 0x64 /* the d of endstream */)) {
      const end = indexOfWord(bytes, 'endstream', i + 6);
      if (end === -1) return false;
      i = end + 8;
      continue;
    }
    if (b !== 0x2f /* / */) continue;
    let name = '';
    let j = i + 1;
    for (; j < bytes.length && name.length < 40 && !isDelimiter(bytes[j]); j++) {
      if (bytes[j] === 0x23 && j + 2 < bytes.length) {
        const hex = Number.parseInt(ascii(bytes, j + 1, j + 3), 16);
        if (!Number.isNaN(hex)) {
          name += String.fromCharCode(hex);
          j += 2;
          continue;
        }
      }
      name += String.fromCharCode(bytes[j]);
    }
    if (ACTIVE_NAMES.has(name)) return true;
    i = j - 1;
  }
  return false;
}

/** The tail every finished PDF has: a cross-reference offset and the end marker. A file cut off in transit is refused. */
function pdfEndsLikeOne(bytes: Uint8Array): boolean {
  if (!/^%PDF-\d\.\d/.test(ascii(bytes, 0, Math.min(bytes.length, 16)))) return false;
  const tail = ascii(bytes, Math.max(0, bytes.length - 2048), bytes.length);
  return tail.includes('startxref') && tail.includes('%%EOF');
}

export type DocumentRefusal = 'research.err.file_empty' | 'research.err.file_large' | 'research.err.file_type' | 'research.err.pdf_broken' | 'research.err.pdf_active';

/**
 * Checks an upload by its content. `declared` is the type the browser sent (empty for an unknown one); a file whose bytes
 * disagree with it is refused too, so a picture renamed .pdf, or a script renamed anything, never gets a stored type it isn't.
 */
export function checkDocument(bytes: Uint8Array, declared: string): { mime: DocumentMime } | { refused: DocumentRefusal } {
  if (bytes.length === 0) return { refused: 'research.err.file_empty' };
  if (bytes.length > MAX_DOCUMENT_BYTES) return { refused: 'research.err.file_large' };
  const mime = sniffDocument(bytes);
  if (!mime || (declared && declared !== mime)) return { refused: 'research.err.file_type' };
  if (mime === 'application/pdf') {
    if (!pdfEndsLikeOne(bytes)) return { refused: 'research.err.pdf_broken' };
    if (pdfHasActiveContent(bytes)) return { refused: 'research.err.pdf_active' };
  }
  return { mime };
}

// ---------- the timeline ----------

export type TimelineKind = 'document' | 'note' | 'picture' | 'birth' | 'death' | 'union' | 'union-end';

export interface TimelineEntry {
  /** Stable across renders: the kind and what it points at. */
  id: string;
  date: string;
  kind: TimelineKind;
  /** The linked person the event belongs to. */
  person?: string;
  /** The partner in a union, when the event is one. */
  other?: string;
  unionKind?: string;
  /** Why a union ended: 'death', 'divorce' or 'other'. */
  endReason?: string;
  /** The document's id, the note's id, or the picture's key. */
  ref?: string;
  /** A document's or note's title, or a picture's caption. */
  title?: string;
}

interface TimelineFamily {
  byId: Map<string, { born?: string; died?: string }>;
  unionsOf: Map<string, { id: string; a: string; b: string; kind: string; start?: string; end?: string; endReason?: string }[]>;
}

/** Sorts a partial date by what is known: a bare year sits before the dated events of that year. */
export function dateOrder(date: string): [number, number, number] {
  const [y, m, d] = date.replace(/^~/, '').split('-').map(Number);
  return [y, m || 0, d || 0];
}

const KIND_RANK: Record<TimelineKind, number> = { birth: 0, union: 1, document: 2, note: 3, picture: 4, 'union-end': 5, death: 6 };

/**
 * A project's timeline: its dated documents, notes and pictures, and the events of its linked people (births, deaths,
 * and the unions they were part of, once each when both partners are linked), earliest first. Derived on every read,
 * so a date corrected on a person or a document moves here by itself. `view` holds only what the reader may see,
 * so a private person's events are not derived for a viewer.
 */
export function researchTimeline(view: Pick<ProjectView, 'documents' | 'notes' | 'pictures' | 'people'>, family: TimelineFamily): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const d of view.documents) if (d.date) entries.push({ id: `document:${d.id}`, date: d.date, kind: 'document', ref: d.id, title: d.title });
  for (const n of view.notes) if (n.date) entries.push({ id: `note:${n.id}`, date: n.date, kind: 'note', ref: n.id, title: n.title });
  for (const p of view.pictures) if (p.taken) entries.push({ id: `picture:${p.key}`, date: p.taken, kind: 'picture', ref: p.key, title: p.caption ?? undefined });
  const linked = new Set(view.people.map((l) => l.person));
  const unionsDone = new Set<string>();
  for (const { person } of view.people) {
    const p = family.byId.get(person);
    if (!p) continue;
    if (p.born) entries.push({ id: `birth:${person}`, date: p.born, kind: 'birth', person });
    if (p.died) entries.push({ id: `death:${person}`, date: p.died, kind: 'death', person });
    for (const u of family.unionsOf.get(person) ?? []) {
      if (unionsDone.has(u.id)) continue;
      unionsDone.add(u.id);
      const a = linked.has(u.a) ? u.a : u.b;
      const other = a === u.a ? u.b : u.a;
      if (u.start) entries.push({ id: `union:${u.id}`, date: u.start, kind: 'union', person: a, other, unionKind: u.kind });
      if (u.end) entries.push({ id: `union-end:${u.id}`, date: u.end, kind: 'union-end', person: a, other, unionKind: u.kind, endReason: u.endReason });
    }
  }
  return entries.sort((a, b) => {
    const [ay, am, ad] = dateOrder(a.date);
    const [by, bm, bd] = dateOrder(b.date);
    return ay - by || am - bm || ad - bd || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.id.localeCompare(b.id);
  });
}

/** The text key for a union's end, by why it ended: a death is not a separation. */
export const unionEndKey = (reason?: string | null) =>
  reason === 'death' ? 'research.tl_union_end_death' as const : reason === 'divorce' ? 'research.tl_union_end_divorce' as const : 'research.tl_union_end' as const;

/** A date as the reader's language says it. An approximate date carries one marker ("ca. 1931"), from formatDate. */
export const dateText = (date: string | null | undefined, locale: Parameters<typeof formatDate>[1]) => formatDate(date, locale);

// ---------- reading a document ----------

/** Where a document's file is served. `download` asks for a file to save instead of showing it. */
export const documentUrl = (tree: string, key: string, download = false) => `/api/research/${tree}/${key.replace(/^research\//, '')}${download ? '?download=1' : ''}`;

export const isPdf = (mime: string) => mime === 'application/pdf';

/** A name for a saved document: the title in safe characters, with the extension its type has. */
export function documentFileName(title: string, mime: DocumentMime): string {
  const safe = title.normalize('NFKD').replace(/[^\w .-]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${safe || 'document'}.${DOCUMENT_EXT[mime]}`;
}
