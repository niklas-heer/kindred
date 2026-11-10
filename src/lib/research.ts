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

const isWhite = (b: number | undefined) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0x0c || b === 0x00;
const isDelimiter = (b: number | undefined) => b === undefined || b <= 0x20 || '()<>[]{}/%'.includes(String.fromCharCode(b));
const isHex = (b: number) => (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66);
/** PDF names that run code, act on their own or carry files inside a document. Written as hex escapes (/J#61vaScript) they are the same name. */
const ACTIVE_NAMES = new Set(['JavaScript', 'JS', 'Launch', 'EmbeddedFile', 'EmbeddedFiles', 'RichMedia', 'AA']);
/** Filters an object stream may use and still be read here: only Flate, which DecompressionStream inflates on every runtime. */
const OTHER_FILTERS = new Set(['ASCIIHexDecode', 'AHx', 'ASCII85Decode', 'A85', 'LZWDecode', 'LZW', 'RunLengthDecode', 'RL', 'CCITTFaxDecode', 'JBIG2Decode', 'DCTDecode', 'JPXDecode', 'Crypt']);
/** At most this much inflated object-stream text per file, so a small file cannot unpack into gigabytes. */
const MAX_INFLATED_BYTES = 64_000_000;

export type PdfProblem = 'active' | 'broken';

/** Inflates a FlateDecode body; null when it is not one, or would be larger than `limit`. */
async function inflate(body: Uint8Array, limit: number): Promise<Uint8Array | null> {
  try {
    const reader = new Blob([body as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  } catch {
    return null;
  }
}

/**
 * Whether a PDF names active content ('active'), or cannot be read far enough to tell ('broken'); null when it is clean.
 * A small lexer, enough to agree with a PDF reader about what is an object and what is not:
 *   - a comment (% to the end of the line) and a string ((…) with its nesting and escapes, <hex>) are not objects, so a
 *     `stream` written in either starts nothing; names inside them are still checked, which can only refuse more.
 *   - a stream body is skipped (it is compressed bytes, and a chance /JS in it would refuse a good scan), but only when
 *     `stream` follows a dictionary's `>>` and ends where a reader ends it. A stream that never ends is refused.
 *   - an object stream (/Type /ObjStm, how PDF 1.5 and later pack their objects) is inflated and its objects are checked
 *     the same way. One that is not Flate, or does not inflate, is refused: it would hide what it holds.
 *   - /OpenAction with a page to open at ([…]) is ordinary; any other /OpenAction is an action, and refused.
 * A first filter, not a proof: what really keeps a file harmless is how the route serves it (src/routes/api/research.$tree.$key.ts).
 */
export async function pdfContentProblem(bytes: Uint8Array): Promise<PdfProblem | null> {
  // A document with usage restrictions is encrypted, its packed objects included, so they cannot be inflated here.
  const budget = { inflated: 0, encrypted: indexOfWord(bytes, '/Encrypt', 0) !== -1 };
  return scanPdf(bytes, budget, false);
}

async function scanPdf(bytes: Uint8Array, budget: { inflated: number; encrypted: boolean }, inObjectStream: boolean): Promise<PdfProblem | null> {
  // The last two significant bytes outside comments and strings: `stream` starts a body only right after `>>`.
  let prev1 = 0;
  let prev2 = 0;
  // The names of the current object's dictionary (since the last `obj`), and its direct /Length, to know what a stream is.
  let names: string[] = [];
  let length: number | null = null;
  let afterLength = false;
  const note = (b: number) => { prev2 = prev1; prev1 = b; };

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (isWhite(b)) continue;
    if (b === 0x25 /* % */) {
      // A comment runs to the end of the line. Its names are checked anyway; nothing in it starts a string or a stream.
      let j = i + 1;
      while (j < bytes.length && bytes[j] !== 0x0a && bytes[j] !== 0x0d) j++;
      if (activeName(bytes, i + 1, j)) return 'active';
      i = j;
      continue;
    }
    if (b === 0x28 /* ( */) {
      let depth = 1;
      let j = i + 1;
      for (; j < bytes.length && depth > 0; j++) {
        if (bytes[j] === 0x5c /* \ */) j++;
        else if (bytes[j] === 0x28) depth++;
        else if (bytes[j] === 0x29) depth--;
      }
      if (depth > 0) return 'broken';
      if (activeName(bytes, i + 1, j - 1)) return 'active';
      i = j - 1;
      note(0x29);
      afterLength = false;
      continue;
    }
    if (b === 0x3c /* < */ && bytes[i + 1] !== 0x3c) {
      // A hex string, when it is one: only hex digits and white space up to `>`. Anything else is read on as it comes.
      let j = i + 1;
      while (j < bytes.length && (isHex(bytes[j]) || isWhite(bytes[j]))) j++;
      if (bytes[j] === 0x3e) {
        i = j;
        note(0x29);
        continue;
      }
    }
    if (b === 0x2f /* / */) {
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
      if (ACTIVE_NAMES.has(name)) return 'active';
      if (name === 'OpenAction') {
        let k = j;
        while (k < bytes.length && isWhite(bytes[k])) k++;
        // A page to open at, written here or as a reference to it ("6 0 R"), is harmless. The object a reference
        // points to is scanned like every other, so a script or a launch there is still refused by its own name.
        if (bytes[k] !== 0x5b /* [ */ && !/^\d{1,10}\s+\d{1,5}\s+R(?![A-Za-z0-9])/.test(ascii(bytes, k, Math.min(bytes.length, k + 24)))) return 'active';
      }
      names.push(name);
      afterLength = name === 'Length';
      i = j - 1;
      note(0x2f);
      continue;
    }
    if (isDelimiter(b)) {
      note(b);
      afterLength = false;
      continue;
    }
    // A regular word: a number, `obj`, `stream`, `R`, `true`…
    let j = i;
    while (j < bytes.length && !isDelimiter(bytes[j])) j++;
    const word = ascii(bytes, i, j);
    if (word === 'obj') {
      names = [];
      length = null;
    } else if (afterLength && /^\d+$/.test(word)) {
      length = Number(word);
      // `/Length 5 0 R` names another object, not a length: the next word being a number says so.
      let k = j;
      while (k < bytes.length && isWhite(bytes[k])) k++;
      if (bytes[k] >= 0x30 && bytes[k] <= 0x39) length = null;
    } else if (word === 'stream' && prev1 === 0x3e && prev2 === 0x3e) {
      // The body starts after the end of this line.
      let from = j;
      if (bytes[from] === 0x0d) from++;
      if (bytes[from] === 0x0a) from++;
      const found = indexOfWord(bytes, 'endstream', from);
      if (found === -1) return 'broken';
      // A reader ends the body at its /Length when `endstream` is there; else at the first `endstream`. Take whichever is
      // earlier, so a wrong /Length can never hide more than a reader would see as the body.
      let to = found;
      if (length !== null && from + length <= found) {
        let k = from + length;
        while (k < bytes.length && isWhite(bytes[k])) k++;
        if (k === found) to = from + length;
      }
      if (to === found) while (to > from && (bytes[to - 1] === 0x0a || bytes[to - 1] === 0x0d)) to--;
      if (names.includes('ObjStm')) {
        if (inObjectStream) return 'broken';
        if (names.includes('DecodeParms') || names.some((n) => OTHER_FILTERS.has(n))) return 'broken';
        const body = bytes.subarray(from, to);
        const inner = names.includes('FlateDecode') || names.includes('Fl') ? await inflate(body, MAX_INFLATED_BYTES - budget.inflated) : body;
        // What cannot be inflated in an encrypted document is its cipher text, not damage: such a file is kept, and
        // served as every research file is, as a download no page can run. One that does inflate is read as usual,
        // so naming /Encrypt in a plain file hides nothing.
        if (!inner && !budget.encrypted) return 'broken';
        if (inner) {
          budget.inflated += inner.length;
          const problem = await scanPdf(inner, budget, true);
          if (problem) return problem;
        }
      }
      i = found + 8;
      names = [];
      length = null;
      note(0x6d /* the m of endstream */);
      afterLength = false;
      continue;
    }
    if (!/^[-+.\d]+$/.test(word)) afterLength = false;
    i = j - 1;
    note(bytes[j - 1]);
  }
  return null;
}

/** Whether a name in `bytes[from, to)` is an active one, for text that is not an object (a comment, a string). */
function activeName(bytes: Uint8Array, from: number, to: number): boolean {
  for (let i = bytes.indexOf(0x2f, from); i !== -1 && i < to; i = bytes.indexOf(0x2f, i + 1)) {
    let name = '';
    for (let j = i + 1; j < to && name.length < 40 && !isDelimiter(bytes[j]); j++) {
      if (bytes[j] === 0x23 && j + 2 < to) {
        const hex = Number.parseInt(ascii(bytes, j + 1, j + 3), 16);
        if (!Number.isNaN(hex)) { name += String.fromCharCode(hex); j += 2; continue; }
      }
      name += String.fromCharCode(bytes[j]);
    }
    if (ACTIVE_NAMES.has(name) || name === 'OpenAction') return true;
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
export async function checkDocument(bytes: Uint8Array, declared: string): Promise<{ mime: DocumentMime } | { refused: DocumentRefusal }> {
  if (bytes.length === 0) return { refused: 'research.err.file_empty' };
  if (bytes.length > MAX_DOCUMENT_BYTES) return { refused: 'research.err.file_large' };
  const mime = sniffDocument(bytes);
  if (!mime || (declared && declared !== mime)) return { refused: 'research.err.file_type' };
  if (mime === 'application/pdf') {
    if (!pdfEndsLikeOne(bytes)) return { refused: 'research.err.pdf_broken' };
    const problem = await pdfContentProblem(bytes);
    if (problem) return { refused: problem === 'active' ? 'research.err.pdf_active' : 'research.err.pdf_broken' };
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
